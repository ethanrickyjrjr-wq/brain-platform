import { describe, test, expect } from "bun:test";
import { parseVcard } from "../parse-vcard";

const card = (body: string) => `BEGIN:VCARD\nVERSION:3.0\n${body}\nEND:VCARD\n`;

describe("parseVcard", () => {
  test("FN + EMAIL → one row", () => {
    const { rows, skippedCards } = parseVcard(card("FN:Jane Broker\nEMAIL;TYPE=WORK:jane@acme.com"));
    expect(rows).toEqual([{ email: "jane@acme.com", name: "Jane Broker", tags: [] }]);
    expect(skippedCards).toBe(0);
  });

  test("multiple cards → multiple rows", () => {
    const vcf =
      card("FN:A\nEMAIL:a@x.com") + card("FN:B\nEMAIL:b@y.com");
    expect(parseVcard(vcf).rows.map((r) => r.email)).toEqual(["a@x.com", "b@y.com"]);
  });

  test("several emails on one card → one row each, same name", () => {
    const { rows } = parseVcard(
      card("FN:Multi\nEMAIL;TYPE=WORK:work@acme.com\nEMAIL;TYPE=HOME:home@gmail.com"),
    );
    expect(rows.map((r) => r.email)).toEqual(["work@acme.com", "home@gmail.com"]);
    expect(rows.every((r) => r.name === "Multi")).toBe(true);
  });

  test("falls back to structured N when FN is absent", () => {
    const { rows } = parseVcard(card("N:Smith;John;;;\nEMAIL:js@acme.com"));
    expect(rows[0].name).toBe("John Smith");
  });

  test("grouped property (item1.EMAIL) is recognized", () => {
    const { rows } = parseVcard(card("FN:Grouped\nitem1.EMAIL;type=INTERNET:g@acme.com"));
    expect(rows[0].email).toBe("g@acme.com");
  });

  test("quoted-printable name is decoded", () => {
    const { rows } = parseVcard(
      card("FN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9\nEMAIL:jose@acme.com"),
    );
    expect(rows[0].name).toBe("José");
  });

  test("a card with no email is skipped + counted", () => {
    const { rows, skippedCards } = parseVcard(card("FN:No Email"));
    expect(rows).toHaveLength(0);
    expect(skippedCards).toBe(1);
  });

  test("strips a mailto: scheme so the stored address is bare", () => {
    const { rows } = parseVcard(card("FN:Mailto\nEMAIL;TYPE=INTERNET:mailto:m@acme.com"));
    expect(rows[0].email).toBe("m@acme.com");
  });

  test("tolerates a missing final END:VCARD", () => {
    const { rows } = parseVcard("BEGIN:VCARD\nFN:Dangling\nEMAIL:d@acme.com");
    expect(rows).toEqual([{ email: "d@acme.com", name: "Dangling", tags: [] }]);
  });

  test("line folding (continuation lines) is unfolded", () => {
    // The email is split across two physical lines with a leading space.
    const { rows } = parseVcard("BEGIN:VCARD\nFN:Fold\nEMAIL:fold@ac\n me.com\nEND:VCARD");
    expect(rows[0].email).toBe("fold@acme.com");
  });
});
