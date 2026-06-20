import { describe, test, expect } from "bun:test";
import { peopleConnectionsToContactRows, type GooglePerson } from "../google-people";

describe("peopleConnectionsToContactRows", () => {
  test("one row per email; the display name + provenance tag ride along", () => {
    const people: GooglePerson[] = [
      { names: [{ displayName: "Jane Broker" }], emailAddresses: [{ value: "jane@acme.com" }] },
    ];
    expect(peopleConnectionsToContactRows(people, ["google"])).toEqual([
      { email: "jane@acme.com", name: "Jane Broker", tags: ["google"] },
    ]);
  });

  test("a person with several emails becomes several rows (same name)", () => {
    const people: GooglePerson[] = [
      {
        names: [{ displayName: "Multi" }],
        emailAddresses: [{ value: "work@acme.com" }, { value: "home@gmail.com" }],
      },
    ];
    const rows = peopleConnectionsToContactRows(people);
    expect(rows.map((r) => r.email)).toEqual(["work@acme.com", "home@gmail.com"]);
    expect(rows.every((r) => r.name === "Multi")).toBe(true);
  });

  test("no email → person skipped; no name → name null; blank email values ignored", () => {
    const people: GooglePerson[] = [
      { names: [{ displayName: "No Email" }] },
      { emailAddresses: [{ value: "anon@acme.com" }] },
      { names: [{ displayName: "Has Blank" }], emailAddresses: [{ value: "" }, { value: "  " }] },
    ];
    expect(peopleConnectionsToContactRows(people)).toEqual([
      { email: "anon@acme.com", name: null, tags: [] },
    ]);
  });

  test("tolerates a missing/empty connections array", () => {
    expect(peopleConnectionsToContactRows([])).toEqual([]);
    expect(peopleConnectionsToContactRows(undefined as unknown as GooglePerson[])).toEqual([]);
  });
});
