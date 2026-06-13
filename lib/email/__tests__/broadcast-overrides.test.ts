import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { resolveSegmentId, resolveSender, resolveReplyTo } from "../broadcast-overrides.ts";

// Unit B — multi-tenant broadcast overrides. The broadcast route must stay
// byte-for-byte unchanged when no overrides are sent (the live SWFL digest),
// and target a per-tenant segment/sender when they are. These pure resolvers
// hold that logic so it's deterministically testable without Resend.

describe("resolveSegmentId", () => {
  test("uses the per-tenant override when provided", () => {
    assert.equal(
      resolveSegmentId("seg_tenant", () => "seg_digest"),
      "seg_tenant",
    );
  });

  test("does NOT call the digest default when an override is given", () => {
    // A tenant send must work even if RESEND_DIGEST_SEGMENT_ID is unset — the
    // default thunk throws exactly like getDigestSegmentId() does, proving the
    // override path never touches it.
    const throwingDefault = (): string => {
      throw new Error("getDigestSegmentId called");
    };
    assert.equal(resolveSegmentId("seg_tenant", throwingDefault), "seg_tenant");
  });

  test("falls back to the digest default when no override", () => {
    assert.equal(
      resolveSegmentId(undefined, () => "seg_digest"),
      "seg_digest",
    );
  });

  test("treats blank / non-string overrides as absent", () => {
    assert.equal(
      resolveSegmentId("   ", () => "seg_digest"),
      "seg_digest",
    );
    assert.equal(
      resolveSegmentId(42, () => "seg_digest"),
      "seg_digest",
    );
  });
});

describe("resolveSender", () => {
  // The digest env defaults are DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS —
  // never RESEND_FROM_EMAIL (plan landmine #1). The route wires those env reads
  // into `defaults`; this models them.
  const env = { name: "SWFL Data Gulf", address: "digest@swfldatagulf.com" };

  test("no overrides → digest env sender unchanged (backward compatible)", () => {
    assert.deepEqual(resolveSender({}, env), {
      name: "SWFL Data Gulf",
      address: "digest@swfldatagulf.com",
    });
  });

  test("both overrides → per-tenant sender", () => {
    assert.deepEqual(resolveSender({ fromName: "Acme", fromEmail: "news@acme.com" }, env), {
      name: "Acme",
      address: "news@acme.com",
    });
  });

  test("partial override → email from tenant, name from digest env", () => {
    assert.deepEqual(resolveSender({ fromEmail: "news@acme.com" }, env), {
      name: "SWFL Data Gulf",
      address: "news@acme.com",
    });
  });

  test("blank / non-string overrides fall back to env defaults", () => {
    assert.deepEqual(resolveSender({ fromName: "  ", fromEmail: "" }, env), env);
    assert.deepEqual(resolveSender({ fromName: 7, fromEmail: null }, env), env);
  });

  test("missing env and no override → null (route returns sender_not_configured)", () => {
    assert.equal(resolveSender({}, {}), null);
    assert.equal(resolveSender({ fromName: "Acme" }, {}), null); // address still missing
  });
});

describe("resolveReplyTo", () => {
  // No env default — a digest send has no reply-to. Absent/blank/non-string →
  // undefined so the route omits the SDK `replyTo` field (backward compatible).
  test("a tenant reply-to passes through, trimmed", () => {
    assert.equal(resolveReplyTo("  hi@acme.com "), "hi@acme.com");
  });

  test("absent / blank / non-string → undefined (field omitted)", () => {
    assert.equal(resolveReplyTo(undefined), undefined);
    assert.equal(resolveReplyTo("   "), undefined);
    assert.equal(resolveReplyTo(42), undefined);
    assert.equal(resolveReplyTo(null), undefined);
  });
});
