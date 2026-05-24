import { test } from "bun:test";
import assert from "node:assert/strict";

import { BRAIN_CATALOG } from "./catalog.mts";
import { PER_PACK_REGISTRY } from "./index.mts";

test("BRAIN_CATALOG: every catalog id exists in PER_PACK_REGISTRY", () => {
  for (const entry of BRAIN_CATALOG) {
    assert.ok(
      Object.hasOwn(PER_PACK_REGISTRY, entry.id),
      `catalog has "${entry.id}" but PER_PACK_REGISTRY does not — remove from catalog or restore the pack`,
    );
  }
});

test("BRAIN_CATALOG: every PER_PACK_REGISTRY id exists in catalog", () => {
  const catalogIds = new Set(BRAIN_CATALOG.map((e) => e.id));
  for (const id of Object.keys(PER_PACK_REGISTRY)) {
    assert.ok(
      catalogIds.has(id),
      `PER_PACK_REGISTRY has "${id}" but catalog.mts does not — add an entry to BRAIN_CATALOG`,
    );
  }
});

test("BRAIN_CATALOG: domain/scope/ttl_seconds match the pack definition", () => {
  for (const entry of BRAIN_CATALOG) {
    const pack = PER_PACK_REGISTRY[entry.id];
    assert.equal(
      entry.domain,
      pack.domain,
      `catalog "${entry.id}".domain mismatch: ${entry.domain} vs pack ${pack.domain}`,
    );
    assert.equal(
      entry.scope,
      pack.scope,
      `catalog "${entry.id}".scope drifted from pack scope`,
    );
    assert.equal(
      entry.ttl_seconds,
      pack.ttl_seconds,
      `catalog "${entry.id}".ttl_seconds mismatch: ${entry.ttl_seconds} vs pack ${pack.ttl_seconds}`,
    );
  }
});

test("BRAIN_CATALOG: ids are unique", () => {
  const seen = new Set<string>();
  for (const entry of BRAIN_CATALOG) {
    assert.ok(!seen.has(entry.id), `catalog has duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
});
