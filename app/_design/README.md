# SWFL Data Lake — Design System

This folder is the toolkit for designing the SWFL Data Lake. It lives at
`app/_design/` so the underscore prefix keeps Next.js routing out of it
— this is reference material, not a route.

**If you're an AI tool (Claude Design, Cursor, etc.) reading this folder:**
open `00-START-HERE.md` first. It walks you through the rest in order.

**If you're a human:** same advice. `00-START-HERE.md` is the entry
point. After that, the 6 rule docs are numbered for the order you read
them, and `QUICK-REFERENCE.md` is the one-page cheat sheet you keep
open while building.

## File index

| File                          | What it covers                                                          |
| ----------------------------- | ----------------------------------------------------------------------- |
| `00-START-HERE.md`            | Soul of the product, three contexts, load order                         |
| `01-product-brief.md`         | Product brief + canonical mock data shape                               |
| `02-motion-rules.md`          | Three-context motion model, vetoes, the toggle, default timings         |
| `03-surface-recipes.md`       | Beat-by-beat sequence per surface + empty/loading/error states          |
| `04-context-decision-tree.md` | Content × user state → motion pattern lookup table                      |
| `05-color-and-type.md`        | Gulf palette + typography system as concrete tokens                     |
| `06-voice-and-microcopy.md`   | How the product talks: number formatting, trend language, copy rules    |
| `QUICK-REFERENCE.md`          | One-page cheat sheet — palette, type scale, motion budgets              |
| `prompts/`                    | Ready-to-use prompts for Claude Design, one per surface                 |
| `animejs-v4-examples/`        | 24 standalone working Anime.js v4 example apps (primary code reference) |
| `animejs-docs/`               | v4 API reference docs                                                   |

## When to update what

- **New surface** → add a recipe to `03-surface-recipes.md` and a row
  to `04-context-decision-tree.md`. Add a prompt to `prompts/`.
- **New motion primitive** → add an entry to `04-context-decision-tree.md`
  with the example folder reference.
- **New color or type token** → add to `05-color-and-type.md` and the
  swatch list in `QUICK-REFERENCE.md`.
- **Voice change** → `06-voice-and-microcopy.md` is canonical.
- **Three-context model change** → `02-motion-rules.md` is the source of
  truth; sweep `03` and `04` for references.

## Refreshing the Anime.js material

```bash
# v4 examples — sparse clone the official repo
git clone --depth 1 --filter=blob:none --sparse https://github.com/juliangarnier/anime.git _tmp
cd _tmp && git sparse-checkout set examples && cd ..
# move _tmp/examples → app/_design/animejs-v4-examples, then remove _tmp

# v4 docs (substantive pages only — see existing list)
firecrawl scrape <list of doc URLs> --only-main-content -o app/_design/animejs-docs/
```
