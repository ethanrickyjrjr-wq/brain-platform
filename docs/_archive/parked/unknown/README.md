# UNKNOWN — Rescued Branch Work

These branches had real unmerged code. Patches saved here before branch deletion.
Apply with: `git am <file>.patch`

## contacts-hardening/ (3 patches)
**Source:** `claude/branch-status-check-84t7dh`
- Phone + CSV/vCard contact import + work-email filter
- Adversarial audit fixes (body caps, sanitization)
- Single-use QR token + rate limits on contact endpoints

## branding-color-palette/ (2 patches)
**Source:** `claude/hex-color-chart-branding-svusth`
- Hex input, color chart, 3 saved-color slots in brand block
- Saved color-palette library + carry colors to new projects
- SQL migration: `docs/sql/20260621_user_brand_color_palettes.sql`

## style-gallery/ (1 patch)
**Source:** `wip/style-gallery-visual-polish`
- StyleGallery component, test-send route, print route, style catalog
- Full preview HTML: `style-gallery-preview.html`
- Design handoff: `docs/superpowers/plans/2026-06-15-B2-style-gallery-visual-handoff.md`

## email-shells/ (2 patches)
**Source:** `archive/email-shell-screenshots`
- 5 CAN-SPAM-ready HTML email layout shells (alert/digest/report/single/two-col)
- Cross-client QA screenshots (Desktop, Phone, Outlook)

## social-scheduling/ (1 patch)
**Source:** `worktree-agent-af74555034e275042`
- Social scheduling cron worker + GHA workflow (`social-scheduler.yml`)
- `scripts/social/run-schedules.mts` + full test suite

## social-engagement/ (1 patch)
**Source:** `worktree-agent-ad58ef888c1f09b0f`
- Per-platform engagement polling (X/Meta/LinkedIn/GBP)
- `lib/social/engagement.ts` + `poll-engagement.mts` + GHA
