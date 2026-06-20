import { describe, expect, it } from "bun:test";
import { parseTargetsCsv } from "./targets";

describe("parseTargetsCsv", () => {
  it("parses a headered CSV in any column order", () => {
    const { rows, errors } = parseTargetsCsv(
      "name,email,zip,domain\nAcme Realty,broker@acme.com,33931,https://www.acme.com/about\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { email: "broker@acme.com", name: "Acme Realty", domain: "acme.com", zip: "33931" },
    ]);
  });

  it("treats the first row as DATA when it is not all known columns", () => {
    const { rows } = parseTargetsCsv("broker@acme.com,Acme,acme.com,33901\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("broker@acme.com");
    expect(rows[0].zip).toBe("33901");
  });

  it("lowercases emails and dedupes them", () => {
    const { rows, errors } = parseTargetsCsv(
      "email\nBroker@Acme.com\nbroker@acme.com\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("broker@acme.com");
    expect(errors[0].reason).toContain("duplicate");
  });

  it("flags invalid emails and invalid zips with 1-based line numbers", () => {
    const { rows, errors } = parseTargetsCsv(
      "email,zip\nnot-an-email,33931\ngood@x.com,abcde\nok@y.com,33901\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("ok@y.com");
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(2);
    expect(errors[0].reason).toContain("invalid email");
    expect(errors[1].line).toBe(3);
    expect(errors[1].reason).toContain("invalid zip");
  });

  it("handles quoted fields containing commas", () => {
    const { rows } = parseTargetsCsv(
      'email,name\nbroker@acme.com,"Acme, Realty & Co"\n',
    );
    expect(rows[0].name).toBe("Acme, Realty & Co");
  });

  it("skips blank lines and tolerates a missing optional column", () => {
    const { rows, errors } = parseTargetsCsv("email\n\nbroker@acme.com\n\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].zip).toBeUndefined();
    expect(rows[0].domain).toBeUndefined();
  });
});
