# A-7 — Adaptive prompts + escalating CTA — **SONNET**

## Goal
Make the Briefcase feel alive on return visits: the prompt set and CTA intensity adapt to how many
times the user has come back.

## Behaviour
- Track visit count (client-side); change the prompt set + escalate the CTA as visits increase
  (gentle on visit 1 → more direct by visit N), still honest and ladder-aligned.

## Acceptance test
- `visits.test.ts` covers the count→prompt/CTA mapping.
- Manual: revisiting changes the prompt set and the CTA intensity.
