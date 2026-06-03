#!/usr/bin/env node
// check.mjs — the UPDATE beat of the session loop (Check → Submit → Update).
//
// Open obligations live in the Supabase `checks` table — the same table the
// SessionStart kickoff (scripts/session-kickoff.mjs) prints. This helper makes
// reconciling that table a one-liner so the next session's CHECK is true:
//
//   node scripts/check.mjs list
//   node scripts/check.mjs open <project> <check_key> "<label>" [--detail "..."] [--due YYYY-MM-DD] [--resolution manual] [--priority N]
//   node scripts/check.mjs update <check_key|id> [--detail "..."] [--due YYYY-MM-DD] [--priority N] [--label "..."]
//   node scripts/check.mjs close <check_key|id> [note]
//
// `open` creates only — it fails loud (exit 1) if the key already exists, so a
// no-op can never masquerade as success. Revise metadata with `update`
// (state-preserving); change state with `close`.
//
// `check_key` is the stable handle you close on later (e.g. surface_parent_links).
// Credentials come from .dlt/secrets.toml (gitignored), never printed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const SECRETS_PATH = resolve(ROOT, ".dlt/secrets.toml");

/** Parse a double-quoted TOML scalar by key, line-by-line (tolerant of CRLF). */
function tomlStr(toml, key) {
  for (const line of toml.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`));
    if (m) return m[1];
  }
  return null;
}

// Sentinel so fail() can halt execution like a throw (callers rely on it never
// returning) while letting the top-level catch print nothing extra.
class CheckFail extends Error {}

// Loud, non-zero, but DON'T force process.exit(): calling it synchronously while
// an undici fetch handle is mid-close trips a libuv assertion on Windows (exit
// 127, not 1). Setting exitCode + throwing lets node tear down cleanly — the
// success paths already exit promptly, so the open sockets are unref'd.
function fail(msg) {
  console.error(`check: ${msg}`);
  process.exitCode = 1;
  throw new CheckFail(msg);
}

function creds() {
  let toml;
  try {
    toml = readFileSync(SECRETS_PATH, "utf8");
  } catch {
    fail(`could not read ${SECRETS_PATH}`);
  }
  const url =
    tomlStr(toml, "SUPABASE_URL") ?? tomlStr(toml, "BRAINS_SUPABASE_URL");
  const key =
    tomlStr(toml, "SUPABASE_SERVICE_KEY") ??
    tomlStr(toml, "BRAINS_SUPABASE_SERVICE_KEY");
  if (!url || !key)
    fail("SUPABASE_URL / SUPABASE_SERVICE_KEY not found in secrets");
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(path, init = {}) {
  const { url, key } = creds();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) fail(`Supabase ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function fmtDate(iso) {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/** Split argv into positionals + a flag map (flags take the next token as value). */
function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) flags[a.slice(2)] = args[++i] ?? true;
    else positionals.push(a);
  }
  return { positionals, flags };
}

async function list() {
  const rows = await rest(
    "checks?state=eq.open&order=due_at.asc.nullslast&select=*",
  );
  if (!rows.length) {
    console.log("none open ✓");
    return;
  }
  for (const r of rows) {
    const due = r.due_at ? ` (due ${fmtDate(r.due_at)})` : "";
    console.log(`  ${r.check_key}  ·  ${r.label}${due}  [${r.project}]`);
  }
}

async function open(args) {
  const { positionals, flags } = parseArgs(args);
  const [project, checkKey, label] = positionals;
  if (!project || !checkKey || !label)
    fail(
      'open: need <project> <check_key> "<label>" — e.g. open surface surface_parent_links "Wire corridor links"',
    );
  // Idempotent on the stable check_key.
  const existing = await rest(
    `checks?check_key=eq.${encodeURIComponent(checkKey)}&select=check_key,state,label`,
  );
  if (existing.length) {
    // Loud, non-zero: a no-op must never masquerade as success. `open` only
    // creates — to revise an existing check's metadata use `update`, to change
    // its state use `close`.
    fail(
      `already exists (${existing[0].state}): ${checkKey} — ${existing[0].label}. ` +
        `open creates only; use \`update ${checkKey} [--detail …]\` to revise, or \`close\` to change state.`,
    );
  }
  const row = {
    project,
    check_key: checkKey,
    label,
    state: "open",
    resolution: flags.resolution ?? "manual",
    priority: flags.priority ? Number(flags.priority) : 0,
  };
  if (flags.detail) row.detail = flags.detail;
  if (flags.due) row.due_at = flags.due;
  await rest("checks", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  console.log(`opened: ${checkKey} — ${label}`);
}

async function close(args) {
  const { positionals, flags } = parseArgs(args);
  const [handle, ...noteParts] = positionals;
  if (!handle)
    fail(
      "close: need a check_key or id — close <check_key|id> [note] [--drop]",
    );
  const note = noteParts.join(" ") || null;
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      handle,
    );
  const col = isUuid ? "id" : "check_key";
  // state IN ('open','done','dropped'). --drop = abandoned (note → drop_reason);
  // otherwise the obligation was met (note → resolved_by, defaults to 'session').
  const dropped = Boolean(flags.drop);
  const patch = {
    state: dropped ? "dropped" : "done",
    resolved_at: new Date().toISOString(),
    resolved_by: dropped ? "session" : (note ?? "session"),
  };
  if (dropped && note) patch.drop_reason = note;
  const updated = await rest(`checks?${col}=eq.${encodeURIComponent(handle)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const arr = Array.isArray(updated) ? updated : [updated];
  if (!arr.length) fail(`no check matched ${col}=${handle}`);
  console.log(`closed: ${handle} — ${arr[0]?.label ?? ""}`.trim());
}

async function update(args) {
  const { positionals, flags } = parseArgs(args);
  const [handle] = positionals;
  if (!handle)
    fail(
      'update: need a check_key or id — update <check_key|id> [--detail "..."] [--due YYYY-MM-DD] [--priority N]',
    );
  // Metadata-only: PATCH the named fields, leave `state` untouched (that's
  // `close`'s job). At least one field is required so a no-op can't pass.
  const patch = {};
  if (flags.detail != null) patch.detail = flags.detail;
  if (flags.due != null) patch.due_at = flags.due;
  if (flags.priority != null) patch.priority = Number(flags.priority);
  if (flags.label != null) patch.label = flags.label;
  if (!Object.keys(patch).length)
    fail(
      "update: nothing to change — pass --detail / --due / --priority / --label",
    );
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      handle,
    );
  const col = isUuid ? "id" : "check_key";
  const updated = await rest(`checks?${col}=eq.${encodeURIComponent(handle)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const arr = Array.isArray(updated) ? updated : [updated];
  if (!arr.length) fail(`no check matched ${col}=${handle}`);
  console.log(
    `updated: ${handle} — ${Object.keys(patch).join(", ")} [${arr[0]?.state}]`,
  );
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case "list":
      await list();
      break;
    case "open":
      await open(args);
      break;
    case "close":
      await close(args);
      break;
    case "update":
      await update(args);
      break;
    default:
      console.log(
        'usage:\n  check.mjs list\n  check.mjs open <project> <check_key> "<label>" [--detail "..."] [--due YYYY-MM-DD] [--resolution manual] [--priority N]\n  check.mjs update <check_key|id> [--detail "..."] [--due YYYY-MM-DD] [--priority N] [--label "..."]\n  check.mjs close <check_key|id> [note] [--drop]',
      );
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  // CheckFail already printed its message + set exitCode; anything else is a
  // real crash worth surfacing.
  if (!(e instanceof CheckFail)) {
    console.error(e);
    process.exitCode = 1;
  }
}
