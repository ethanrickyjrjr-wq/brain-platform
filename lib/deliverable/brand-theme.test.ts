import { describe, it, expect } from "bun:test";
import { extractBrandTheme, toChartTheme } from "./brand-theme";

describe("extractBrandTheme", () => {
  it("returns null for null/undefined input", () => {
    expect(extractBrandTheme(null)).toBeNull();
    expect(extractBrandTheme(undefined)).toBeNull();
  });

  it("returns null when no theme fields are present", () => {
    expect(
      extractBrandTheme({ agent_name: "Alice", photo: "https://example.com/photo.jpg" }),
    ).toBeNull();
  });

  it("extracts primary_color only", () => {
    const result = extractBrandTheme({ primary_color: "#1a2b3c" });
    expect(result).toEqual({ primary: "#1a2b3c", accent: null, logoUrl: null });
  });

  it("extracts accent_color only", () => {
    const result = extractBrandTheme({ accent_color: "#ff6600" });
    expect(result).toEqual({ primary: null, accent: "#ff6600", logoUrl: null });
  });

  it("extracts logo_url only", () => {
    const result = extractBrandTheme({ logo_url: "https://cdn.example.com/logo.png" });
    expect(result).toEqual({
      primary: null,
      accent: null,
      logoUrl: "https://cdn.example.com/logo.png",
    });
  });

  it("extracts all three fields together", () => {
    const result = extractBrandTheme({
      primary_color: "#003366",
      accent_color: "#cc9900",
      logo_url: "https://cdn.example.com/logo.svg",
      agent_name: "Bob",
    });
    expect(result).toEqual({
      primary: "#003366",
      accent: "#cc9900",
      logoUrl: "https://cdn.example.com/logo.svg",
    });
  });

  it("ignores non-string primary_color", () => {
    expect(extractBrandTheme({ primary_color: 42 })).toBeNull();
  });
});

describe("toChartTheme", () => {
  it("maps all three fields", () => {
    const result = toChartTheme({
      primary: "#003366",
      accent: "#cc9900",
      logoUrl: "https://example.com/logo.png",
    });
    expect(result).toEqual({
      primary: "#003366",
      accent: "#cc9900",
      logoUrl: "https://example.com/logo.png",
    });
  });

  it("omits null fields", () => {
    const result = toChartTheme({ primary: "#003366", accent: null, logoUrl: null });
    expect(result).toEqual({ primary: "#003366" });
    expect("accent" in result).toBe(false);
    expect("logoUrl" in result).toBe(false);
  });

  it("returns empty object when all null", () => {
    const result = toChartTheme({ primary: null, accent: null, logoUrl: null });
    expect(result).toEqual({});
  });
});
