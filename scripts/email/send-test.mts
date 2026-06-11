// One-off preview send: renders the standalone 33908 white-label digest and
// sends it via Resend. Run: `bun scripts/email/send-test.mts`
// Recipient override: `TEST_TO=you@example.com bun scripts/email/send-test.mts`
// RESEND_API_KEY is auto-loaded from .env.local by Bun.
import { Resend } from "resend";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.join(import.meta.dirname, "test-send-33908.html"), "utf-8");
const to = process.env.TEST_TO ?? "ethanrickyjrjr@gmail.com";
const subject = "33908 right now — you've got room to negotiate";
const unsub = "https://www.swfldatagulf.com/unsubscribe?token=preview";

if (!process.env.RESEND_API_KEY) {
  console.error("[send-test] RESEND_API_KEY not set");
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);
const res = await resend.emails.send({
  from: "SWFL Data Gulf <hello@swfldatagulf.com>",
  to: [to],
  subject,
  html,
  headers: {
    "List-Unsubscribe": `<${unsub}>, <mailto:unsubscribe@swfldatagulf.com?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
});

console.log(JSON.stringify(res, null, 2));
if (res.error) {
  console.error(`[send-test] FAILED → ${to}`);
  process.exit(1);
}
console.log(`[send-test] SENT → ${to} · id ${res.data?.id} · ${html.length} bytes`);
