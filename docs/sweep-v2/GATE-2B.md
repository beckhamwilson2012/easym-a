# STAGE 10-C PHASE 2B — STOP-GATE 2B

## 2B.0 — 3 reopened PF-NI flags: PARSE GAP → genuine FALSE POSITIVES (deck correct)
label expected "After-Tax Synergies (Y1)" tile; actually rendered narrative "Year 1 cost synergies of $X" (PRE-tax).
Fixed: fall back to narrative × 0.79. All 3 now tie Δ0.00%:
  JPM/BAC 57+30.5+2.77−18.7 = 71.56 = rendered 71.60
  HOOD/COIN 1.88+1.26+0.114−1.69 = 1.57 = rendered 1.57
  MSTR/COIN −3.85+1.26+0.114−1.69 = −4.17 = rendered −4.17

## 2B.1 — Defect #1 split (32 pairs):
BUG5 (concept naming — all 7 GP cols blank, §2 FMP margin present): 10
  TM/GM ABNB/EXPE UNH/HUM ET/WMB BRK.B/PGR MMC/AON SPGI/MSCI BX/APO CART/DASH AAPL/VZ
BUG6 (leg availability — annual GP present, LTM GP blank): 10
  SHEL/OXY NVS/BIIB VZ/LUMN CVS/CI KMI/OKE AMT/CCI LLY/SRPT COST/BJ RDDT/PINS GOOGL/AMZN
§8-forward-GP-blank (actuals GP present at LTM; only the forward analyst col blank): 12 — softer, likely by-design
=> the 5(e) FMP-wiring fix closes BUG5 only = 10/32 (31%), NOT the majority. BUG6 needs its own LTM-leg fix + rank.

## 2B.2 — #2 vs #4: TWO distinct defects, shared trigger (null target/combined debt)
branch (SectionDashboard.js:260): note = results.debtEBITDA === 'N/A' ? 'Combined EBITDA is non-positive' : null
  — does NOT branch on EBITDA; falls through whenever debtEBITDA==='N/A'.
debtEBITDA (dealCalc.js:184) = (combinedEBITDA>0 && combinedDebt!=null) ? ... : null  → 'N/A'
combinedDebt (dealCalc.js:183) = (companyADebt!=null && companyBDebt!=null) ? ... : null  → null if EITHER debt null
#4 = data defect (null target debt corrupts EV/net-debt). #2 = message defect (false claim on ANY null-combinedDebt).
overlap (both): TM/GM NET/DDOG CART/DASH. #2 has 9 pairs #4 lacks. Different fix sites.
#2 SEVERITY: false FACTUAL claim ("non-positive" while +$4,112M) — rank above pair count.

## 2B.3 — item 17 (live /api/pnl, 43 targets, fetch 2026-08-09 vs captures 2026-08-07/08)
classes: CLEAN-3LEG 37 · FALLBACK(annual) 3 (SONY/EA UBER/LYFT AMZN/MSFT) · UNTRUSTED/other 3 (T/USM CMCSA/PARA MRNA/BNTX)
SILENT-ZEROED (trusted 3-leg, annual+latest present, prior NULL) = 0. Excluding #1 = 0.
CONTROL 5 MSFT: trusted=false fallback=annual, all 3 legs NULL, reason "LTM==annual". $133,749 = FY2026 annual
  (columns 88,136→101,832→133,749). NULL-PRIOR HYPOTHESIS DISPROVEN. Not Pattern B.
DRIFT: 0 ranked (structural present/null check; no value deltas).
