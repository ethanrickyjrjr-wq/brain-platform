# AI tool-awareness + scheduling research — Email Lab AI / Social AI

Date: 2026-07-01
Method: crawl4ai (pinned client, `ingest/lib/crawl_client.py::fetch_page_markdown`) fetched every source
below live in-session, per CLAUDE.md RULE 0.4. No Firecrawl used. Full raw markdown dumps kept locally in
the session scratchpad (not committed — this file is the synthesis).

Repo grounding check (read, not modified): our current AI-authoring surfaces already use a **forced
single-tool-call pattern**, one Claude API call = one tool, defense-in-depth validated with zod — see
`lib/email/schedule-command.ts` (`propose_email_schedule_action`), `lib/email/author-doc.ts`
(`author_email`), `lib/assistant/compose-chart.ts`, `lib/assistant/web-fallback.ts`,
`lib/assistant/gap-fill.ts`, `lib/deliverable/build.ts`, `lib/prospects/enrich-brand.ts`,
`app/api/projects/[id]/action/route.ts`. Eight separate call sites, each with its own narrow tool — not
one agent loop holding a large tool menu. That shapes which findings below are "adopt now" vs "adopt when
we consolidate into a real multi-tool agent loop."

---

## 1. Tool-use best practices (system prompt design, tool descriptions, structured/strict output)

### 1.1 Write tools for agents, not for other programs
**Finding:** Anthropic's own internal process for building tools: prototype → run an evaluation with
realistic multi-tool-call tasks → let an agent (Claude Code) read the eval transcripts and rewrite the
tool descriptions itself. Concrete named principles: (a) build fewer, higher-level tools that consolidate
multiple API calls (e.g. one `schedule_event` tool that finds availability AND books it, instead of three
separate `list_users`/`list_events`/`create_event` tools); (b) namespace tools by service/resource
(`asana_search`, `asana_projects_search`) once you have dozens, because ambiguous names cause wrong-tool
selection; (c) return high-signal fields only — drop `uuid`/`mime_type`/raw IDs in favor of natural-language
names, or expose a `response_format: "concise" | "detailed"` enum so the agent can choose (their internal
test: 206 tokens detailed vs 72 tokens concise for the same Slack thread — a 3x difference); (d) tool
descriptions should be written "as you'd explain the tool to a new hire" — spell out implicit context,
niche terms, and resource relationships explicitly, and name parameters unambiguously (`user_id` not
`user`); (e) truncate large responses with sensible defaults and steer the agent toward efficient
strategies in the truncation/error message itself, not just an error code.
**Source:** https://www.anthropic.com/engineering/writing-tools-for-agents (Anthropic Engineering, published
Sep 11 2025 — fetched live)

**Applicability:** Our Email Lab and Social AI each currently expose one narrow forced tool per API route
(`author_email`, `propose_email_schedule_action`, chart-building, brand enrichment). That's actually
already close to the "few, high-level, consolidated tools" ideal Anthropic recommends — we are not
suffering from tool sprawl today. The risk is the other direction: if/when these get unified into one
agent loop that holds all of them at once (data-lake query + photo lookup + chart + send + schedule), we
should resist exploding that into dozens of granular tools and instead keep the same consolidated shape
(e.g. one `build_deliverable` tool, not five). The "new hire" framing is directly usable for tightening our
existing tool `description` strings, most of which are currently short one-liners.

### 1.2 Structured outputs are now GA — not just a beta trick
**Finding:** `output_config.format` (JSON outputs) and `strict: true` (strict tool use) are both **generally
available** on the Claude API today, across current-generation models — this supersedes the earlier beta
header (`structured-outputs-2025-11-13`), which still works for a transition period but is deprecated.
Strict tool use works via grammar-constrained sampling: setting `"strict": true` on a tool definition
guarantees the `input` block matches the JSON Schema exactly — correct types, no missing required fields,
`additionalProperties: false` enforced — with **no retries needed for schema violations**. Their own example:
without strict mode Claude might emit `passengers: "two"` or `passengers: "2"` for an `int` field; with
`strict: true` it always emits `passengers: 2`.
**Source:** https://platform.claude.com/docs/en/build-with-claude/structured-outputs and
https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use (Claude Platform Docs — fetched
live; both required a longer `networkidle` wait via a raw `AsyncWebCrawler` call, the default 1s
`delay_before_return_html` in our pinned `fetch_page_markdown` returned an empty shell on this
React-rendered docs site)

**Applicability:** This is the single most directly actionable finding for the scheduling tool. Our
`SCHEDULE_COMMAND_TOOL` in `lib/email/schedule-command.ts` currently relies on a hand-written zod schema as
defense-in-depth *after* the model call, because the Anthropic tool-call contract alone doesn't guarantee
schema conformance. Adding `strict: true` to that tool definition would let Anthropic's own
grammar-constrained sampling guarantee `cadence` is one of the three enum values, `send_hour_et` is really
an integer 0–23, etc., *before* our zod layer ever runs — turning zod from "catch the model's mistakes"
into "catch a genuinely malformed request," which is a meaningfully stronger reliability floor for a
feature whose entire job is firing off recurring sends. Low-risk, additive change: same schema, one new
top-level key.

### 1.3 Tool Use Examples fix "valid JSON, wrong convention" — 72%→90% accuracy in Anthropic's own test
**Finding:** JSON Schema can express *type* but not *convention* — it can't tell the model that dates should
be `"2024-11-06"` not `"Nov 6, 2024"`, or that `user_id` follows the pattern `"USR-12345"`. Anthropic's new
`input_examples` field on a tool definition lets you attach 1–5 concrete example tool-call payloads
directly to the tool definition; the model infers format conventions and "which optional fields travel
together" from those examples. Their own measured lift: 72% → 90% accuracy on complex parameter handling.
Guidance: use realistic data (not `"string"`/`"value"`), show minimal/partial/full variants, and only add
examples where the correct usage genuinely isn't obvious from the schema alone.
**Source:** https://www.anthropic.com/engineering/advanced-tool-use (Anthropic Engineering, published Nov 24
2025 — fetched live)

**Applicability:** This maps almost exactly onto the ambiguity our own `send_hour_et` / `ambiguous_hour`
logic in `schedule-command.ts` already works around in prose ("convert '7am' → 7, '5pm' → 17, 'noon' → 12,
'midnight' → 0" — spelled out as system-prompt text). Attaching 3–4 `input_examples` to
`propose_email_schedule_action` (one weekly, one monthly, one clarify-case for a bare hour) would let the
model learn that convention from data instead of from an ever-growing paragraph of prose rules in
`buildSystemPrompt` — and is the officially-recommended fix for exactly the "similar tools, which one do I
use" and "which optional fields travel together" ambiguity our `create` vs `change-cadence` vs `clarify`
action split already runs into.

### 1.4 System-prompt trigger language: stop over-instructing tool use
**Finding:** Current-generation Claude models are more responsive to tool-triggering language than older
models, so the previously-recommended aggressive phrasing now **overtriggers**. Anthropic's explicit
before/after: replace `"CRITICAL: You MUST use this tool when..."` with plain `"Use this tool when..."`;
replace `"Default to using [tool]"` with `"Use [tool] when it would enhance your understanding of the
problem."` For parallel-safe tool calls, there's a documented `<use_parallel_tool_calls>` system-prompt
block pattern that explicitly tells the model to batch independent calls and never guess a parameter to
force parallelism — dependent calls must stay sequential.
**Source:** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
(Claude Platform Docs — fetched live)

**Applicability:** Worth a direct audit of our existing system prompts (`buildSystemPrompt` in
schedule-command.ts, the equivalent in author-doc.ts) for exactly this pattern — "Never invent an
audience_slug" and "do NOT guess: set action 'clarify'" are already appropriately plain, non-aggressive
instructions in the right style. If a future consolidated agent adds parallel-safe tools (e.g. "look up a
photo AND query the data lake for the same request"), the `<use_parallel_tool_calls>` block is the
vendor-documented way to get that without the model serializing unnecessarily or guessing missing params
to force parallelism.

---

## 2. Reliable scheduling / recurring-task tool-call patterns ("send every Monday 8am")

### 2.1 Natural language stays natural language in the schedule field — don't force cron at the UI boundary
**Finding:** A real production agent scheduler (Hermes Agent) accepts the `schedule` field as **either** a
cron expression **or** natural language directly — `"0 9 * * *"` or `"every 30 minutes"` / `"daily at
9am"` are both valid inputs to the same field; the system does the NL→cron normalization internally. Each
scheduled job spawns a **fresh agent per run** specifically so jobs don't pollute each other's context —
each tick wakes up clean, does its task, reports, and exits. Because a cron job's prompt executes
**unattended**, the scheduler explicitly scans job prompts for prompt-injection patterns before storing
them, and the docs call out that any job whose prompt "ingests outside content" (summarize this webpage,
read my inbox) should get a restricted toolset — the same caution you'd give an untrusted email.
**Source:** https://hermesatlas.com/dev/mcp-gateway-cron (Hermes Agent dev tutorial, Module 6 — fetched
live)

**Applicability:** Our `schedule-command.ts` already does the harder, more correct version of this: it
converts natural language to *typed, validated fields* (`cadence` + `day_of_week`/`day_of_month` +
`send_hour_et`), not to a raw cron string — which is actually the safer design since it's directly
composable with a zod schema and a human-readable confirmation ("every Monday at 8am ET"), and it never
lets an ambiguous cron string reach a cron parser silently. The one gap worth flagging: Hermes's
prompt-injection scanning point applies more to our *content-generation* side than our schedule-parsing
side — if a future "topic"/"scope_value" free-text field (already present, currently unconsumed per the
`SCOPE_CONSUMER_LIVE` gate in `schedule-command.ts`) ever feeds into a prompt that fetches external content
on each scheduled run, that's the moment to add an injection-scan step, not before.

### 2.2 Concrete NL→cron mapping and typed-task-kind pattern from a live MCP scheduler
**Finding:** A widely-used MCP scheduler server (58 GitHub stars, actively used with Claude Desktop) exposes
distinct typed tools per task kind rather than one generic "schedule anything" tool:
`add_command_task`, `add_api_task`, `add_ai_task`, `add_reminder_task` — each with its own required params
— plus generic `list_tasks` / `update_task` / `remove_task` / `enable_task` / `disable_task` /
`run_task_now`. Every add-task call takes a `do_only_once: bool` to distinguish one-shot from recurring in
the same call shape, rather than two separate tools. Their own worked example is literally our target
phrase: `schedule="0 9 * * 1"  # 9 AM every Monday` on an `add_ai_task` call named "Generate Weekly Report."
Other worked mappings: `0 */2 * * *` = every 2 hours, `0 9-17 * * 1-5` = hourly 9–5 weekdays,
`30 9 * * 2,4` = 9:30am Tuesday+Thursday.
**Source:** https://github.com/PhialsBasement/scheduler-mcp (README, fetched live — MCP Scheduler by
PhialsBasement)

**Applicability:** Validates the shape we already chose (typed cadence enum + day-of-week/month + hour,
rather than raw cron) over exposing cron syntax directly to either the LLM or the end user — cron strings
are exactly the kind of "valid JSON, wrong convention" ambiguity Tool Use Examples (finding 1.3) exists to
fix, and typed fields sidestep the whole problem. If Social AI's scheduling ever needs finer-grained
patterns than daily/weekly/monthly (e.g. "every 2 hours" for a social posting cadence), this confirms the
minimum typed-field vocabulary needed (interval unit + interval count + optional day/hour anchor) rather
than reaching for a raw cron string in the tool schema.

---

## 3. Grounding an agent's knowledge of a large/evolving tool catalog

### 3.1 Tool Search Tool: defer_loading + on-demand discovery — 85% token reduction, real accuracy gains
**Finding:** Loading all tool definitions upfront doesn't scale: Anthropic's own worked example — 5 MCP
servers (GitHub, Slack, Sentry, Grafana, Splunk) — was 58 tools consuming ~55K tokens before the
conversation even starts, and they've seen internal setups hit 134K tokens of tool definitions before
optimization. The **Tool Search Tool** (beta, `tool_search_tool_regex_20251119` or BM25/embeddings variant)
lets you mark individual tools `"defer_loading": true`; deferred tools are excluded from the initial prompt
entirely (so **prompt caching is preserved**) and only get expanded into full definitions after Claude
searches for them by name. Their benchmark: traditional loading ≈ 77K tokens consumed before any work
begins vs ≈ 8.7K tokens with Tool Search Tool — a 95% context-window preservation, and it's not just
token savings: Opus 4 accuracy on MCP evaluations went from 49%→74%, Opus 4.5 from 79.5%→88.1%, purely
from switching to on-demand tool discovery. Recommended rule of thumb: use it when tool definitions exceed
~10K tokens, you have 10+ tools, or you're seeing wrong-tool-selection errors; skip it for <10 tools or
tools used in every session. You can defer an entire MCP server's tools while keeping its most-used tool
(e.g. `search_files`) always loaded via `default_config.defer_loading: true` + a per-tool override.
**Source:** https://www.anthropic.com/engineering/advanced-tool-use (Anthropic Engineering, published Nov 24
2025 — fetched live)

**Applicability:** Not relevant to Email Lab / Social AI *today* — each currently makes isolated, single-tool
forced calls, nowhere near the 10-tool/10K-token threshold where this pays off. It becomes directly
relevant the moment these surfaces get unified into the "one agent, many tools" architecture implied by
this research task's framing (data lake + photo lookup + chart + send + schedule + brand + audience, all
in one loop) — at that point, mark the rarely-used tools (e.g. brand-enrichment, one-off photo lookup)
`defer_loading: true` and keep the 3–5 hottest tools (chart build, schedule command, author) always loaded,
per Anthropic's own recommendation to keep "your three to five most-used tools always loaded, defer the
rest."

### 3.2 Code execution with MCP: shift the tool catalog from context into a filesystem the agent can read on demand
**Finding:** A second, complementary pattern to Tool Search Tool: instead of loading tool *definitions* into
the model's context as text, generate a **file tree** of available tools (one file per tool, organized by
server — `servers/google-drive/getDocument.ts`, `servers/salesforce/updateRecord.ts`, etc.) inside a code
execution sandbox. The agent then writes code that imports and calls these functions directly, discovering
them by exploring the filesystem (`ls`, `read` a specific tool's file) rather than having every tool's
schema pre-loaded as text. Combined with **Programmatic Tool Calling** (writing orchestration code instead
of one-tool-call-per-inference-pass), Anthropic's own measured case: a workflow that cost ~150,000 tokens
with tools/results passed directly through the model dropped to ~2,000 tokens (98.7% reduction) when
reimplemented as generated code against a filesystem-backed tool tree. A second worked example: a
budget-compliance check across 20 team members that would normally push 2,000+ raw expense line items
(50KB+) into context instead runs entirely in the sandbox and returns only the 2–3 people who exceeded
budget (200KB raw data → 1KB result).
**Source:** https://www.anthropic.com/engineering/code-execution-with-mcp (Anthropic Engineering, published
Nov 4 2025 — fetched live)

**Applicability:** This is the pattern to reach for specifically once/if Email Lab AI or Social AI need to
process *large intermediate data* before the model reasons about it — e.g. "build me a chart of every ZIP
in Lee County's home value trend" pulling hundreds of rows from the data lake, where today's forced
single-tool-call pattern (`compose-chart.ts`) would have to pass the raw rows through the model's context
to select chart points. Progressive disclosure via a generated tool tree is the vendor-recommended
mechanism for "the agent should know its full tool catalog exists without paying the token cost of loading
all of it" — directly answering the "complete, reliable knowledge of all its tools" half of this research
task's brief, as distinct from the "call the right one correctly" half that findings 1.2/1.3 and 2.2
address.

---

## Summary of source URLs

| # | URL | Fetched via crawl4ai |
|---|---|---|
| 1 | https://www.anthropic.com/engineering/writing-tools-for-agents | yes |
| 2 | https://www.anthropic.com/engineering/advanced-tool-use | yes |
| 3 | https://www.anthropic.com/engineering/code-execution-with-mcp | yes |
| 4 | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | yes |
| 5 | https://platform.claude.com/docs/en/build-with-claude/structured-outputs | yes (required raw AsyncWebCrawler + `wait_until="networkidle"`, default helper returned empty) |
| 6 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use | yes (same as above) |
| 7 | https://github.com/PhialsBasement/scheduler-mcp | yes |
| 8 | https://hermesatlas.com/dev/mcp-gateway-cron | yes |
