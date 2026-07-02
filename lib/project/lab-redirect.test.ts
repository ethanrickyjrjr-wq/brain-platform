// lib/project/lab-redirect.test.ts
import { describe, expect, test } from "bun:test";
import { labDestination } from "./lab-redirect";

describe("labDestination (signed-in standalone-lab redirect chooser)", () => {
  test("most recent project wins (input is already updated_at-desc)", () => {
    expect(labDestination([{ id: "recent" }, { id: "older" }])).toBe("/project/recent/email-lab");
  });
  test("zero projects → null (caller auto-creates via POST /api/projects)", () => {
    expect(labDestination([])).toBeNull();
  });
});
