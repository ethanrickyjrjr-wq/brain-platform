import type { BrandEnrichment } from "./enrich-brand";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** Max seeded-prompt length the welcome page will accept. Longer prompts are DROPPED (not truncated). */
export const ARRIVAL_PROMPT_MAX = 200;

/** Click-attribution ref: `<recipient uuid>-<touch>` (outreach demo cadence). */
export const REF_RE = /^[0-9a-f-]{36}-(t[1-4]|trial|reengage)$/i;

/**
 * Build the personalized arrival URL the welcome page parses:
 * /welcome?name=&primary=&secondary=&logo=&zip=&prompt=&ref=
 * Honors the page's exact validators (HEX_RE, ^https?://, ARRIVAL_PROMPT_MAX, REF_RE)
 * so the page never receives a value it would reject. Pure — no I/O.
 */
export function buildArrivalUrl(input: {
  name?: string;
  brand?: BrandEnrichment | null;
  /** Prospect scope ZIP — carried so the arrival's "Open your project" CTA can seed. */
  zip?: string;
  /** Seeds the welcome chat: the assistant answers this question live on landing. */
  prompt?: string;
  /** Outreach click attribution: `<recipient uuid>-<touch>` (see REF_RE). */
  ref?: string;
  base?: string;
}): string {
  const { brand, base = "" } = input;
  const name = input.name ?? brand?.company_name ?? undefined;
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (brand?.primary && HEX_RE.test(brand.primary)) params.set("primary", brand.primary);
  if (brand?.secondary && HEX_RE.test(brand.secondary)) params.set("secondary", brand.secondary);
  if (brand?.logo_url && /^https?:\/\//i.test(brand.logo_url)) params.set("logo", brand.logo_url);
  if (input.zip && /^\d{5}$/.test(input.zip)) params.set("zip", input.zip);
  const prompt = input.prompt?.trim();
  if (prompt && prompt.length <= ARRIVAL_PROMPT_MAX) params.set("prompt", prompt);
  if (input.ref && REF_RE.test(input.ref)) params.set("ref", input.ref);
  const qs = params.toString();
  const path = qs ? `/welcome?${qs}` : "/welcome";
  return base ? new URL(path, base).href : path;
}
