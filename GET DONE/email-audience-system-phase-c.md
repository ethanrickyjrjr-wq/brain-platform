# Email Audience System — Phase C (Future)

Decided 2026-06-18. Build this after Phase B (user-level contacts + one-time blast) is live and brokers are using it.

## What this is

A full audience/segmentation layer on top of the Phase B contact list. Basically the features you'd expect from a lightweight Mailchimp — but owned, in-product, with SWFL market data baked in.

## Features

- **Named audiences** — e.g. "Lee County Investors", "FMB Buyers", "Naples Landlords"
- **Tags on contacts** — tag at import or manually; audiences = saved tag filters
- **Audience-level scheduling** — "send the FMB market update to 'FMB Buyers' every Monday at 9am ET"
- **Unsubscribe tracking** — one-click unsubscribe link in every email, contact marked `unsubscribed`, excluded from future blasts
- **Open/click tracking** — pixel + redirect links to measure engagement
- **Suppression list** — hard bounces and unsubscribes rolled into a global suppression
- **Segment builder** — filter contacts by tag, ZIP interest, last-opened date, etc.

## Why it was deferred

Phase B already covers the core use case (upload your list, blast a deliverable). Phase C adds operational overhead (CANCAN-SPAM compliance per audience, bounce handling, suppression sync) that needs volume to justify — build it once brokers have real lists and real sends happening.

## Trigger to build

When any user has sent >5 blasts OR has >200 contacts, the audience system becomes the obvious next ask. Watch for it.
