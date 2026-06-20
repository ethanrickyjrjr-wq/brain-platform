import { describe, expect, it } from "bun:test";
import { isSafeReturnPath } from "./safe-return";

describe("isSafeReturnPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeReturnPath("/")).toBe(true);
    expect(isSafeReturnPath("/project/42")).toBe(true);
    expect(isSafeReturnPath("/a?b=c#d")).toBe(true);
  });

  it("rejects every open-redirect vector", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false); // protocol-relative
    expect(isSafeReturnPath("https://evil.com")).toBe(false); // absolute
    expect(isSafeReturnPath("/\\evil.com")).toBe(false); // backslash → parsed as /
    expect(isSafeReturnPath("\\\\evil.com")).toBe(false);
    expect(isSafeReturnPath("evil")).toBe(false); // not rooted
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(42)).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
  });
});
