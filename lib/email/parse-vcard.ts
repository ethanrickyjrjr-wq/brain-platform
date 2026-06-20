/**
 * Pure vCard (.vcf) → ContactRow parser.
 *
 * vCard is plumbing we *accept*, never an instruction we give a user: iCloud's
 * "Export vCard" and Android's contact share-sheet both emit it. Handles the
 * shapes those exports actually produce — multiple cards per file, RFC line
 * folding, grouped properties (`item1.EMAIL`), TYPE params, quoted-printable
 * names, and several emails per card (one ContactRow each, so the work-email
 * filter can keep a work address and drop a personal one independently).
 *
 * Not a full RFC-6350 implementation; normalization/validation of the email is
 * left to `upsertContacts`. Cards with no usable email are skipped + counted.
 */
import type { ContactRow } from "./parse-contacts-csv";

export interface VcardParseResult {
  rows: ContactRow[];
  /** vCards that carried no usable email address. */
  skippedCards: number;
}

/** Unfold continuation lines (a line beginning with space/tab continues the prior one). */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if (out.length > 0 && (line.startsWith(" ") || line.startsWith("\t"))) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface Property {
  name: string;
  params: string;
  value: string;
}

/** Split `NAME;PARAM=x:VALUE` (incl. grouped `item1.EMAIL`) into parts. */
function splitProperty(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = head.indexOf(";");
  const nameRaw = semi < 0 ? head : head.slice(0, semi);
  const params = semi < 0 ? "" : head.slice(semi + 1);
  const dot = nameRaw.lastIndexOf("."); // grouped property → keep the part after the dot
  const name = (dot < 0 ? nameRaw : nameRaw.slice(dot + 1)).trim().toUpperCase();
  return { name, params, value };
}

/**
 * Decode a quoted-printable value when the params say so; otherwise pass through.
 * `=XX` escapes are byte values — accumulated and decoded as UTF-8 so multi-byte
 * characters (e.g. `=C3=A9` → "é") come back correctly rather than as mojibake.
 */
function decodeValue(value: string, params: string): string {
  if (!/ENCODING=QUOTED-PRINTABLE/i.test(params)) return value;
  const soft = value.replace(/=\r?\n/g, ""); // drop soft line breaks
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(soft[i], "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Build a display name from a structured `N:Last;First;Middle;Prefix;Suffix`. */
function nameFromStructured(value: string): string | null {
  const [last = "", first = ""] = value.split(";");
  const display = [first.trim(), last.trim()].filter(Boolean).join(" ").trim();
  return display.length > 0 ? display : null;
}

export function parseVcard(text: string): VcardParseResult {
  const rows: ContactRow[] = [];
  let skippedCards = 0;

  let inCard = false;
  let fn: string | null = null;
  let structured: string | null = null;
  let emails: string[] = [];

  const flush = () => {
    if (!inCard) return;
    const name = fn ?? structured ?? null;
    if (emails.length === 0) {
      skippedCards++;
    } else {
      for (const email of emails) rows.push({ email, name, tags: [] });
    }
    inCard = false;
    fn = null;
    structured = null;
    emails = [];
  };

  for (const line of unfoldLines(text)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const prop = splitProperty(trimmed);
    if (!prop) continue;

    if (prop.name === "BEGIN" && prop.value.trim().toUpperCase() === "VCARD") {
      flush(); // tolerate a missing END before the next BEGIN
      inCard = true;
      continue;
    }
    if (prop.name === "END" && prop.value.trim().toUpperCase() === "VCARD") {
      flush();
      continue;
    }
    if (!inCard) continue;

    switch (prop.name) {
      case "FN":
        fn = decodeValue(prop.value, prop.params).trim() || fn;
        break;
      case "N":
        structured = nameFromStructured(decodeValue(prop.value, prop.params));
        break;
      case "EMAIL": {
        // Some exporters emit RFC-6350 `mailto:` URIs — strip the scheme so the
        // stored address is a bare email, not `mailto:x@y.com` (which hard-bounces).
        const email = prop.value.trim().replace(/^mailto:/i, "").trim();
        if (email) emails.push(email);
        break;
      }
    }
  }
  flush(); // tolerate a missing final END:VCARD

  return { rows, skippedCards };
}
