import { describe, test, expect, beforeAll } from "bun:test";
import {
  issueContactImportToken,
  verifyContactImportToken,
} from "../contact-import-token";

beforeAll(() => {
  process.env.SDG_COOKIE_SECRET = "test-secret-for-contact-import-token";
});

describe("contact-import-token", () => {
  test("round-trip recovers uid + workOnly", () => {
    const token = issueContactImportToken({ uid: "user-9", workOnly: true })!;
    expect(token).toBeTruthy();
    const v = verifyContactImportToken(token);
    expect(v).toEqual({ ok: true, uid: "user-9", workOnly: true });
  });

  test("workOnly false is preserved", () => {
    const token = issueContactImportToken({ uid: "u", workOnly: false })!;
    const v = verifyContactImportToken(token);
    expect(v.ok && v.workOnly).toBe(false);
  });

  test("a tampered payload fails the signature check", () => {
    const token = issueContactImportToken({ uid: "u", workOnly: false })!;
    const [, sig] = token.split(".");
    // Swap the payload for a forged one (different uid) but keep the old signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 1, uid: "attacker", wo: 1, iat: Date.now() }),
    ).toString("base64url");
    const v = verifyContactImportToken(`${forgedPayload}.${sig}`);
    expect(v).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("an expired token is rejected", () => {
    const old = Date.now() - 11 * 60 * 1000; // TTL is 10 min
    const token = issueContactImportToken({ uid: "u", workOnly: false, nowMs: old })!;
    const v = verifyContactImportToken(token);
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  test("garbage is malformed, not a crash", () => {
    expect(verifyContactImportToken("not-a-token").ok).toBe(false);
    expect(verifyContactImportToken("").ok).toBe(false);
  });

  test("no signing secret → issue null, verify missing_secret", () => {
    const saved = process.env.SDG_COOKIE_SECRET;
    delete process.env.SDG_COOKIE_SECRET;
    try {
      expect(issueContactImportToken({ uid: "u", workOnly: false })).toBeNull();
      expect(verifyContactImportToken("x.y")).toEqual({ ok: false, reason: "missing_secret" });
    } finally {
      process.env.SDG_COOKIE_SECRET = saved;
    }
  });
});
