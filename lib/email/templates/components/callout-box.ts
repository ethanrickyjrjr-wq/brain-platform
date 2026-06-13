import { COMPONENT_DEFAULTS, esc } from "./_shared";

// Section 3 (S3) Task 3B — callout box. A left-border accent block. Built on a
// table cell (Outlook renders td borders far more reliably than div borders) with
// a solid light surface — no gradients, no background images (email-safe).

export type CalloutType = "info" | "warn" | "highlight";

const BORDER: Record<CalloutType, string> = {
  info: COMPONENT_DEFAULTS.accent,
  warn: COMPONENT_DEFAULTS.warn,
  highlight: COMPONENT_DEFAULTS.primary,
};

const SURFACE_TINT = "#F9FAFB"; // solid neutral fill, not a gradient/image

export function renderCallout(type: CalloutType, text: string): string {
  const font = COMPONENT_DEFAULTS.font;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:600px;max-width:600px;border-collapse:collapse;">` +
    `<tr><td style="border-left:4px solid ${BORDER[type]};background:${SURFACE_TINT};padding:12px 16px;` +
    `font-family:${font};font-size:14px;line-height:1.5;color:${COMPONENT_DEFAULTS.text};">` +
    `${esc(text)}</td></tr></table>`
  );
}
