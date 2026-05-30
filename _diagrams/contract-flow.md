# SWFL Data Gulf — Contract Flow

How a user gets answers to: _"How is NNN compared to Vanderbilt NNN, and tell me about each area's economic growth since Hurricane Ian?"_ — and how the contract holds on the follow-up.

Live token at capture: `SWFL-7421-v59-20260529` (master read: bearish).

---

## Picture 1 — The three-tier building (where the data lives)

```mermaid
flowchart TB
    subgraph T3["TIER 3 - CONVERSATION (the user's AI)"]
        U["User asks:<br/>NNN vs Vanderbilt NNN +<br/>growth since Hurricane Ian"]
    end

    subgraph T2["TIER 2 - MASTER (the only speculator)"]
        M["master dossier<br/>bearish thesis (conditional)<br/>falsifier<br/>grain = county-month<br/>token SWFL-7421-v59-20260529"]
    end

    subgraph T1["TIER 1 - REPORTERS (cited facts, no opinions)"]
        direction LR
        CRE["cre-swfl<br/>NNN $/sqft per corridor<br/>your area vs Vanderbilt Beach"]
        MAC["macro-swfl<br/>jobs / permits / recovery<br/>since Ian (BLS LAUS)"]
        ENV["env-swfl<br/>flood / storm modifier"]
    end

    U -->|"1 FETCH master @tier=2"| M
    M -->|"2 ROUTE: detail lives below"| CRE
    M -->|"2 ROUTE"| MAC
    CRE -->|"facts + source URLs"| M
    MAC -->|"facts + source URLs"| M
    ENV -.->|"modifier"| M
    M -->|"3 cited answer + token quoted once"| U

    style T3 fill:#1f3a5f,color:#fff
    style T2 fill:#5a3a6f,color:#fff
    style T1 fill:#1f5f3a,color:#fff
```

---

## Picture 2 — Step-by-step flow for the first question

```mermaid
flowchart TD
    START(["Question arrives"]) --> SHAPE{"What shape?<br/>analytical comparison"}
    SHAPE -->|"tier 2 default"| FETCH["FETCH master<br/>(this conversation)"]

    FETCH --> TOKEN["Quote token<br/>SWFL-7421-v59-20260529"]
    TOKEN --> NEED{"Does master hold<br/>the record-level detail?"}

    NEED -->|"No - NNN per corridor<br/>+ per-area recovery<br/>live BELOW master"| ROUTE["ROUTE to upstreams"]
    ROUTE --> A["cre-swfl:<br/>NNN your area vs Vanderbilt"]
    ROUTE --> B["macro-swfl:<br/>jobs/permits since Ian"]

    A --> GATE
    B --> GATE
    NEED -->|"Yes - the thesis"| GATE

    GATE["Apply the 5 rules:<br/>1 CITE  2 TAG INFERENCE<br/>3 STOP AT GRAIN<br/>4 ONLY MASTER SPECULATES<br/>5 PLAIN ENGLISH"]
    GATE --> OUT(["Cited side-by-side answer<br/>+ master's conditional thesis<br/>+ caveats"])

    style START fill:#1f3a5f,color:#fff
    style OUT fill:#1f5f3a,color:#fff
    style GATE fill:#5a4a1a,color:#fff
    style TOKEN fill:#7a5a20,color:#fff
```

---

## Picture 3 — The follow-up (Tier 3 stands on the payload it already has)

```mermaid
flowchart TD
    FU(["Follow-up question"]) --> CHECK{"Answerable from the<br/>dossier already fetched?"}

    CHECK -->|"Yes<br/>'which area has lower vacancy?'"| CACHE["TIER 3: reason over<br/>cached dossier - NO re-fetch"]
    CACHE --> RECITE["Re-cite from SAME payload<br/>token already quoted"]
    RECITE --> FAST(["Instant answer"])

    CHECK -->|"Crosses the grain<br/>'NNN for one named tenant?'"| STOP(["STOP AT GRAIN:<br/>say what we DON'T have.<br/>No invented number."])

    CHECK -->|"Asks for a prediction<br/>'will rents keep rising?'"| MASTER(["Only master speculates:<br/>restate conditional thesis<br/>+ falsifier"])

    CHECK -->|"Token aged out"| REFETCH(["Re-FETCH master<br/>quote the NEW token"])
    REFETCH --> CHECK

    style FU fill:#1f3a5f,color:#fff
    style FAST fill:#1f5f3a,color:#fff
    style STOP fill:#7a2020,color:#fff
    style MASTER fill:#5a3a6f,color:#fff
```
