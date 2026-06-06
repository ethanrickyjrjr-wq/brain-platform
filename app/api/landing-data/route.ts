import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    comparison: [
      {
        question: "Which SWFL corridor commands the highest asking rent?",
        genericResponse:
          "Rents vary widely by submarket and property type. You'd need to consult local commercial brokers for current figures.",
        value: "5th Ave South / Waterside",
        subtext: "$60.84/sqft NNN",
        source: "SWFL CRE Corridor Profiles",
        freshness: "Updated today",
      },
      {
        question: "How many building permits are active in Lee + Collier?",
        genericResponse:
          "Permit activity fluctuates seasonally. Check with county building departments for current numbers.",
        value: "5,003 Permits",
        subtext: "Trailing 63 days",
        source: "Lee County Accela + Collier County Building",
        freshness: "Updated 3 days ago",
      },
      {
        question: "What's the median CRE vacancy rate across SWFL corridors?",
        genericResponse:
          "Vacancy rates depend on submarket and property type. Conditions change frequently and local expertise is required.",
        value: "3.2% Median Vacancy",
        subtext: "Across 25 tracked corridors",
        source: "SWFL CRE Corridor Profiles",
        freshness: "Updated today",
      },
      {
        question:
          "How concentrated is SWFL's construction workforce vs. national?",
        genericResponse:
          "Construction employment in SWFL follows Sun Belt trends, though exact figures require current BLS data to confirm.",
        value: "2.17× National Avg",
        subtext: "Lee County construction LOC quotient",
        source: "BLS OEWS May 2025",
        freshness: "Updated 6 days ago",
      },
    ],
    charts: {
      // Top SWFL corridors by asking rent ($/sqft NNN) — source: cre-swfl brain 2026-06-05
      corridorRents: [
        { name: "5th Ave / Waterside", rent: 60.84 },
        { name: "Pine Ridge Rd", rent: 39.2 },
        { name: "Ben Hill Griffin", rent: 34.24 },
        { name: "Summerlin Rd", rent: 32.73 },
        { name: "Immokalee Rd N", rent: 30.91 },
        { name: "Three Oaks / Coconut", rent: 30.88 },
        { name: "Bonita Trail", rent: 27.51 },
        { name: "Davis Blvd E", rent: 26.79 },
      ],
      // Active corridor flags by type — source: cre-swfl brain 2026-06-05
      marketEvents: [
        { name: "Status Updates", count: 11 },
        { name: "New Projects", count: 7 },
        { name: "Infrastructure", count: 6 },
        { name: "Construction", count: 5 },
        { name: "Regulatory", count: 3 },
      ],
      // Key metrics — source: cre-swfl + permits-swfl + labor-demand-swfl brains
      keyMetrics: [
        { label: "Active Permits", value: "5,003", change: "Trailing 63 days" },
        { label: "Median Vacancy", value: "3.2%", change: "25 corridors" },
        { label: "Median Asking Rent", value: "$27.51", change: "/sqft NNN" },
        { label: "CRE Corridors", value: "25", change: "Lee + Collier" },
        { label: "Active Market Flags", value: "32", change: "17 corridors" },
        {
          label: "Construction LOC Q",
          value: "2.17×",
          change: "vs. national avg",
        },
      ],
    },
  });
}
