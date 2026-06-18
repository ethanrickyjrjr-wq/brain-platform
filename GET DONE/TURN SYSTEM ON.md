# TURN SYSTEM ON — Credit Freeze Reversal

Frozen 2026-06-18. Run these in order when ready to launch.

---

## 1. Re-enable GHA schedules

Edit each file and un-comment the `schedule:` block (remove the `# PAUSED` line and the `#` prefixes):

- `.github/workflows/daily-rebuild.yml` — `cron: "0 6 * * *"`
- `.github/workflows/city-pulse-daily.yml` — `cron: "0 9 * * *"`
- `.github/workflows/dbpr-public-notices-weekly.yml` — `cron: "0 10 * * 1"`
- `.github/workflows/gate-a-parity.yml` — `cron: "0 7 * * *"`

---

## 2. Upgrade synthesis back to Sonnet (optional — do when revenue covers it)

In `refinery/agents/anthropic.mts`, change:

```ts
export const SYNTHESIS_MODEL = "claude-haiku-4-5";
```
→
```ts
export const SYNTHESIS_MODEL = "claude-sonnet-4-6";
```

Also bump `max_tokens` back in `refinery/agents/synthesis-agent.mts` if needed (currently 4096, was 16000).

---

## 3. Force a full brain rebuild to freshen data

```
gh workflow run daily-rebuild.yml -f pack_id=master -f force=true
```

Or locally: `bun refinery/cli.mts master --force`

---

## 4. Verify city pulse is catching up

After the first city-pulse run, check the `city_pulse_corridors_tier2` recency row in the freshness probe dashboard.

