import { describe, test, expect } from "bun:test";
import { getMaterialStatus, getFormatBadge } from "./material-status";

const fresh = { deleted_at: null, data_as_of: new Date().toISOString() };

describe("getMaterialStatus", () => {
  test("archived when deleted_at set", () => {
    expect(getMaterialStatus({ ...fresh, deleted_at: "2026-01-01" })).toBe("archived");
  });
  test("needs_update when data_as_of > 30 days", () => {
    const old = new Date();
    old.setDate(old.getDate() - 31);
    expect(getMaterialStatus({ ...fresh, data_as_of: old.toISOString() })).toBe("needs_update");
  });
  test("archived beats needs_update", () => {
    const old = new Date();
    old.setDate(old.getDate() - 31);
    expect(getMaterialStatus({ deleted_at: "2026-01-01", data_as_of: old.toISOString() })).toBe(
      "archived",
    );
  });
  test("draft when fresh", () => {
    expect(getMaterialStatus(fresh)).toBe("draft");
  });
  test("draft when data_as_of null (report templates)", () => {
    expect(getMaterialStatus({ deleted_at: null, data_as_of: null })).toBe("draft");
  });
});

describe("getFormatBadge", () => {
  test("block-canvas → email / teal", () => {
    expect(getFormatBadge("block-canvas")).toMatchObject({ label: "email", color: "#1BB8C9" });
  });
  test("market-overview → overview", () => {
    expect(getFormatBadge("market-overview").label).toBe("overview");
  });
  test("bov-lite → BOV / rose", () => {
    expect(getFormatBadge("bov-lite").color).toBe("#f43f5e");
  });
  test("unknown → passthrough label, white", () => {
    expect(getFormatBadge("mystery")).toMatchObject({ label: "mystery", color: "#ffffff" });
  });
});
