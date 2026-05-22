# Asset Management Metrics — Data Tracker

Skim this as client data arrives. Mark `Have Data?` column and drop a note when a metric becomes computable.
Full definitions + formulas → `docs/superpowers/specs/2026-05-22-asset-management-brain-metrics.md`

**Status key:** `✅ Have` | `🟡 Partial` | `❌ Need`

---

## NOI & Income

| Metric            | Category    | Have Data? | Source When Available                             | Notes                         |
| ----------------- | ----------- | ---------- | ------------------------------------------------- | ----------------------------- |
| NOI               | Income Core | ❌ Need    | Client operating statement                        |                               |
| NOI Variance      | Income Core | ❌ Need    | Operating statement + budget                      |                               |
| NOI Margin        | Income Core | ❌ Need    | Operating statement                               |                               |
| YTD NOI           | Income Core | ❌ Need    | Monthly operating statements                      |                               |
| Budget            | Baseline    | ❌ Need    | Client budget file                                | Unlocks all variance metrics  |
| Combined NOI VAR  | Portfolio   | ❌ Need    | All asset operating statements + budgets          |                               |
| NRI               | Income Core | ❌ Need    | Rent roll + concession ledger                     |                               |
| NRI Variance      | Income Core | ❌ Need    | Rent roll + budget                                |                               |
| Combined NRI MISS | Portfolio   | ❌ Need    | All rent rolls + budgets                          |                               |
| Other Inc VAR     | Income Core | ❌ Need    | Operating statement                               |                               |
| TRI               | Income Core | ❌ Need    | Rent roll                                         |                               |
| AUR               | Income Core | ❌ Need    | Rent roll                                         |                               |
| ARI               | Income Core | ❌ Need    | Rent roll                                         |                               |
| EGI               | Income Core | ❌ Need    | Operating statement                               |                               |
| GPR               | Income Core | 🟡 Partial | cre-swfl corridor asking rents (market side only) | Missing unit count + unit mix |
| T12 NOI           | Income Core | ❌ Need    | 12 months of operating statements                 |                               |
| Revenue Softness  | Diagnostic  | ❌ Need    | Rent roll + budget                                |                               |

---

## Operating Expenses

| Metric                   | Category  | Have Data? | Source When Available              | Notes |
| ------------------------ | --------- | ---------- | ---------------------------------- | ----- |
| OPEX Variance            | Expenses  | ❌ Need    | Operating statement + budget       |       |
| Combined OPEX OVER       | Portfolio | ❌ Need    | All operating statements + budgets |       |
| OPEX Favorability        | Expenses  | ❌ Need    | Operating statement + budget       |       |
| Days Payable             | Expenses  | ❌ Need    | AP ledger + operating statement    |       |
| CapEx vs. OpEx           | Expenses  | ❌ Need    | Capital expenditure log            |       |
| Make-Ready Cost per Turn | Expenses  | ❌ Need    | Maintenance ledger + turn log      |       |

---

## Bad Debt & Collections

| Metric           | Category    | Have Data? | Source When Available | Notes |
| ---------------- | ----------- | ---------- | --------------------- | ----- |
| Bad Debt $       | Collections | ❌ Need    | AR ledger             |       |
| Bad Debt %       | Collections | ❌ Need    | AR ledger + rent roll |       |
| AUR Bad Debt %   | Collections | ❌ Need    | AR ledger + rent roll |       |
| ARI Bad Debt %   | Collections | ❌ Need    | AR ledger + rent roll |       |
| Combined BD %    | Portfolio   | ❌ Need    | AR ledger + rent roll |       |
| Delinquency Rate | Collections | ❌ Need    | AR ledger             |       |
| Collections Rate | Collections | ❌ Need    | AR ledger + rent roll |       |

---

## Occupancy & Leasing

| Metric                    | Category  | Have Data? | Source When Available          | Notes |
| ------------------------- | --------- | ---------- | ------------------------------ | ----- |
| Current Occ %             | Occupancy | ❌ Need    | Rent roll                      |       |
| Avg Occupancy %           | Occupancy | ❌ Need    | Rolling rent roll              |       |
| Current Weekly Occupancy  | Occupancy | ❌ Need    | Weekly leasing report          |       |
| Physical vs. Economic Occ | Occupancy | ❌ Need    | Rent roll + AR ledger          |       |
| Break-Even Occupancy      | Occupancy | ❌ Need    | OPEX + GPR                     |       |
| Leasing Velocity          | Leasing   | ❌ Need    | Leasing activity log           |       |
| Renewal Rate              | Leasing   | ❌ Need    | Lease expiration + renewal log |       |
| Turnover Rate             | Leasing   | ❌ Need    | Lease log                      |       |

---

## Rent Roll / Pricing

| Metric                    | Category | Have Data? | Source When Available                                          | Notes |
| ------------------------- | -------- | ---------- | -------------------------------------------------------------- | ----- |
| Loss to Lease             | Pricing  | 🟡 Partial | cre-swfl corridor rents (market side); need in-place rent roll |       |
| Gain to Lease             | Pricing  | 🟡 Partial | Same as Loss to Lease                                          |       |
| New-Lease Concessions     | Pricing  | ❌ Need    | Concession ledger                                              |       |
| Renewal Trade-Out Gap     | Pricing  | ❌ Need    | Lease renewal records                                          |       |
| Underlying Less Trade-Out | Pricing  | ❌ Need    | Underwriting model + actual lease data                         |       |
| Concession Burn Rate      | Pricing  | ❌ Need    | Concession ledger                                              |       |

---

## Cash & Forward-Looking

| Metric                       | Category | Have Data? | Source When Available                    | Notes |
| ---------------------------- | -------- | ---------- | ---------------------------------------- | ----- |
| Actual Cash                  | Cash     | ❌ Need    | Bank statement / accounting system       |       |
| Cash Flow Forecast           | Forward  | ❌ Need    | Budget + AR aging + AP schedule          |       |
| DSCR                         | Debt     | ❌ Need    | NOI + loan schedule                      |       |
| Refreshed Stabilization Plan | Forward  | ❌ Need    | Budget + leasing pipeline + market rents |       |

---

## Portfolio Diagnostic Flags

These are auto-classifiable once the underlying metrics above are populated.

| Flag                                                          | Triggers On                                 | Have Data? |
| ------------------------------------------------------------- | ------------------------------------------- | ---------- |
| NOI MISS                                                      | NOI Variance < 0                            | ❌ Need    |
| Moderate NOI MISS                                             | NOI Variance between −3% and −7%            | ❌ Need    |
| Cost Driven Miss with Revenue Near Path                       | NRI ≥ 97% budget + OPEX over                | ❌ Need    |
| NOI Miss Plus Elevated Bad Debt                               | NOI miss + Bad Debt % above threshold       | ❌ Need    |
| NOI Miss Masked by OPEX Favorability                          | NRI miss offset by OPEX savings             | ❌ Need    |
| NOI Miss Compounded by Negative Cash                          | NOI miss + Actual Cash below reserve        | ❌ Need    |
| Healthy Occ and BD                                            | Occ on target + Bad Debt % within threshold | ❌ Need    |
| Masked Collections Issues                                     | Physical occ OK but Economic occ lagging    | ❌ Need    |
| Small NOI Miss Compared with Bad Debt                         | Minor NOI miss but large Bad Debt $         | ❌ Need    |
| Bad Debt Elevated Across Multiple Assets Despite Positive NOI | Portfolio-wide bad debt above threshold     | ❌ Need    |
| Revenue Softness                                              | NRI below budget or prior year trend        | ❌ Need    |
| WAV NOI MISS                                                  | Asset WAV NOI < Budget                      | ❌ Need    |
| WEX NOI MISS                                                  | Asset WEX NOI < Budget                      | ❌ Need    |
| RCI NOI MISS                                                  | Asset RCI NOI < Budget                      | ❌ Need    |

---

## Per-Asset Status Grid

One row per property. Fill as data arrives.

| Asset | Have P&L? | Have Budget? | Have Rent Roll? | Have AR Ledger? | Computable Metrics |
| ----- | --------- | ------------ | --------------- | --------------- | ------------------ |
| PKL   | ❌        | ❌           | ❌              | ❌              | None yet           |
| CNR   | ❌        | ❌           | ❌              | ❌              | None yet           |
| EDM   | ❌        | ❌           | ❌              | ❌              | None yet           |
| EVR   | ❌        | ❌           | ❌              | ❌              | None yet           |
| PAL   | ❌        | ❌           | ❌              | ❌              | None yet           |
| WAV   | ❌        | ❌           | ❌              | ❌              | None yet           |
| WEX   | ❌        | ❌           | ❌              | ❌              | None yet           |
| RCI   | ❌        | ❌           | ❌              | ❌              | None yet           |
