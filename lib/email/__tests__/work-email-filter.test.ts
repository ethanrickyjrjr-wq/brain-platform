import { describe, test, expect } from "bun:test";
import type { ContactRow } from "../parse-contacts-csv";
import {
  isWorkEmail,
  emailDomain,
  partitionContacts,
  PERSONAL_EMAIL_DOMAINS,
} from "../work-email-filter";

describe("emailDomain / isWorkEmail", () => {
  test("personal consumer domains are not work", () => {
    expect(isWorkEmail("jane@gmail.com")).toBe(false);
    expect(isWorkEmail("Jane@ICLOUD.com")).toBe(false); // case-insensitive
    expect(isWorkEmail("x@yahoo.com")).toBe(false);
  });

  test("company / professional domains are work", () => {
    expect(isWorkEmail("jane@premiercre.com")).toBe(true);
    expect(isWorkEmail("broker@swfldatagulf.com")).toBe(true);
  });

  test("malformed addresses (no domain) are not classified work", () => {
    expect(isWorkEmail("not-an-email")).toBe(false);
    expect(emailDomain("not-an-email")).toBe("");
  });

  test("a trailing dot does not let a personal domain evade the blocklist", () => {
    expect(emailDomain("x@gmail.com.")).toBe("gmail.com");
    expect(isWorkEmail("x@gmail.com.")).toBe(false);
  });

  test("the blocklist covers the operator's named personal domains", () => {
    for (const d of ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net"]) {
      expect(PERSONAL_EMAIL_DOMAINS.has(d)).toBe(true);
    }
  });
});

describe("partitionContacts", () => {
  const rows: ContactRow[] = [
    { email: "ceo@acme.com", name: "Boss", tags: [] },
    { email: "friend@gmail.com", name: "Pal", tags: [] },
    { email: "broker@realty.com", name: "Agent", tags: [] },
    { email: "mom@icloud.com", name: "Mom", tags: [] },
  ];

  test("workOnly off → pass-through, nothing flagged personal", () => {
    const { kept, skippedPersonal } = partitionContacts(rows, { workOnly: false });
    expect(kept).toHaveLength(4);
    expect(skippedPersonal).toBe(0);
  });

  test("workOnly on → drops personal domains and counts them", () => {
    const { kept, skippedPersonal } = partitionContacts(rows, { workOnly: true });
    expect(kept.map((r) => r.email)).toEqual(["ceo@acme.com", "broker@realty.com"]);
    expect(skippedPersonal).toBe(2);
  });

  test("one person, two emails: keep work, drop personal (independent rows)", () => {
    // Mirrors the People-API shape: one contact emitted as two rows.
    const twoEmails: ContactRow[] = [
      { email: "j.smith@brokerage.com", name: "J Smith", tags: ["google"] },
      { email: "jsmith@gmail.com", name: "J Smith", tags: ["google"] },
    ];
    const { kept, skippedPersonal } = partitionContacts(twoEmails, { workOnly: true });
    expect(kept.map((r) => r.email)).toEqual(["j.smith@brokerage.com"]);
    expect(skippedPersonal).toBe(1);
  });
});
