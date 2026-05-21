# Session Notes — 2026-05-21

## Brain Protocol Instructions (paste into Claude)

SWFL Intelligence Lake — data protocol (v2.1, always follow):

1. FETCH FRESH. Before answering any franchise or CRE question, fetch
   https://brain-platform-amber.vercel.app/api/b/master?v=4 in THIS conversation.
   Never answer from memory, project knowledge, earlier messages, or a cached
   copy — only from a fetch made in this conversation.
2. PROVE IT'S LIVE. The payload frontmatter carries a `freshness_token`
   (format SWFL-7421-v{n}-{YYYYMMDD}). Quote it verbatim in your first
   response. If you cannot fetch, say so — never answer from stale context.
3. ROUTE, DON'T GUESS. The master index is a directory. When it gives a
   count but points to a sub-brain for the names/detail, fetch that sub-brain
   (franchise-outcomes, cre-swfl) before answering. Do not infer the detail.
4. READ RATES AS WRITTEN. Survival rates are stated explicitly and are always
   over RESOLVED loans. Never recompute a rate from loan counts; never treat a
   "total loans" number as a denominator.
5. RIGID SECTIONS. Every response — even small-talk and one-liners — MUST
   emit exactly the six section headers below in this order, as level-3
   Markdown headings:
   `### §Receipts` → `### §Hard Edges` → `### §Live-Sources` →
   `### §Speculation` → `### §User-Supplied Data` → `### §Handoff`.
6. SECTION OWNERSHIP. §Receipts / §Hard Edges / §Live-Sources / §User-Supplied Data
   are QUOTE-ONLY zones. §Speculation is the LICENSED ANALYTICAL ZONE — projections,
   scenario analysis, pattern-matching, base-rate priors expected here.
7. SHOW YOUR WORK IN §SPECULATION. Every projection must: (a) cite §Receipts items
   it builds on, (b) name the inferential move, (c) carry an inline [INFERENCE] tag,
   (d) state one condition that would falsify the call.
8. NO SMOOTHING. Quantify projections numerically. No numeric_softening or
   prose_confidence_translation anywhere.

---

## MCP Trigger Strategy

### How Claude decides when to fetch a brain

- Topic trigger (not geography trigger) — "Punta Gorda retail vacancy" fetches, "Punta Gorda weather" does not
- Tool description scopes the trigger — name the DATA DOMAINS not the geography
- System prompt explicit rules close the gap for ambiguous middle cases
- Current rules cover ~15% of the legitimate user surface

### Current trigger gaps

The CRE/franchise/broker rules miss most of the user surface. Every category below
needs its own trigger scope.

---

## Full Professional / Use-Case Expansion

### Finance & Investment

- CRE investors, franchise buyers/sellers, lenders/underwriters
- REIT analysts, private equity (real assets), business brokers, appraisers

### Built Environment

- Commercial brokers, residential developers, homebuilders
- Architects, urban designers, land use attorneys, title companies, property managers

### Government & Planning

- City/county planners, transportation engineers, school district planners
- Utility planners, emergency managers, economic development officers
- Port/airport authorities, elected officials

### Healthcare & Social Services

- Hospital system planners, senior living developers, home health agencies
- Non-profits, public health departments, pharmacy chains (site selection)

### Retail & Hospitality

- Retail site selectors, restaurant chains, hotel/resort investors
- Tourism boards/CVBs, marina operators, entertainment venue developers

### Logistics & Industrial

- 3PLs and freight companies, industrial/warehouse developers
- Supply chain consultants, port logistics operators, last-mile delivery planners

### Energy & Environment

- Solar/renewable developers, environmental consultants
- Utility companies, insurance risk modelers

### Professional Services

- CRE attorneys, business attorneys, CPAs advising business buyers
- Relocation companies, staffing/workforce firms

### Media, Research & Policy

- Local journalists, university researchers, think tanks
- Political consultants, advocacy organizations

### Community / Non-Professional

- Residents wanting to understand their neighborhood
- Families choosing where to live or which school district
- Retirees evaluating SWFL relocation
- Anyone asking "is this a good place for X"

---

## Data We Don't Have Yet — Easy to Acquire

| Data                            | Source              | Cost     | Unlocks                                |
| ------------------------------- | ------------------- | -------- | -------------------------------------- |
| School performance + enrollment | FLDOE               | Free     | Parents, school planners, developers   |
| Healthcare facility density     | CMS/AHCA            | Free     | Healthcare planners, senior living     |
| Pet ownership by area           | AVMA + ACS proxy    | Low      | Vets, pet retail, groomers             |
| Short-term rental inventory     | AirDNA/Transparent  | ~$200/mo | Hospitality, housing policy            |
| Crime data by block group       | FDLE                | Free     | Homebuyers, retailers, insurance       |
| Utility connection permits      | County records      | Free     | Growth forecasting, developer siting   |
| Building permits                | County              | Free     | Construction pipeline                  |
| Medicare/Medicaid enrollment    | CMS                 | Free     | Senior living, healthcare, pharmacy    |
| Solar permit density            | County + FDEP       | Free     | Solar installers, energy companies     |
| Marina slip inventory           | FWCC                | Free     | Marine industry, waterfront developers |
| Broadband availability          | FCC                 | Free     | Telecom, remote work migration         |
| Water/sewer capacity            | Utility authorities | Free     | Developers, city planners              |

---

## Synthetic Insight Layer (where combination creates instinct)

| Combination                                                      | Insight                                                                   | Who it serves                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| ACS age + Medicare density + healthcare gaps                     | "This zip is aging fast with no capacity"                                 | Senior living, healthcare, policy             |
| FAF5 + FDOT trends + CBP warehouse density                       | "This corridor breaks in 4 years"                                         | Planners, logistics investors, industrial CRE |
| ACS household size + school enrollment decline + permit activity | "Family formation collapsing while inventory builds"                      | School districts, developers                  |
| FEMA risk + ACS income + insurance penetration                   | "High-risk, low-income, underinsured"                                     | Emergency mgmt, non-profits, insurance        |
| STR density + hospitality occupancy + population growth          | "Long-term supply consumed by STRs faster than built"                     | Housing policy, workforce housing             |
| Pet ownership proxy + income + traffic + retail gaps             | "Underserved for pet services by 3x vs comparable metros"                 | Vets, pet retail chains                       |
| CBP business mix + ACS workforce + freight flows                 | "Labor pool + logistics access for light manufacturing — nobody knows it" | Economic development, site selectors          |

---

## Value Assessment

### Brain MCP alone vs baseline Claude

- Baseline Claude: confident guesser on local specifics
- With Brain MCP: genuine market analyst with ground truth, freshness tokens, confidence scores
- Scale 1 to 1 trillion: **~50 billion**
- Key shift: stops hallucinating local data, starts citing verified current numbers

### Brain MCP + Clean Company Data

- Adds: their deal history, client outcomes, internal patterns
- Creates: ability to show where company diverges from market and why
- Closes the loop between market truth and company truth
- Scale 1 to 1 trillion: **~900 trillion**
- Key shift: from reactive (answering questions) to proactive (surfacing things they didn't know to ask)

### Pricing sanity check

- $20-500/month depending on single user vs enterprise
- A CRE broker making one better deal covers years of fees
- A franchise buyer avoiding one bad territory covers a lifetime of fees
- Not having this when competitors do is functionally operating blind

---

## The Problem with This Session System

Web sessions (claude.ai/code) and terminal sessions (Claude Code CLI) are isolated.
Conversations don't sync between them. This file is the workaround — key content
committed to the repo so it survives and is accessible anywhere via git pull.

Next step: lobby Anthropic to fix this. It should just work.

---

## Common Commands

### Get the notes on any computer

```powershell
cd brain-platform
git pull
cat .claude/session-notes.md
```

### First time on a new computer (clone the repo)

```powershell
git clone https://github.com/ethanrickyjrjr-wq/brain-platform.git
cd brain-platform
cat .claude/session-notes.md
```

### Manually save and push notes

```powershell
git add .claude/session-notes.md
git commit -m "notes update"
git push
```

### Tell any Claude session to save notes before closing

Just say: "Add the key points from this conversation to .claude/session-notes.md and push."

### Start Claude Code in terminal

```powershell
cd brain-platform
claude
```

---

## Topic: AI Market Analysis / Competitive Positioning

### Why the "too many competitors" objection is partially right

- OpenAI, Google, Anthropic are absorbing "brain as a feature" natively into model layers (Projects, Memory, long-context windows)
- Mem.ai, Rewind, Glean, Notion AI have raised $100M+ on generic AI memory
- Expanding context windows reduce the need for some external retrieval architectures
- Big players own the chat surface where context lives — distribution advantage is real

### Why the objection misidentifies the competition

- The crowded space is _generic AI memory_ — this platform is a domain-specific, trust-scored, freshness-tracked intelligence layer with auditable provenance
- No well-funded generalist is building a verifiable regional intelligence layer with domain-locked freshness guarantees — too specific, too liability-adjacent, too low-volume for them
- The real moat is data curation discipline and the consumption contract, not AI plumbing
- OpenAI will never own liability for whether a Southwest Florida cap rate is stale
- The real competitors are CoStar, ESRI, Dun & Bradstreet — not OpenAI — and they lack the AI layer and small-business pricing model

### Core value thesis (validated in discussion)

- **Historical ground-truth beats statistical averages for decisions.** Example: 15 pizza places failing at a location over 30 years is a verdict no foot-traffic aggregate overrules.
- **Temporal pattern recognition.** Matching analogous macro conditions across time (e.g., war-period market patterns) requires 10-year context that 1–2 year data windows miss entirely.
- **Pricing gap.** Enterprise data brokers charge $10K–$50K/year minimum, locking out franchisees, solo CRE investors, and regional operators — exactly who needs it most.
- **Data cleaning + combination compounds advantage.** Curated, combined, validated data gives small operators an edge over local competitors for far less than enterprise pricing.

### Actual risks (not the soft concerns)

1. **Data acquisition is the hardest part** — address-level business open/close history is messy, incomplete, often paywalled (SBA records, state business licenses, D&B). This is years of ingestion work.
2. **Geographic moat builds slowly** — deep in SWFL is powerful; national requires market-by-market data-acquisition grind or a partnership/acquisition strategy.
3. **Small business distribution is expensive** — reaching franchisees and solo operators costs more per customer than enterprise sales; unit economics need to be modeled carefully.
4. **Signal validation risk** — historical pattern matching (war analogies, cycle comparisons) must distinguish analogous conditions from superficially similar ones, or it produces overconfident noise.
5. **CoStar/ESRI down-market risk** — if they add an AI wrapper and move down-market, they have a head start on the data moat.

### Strategic framing

- The idea is sound. The concern is **execution sequence**: value is in the data, data is hard to get, target customers are hard to reach cheaply.
- None of the above are dealbreakers — they are the actual problems to solve.
