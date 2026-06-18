# Phone Contact Import — Future Options

Decided 2026-06-18. Phase B ships CSV + manual add from desktop. Add phone import once the contact system has traction.

## Option A — Google Contacts OAuth (for Google/Gmail users)
- User taps "Import from Google Contacts"
- Standard Google OAuth flow → we pull name + email + phone directly
- No file, no steps — genuinely seamless
- Covers most brokers on Google Workspace / Gmail
- Build: ~1 day (Google OAuth client + contacts.people API)

## Option B — Apple iCloud Contacts (for non-Google users)
- Apple does NOT offer a public OAuth API for Contacts (unlike Google)
- Best realistic path: user exports their iCloud contacts as a .vcf file from iCloud.com on desktop, then imports via CSV/vCard uploader
- Alternatively: Apple's CardDAV protocol — we'd need a CardDAV client + user's iCloud app-specific password. Fragile and rarely worth it.
- Honest take: iCloud contacts import is painful by design (Apple keeps it closed). Guide them to export CSV from iCloud.com instead.

## Option C — QR Code Mobile Upload
- Desktop shows a QR code with a short-lived authenticated import link
- User scans → phone browser opens a mobile-optimized upload page
- Page walks them through exporting .vcf from their phone Contacts app with screenshots
- Still requires manual export steps — not magic, but guided
- Worth building after Google OAuth is live, as a fallback for non-Google users

## Work email filter

When importing from any source (Google Contacts, vCard, CSV), add a toggle:
**"Work emails only"** — filters out personal email domains (`@gmail.com`, `@yahoo.com`, `@hotmail.com`, `@outlook.com`, `@icloud.com`, `@aol.com`, `@me.com`, `@live.com`, `@msn.com`, `@comcast.net`, `@att.net`, `@verizon.net`, etc.) and keeps only company/professional domains.

- Default: off (import all)
- On: exclude personal-domain emails; show count "Kept 47 work emails, skipped 12 personal"
- Edge case: some contacts may have BOTH a work + personal email — keep the work one, skip the personal one; if only personal, skip the whole contact when the toggle is on
- Maintain a short hardcoded blocklist of personal domains + add any that appear frequently

This is especially useful for brokers importing their full phone book — they only want their business network, not family/friends.

## Recommended build order
1. Google OAuth (covers ~70% of the audience, fully automatic) — add work-email filter at this step
2. QR + guided vCard upload (covers the rest with guided steps) — same filter
3. Skip CardDAV — not worth the fragility
