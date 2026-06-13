# Email Template Adapter — Build Index

All code output → `lib/email/templates/`

---

## Files in this folder

| File | Builder | Gate |
|---|---|---|
| `gaps.md` | Read before building anything | always |
| `s4-brand-persistence__SONNET__NOW.md` | Sonnet | Build now — no shell dependency |
| `s1-template-adapter__SONNET__BLOCKED-shells.md` | Sonnet | Blocked until 5 HTML shells committed |
| `s2-charts__OPUS__BLOCKED-shells.md` | Opus | Blocked until 5 HTML shells committed |
| `s3-visual-components__OPUS__DONE.md` | Opus | DONE — shipped (gate cleared: shells committed + S2 done) |
| `plan.md` | Reference | Full detail — source of truth |

---

## Dependency graph — what runs when

```
RIGHT NOW (no shells needed)
────────────────────────────
  ┌─────────────────────────────────────────────────────┐
  │  Section 4 — Brand Persistence (Sonnet)             │
  │                                                     │
  │  [4A] DB migration ──┐                              │
  │     (parallel)       ├──→ [4C] project auto-fill    │
  │  [4B] resolve-brand ─┘         ↓                   │
  │                           [4D] signup capture       │
  │                                ↓                    │
  │                           [4E] AI context wiring    │
  └─────────────────────────────────────────────────────┘

WHEN SHELLS ARRIVE
──────────────────
  Section 1 (Sonnet)      Section 2 (Opus)          Section 3 (Opus)
  ──────────────────      ────────────────          ────────────────
  [1A] token-defaults ┐   [2A] chart-types ┐        starts after 2A
  (parallel)          ├→  (parallel)       ├→ [2C]  ──────────────
  [1B] types + sig   ─┘   [2B] chart-defs ─┘        [3A] metric-card
        ↓                        ↓                   [3B] callout     } parallel
      [1C] render body     [2C] chart-renderer       [3C] map-holder  }
                                                           ↓
                           ← all of 1C + 2C + 3A + 3B + 3C done →
                                        ↓
                                  [3D] smoke test (Sonnet)
```

---

## What CANNOT run at the same time (sequential — must wait)

| Must finish first | Before starting |
|---|---|
| 4A AND 4B both done | 4C |
| 4C done | 4D |
| 4D done | 4E |
| 1A AND 1B both done | 1C |
| 2A AND 2B both done | 2C |
| 2A done | 3A, 3B, 3C (any of them) |
| 1C + 2C + 3A + 3B + 3C all done | 3D smoke test |
| Section 4 complete | Any Section 1–3 output ships to real users |

---

## What CAN run in parallel

- Section 4 entire track runs independently of Sections 1–3
- Within Section 4: **4A and 4B** run together
- Within Section 1: **1A and 1B** run together
- Within Section 2: **2A and 2B** run together
- Within Section 3: **3A, 3B, and 3C** all run together (once 2A done)
- Sections 1, 2, and 3 share the same gate (shells) but have no deps on each other — **all three start the same day shells arrive**
