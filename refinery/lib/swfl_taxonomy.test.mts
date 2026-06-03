import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  classify,
  CORRIDOR_SLUGS,
  TOPIC_BRAIN_RULES,
} from "./swfl_taxonomy.mts";

describe("classify", () => {
  test("maps a place + topic + brain (flood)", () => {
    const c = classify("Cape Coral flood insurance cost");
    expect(c.isSwfl).toBe(true);
    expect(c.places).toContain("cape coral");
    expect(c.topic).toBe("flood");
    expect(c.brains).toContain("env-swfl");
  });

  test("Lehigh Acres new construction → permits/housing (the roadmap example)", () => {
    const c = classify("lehigh acres new construction homes");
    expect(c.isSwfl).toBe(true);
    expect(c.places).toContain("lehigh acres");
    expect(c.brains).toContain("permits-swfl");
  });

  test("region term alone makes it SWFL", () => {
    expect(classify("southwest florida cap rate").isSwfl).toBe(true);
  });

  test("non-SWFL query is not SWFL and maps to no brain", () => {
    const c = classify("best pizza near me");
    expect(c.isSwfl).toBe(false);
    expect(c.brains).toEqual([]);
  });

  test("longer place wins (fort myers beach, not fort myers)", () => {
    const c = classify("fort myers beach homes for sale");
    expect(c.places).toContain("fort myers beach");
    expect(c.places).not.toContain("fort myers");
  });
});

describe("taxonomy integrity", () => {
  test("every topic-rule brain slug has shipped (brains/{slug}.md exists)", () => {
    const missing: string[] = [];
    for (const rule of TOPIC_BRAIN_RULES) {
      for (const slug of rule.brains) {
        if (!existsSync(resolve(process.cwd(), "brains", `${slug}.md`))) {
          missing.push(`${rule.topic} → ${slug}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("CORRIDOR_SLUGS is the 25-corridor canonical set", () => {
    expect(CORRIDOR_SLUGS.length).toBe(25);
    expect(CORRIDOR_SLUGS).toContain("cleveland-ave-fort-myers");
  });
});
