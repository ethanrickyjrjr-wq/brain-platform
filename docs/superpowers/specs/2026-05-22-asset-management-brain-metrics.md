# Asset Management Metrics Reference

Primary domain: **Multifamily Residential**. Secondary applicability noted per metric.
"Have Data?" = what the brain platform currently holds. Client financials (rent rolls, P&L, budget) are not ingested yet — those would unlock most property-level metrics.

---

## ⚠ Ingest Schema Constraint — Read Before Building

**Asset identifiers (PKL, CNR, WAV, etc.) are portfolio-specific placeholders, not universal codes.**
The ingest schema must treat asset ID as a **client-configurable dimension** — a config/lookup row per portfolio, not a hardcoded enum. Every new portfolio must be addable via a config row, never a code change. Design the schema with a `client_id` + `asset_code` composite key and a separate `client_assets` config table from day one.

---

## 1. NOI & Income Core

| Metric            | Full Name                  | Formula                                                                            | What It Reveals                                                               | Industries                                                                        | Data Needed                                  | Have Data?                                  |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| NOI               | Net Operating Income       | EGI − Total OPEX                                                                   | Core profitability before debt service                                        | Multifamily, Office, Retail, Industrial, Hospitality, Self-Storage, Senior Living | Operating statement                          | No — needs client P&L                       |
| NOI Variance      | NOI Variance               | Actual NOI − Budgeted NOI (negative = miss)                                        | Whether the asset is on, over, or under its financial plan                    | All CRE                                                                           | Operating statement + budget                 | No                                          |
| NOI Margin        | NOI Margin                 | NOI ÷ EGI × 100                                                                    | Operating efficiency; how much revenue survives OPEX                          | All CRE                                                                           | Operating statement                          | No                                          |
| YTD NOI           | Year-to-Date NOI           | Sum of monthly NOI from Jan 1 to reporting date                                    | In-year performance trajectory; pace vs. annual budget                        | All CRE                                                                           | Monthly operating statements                 | No                                          |
| Budget            | Operating Budget           | Client-supplied                                                                    | Baseline for all variance calculations; without it, variances are meaningless | All CRE                                                                           | Budget file                                  | No                                          |
| Combined NOI VAR  | Combined NOI Variance      | Sum of all asset-level NOI variances across portfolio                              | Portfolio-level P&L health in one number                                      | Multifamily, All CRE                                                              | Operating statements + budget for each asset | No                                          |
| NRI               | Net Rental Income          | GPR − Vacancy Loss − Concessions − Bad Debt                                        | Actual rental revenue reaching the owner after all reductions                 | Multifamily, SFR, Student Housing                                                 | Rent roll + concession ledger                | No                                          |
| NRI Variance      | Net Rental Income Variance | Actual NRI − Budgeted NRI                                                          | Revenue-side of NOI miss; separates rent problem from expense problem         | Multifamily, SFR                                                                  | Rent roll + budget                           | No                                          |
| Combined NRI MISS | Combined NRI Miss          | Sum of all negative NRI variances across portfolio                                 | Revenue drag across the portfolio                                             | Multifamily                                                                       | Rent rolls + budget                          | No                                          |
| Other Inc VAR     | Other Income Variance      | Actual Other Income − Budgeted Other Income                                        | Whether non-rent lines (parking, laundry, pet fees, storage) are on track     | Multifamily, Hospitality, Self-Storage                                            | Operating statement                          | No                                          |
| TRI               | Total Rental Income        | Sum of all rent collected across portfolio                                         | Raw rental revenue before deductions; portfolio revenue baseline              | Multifamily, SFR                                                                  | Rent roll                                    | No                                          |
| AUR               | Average Unit Rent          | Total Rent Collected ÷ Total Units                                                 | Per-unit revenue including vacant units; true portfolio yield                 | Multifamily, SFR, Student Housing                                                 | Rent roll                                    | No                                          |
| ARI               | Average Rental Income      | Total Rental Income ÷ Occupied Units                                               | Per-occupied-unit revenue; what leased units are actually generating          | Multifamily, SFR                                                                  | Rent roll                                    | No                                          |
| Revenue Softness  | Revenue Softness           | NRI below budget or prior-year trend, typically from occupancy drag or concessions | Early warning that income is weakening before it hits NOI hard                | Multifamily, Hospitality                                                          | Rent roll + budget                           | No                                          |
| EGI               | Effective Gross Income     | GPR − Vacancy Loss − Concessions + Other Income                                    | Total income available for operations; basis for NOI Margin                   | All CRE                                                                           | Operating statement                          | No                                          |
| GPR               | Gross Potential Rent       | Market Rent × Total Units                                                          | Max rental income at 100% occupancy at market rate                            | Multifamily, SFR                                                                  | Rent roll + market rents                     | Partial — corridor asking rents in cre-swfl |
| T12 NOI           | Trailing 12-Month NOI      | Sum of the last 12 months of NOI                                                   | Valuation basis; lender and buyer underwriting standard                       | All CRE                                                                           | 12 months of operating statements            | No                                          |

---

## 2. Operating Expenses

| Metric                   | Full Name                         | Formula                                                           | What It Reveals                                                                       | Industries                        | Data Needed                    | Have Data? |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------ | ---------- |
| OPEX Variance            | Operating Expense Variance        | Actual OPEX − Budgeted OPEX (negative = favorable)                | Whether expenses are running above or below plan                                      | All CRE                           | Operating statement + budget   | No         |
| Combined OPEX OVER       | Combined OPEX Over Budget         | Sum of all positive OPEX variances (over budget) across portfolio | Total cost overrun at portfolio level                                                 | Multifamily, All CRE              | Operating statements + budget  | No         |
| OPEX Favorability        | OPEX Favorability                 | Budgeted OPEX − Actual OPEX when positive                         | Expense savings; sometimes masks revenue misses on NOI                                | All CRE                           | Operating statement + budget   | No         |
| Days Payable             | Days Payable Outstanding          | AP Balance ÷ (Total OPEX ÷ Days in Period)                        | How long it takes the asset to pay vendors; high = cash flow stress or management lag | All CRE                           | Accounts payable ledger + OPEX | No         |
| CapEx vs. OpEx           | Capital vs. Operating Expenditure | CapEx = improvements/replacements; OpEx = recurring operations    | CapEx doesn't hit NOI but does hit cash flow; misclassification inflates NOI          | All CRE                           | Capital expenditure log        | No         |
| Make-Ready Cost per Turn | Make-Ready Cost per Turn          | Total make-ready spend ÷ Units turned                             | Unit prep efficiency; high = aging stock or deferred maintenance                      | Multifamily, SFR, Student Housing | Maintenance ledger + turn log  | No         |

---

## 3. Bad Debt & Collections

| Metric           | Full Name              | Formula                                                 | What It Reveals                                                            | Industries                                       | Data Needed           | Have Data? |
| ---------------- | ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- | ---------- |
| Bad Debt $       | Bad Debt Dollar Amount | Sum of rent written off as uncollectible                | Hard dollar revenue loss from non-paying residents                         | Multifamily, SFR, Senior Living, Student Housing | AR ledger             | No         |
| Bad Debt %       | Bad Debt Percentage    | Bad Debt $ ÷ Scheduled Rent × 100                       | Collections quality normalized for portfolio size                          | Multifamily, SFR, Senior Living                  | AR ledger + rent roll | No         |
| AUR Bad Debt %   | AUR Bad Debt %         | Bad Debt $ ÷ (AUR × Total Units) × 100                  | Bad debt relative to total potential rent per unit; portfolio-normalized   | Multifamily                                      | AR ledger + rent roll | No         |
| ARI Bad Debt %   | ARI Bad Debt %         | Bad Debt $ ÷ (ARI × Occupied Units) × 100               | Bad debt relative to occupied-unit income; leased-unit efficiency view     | Multifamily                                      | AR ledger + rent roll | No         |
| Combined BD %    | Combined Bad Debt %    | Total Portfolio Bad Debt $ ÷ Total Scheduled Rent × 100 | Portfolio-wide collections health                                          | Multifamily                                      | AR ledger + rent roll | No         |
| Delinquency Rate | Delinquency Rate       | # Residents with Balance > 0 ÷ Total Residents × 100    | Breadth of collections issue — how many residents, not just how much money | Multifamily, Senior Living                       | AR ledger             | No         |
| Collections Rate | Collections Rate       | Cash Collected ÷ Scheduled Rent × 100                   | % of billed rent that actually came in                                     | Multifamily, SFR, Senior Living                  | AR ledger + rent roll | No         |

---

## 4. Occupancy & Leasing

| Metric                    | Full Name                       | Formula                                                 | What It Reveals                                                      | Industries                                                                  | Data Needed                    | Have Data? |
| ------------------------- | ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------ | ---------- |
| Current Occ %             | Current Occupancy               | Occupied Units ÷ Total Units × 100                      | Snapshot occupancy at reporting date                                 | Multifamily, SFR, Student Housing, Hospitality, Senior Living, Self-Storage | Rent roll                      | No         |
| Avg Occupancy %           | Average Occupancy               | Average of daily or weekly occupancy over period        | Smoothed view; removes one-day spikes                                | All CRE with occupancy tracking                                             | Rent roll (rolling)            | No         |
| Current Weekly Occupancy  | Current Weekly Occupancy        | Occupied Units this week ÷ Total Units × 100            | Short-cycle AM view; used in weekly leasing calls                    | Multifamily, Hospitality, Senior Living                                     | Weekly leasing report          | No         |
| Physical vs. Economic Occ | Physical vs. Economic Occupancy | Physical = units occupied; Economic = $ collected ÷ GPR | Physical occ can look healthy while economic occ shows bad debt drag | Multifamily, Senior Living                                                  | Rent roll + AR ledger          | No         |
| Break-Even Occupancy      | Break-Even Occupancy            | Total OPEX ÷ GPR × 100                                  | Minimum occupancy to cover all operating costs; lender stress-test   | All CRE                                                                     | OPEX + rent roll               | No         |
| Leasing Velocity          | Leasing Velocity                | New leases signed per week or month                     | Pipeline health; leads occupancy by 30–60 days                       | Multifamily, Student Housing, Self-Storage                                  | Leasing activity log           | No         |
| Renewal Rate              | Renewal Rate                    | Renewals executed ÷ Leases expiring × 100               | Resident retention efficiency; high = lower turnover cost            | Multifamily, SFR, Student Housing                                           | Lease expiration + renewal log | No         |
| Turnover Rate             | Turnover Rate                   | Units vacated ÷ Total Units × 100 (annualized)          | Operating cost driver; each turn = make-ready + vacancy loss         | Multifamily, SFR                                                            | Lease log                      | No         |

---

## 5. Rent Roll / Pricing

| Metric                    | Full Name                 | Formula                                                    | What It Reveals                                                            | Industries                              | Data Needed                            | Have Data?                                  |
| ------------------------- | ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- | ------------------------------------------- |
| Loss to Lease             | Loss to Lease             | Market Rent − In-Place (Contract) Rent per unit            | Unrealized income potential; value-add gap                                 | Multifamily, Office, Retail, Industrial | Rent roll + market rents               | Partial — corridor asking rents in cre-swfl |
| Gain to Lease             | Gain to Lease             | In-Place Rent − Market Rent per unit (when above market)   | Rent roll above market; renewal risk                                       | Multifamily, Office                     | Rent roll + market rents               | Partial                                     |
| New-Lease Concessions     | New-Lease Concessions     | $ or months of free rent given on new leases               | Cost of driving occupancy; erodes effective NRI                            | Multifamily, Office, Retail             | Concession ledger                      | No                                          |
| Renewal Trade-Out Gap     | Renewal Trade-Out Gap     | Renewal Rent − Expiring Lease Rent (negative = step down)  | Rent growth or contraction on renewals; leading indicator of NRI direction | Multifamily, SFR, Student Housing       | Lease renewal records                  | No                                          |
| Underlying Less Trade-Out | Underlying Less Trade-Out | Modeled rent growth assumption − Actual trade-out achieved | Gap between underwriting expectations and real leasing results             | Multifamily                             | Underwriting model + actual lease data | No                                          |
| Concession Burn Rate      | Concession Burn Rate      | Monthly $ value of concessions being absorbed into P&L     | How long concession credits suppress NRI                                   | Multifamily, Office                     | Concession ledger                      | No                                          |

---

## 6. Cash & Forward-Looking

| Metric                       | Full Name                               | Formula                                                                   | What It Reveals                                             | Industries                                  | Data Needed                              | Have Data? |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | ---------- |
| Actual Cash                  | Actual Cash                             | Operating account balance at reporting date                               | Whether the asset has liquidity to cover near-term payables | All CRE                                     | Bank statement / accounting system       | No         |
| Cash Flow Forecast           | Cash Flow Forecast                      | Projected NRI − Projected OPEX − Debt Service ± Reserves                  | 30/60/90-day liquidity view; flags upcoming cash shortfalls | All CRE                                     | Budget + AR aging + AP schedule          | No         |
| DSCR                         | Debt Service Coverage Ratio             | NOI ÷ Annual Debt Service                                                 | Lender covenant compliance; below 1.0 = insolvency risk     | All CRE with debt                           | NOI + loan schedule                      | No         |
| Refreshed Stabilization Plan | Refreshed Lease-Up / Stabilization Plan | Forward-looking path to stabilized occupancy and NOI; output of AM review | Alignment of leasing, pricing, and OPEX to hit NOI target   | Multifamily, Student Housing, Senior Living | Budget + leasing pipeline + market rents | No         |

---

## 7. Portfolio Diagnostic Flags

These are classification labels, not raw calculations. Each is triggered by the combination of the underlying metrics above.

| Flag                                                          | Triggered When                                                                  | What It Means                                                        | Action Signal                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| NOI MISS                                                      | Actual NOI < Budgeted NOI                                                       | Asset is below plan                                                  | Identify whether NRI or OPEX is the driver        |
| Moderate NOI MISS                                             | NOI miss within ~3–7% of budget                                                 | Small but real underperformance                                      | Monitor; not yet a crisis                         |
| Cost Driven Miss with Revenue Near Path                       | NRI ≥ ~97% of budget AND OPEX over budget                                       | Expense problem, not a revenue problem                               | Audit OPEX line by line                           |
| NOI Miss Plus Elevated Bad Debt                               | NOI miss AND Bad Debt % above threshold                                         | Double exposure: lost revenue + credit risk                          | Collections intervention + AM review              |
| NOI Miss Masked by OPEX Favorability                          | NRI miss offset by OPEX savings making NOI look OK                              | Revenue problem is hidden                                            | Watch NRI trajectory; OPEX savings may not repeat |
| NOI Miss Compounded by Negative Cash                          | NOI miss AND Actual Cash below minimum reserve                                  | Operational and liquidity risk simultaneously                        | Immediate AM + ownership notification             |
| Healthy Occ and BD                                            | Occupancy on target AND Bad Debt % within threshold, but NOI miss exists        | NOI miss is OPEX-driven; revenue is solid                            | Narrow OPEX review                                |
| Masked Collections Issues                                     | Collections problems obscured by strong physical occupancy or OPEX favorability | Economic occupancy diverging from physical                           | Pull economic occ and delinquency rate            |
| Small NOI Miss Compared with Bad Debt                         | NOI miss is minor but bad debt $ is large relative to the miss                  | Bad debt is the primary exposure even though NOI looks near plan     | Collections + bad debt writeoff review            |
| Bad Debt Elevated Across Multiple Assets Despite Positive NOI | Portfolio-wide bad debt high even where per-asset NOI is positive               | Systemic collections risk not yet hitting NOI                        | Portfolio-level collections audit                 |
| Revenue Softness                                              | NRI trending below budget or prior year                                         | Income is weakening; may not show up in NOI yet if OPEX is favorable | Leasing and pricing review                        |
| WAV NOI MISS                                                  | Asset WAV: Actual NOI < Budget                                                  | Asset-level flag                                                     | Same workflow as NOI Miss                         |
| WEX NOI MISS                                                  | Asset WEX: Actual NOI < Budget                                                  | Asset-level flag                                                     | Same workflow as NOI Miss                         |
| RCI NOI MISS                                                  | Asset RCI: Actual NOI < Budget                                                  | Asset-level flag                                                     | Same workflow as NOI Miss                         |

---

## 8. Asset Identifier Codes (Portfolio Placeholders)

| Code | Role                                  | How Used                                             |
| ---- | ------------------------------------- | ---------------------------------------------------- |
| PKL  | Asset identifier                      | Per-asset NOI, occupancy, bad debt, and leasing rows |
| CNR  | Asset identifier                      | Per-asset rows                                       |
| EDM  | Asset identifier                      | Per-asset rows                                       |
| EVR  | Asset identifier                      | Per-asset rows                                       |
| PAL  | Asset identifier                      | Per-asset rows                                       |
| WAV  | Asset identifier — Waverly or similar | Appears as WAV NOI MISS diagnostic flag              |
| WEX  | Asset identifier                      | Appears as WEX NOI MISS diagnostic flag              |
| RCI  | Asset identifier                      | Appears as RCI NOI MISS diagnostic flag              |

---

## Metrics Not Listed But Worth Tracking

| Metric                             | Why Add It                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| EGI (Effective Gross Income)       | Basis for NOI Margin; without it the margin calc has no denominator           |
| GPR (Gross Potential Rent)         | Ceiling against which all income metrics are measured                         |
| Physical vs. Economic Occupancy    | Strong physical occ can mask bad debt; these two diverging is a red flag      |
| Break-Even Occupancy               | Lender stress test and minimum viability threshold                            |
| DSCR (Debt Service Coverage Ratio) | Lender covenant; NOI alone doesn't tell you if debt is covered                |
| Gain to Lease                      | Opposite of Loss to Lease; in-place rents above market = renewal risk         |
| Delinquency Rate                   | Breadth of collections problem (how many residents vs. how many dollars)      |
| Collections Rate                   | % of scheduled rent actually collected; companion to Bad Debt %               |
| Leasing Velocity                   | Leads occupancy by 30–60 days; the earliest revenue signal                    |
| Renewal Rate                       | Retention efficiency; lower renewal rate = higher make-ready and vacancy cost |
| Turnover Rate                      | Direct driver of make-ready cost and vacancy loss                             |
| Concession Burn Rate               | How long concessions suppress NRI on the P&L                                  |
| T12 NOI                            | Trailing 12-month NOI; standard for valuations and refinancings               |
| CapEx vs. OpEx Split               | CapEx hits cash, not NOI; misclassification inflates reported NOI             |
| Make-Ready Cost per Turn           | Efficiency metric; rising costs indicate deferred maintenance                 |
