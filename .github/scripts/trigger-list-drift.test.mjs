// Drift guard: the heal workflow must watch EXACTLY the logger's watched set,
// MINUS "Daily Brain Rebuild" (intentionally excluded — it owns
// refinery/lib/master-freeze-watchdog.mts and the vocab pre-push gate, and must
// never be auto-healed). The two trigger lists are SUPPOSED to differ by exactly
// that one entry.
//
// This catches the real future-drift failure mode: a new pipeline added to one
// trigger list but not the other (a healer that silently stops watching a cron,
// or a logger that stops recording one). It turns silent drift into a loud CI
// failure — same philosophy as the vocab-slug smoke test.
//
// Run: node --test .github/scripts/trigger-list-drift.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WF = (name) => resolve(HERE, "../workflows", name);

// Extract the `on.workflow_run.workflows:` string list from a workflow YAML
// WITHOUT a YAML dependency (no new lockfile entry — CLAUDE.md RULE 1 breaker #1).
// The block is a run of `  - "..."` lines immediately after the `workflows:` key,
// terminated by the next non-list line (`types:`).
function extractWorkflowList(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*workflows:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*"(.+)"\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

const heal = extractWorkflowList(readFileSync(WF("heal-cron-failure.yml"), "utf8"));
const log = extractWorkflowList(readFileSync(WF("log-cron-incident.yml"), "utf8"));

const EXCLUDED = "Daily Brain Rebuild";

test("trigger lists parsed (guard against a silent empty-list false pass)", () => {
  assert.ok(heal.length > 5, `heal watched set looks empty/unparsed: ${heal.length}`);
  assert.ok(log.length > 5, `log watched set looks empty/unparsed: ${log.length}`);
});

test(`logger watches "${EXCLUDED}"; healer does NOT (intentional exclusion)`, () => {
  assert.ok(log.includes(EXCLUDED), `logger must watch "${EXCLUDED}"`);
  assert.ok(
    !heal.includes(EXCLUDED),
    `healer must NOT watch "${EXCLUDED}" (it owns master-freeze-watchdog)`,
  );
});

test("heal watched set === logger watched set minus the one intentional exclusion", () => {
  const expected = log.filter((w) => w !== EXCLUDED);
  assert.deepEqual(
    [...heal].sort(),
    [...expected].sort(),
    "Trigger lists drifted: a workflow was added to one of heal-cron-failure.yml / " +
      "log-cron-incident.yml but not the other. Reconcile them (the only allowed " +
      'difference is "' +
      EXCLUDED +
      '", which the logger watches and the healer skips).',
  );
});
