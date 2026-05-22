# Prompts — Which one to run

Four self-contained prompts. Pick one based on what you want built. The
recommended sequence is top-down: each later prompt benefits from the
look-and-feel established by the earlier ones, but you can run them in
any order.

## The four prompts

| File                   | What it builds                                  | When to use                                                                     | Animation budget                             |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `1-design-system.md`   | `/design` — atmosphere + tokens + motion demos  | First — lock the look. Safest start. Validate the vibe before product surfaces. | Moderate                                     |
| `2-report-page.md`     | `/r/{report_id}` — flagship report with 3 tiers | Biggest payoff. If you only run one, run this.                                  | Moderate (Tier 2), near-zero (Tiers 1 + 3)   |
| `3-connect-landing.md` | `/connect` — install + waitlist                 | First-impression page. High wow. Run when you want to feel the hook.            | High                                         |
| `4-mcp-widget.md`      | MCP inline widget for AI chat                   | Smallest. Constrained-context test of the system.                               | Tiny (≤ 300ms default, ≤ 600ms impress mode) |

## How to run a prompt in Claude Design

1. Make sure brain-platform is connected to Claude Design via GitHub.
2. Open the prompt file you want (e.g. `2-report-page.md`).
3. Copy everything below the dashed line (`---`) — the section above
   is meta just for you.
4. Paste as your Claude Design message. Make sure Claude Design has
   `app/` (or at least `app/_design/`) in scope as the frontend-focused
   subfolder so it can read the rule docs and the v4 examples.
5. Send.

## If you don't know where to start

Run `1-design-system.md` first. It produces a self-contained `/design`
page that demonstrates the palette, typography, and the three signature
motion patterns (hero spring, metric stagger, SVG path draw) in working
form. Use the result to validate the vibe. Then pick whichever surface
to build next based on what excites you that day.

## Follow-up turn tips

- If Claude Design starts writing **v3 anime.js syntax**
  (`anime({...})`), reply:
  "Open `app/_design/animejs-v4-examples/<folder>/index.js` — that's
  the v4 syntax I want."
- If you want to **refine one section** of an existing build, paste the
  relevant section from `app/_design/03-surface-recipes.md` or
  `app/_design/04-context-decision-tree.md` with
  "Refine the [X] using this recipe."
- If motion **feels wrong**, point at the rule it's violating:
  "Re-read `app/_design/02-motion-rules.md` § Personality vetoes — the
  current reveal bounces, but bounce is banned."
- If copy **sounds off**, point at
  `app/_design/06-voice-and-microcopy.md`: "Re-read the trend-language
  section — these labels say 'trending higher' when they should say
  '+18 bps QoQ'."
- For real-world reference patterns (Pudding's scrollytelling map,
  meteo's data tick cadence, Linear's homepage IA), the beautified
  production JS bundles + editorial markdown captures live at
  `app/_design/assets/reference-builds/`. Already in the GitHub-
  attached folder — point Claude Design at a specific file by name as
  a surgical follow-up.
