# Grounded Web-Search API Research — 2026-05-26

Background research for the corridor character generator (`docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`, Step 1). Performed via background agent run on 2026-05-26 using live WebFetch / WebSearch against vendor docs. Every field name and parameter below was extracted from a doc page fetched in-session; nothing from training data.

---

## Headline recommendation

**Anthropic's `web_search_20260209` tool is the strongest pick** for the SWFL corridor-character pipeline. It is the only vendor in the field that returns **per-claim citations** (`citations: [{ url, title, cited_text, encrypted_index }]` attached to specific text blocks, not just a flat URL list at the bottom), which is exactly the contract a "every line traces to a source" guardrail needs. It is GA on Opus 4.7 and Sonnet 4.6, supports `allowed_domains` / `blocked_domains` for steering toward primary sources (county portals, broker reports, NAR/FAR), and ships with the same Anthropic SDK Brains already uses — no second auth surface. Reservations: searches are LLM-decided (Claude picks query and frequency, capped by `max_uses`), not deterministic; and the underlying index provider/freshness window is not stated in docs. If we need explicit "give me primary-source URLs for this exact query string and let me do my own synthesis," **Tavily** is the right secondary tool — it returns a clean structured `results[]` array with `score` and `raw_content`, which is closer to a search primitive than a grounded-LLM response.

## Comparison table

| Vendor                      | Citation format                                                                                            | Source diversity                                                                                        | Maturity                                                                                              | Recency                                                               | Domain filter                                                 | Example shape                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Anthropic web_search**    | Per-claim block: `citations:[{url,title,cited_text,encrypted_index}]` attached to each text segment        | Open web; not stated which underlying index                                                             | GA on Opus 4.7 / Sonnet 4.6; latest tool `web_search_20260209`                                        | `page_age` per result; not stated                                     | `allowed_domains`, `blocked_domains`, `user_location`         | High (multi-block content[] with tool_use + result + cited text) |
| **Google Gemini grounding** | Per-span: `groundingSupports[].segment{startIndex,endIndex}` → `groundingChunks[].web.uri`                 | Open web (real-time); chunks proxied via `vertexaisearch.cloud.google.com` URLs, not raw publisher URLs | GA on Gemini 2.5 Pro/Flash                                                                            | "Real-time"; not quantified                                           | None documented                                               | Medium (nested groundingMetadata, but URIs are Vertex redirects) |
| **Perplexity Sonar**        | Per-response flat list: `citations: ["url1","url2"]` + richer `search_results[]`                           | Open web + `search_mode: web\|academic\|sec`                                                            | Production; no explicit GA/beta label                                                                 | `search_recency_filter`, `search_after_date_filter`, `last_updated_*` | `search_domain_filter`                                        | Low (chat-completions shape + URL array)                         |
| **OpenAI web_search**       | Per-span: `annotations:[{type:"url_citation",start_index,end_index,url,title}]` + separate `sources` field | Open web + third-party feeds (`oai-sports`, `oai-weather`, `oai-finance`)                               | GA (`web_search`); `web_search_preview` legacy                                                        | `search_context_size: low\|med\|high`; no explicit time filter        | `filters.allowed_domains` / `blocked_domains` (≤100)          | Medium (Responses API content[] with annotations)                |
| **Tavily**                  | No per-claim citations; structured `results[]` with `url,title,content,score,raw_content`                  | Open web; "mainstream media" for news topic                                                             | Production v1.0; no beta label                                                                        | `time_range: day\|week\|month\|year`; `start_date`/`end_date`         | `include_domains` (≤300), `exclude_domains` (≤150)            | Low (clean results[] + optional `answer`)                        |
| **Brave Search**            | No citations; raw web results `web.results[]` with `url,title,description,age`                             | Brave's independent crawler index                                                                       | Production                                                                                            | `freshness: pd\|pw\|pm\|py` + custom dates                            | `goggles` re-ranker; no native allowlist (use site: operator) | Low (web index response, BYO synthesis)                          |
| **You.com**                 | No per-claim citations on /search; Research API does inline `[[1,3]]`-style with `output.sources[]`        | Open web                                                                                                | Search: GA; Research: GA with beta `source_control`/`output_schema` fields; Deep Search: early access | `page_age` field on results; not stated freshness window              | Not documented in quickstart                                  | Low (search) / Medium (research with effort levels)              |

## Per-vendor sections

### 1. Anthropic web search tool

**A. Citation contract.** Structured and **per-claim**. Each assistant text block can carry a `citations` array of `web_search_result_location` objects with `url`, `title`, `cited_text` (≤150 chars), and `encrypted_index` (opaque token for multi-turn replays). Separately, the `web_search_tool_result` block lists the raw fetched pages with `url`, `title`, `page_age`, and `encrypted_content`. This is the only vendor in this set where Claude's prose is decomposed into spans and each span carries its own provenance — exactly the shape a "trace every line to a source" auditor wants.

**B. Source diversity.** Open web. Docs do not name the underlying search provider. The Wikipedia example in the docs suggests it can hit aggregators; `allowed_domains` / `blocked_domains` are the lever for steering toward primary sources (county portals, FDOT, NAR, broker pages).

**C. Maturity.** GA. Latest version `web_search_20260209` (with dynamic filtering via code execution); previous `web_search_20250305` remains available. Supported on Claude API, Microsoft Foundry, Vertex AI (basic tool only). Not on Bedrock. First-party Python and TypeScript SDKs both shown in docs.

**D. Recency.** Each `web_search_result` carries `page_age` (string, e.g. "April 30, 2025"), but the docs do not state how fresh the underlying index is.

**E. Auth + wiring.** `ANTHROPIC_API_KEY` (already wired in Brains). Web search must be enabled by the org admin in the Claude Console under `/settings/privacy`. Pricing $10 per 1,000 searches plus token costs (a rounding error for 104 calls/year).

**F. Filtering.** `allowed_domains` and `blocked_domains` arrays. `user_location` for localization (`city`, `region`, `country`, `timezone`). `max_uses` to cap search count per request.

**G. Failure modes.** API returns 200 even on tool errors; check `web_search_tool_result_error` with `error_code` in {`too_many_requests`, `invalid_input`, `max_uses_exceeded`, `query_too_long`, `unavailable`}. No documented "no relevant results → hallucinate" behavior.

**H. Sample.**

```json
{
  "type": "text",
  "text": "Claude Shannon was born on April 30, 1916, in Petoskey, Michigan",
  "citations": [
    {
      "type": "web_search_result_location",
      "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
      "title": "Claude Shannon - Wikipedia",
      "encrypted_index": "Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..",
      "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician..."
    }
  ]
}
```

**Verdict for SWFL CRE corridor research: yes, primary pick.** Per-claim citation contract maps cleanly onto the project's "every prose line traces to source" rule. Already using the SDK.

---

### 2. Google Gemini grounded search

**A. Citation contract.** Structured and **per-span**: `candidates[0].groundingMetadata.groundingSupports[]` carries `segment.startIndex` / `segment.endIndex` / `segment.text` plus `groundingChunkIndices` pointing into `groundingChunks[].web.{uri,title}`. Caveat: the `uri` is a `vertexaisearch.cloud.google.com/...` redirect, not the raw publisher URL — you have to resolve or display via Google's redirector, which adds a step for "show source URL in the report."

**B. Source diversity.** Real-time open web. Documented examples reference `aljazeera.com`, `uefa.com`. No domain steering.

**C. Maturity.** GA on Gemini 2.5 Pro and 2.5 Flash. Doc page last updated 2026-05-18. First-party Python + Node SDKs.

**D. Recency.** "Real-time web content"; no quantified freshness window.

**E. Auth + wiring.** `GEMINI_API_KEY` via `x-goog-api-key` header. Free tier exists; paid tier requires Google Cloud billing.

**F. Filtering.** None documented.

**G. Failure modes.** Not addressed in the docs page fetched.

**H. Sample.**

```json
{
  "groundingChunks": [
    {
      "web": {
        "uri": "https://vertexaisearch.cloud.google.com.....",
        "title": "aljazeera.com"
      }
    },
    {
      "web": {
        "uri": "https://vertexaisearch.cloud.google.com.....",
        "title": "uefa.com"
      }
    }
  ],
  "groundingSupports": [
    {
      "segment": {
        "startIndex": 0,
        "endIndex": 85,
        "text": "Spain won Euro 2024, defeatin..."
      },
      "groundingChunkIndices": [0]
    }
  ]
}
```

**Verdict: capable but second-class for this pipeline.** Vertex-redirected URIs make "render a clean primary-source citation in the corridor report" annoying. No domain steering closes off the "force this to query county-level sources" play. Pick if we want Gemini-2.5-Pro reasoning specifically.

---

### 3. Perplexity Sonar API

**A. Citation contract.** **Per-response flat list**, not per-claim. Top-level `"citations": ["url1","url2",...]` array of source URLs used to produce the answer. A richer `"search_results"` array (with `title` and structured fields) is also returned. Annotations of type `"citation"` with `url` exist inside message content per docs but not span-anchored the way Anthropic/OpenAI offer.

**B. Source diversity.** Open web. `search_mode` accepts `web`, `academic`, `sec` — the SEC mode is interesting for any future financial-disclosure brain but isn't load-bearing for SWFL CRE.

**C. Maturity.** Production. No explicit GA/beta label in docs. Models: `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`. First-party Python SDK; community TS SDKs.

**D. Recency.** Best-in-class explicit filters: `search_recency_filter` (`hour`/`day`/`week`/`month`/`year`), `search_after_date_filter`, `search_before_date_filter`, `last_updated_before_filter`, `last_updated_after_filter` (all `MM/DD/YYYY`).

**E. Auth + wiring.** `PERPLEXITY_API_KEY` via `Authorization: Bearer`. Sign up at console.perplexity.ai. Pay-as-you-go.

**F. Filtering.** `search_domain_filter` (allow/block specific domains, e.g. `github.com`, `wikipedia.org`).

**G. Failure modes.** Not addressed in the fetched docs page.

**H. Sample (shape inferred from documented schema; Perplexity docs do not embed a full populated response in the pages fetched):**

```json
{
  "id": "...",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Lionel Messi won the 2022 World Cup with Argentina...",
        "annotations": [
          { "type": "citation", "url": "https://example.com/article1" }
        ]
      }
    }
  ],
  "citations": ["https://example.com/article1", "https://example.com/article2"],
  "search_results": [
    { "title": "Article title", "url": "https://example.com/article1" }
  ]
}
```

**Verdict: strong filtering, weak citation granularity.** The per-response URL list is fine for "list the sources we used" but doesn't give you "this exact sentence came from this exact URL." Better than Tavily/Brave because you do get prose synthesis; worse than Anthropic/OpenAI on the audit story.

---

### 4. OpenAI web search

**A. Citation contract.** Structured per-span: `annotations: [{ type: "url_citation", start_index, end_index, url, title }]` inside `output_text` content. Plus a separate `sources` field (via `include: ["web_search_call.action.sources"]`) listing the complete URL set the model consulted — typically broader than the inline citation set. Some entries carry third-party feed labels (`oai-sports`, `oai-weather`, `oai-finance`).

**B. Source diversity.** Open web plus the labeled third-party feeds above. No CRE-specific feed but `filters.allowed_domains` lets us pin to primary sources.

**C. Maturity.** `web_search` is GA on `gpt-5.5`, `gpt-4.1`, `gpt-4.1-mini`, and `gpt-5-search-api` (Chat Completions). `web_search_preview` legacy, limited features. `gpt-4o-search-preview` deprecated, shutdown 2026-07-23. First-party Python + Node SDKs.

**D. Recency.** Not stated as a date filter; `search_context_size: low|medium|high` is the lever for how much content to pull. No explicit `time_range` parameter found in docs.

**E. Auth + wiring.** `OPENAI_API_KEY` via `Authorization: Bearer`.

**F. Filtering.** `filters.allowed_domains` and `filters.blocked_domains` (≤100 each). `user_location` (`{type:"approximate", country, city, region, timezone}`). `external_web_access` boolean. `return_token_budget`.

**G. Failure modes.** Not addressed in the doc section fetched.

**H. Sample.**

```json
[
  {
    "type": "web_search_call",
    "id": "ws_...",
    "status": "completed",
    "action": { "type": "search", "query": "latest news about AI" }
  },
  {
    "id": "msg_...",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "On March 6, 2025, several news...",
        "annotations": [
          {
            "type": "url_citation",
            "start_index": 2606,
            "end_index": 2758,
            "url": "https://...",
            "title": "Title..."
          }
        ]
      }
    ]
  }
]
```

**Verdict: a very close second to Anthropic.** Same per-span citation quality, similar domain filtering. Anthropic wins only on "already wired into Brains" and a slightly cleaner content-block model. Pick OpenAI if there's a model-quality reason on a specific corridor.

---

### 5. Tavily

**A. Citation contract.** No per-claim citations. Returns a structured `results[]` array with `title`, `url`, `content` (short description), `score` (float relevance), optional `raw_content` (cleaned HTML), `favicon`, `images`. Optional top-level `answer` field if requested.

**B. Source diversity.** Open web. Docs mention "mainstream media sources" for the news topic but don't otherwise describe the index.

**C. Maturity.** Production v1.0. No beta label. First-party Python and JS SDKs.

**D. Recency.** `time_range: day|week|month|year`, plus `start_date` / `end_date` (`YYYY-MM-DD`).

**E. Auth + wiring.** `TAVILY_API_KEY`, key format `tvly-...`. Bearer auth.

**F. Filtering.** `include_domains` (≤300), `exclude_domains` (≤150). Best-in-class allowlist size — useful for "only ever search these 40 SWFL county portals + 12 broker sites."

**G. Failure modes.** HTTP error codes documented: 400 (invalid topic), 401 (bad key), 429 (rate limit), 432 (plan limit), 433 (pay-as-you-go limit), 500 (internal). No hallucination concern because Tavily is a search primitive, not a synthesizer.

**H. Sample.**

```json
{
  "query": "Who is Leo Messi?",
  "answer": "Lionel Messi, born in 1987, is an Argentine footballer...",
  "results": [
    {
      "title": "Lionel Messi Facts | Britannica",
      "url": "https://www.britannica.com/facts/Lionel-Messi",
      "content": "Lionel Messi, an Argentine footballer, is widely regarded...",
      "score": 0.81025416,
      "favicon": "https://britannica.com/favicon.png"
    }
  ],
  "response_time": 1.67,
  "usage": { "credits": 1 }
}
```

**Verdict: best secondary tool.** Use Tavily when we want explicit "go fetch these URLs from this domain allowlist and hand them to me as structured rows" — i.e. the pipeline does its own synthesis with an LLM step after. Pair with Anthropic for hybrid: Tavily fetches → Claude synthesizes with cited spans.

---

### 6. Brave Search

**A. Citation contract.** None. Brave is a raw search index: `web.results[]` with `url`, `title`, `description`, plus `age`, `profile`, `extra_snippets` (optional).

**B. Source diversity.** Brave's independent crawler (one of the few non-Bing, non-Google indices). Strong for "we want a different point of view than the duopoly."

**C. Maturity.** Production. No explicit GA label but stable; widely used.

**D. Recency.** `freshness: pd|pw|pm|py` (past day/week/month/year) plus custom date ranges.

**E. Auth + wiring.** `X-Subscription-Token` header. Sign up at api-dashboard.search.brave.com. Free tier exists.

**F. Filtering.** No native allowlist parameter; use the `site:` query operator. `goggles_id` re-ranker for custom ranking profiles. `country`, `search_lang`, `ui_lang`, `count` (1–20), `offset` (0–9), `safesearch`, `extra_snippets`, `summary`.

**G. Failure modes.** Not documented in the pages fetched.

**H. Sample.** Brave's docs pages do not embed a full populated JSON response — only the schema with collapsed child attributes. Shape (from schema): `{ type: "search", query: {original, ...}, web: { results: [{url, title, description, age, profile, language, ...}] } }`.

**Verdict: skip for this pipeline.** No synthesis, no citation contract, no first-party allowlist. We'd be bolting an LLM on top to get prose — at which point Anthropic+Tavily is simpler.

---

### 7. You.com YouAPI

**A. Citation contract.** /search returns `results.web[]` with `url`, `title`, `description`, `snippets`, `page_age`, `authors`, `favicon_url` — no per-claim citations. /research returns prose with inline `[[1,3]]`-style markers and an `output.sources[]` array (`url`, `title`, `snippets`).

**B. Source diversity.** Open web. Research API claims #1 on DeepSearchQA benchmark (83.67% accuracy).

**C. Maturity.** /search GA. /research GA but ships `source_control` and `output_schema` as beta fields. Deep Search API in early access. First-party Python SDK shown in quickstart.

**D. Recency.** `page_age` field present; no documented time-range filter on /search.

**E. Auth + wiring.** `X-API-Key` header. Sign up at you.com/platform with $100 in complimentary credits, no credit card.

**F. Filtering.** Not documented in the quickstart fetched. /research has a `research_effort` knob (`lite|standard|deep|exhaustive`).

**G. Failure modes.** Not documented in the pages fetched.

**H. Sample.**

```json
{
  "results": {
    "web": [
      {
        "url": "string",
        "title": "string",
        "description": "string",
        "snippets": ["string"],
        "page_age": "2024-01-15T10:30:00Z",
        "contents": { "html": "string", "markdown": "string" },
        "authors": ["string"],
        "favicon_url": "string"
      }
    ]
  },
  "metadata": {
    "search_uuid": "uuid-string",
    "query": "string",
    "latency": 0.123
  }
}
```

**Verdict: interesting on /research, skip for this pipeline.** /search is in the same "raw index, no citations" tier as Brave. /research is closer to Perplexity Sonar Deep Research — but the inline `[[1,3]]` markers are span-anchored only in the prose, not in API metadata you can post-process. Worth a second look if the corridor narrative goal becomes "deep multi-source research report per corridor" rather than "quarterly grounded prose refresh."

---

## Sources fetched (this session, 2026-05-26)

| URL                                                                                 | Vendor     | Status                                      |
| ----------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| https://ai.google.dev/gemini-api/docs/grounding                                     | Google     | OK                                          |
| https://ai.google.dev/gemini-api/docs/google-search                                 | Google     | OK                                          |
| https://docs.perplexity.ai/api-reference/chat-completions-post                      | Perplexity | OK                                          |
| https://docs.perplexity.ai/getting-started/quickstart                               | Perplexity | OK                                          |
| https://docs.perplexity.ai/getting-started/models                                   | Perplexity | OK                                          |
| https://docs.perplexity.ai/guides/getting-started                                   | Perplexity | partial / no example JSON                   |
| https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/web-search-tool | Anthropic  | OK (after redirect from docs.anthropic.com) |
| https://developers.openai.com/api/docs/guides/tools-web-search                      | OpenAI     | OK                                          |
| https://platform.openai.com/docs/guides/tools-web-search                            | OpenAI     | 403 (use developers.openai.com mirror)      |
| https://docs.tavily.com/documentation/api-reference/endpoint/search                 | Tavily     | OK                                          |
| https://api.search.brave.com/app/documentation/web-search/get-started               | Brave      | 403                                         |
| https://api-dashboard.search.brave.com/app/documentation/web-search/get-started     | Brave      | OK                                          |
| https://api-dashboard.search.brave.com/api-reference/web/search/get                 | Brave      | OK (no populated example)                   |
| https://api-dashboard.search.brave.com/api-reference/web/search/post                | Brave      | OK (no populated example)                   |
| https://you.com/docs/quickstart                                                     | You.com    | OK                                          |
| https://you.com/docs/api-reference/search/v1-search                                 | You.com    | OK                                          |
| https://docs.you.com/docs/api-overview                                              | You.com    | 404 (page moved)                            |

All fetches performed live during the agent run via WebFetch / WebSearch. No claim above is from training data — every field name and parameter was extracted from a doc page fetched on 2026-05-26. Where a vendor's docs did not state an answer (failure modes, freshness window, populated JSON sample), the agent marked it "not stated" / "not addressed" rather than guessing.
