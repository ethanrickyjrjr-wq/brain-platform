// Maps semantic email slug → renderHtmlTemplate slug (relative to templates/html/)
export const EMAIL_TEMPLATES = {
  compare: "email/email-compare",
  hbar: "email/email-hbar",
  hero: "email/email-hero",
  ranked: "email/email-ranked",
  report: "email/email-report",
  table: "email/email-table",
  // The print/PDF skin of the grounded report — same tokens + repeats as `report`,
  // letter-size print CSS, no CTA. Routed from renderGroundedReport's `skin: "pdf"`.
  "doc-report": "email/doc-report",
} as const;

export type TemplateSlug = keyof typeof EMAIL_TEMPLATES;
