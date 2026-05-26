# SESSION_LOG.md — Append-Only Cross-Session Memory

**Read this on session start. Append to it before every `git push`.**

Format per entry (newest at top):

```
## YYYY-MM-DD HH:MM (model · branch)
- What changed (1–3 lines, present tense, file paths welcome)
- What's next / what's blocked
- Links: PR #, issue #, plan path
```

If a hook blocks your push, that's the system working. Fix the entry, then push.

---

## 2026-05-26 (Opus 4.7 · main)

- Shipped enforced session-log mechanism + commit/push autonomy rubric. Five files: `SESSION_LOG.md` (this), `CLAUDE.md` (RULE 0 + RULE 1 at top, behind `<!-- SESSION-LOG-RULE-MARKER -->`), `.claude/hooks/print-session-log.mjs` (SessionStart: prints last 8 entries + verifies marker), `.claude/hooks/check-session-log-on-push.mjs` (PreToolUse Bash: blocks `git push` when no commit ahead touched SESSION_LOG.md), `.claude/settings.json` (wired).
- RULE 1 authorizes Claude to commit + push small/policy/tooling changes without asking, and lists what still requires a diff review (brain pack math, ingest→data_lake, schema migrations, multi-file refactors, anything affecting live `/api/b/*` or MCP).
- Race condition discovered mid-build: a parallel Sonnet 4.6 session sharing this working tree picked up my untracked `SESSION_LOG.md`, committed it onto `feat/permits-swfl-v2`, and switched HEAD under me. Sonnet's own entry will arrive on `main` when PR #29 merges — expect a 30-second conflict on this file, resolve by keeping both entry blocks. **Operator action needed: use `git worktree add` for parallel Claude sessions, not the same working tree.**
- Memory: `project_session-log-mechanism.md` + high-visibility pointer at top of MEMORY.md.
- Pushing this commit now under RULE 1 authority.

## 2026-05-25 (prior session · main)

- Seed entry — see git log for c19d3ca (GHA unblock + brand scrub), 86435b8 (Lane D fully live), c3b9d0a (waitlist env-name fallback #30).
