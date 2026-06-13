import { describe, test, beforeEach, afterEach } from "bun:test";
import assert from "node:assert/strict";
import { issueProposalNonce, verifyProposalNonce } from "../proposal-nonce.ts";

const SECRET = "test-cookie-secret-please-ignore";
const PROPOSAL = {
  action: "create",
  cadence: "weekly",
  day_of_week: 2,
  send_hour_et: 7,
  audience_slug: "newsletter",
};
const CTX = { uid: "user-1", pid: "proj-1", proposal: PROPOSAL };

let prevSecret: string | undefined;
beforeEach(() => {
  prevSecret = process.env.SDG_COOKIE_SECRET;
  process.env.SDG_COOKIE_SECRET = SECRET;
});
afterEach(() => {
  if (prevSecret === undefined) delete process.env.SDG_COOKIE_SECRET;
  else process.env.SDG_COOKIE_SECRET = prevSecret;
});

describe("proposal nonce", () => {
  test("issue → verify round-trips and returns the nid", () => {
    const token = issueProposalNonce(CTX);
    assert.ok(token, "a token was issued");
    const r = verifyProposalNonce(token!, CTX);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(typeof r.nid, "string");
  });

  test("proposal-hash is key-order independent (canonical form)", () => {
    const token = issueProposalNonce(CTX)!;
    // same fields, different key order → still verifies
    const reordered = {
      send_hour_et: 7,
      audience_slug: "newsletter",
      cadence: "weekly",
      action: "create",
      day_of_week: 2,
    };
    const r = verifyProposalNonce(token, { ...CTX, proposal: reordered });
    assert.equal(r.ok, true);
  });

  test("a SWAPPED proposal under a valid signature is rejected", () => {
    const token = issueProposalNonce(CTX)!;
    const r = verifyProposalNonce(token, {
      ...CTX,
      proposal: { ...PROPOSAL, audience_slug: "vip" }, // attacker swaps the audience
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "proposal_mismatch");
  });

  test("wrong user / wrong project are rejected", () => {
    const token = issueProposalNonce(CTX)!;
    const ru = verifyProposalNonce(token, { ...CTX, uid: "user-2" });
    assert.equal(ru.ok, false);
    if (!ru.ok) assert.equal(ru.reason, "uid_mismatch");
    const rp = verifyProposalNonce(token, { ...CTX, pid: "proj-2" });
    assert.equal(rp.ok, false);
    if (!rp.ok) assert.equal(rp.reason, "pid_mismatch");
  });

  test("expired (issued > TTL ago) is rejected", () => {
    const token = issueProposalNonce({ ...CTX, nowMs: 1_000_000 })!;
    const r = verifyProposalNonce(token, { ...CTX, nowMs: 1_000_000 + 16 * 60 * 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "expired");
  });

  test("a tampered signature is rejected (bad_signature, not a crash)", () => {
    const token = issueProposalNonce(CTX)!;
    const dot = token.lastIndexOf(".");
    assert.ok(dot > 0);
    // Corrupt the signature by flipping an actual DIGEST byte, then re-encoding —
    // NOT by flipping the final base64url char. A 32-byte HMAC encodes to 43
    // base64url chars whose LAST char carries only 4 meaningful bits (the low 2
    // are padding that decode must ignore), so e.g. 'A'(000000) <-> 'B'(000001)
    // decode to the SAME 32 bytes and the "tampered" token would still verify.
    // That made the old char-flip flake ~1/16 (measured 6.5%) and randomly redden
    // CI regardless of the diff (incident 2026-06-13). Flipping a decoded byte
    // changes the digest deterministically: integrity must always fail.
    const sig = Buffer.from(token.slice(dot + 1), "base64url");
    assert.equal(sig.length, 32, "HMAC-SHA256 digest is 32 bytes");
    sig[0] ^= 0xff;
    const tampered = `${token.slice(0, dot + 1)}${sig.toString("base64url")}`;
    assert.notEqual(tampered, token);
    const r = verifyProposalNonce(tampered, CTX);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "bad_signature");
  });

  test("a wrong-length signature is rejected without throwing (timingSafeEqual guard)", () => {
    const token = issueProposalNonce(CTX)!;
    const payloadB64 = token.slice(0, token.lastIndexOf("."));
    const r = verifyProposalNonce(`${payloadB64}.deadbeef`, CTX); // short sig
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "bad_signature");
  });

  test("malformed token (no separator) → malformed", () => {
    const r = verifyProposalNonce("not-a-token", CTX);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "malformed");
  });

  test("no secret configured → issue returns null, verify reports missing_secret", () => {
    delete process.env.SDG_COOKIE_SECRET;
    assert.equal(issueProposalNonce(CTX), null);
    const r = verifyProposalNonce("anything.here", CTX);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing_secret");
  });
});
