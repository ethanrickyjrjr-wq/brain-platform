# Outside-eyes audit of swfldatagulf.com via Firecrawl agent.
# Burns ~1 agent run. Capped at 200 credits.
#
# Usage:   pwsh ./scripts/firecrawl-outside-eyes-audit.ps1
# Output:  .firecrawl/outside-eyes-audit-<timestamp>.json

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = ".firecrawl"
$outFile = Join-Path $outDir "outside-eyes-audit-$timestamp.json"
$schemaFile = "scripts/firecrawl-outside-eyes-schema.json"

if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
if (-not (Test-Path $schemaFile)) { throw "Schema file missing: $schemaFile" }

# URLs the agent should focus on. Order matters — agent reads top-down.
# Trimmed to 10 load-bearing URLs after first run hit credit cap:
#   - landing + connect (what the product CLAIMS + onboarding surface)
#   - master tier=3 (densest caveats payload; references all upstream brains)
#   - 6 upstream brain endpoints with the richest caveats / known data issues
#   - 1 user-facing report (HTML render of the same brain)
$urls = @(
    "https://www.swfldatagulf.com/",
    "https://www.swfldatagulf.com/connect",
    "https://www.swfldatagulf.com/api/b/master?view=speak&tier=3&v=5",
    "https://www.swfldatagulf.com/api/b/permits-swfl?view=speak&tier=2",
    "https://www.swfldatagulf.com/api/b/cre-swfl?view=speak&tier=2",
    "https://www.swfldatagulf.com/api/b/env-swfl?view=speak&tier=2",
    "https://www.swfldatagulf.com/api/b/macro-swfl?view=speak&tier=2",
    "https://www.swfldatagulf.com/api/b/traffic-swfl?view=speak&tier=2",
    "https://www.swfldatagulf.com/api/b/properties-lee-value?view=speak&tier=2",
    "https://www.swfldatagulf.com/r/master"
) -join ","

# The brief. Tight, no-fluff, gives the agent enough anchor to evaluate
# without spoon-feeding our internal nomenclature or framing.
$prompt = @'
You are auditing SWFL Data Gulf, a public-facing intelligence platform for Southwest Florida (Lee and Collier counties).

WHAT THIS PRODUCT IS (anchor, not gospel — verify against what you actually see):
- It produces "brains" — distilled, deterministic conclusions over real estate, freight, environmental risk, building permits, demographics, macro economics, and hospitality data for SWFL.
- Each brain output is a JSON-with-prose endpoint at /api/b/{name}?view=speak&tier={1,2,3} returning: a one-paragraph conclusion, a key_metrics table, a caveats list, and a freshness token in the format SWFL-7421-v{n}-{YYYYMMDD}.
- The "master" brain synthesizes upstream brains. Caveats sections are self-confessions of every limitation, gap, fixture-data substitution, or known bug.
- Target audience: Lee/Collier County operators — small/mid franchise prospectors, CRE brokers, SMB owners, hospitality operators — people who need a single source of truth for a SWFL decision and cannot afford $10k-$50k/yr enterprise data tools (CoStar tier).

YOUR JOB — be an honest outside auditor. The owner wants outside eyes, not validation.

1. Read the landing page (/) and /connect — note what the product CLAIMS to do, and any UX / copy / title / nav problems.
2. Fetch the brain outputs at /api/b/*. The "speak" view is a markdown rendering of the underlying brain JSON. Pay extreme attention to the "Caveats" sections — they are the product confessing its own limitations.
3. Cross-reference: do the conclusions and key_metrics actually deliver what the landing page claims?
4. Identify concrete questions a SWFL operator would ask that THIS product cannot answer from the brains visible to you. Frame them as actual questions, not categories.
5. Suggest specific public/affordable data sources (named agency + dataset + URL pattern) that would close the gaps. Be specific — "more demographic data" is useless; "Florida DOR sales tax monthly distributions at floridarevenue.com/..." is useful.
6. Find data-quality red flags: any brain that admits zero rows, fixture data substituting for live data, stripped metrics, methodology compromises, denominators using proxies.

RULES:
- Quote evidence verbatim from the pages you see. Every data_gap MUST include a verbatim quote and source URL.
- No softening. No "consider", no "might want to". Direct findings.
- Severity is for impact on a paying customer, not engineering effort: critical = the product is misleading or broken on a load-bearing claim; high = a major capability is absent or thin; medium = a noticeable rough edge; low = polish.
- Do NOT use internal pack identifiers (like "env-swfl", "macro-florida", "thin pipe") in the synopsis_understood field — describe what the user sees in plain terms. The other fields can use them since they reference specific URLs.
- If you see the literal string "Create Next App" anywhere in a <title> tag, that is a critical UX problem.
- If you see fixture-mode disclaimers in caveats ("Fixture mode: only Lee County is populated", "synthetic fixture data"), flag those as critical positioning_problems — the product serves fake data while claiming to be live intelligence.

Return strictly the structured JSON the schema asks for. No preamble, no closing remarks.
'@

Write-Output "Running firecrawl agent (spark-1-pro, max 1000 credits, ~3-7 min)..."
Write-Output "Output will land at: $outFile"
Write-Output ""

firecrawl agent $prompt `
    --urls $urls `
    --model spark-1-pro `
    --schema-file $schemaFile `
    --max-credits 1000 `
    --wait `
    --timeout 900 `
    --pretty `
    --json `
    --output $outFile

if (Test-Path $outFile) {
    $bytes = (Get-Item $outFile).Length
    Write-Output ""
    Write-Output "Done. $bytes bytes written to $outFile"
} else {
    Write-Output ""
    Write-Output "WARN: no output file written. Check stdout above for agent errors."
}
