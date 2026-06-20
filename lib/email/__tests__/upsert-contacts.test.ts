import { describe, test, expect } from "bun:test";
import type { ContactRow } from "../parse-contacts-csv";
import { prepareContacts, mergeContact } from "../upsert-contacts";

describe("mergeContact (pure)", () => {
  test("incoming null name preserves the existing name (audit MEDIUM bugfix)", () => {
    const merged = mergeContact(
      { name: "Jane Buyer", tags: ["buyers"] },
      { name: null, tags: ["vip"] },
    );
    expect(merged.name).toBe("Jane Buyer");
    expect(merged.tags.sort()).toEqual(["buyers", "vip"]);
  });

  test("incoming non-null name wins; tags unioned + deduped", () => {
    const merged = mergeContact(
      { name: "Old", tags: ["a", "b"] },
      { name: "New", tags: ["b", "c"] },
    );
    expect(merged.name).toBe("New");
    expect(merged.tags.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("prepareContacts (pure)", () => {
  const userId = "user-1";

  test("normalizes email case + drops invalid, counting them as skipped", () => {
    const rows: ContactRow[] = [
      { email: "JANE@Example.com", name: "Jane", tags: ["x"] },
      { email: "not-an-email", name: "Bad", tags: [] },
      { email: "", name: "Blank", tags: [] },
    ];
    const { records, skipped, errors } = prepareContacts(userId, rows);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      user_id: userId,
      email: "jane@example.com",
      name: "Jane",
      tags: ["x"],
    });
    expect(skipped).toBe(2);
    expect(errors).toHaveLength(2);
  });

  test("de-dupes within the batch: tags union, a later name does not erase an earlier one", () => {
    const rows: ContactRow[] = [
      { email: "dup@acme.com", name: "Real Name", tags: ["buyers"] },
      { email: "DUP@acme.com", name: null, tags: ["vip"] }, // tags-only re-list
    ];
    const { records } = prepareContacts(userId, rows);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("Real Name");
    expect(records[0].tags.sort()).toEqual(["buyers", "vip"]);
  });

  test("every record carries the passed user_id", () => {
    const { records } = prepareContacts("abc", [{ email: "a@b.com", name: null, tags: [] }]);
    expect(records[0].user_id).toBe("abc");
  });
});
