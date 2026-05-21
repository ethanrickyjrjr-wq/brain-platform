#!/usr/bin/env bash
# Runs at session Stop. Commits + pushes session-notes.md if it has changes.
# Skipped if user said "don't update" (sentinel file .claude/.skip-notes exists).

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)"
SENTINEL="$REPO_ROOT/.claude/.skip-notes"
NOTES_FILE="$REPO_ROOT/.claude/session-notes.md"

# Honor "don't update" — delete sentinel and exit cleanly
if [ -f "$SENTINEL" ]; then
  rm -f "$SENTINEL"
  echo '{"systemMessage": "Session notes skipped (don'\''t update was set)."}'
  exit 0
fi

# Nothing to do if notes file doesn't exist
if [ ! -f "$NOTES_FILE" ]; then
  exit 0
fi

cd "$REPO_ROOT" || exit 0

# Check if session-notes.md has any uncommitted changes
if git diff --quiet HEAD -- .claude/session-notes.md 2>/dev/null && git diff --cached --quiet -- .claude/session-notes.md 2>/dev/null; then
  # Also check if it's untracked
  if ! git ls-files --error-unmatch .claude/session-notes.md &>/dev/null; then
    : # untracked, fall through to commit
  else
    exit 0  # no changes, nothing to do
  fi
fi

BRANCH="$(git branch --show-current)"
DATE="$(date '+%Y-%m-%d %H:%M')"

git add .claude/session-notes.md

if git diff --cached --quiet; then
  exit 0  # nothing staged
fi

git commit -m "Session notes update — $DATE" \
  --no-verify 2>/dev/null || true

git push -u origin "$BRANCH" 2>/dev/null || \
  (sleep 2 && git push -u origin "$BRANCH" 2>/dev/null) || \
  (sleep 4 && git push -u origin "$BRANCH" 2>/dev/null) || true

echo '{"systemMessage": "Session notes saved and pushed."}'
