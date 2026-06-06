// refinery/lib/master-frontmatter.test.mts
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readMasterFrontmatter } from "./master-frontmatter.mts";

async function tmpMaster(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "master-fm-"));
  const p = path.join(dir, "master.md");
  await writeFile(p, body, "utf-8");
  return p;
}

const VALID = [
  "---",
  "brain_id: master",
  "version: 5",
  "refined_at: 2026-06-01T00:00:00Z",
  "ttl_seconds: 604800",
  "---",
  "",
  "body",
  "",
].join("\n");

test("file missing (ENOENT) → returns null", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "master-fm-"));
  const result = await readMasterFrontmatter(path.join(dir, "nope.md"));
  assert.equal(result, null);
});

test("valid frontmatter → returns refinedAt + parsed ttlSeconds", async () => {
  const result = await readMasterFrontmatter(await tmpMaster(VALID));
  assert.deepEqual(result, {
    refinedAt: "2026-06-01T00:00:00Z",
    ttlSeconds: 604800,
  });
});

test("valid frontmatter with custom ttl → returns parsed ttlSeconds", async () => {
  const body = VALID.replace("ttl_seconds: 604800", "ttl_seconds: 1234");
  const result = await readMasterFrontmatter(await tmpMaster(body));
  assert.equal(result?.ttlSeconds, 1234);
});

test("valid frontmatter with no ttl_seconds → falls back to MASTER_TTL_FALLBACK_SECONDS (604800)", async () => {
  const body = VALID.replace("ttl_seconds: 604800\n", "");
  const result = await readMasterFrontmatter(await tmpMaster(body));
  assert.equal(result?.ttlSeconds, 604800);
  assert.equal(result?.refinedAt, "2026-06-01T00:00:00Z");
});

test("malformed frontmatter (no closing fence) → throws", async () => {
  const body =
    "---\nbrain_id: master\nrefined_at: 2026-06-01T00:00:00Z\n\nbody\n";
  const p = await tmpMaster(body);
  await assert.rejects(
    () => readMasterFrontmatter(p),
    /frontmatter|unparseable/i,
  );
});

test("frontmatter present but no refined_at key → throws", async () => {
  const body = "---\nbrain_id: master\nttl_seconds: 604800\n---\n\nbody\n";
  const p = await tmpMaster(body);
  await assert.rejects(() => readMasterFrontmatter(p), /refined_at|missing/i);
});

test("non-ENOENT I/O error (path is a directory) → re-throws the original fs error", async () => {
  // Reading a directory as a file yields EISDIR — must propagate, never be
  // silently masked as null/"missing" the way the old broad catch {} did.
  const dir = await mkdtemp(path.join(os.tmpdir(), "master-fm-"));
  await assert.rejects(
    () => readMasterFrontmatter(dir),
    (err: NodeJS.ErrnoException) => {
      assert.ok(
        err.code && err.code !== "ENOENT",
        `expected a non-ENOENT fs error, got code=${err.code}`,
      );
      return true;
    },
  );
});
