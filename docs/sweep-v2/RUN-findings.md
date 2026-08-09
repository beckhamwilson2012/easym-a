# STAGE 10 — FUZZ SWEEP v2 · line-by-line recompute findings

Run started (local): see per-pair timestamps. App @ localhost:3001, current client build.
Method: each deck built live (Puppeteer, `data-section-id` innerText = RENDERED). Independent
oracle per company = `/quote?symbol=` (raw fundamentals the app maps from) + `/api/price/`.
Recompute = checklist formulas applied to oracle + the app's own parsed deal terms; compared to
the figure rendered in the same deck. Every check prints inputs · my result · rendered · delta.
"live data drifts over a long run" — values changing between pairs are drift, not bugs.

================================================================================
## GROUND TRUTH (run first — highest value)
================================================================================

### GT-1 · RKLB / IRDM @ announced terms ($54.00/share) — ts 2026-08-07T21:13Z
Announced (Rocket Lab acquisition of Iridium): $54.00/sh; $27.00 cash + stock, collar $67.50–$112.50;
enterprise value **~$8.0B**; $3.6B committed debt financing (Deutsche Bank, Wells Fargo); 24.1% premium
to the June 26 close; close ~mid-2027.

App figure vs announced counterpart (offer forced to $54.00 to match announced basis):

| Figure | App rendered | Announced | Δ | Verdict |
|---|---|---|---|---|
| Offer / share | $54.00 | $54.00 | 0% | tie (forced) |
| Equity value | $5,670M (=$54.00 × 105M cover shares) | ~$6.4B (fuller diluted count) | −11% | understated |
| **Enterprise value** | **$5,486M** | **~$8,000M** | **−$2,514M / −31.4%** | **DEFECT (>5%)** |
| Premium | 8.2% (vs live $49.93) | 24.1% (vs Jun-26 close) | — | DRIFT, not a bug (price rose post-announcement) |
| Committed debt financing | not modeled as $3.6B new debt (new acq. debt understated; see below) | $3.6B | — | related to EV defect |

**Root of the EV gap — CONFIRMED (traced to source data):**
- `/quote?symbol=IRDM` returns **debt = null** (the deal model's preferred path → `companyBDebt = null`).
- The SAME debt is **$1.8B on §16 Data Verification** — EDGAR★ + FMP agree, marked "✓ verified".
- So the transaction EV = equity $5,670M − cash $184M + **$0 debt** = $5,486M. With IRDM's real $1.8B debt
  the EV would be ~$5,670 + $1,800 − $184 = **~$7,286M** (~$0.7B of the residual gap to $8.0B is the
  cover-share vs fully-diluted equity basis).
- Mechanism = null in the preferred path (data IS available on §16) **and** that null coerced to $0 inside
  the EV/net-debt sum. Both known root-cause shapes, same finding.

**Falsifier:** would be void if `/quote` IRDM debt were non-null, or if §16's $1.8B were unsourced. Both
directly observed: `/quote` debt=null; §16 shows `Total Debt ✓ $1.8B  $1.8BFY2025★ … $1.8BFY2025(FMP)`.

**Cross-surface spread of the same $1.8B (check 20):**
- §16 verification: Total Debt **$1.8B** (EDGAR★+FMP).
- §2 comparables: IRDM **Net Debt/(Cash) = (184)** → net *cash* $184M (debt taken as $0); IRDM **EV $5,059M**,
  **EV/EBITDA 12.0x** — both omit the $1.8B. True net debt ≈ +$1,616M; true EV ≈ $6,859M; true EV/EBITDA ≈ 16.2x.
- §txnstructure: transaction **EV $5,486M**; "IRDM debt repaid on change of control (assumed 100%)" adds **$0**.
- CONFIRMED · narrowest reproducer: any deck where target `/quote` debt is null but §16 shows debt · WRONG NUMBER.

_(More ground-truth announced deals appended below once researched.)_

================================================================================
## PER-PAIR CHECKLIST OUTPUT (24 items each) — appended by the analyzer

### SAP/NOW (30% default) — ts 2026-08-07T21:15:54.385Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $5.43B − cash $2.50B − sti $2.16B · mine $771M · rendered $771M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $130.75B (px 124.88×1047sh) + netdebt $771M · mine $131.52B · rendered $131.52B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 162.34 × shares 1047 · mine $169.97B · rendered $170.00B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $131.52B ÷ ltmRev $14.73B · mine 8.93x · rendered 8.90x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $131.52B ÷ ltmEBITDA $2.75B · mine 47.81x · rendered 47.80x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 124.88 ÷ ltmEPS 1.61 · mine 77.57x · rendered 77.60x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $28.20B + B $14.73B (vs §2 $28.20B+$14.73B) · mine $42.94B · rendered $42.94B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $5.86B + B $2.56B + synY1 $266M · mine $8.69B · rendered $8.69B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $4.83B + tgtNI $1.75B + syn $210M(tile) + fin $-3.88B · mine $2.91B · rendered $2.91B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $2.91B ÷ PF shares 1529 (dil 1199+new 330) · mine 1.90 · rendered 1.90 · Δ 0.00%
13. Accretion %: mine -52.9% (PF EPS 1.9 vs standalone 4.03) · rendered "-52.8%"
14. Exchange ratio (offer÷acqPx): inputs offer 162.34 ÷ acqPx 206.16 · mine 0.79 · rendered 0.79 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.3150 (full-stock ratio 0.7874 × 40%) · §10 at-market ratio rendered 0.6057
15. Sources=Uses: sources $175.90B vs uses $175.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $101.98B + tgtDebtRepaid $5.43B − excessCashUsed $9.19B · mine $98.23B · rendered $98.20B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$14.73B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=74.8%[VALUE] · §7=$11,015[VALUE] · §8tgt=$12,568[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$2,751 §2 EV/EBITDA=47.8x · EPS §2 P/E=77.6x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$5.43B · §16 verif=$2.40B · §2 net-debt-implied gross≈$3.27B · §2 EV=$131.52B · §txn EV=$170.70B | cash: oracle $2.50B · §2 $2.50B · §16 $3.70B | shares: oracle 1047 · §16 1047 | mktcap/equity: §2 130,749
21. Assets/accretion/exch/premium: total assets oracle A/B $51.09B/$31.67B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.7874 · accretion (see #13) · equity/EV token eq="130,749" ev="131,520"
22. "—" counts by section: comparables:10 profiles:9 targetprofile:5 shareholders:4 plAcquirer:18 plTarget:17 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:18 verification:22 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=true · DCF-suppress-signal=false · neg-equity-signal=false

### TM/GM (30% default) — ts 2026-08-07T22:53:01.758Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash $20.13B − sti $4.58B · mine null · rendered $-24.72B · Δ n/a
4. Current EV (target §2): inputs mktcap $79.17B (px 87.58×904sh) + netdebt (oracle null) · mine $54.45B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 113.85 × shares 904 · mine $102.92B · rendered $102.90B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $168.35B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $13.94B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 87.58 ÷ ltmEPS 2.12 · mine 41.31x · rendered 41.30x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $234.60B + B $168.35B (vs §2 $234.60B+$168.35B) · mine $402.95B · rendered $402.95B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $25.80B + B $14.89B + synY1 $3.36B · mine $44.04B · rendered $44.00B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $10.20B + tgtNI $2.70B + syn $2.65B(tile) + fin $-874M · mine $14.68B · rendered $14.70B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $14.70B ÷ PF shares 3063 (dil 2846+new 217) · mine 4.80 · rendered 4.80 · Δ 0.00%
13. Accretion %: mine 48.6% (PF EPS 4.8 vs standalone 3.23) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 113.85 ÷ acqPx 190.09 · mine 0.60 · rendered 0.60 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.2396 (full-stock ratio 0.5989 × 40%) · §10 at-market ratio rendered 0.4607
15. Sources=Uses: sources $103.20B vs uses $103.20B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $61.75B + tgtDebtRepaid $0M − excessCashUsed $39.60B · mine $22.15B · rendered $22.10B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $130.30B (see #20) — new debt understated by ~$130.30B
17. LTM legs: oracle composed LTM rev(B)=$168.35B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=12.0%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 18.3% skips target GP (null) but keeps target revenue → understated; correct ≈ 18.3%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$13,943 §2 EV/EBITDA=— · EPS §2 P/E=41.3x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$130.30B · §2 net-debt-implied gross≈$-4.58B · §2 EV=null · §txn EV=$78.20B | cash: oracle $20.13B · §2 $20.13B · §16 $20.90B | shares: oracle 904 · §16 904 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $377.28B/$282.74B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.5989 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠"
22. "—" counts by section: comparables:11 profiles:10 targetprofile:8 shareholders:13 plAcquirer:12 plTarget:38 proforma:78 txnstructure:9 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:18 verification:23 verification2:22 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$130.30B on §16 (see #20) | target gross profit "—" on §7 but §2 margin 12% / oracle GP $20.10B present (see #18) | target gross profit "—" on §8 but §2 margin 12% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=22.7x) · FX-rate-stated=true · DCF-suppress-signal=false · neg-equity-signal=false

### SHEL/OXY (30% default) — ts 2026-08-07T21:16:22.621Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $12.80B − cash $4.15B − sti 0 · mine $8.65B · rendered $8.65B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $55.13B (px 55.91×986sh) + netdebt $8.65B · mine $63.78B · rendered $63.78B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 72.68 × shares 986 · mine $71.66B · rendered $71.70B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $63.78B ÷ ltmRev $23.21B · mine 2.75x · rendered 2.70x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $63.78B ÷ ltmEBITDA null · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 55.91 ÷ ltmEPS 6.47 · mine 8.64x · rendered 8.60x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $266.89B + B $23.21B (vs §2 $266.89B+$23.21B) · mine $290.10B · rendered $290.10B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $55.05B + B null + synY1 $430M · mine null · rendered $17.80B · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $17.80B + tgtNI $1.61B + syn $340M(tile) + fin $-865M · mine $18.89B · rendered $18.90B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $18.90B ÷ PF shares 6270 (dil 5946+new 324) · mine 3.01 · rendered 3.02 · Δ 0.00%
13. Accretion %: mine 0.7% (PF EPS 3.02 vs standalone 3) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 72.68 ÷ acqPx 88.5 · mine 0.82 · rendered 0.82 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.3285 (full-stock ratio 0.8212 × 40%) · §10 at-market ratio rendered 0.6318
15. Sources=Uses: sources $84.70B vs uses $84.70B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $43.00B + tgtDebtRepaid $12.80B − excessCashUsed $33.90B · mine $21.90B · rendered $21.90B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$23.21B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=33.8%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc **ASYM** · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=— · EPS §2 P/E=8.6x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$12.80B · §16 verif=$21.40B · §2 net-debt-implied gross≈$12.80B · §2 EV=$63.78B · §txn EV=$80.30B | cash: oracle $4.15B · §2 $4.15B · §16 $2.00B | shares: oracle 986 · §16 986 | mktcap/equity: §2 55,127
21. Assets/accretion/exch/premium: total assets oracle A/B $370.35B/$80.36B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.8212 · accretion (see #13) · equity/EV token eq="55,127" ev="63,777"
22. "—" counts by section: comparables:7 profiles:7 targetprofile:7 shareholders:4 plAcquirer:45 plTarget:47 proforma:102 txnstructure:13 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:24 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 33.8% / oracle GP $7.29B present (see #18) | target gross profit "—" on §8 but §2 margin 33.8% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=9.8x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### NVS/BIIB (30% default) — ts 2026-08-07T22:54:11.527Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $6.29B − cash null − sti $900M · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $30.57B (px 207.94×147sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 270.32 × shares 147 · mine $39.74B · rendered $39.70B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $9.94B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $3.62B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 207.94 ÷ ltmEPS 9.24 · mine 22.50x · rendered 22.50x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $2.14B + B $9.94B (vs §2 $2.14B+$9.94B) · mine $12.08B · rendered $12.08B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $17.64B + B $3.62B + synY1 $197M · mine $21.46B · rendered $21.50B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $14.00B + tgtNI $1.29B + syn $156M(tile) + fin $-1.19B · mine $14.26B · rendered $14.20B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $14.20B ÷ PF shares 2058 (dil 1956+new 102) · mine 6.90 · rendered 6.92 · Δ -0.29%
13. Accretion %: mine -3.2% (PF EPS 6.92 vs standalone 7.15) · rendered "-3.2%"
14. Exchange ratio (offer÷acqPx): inputs offer 270.32 ÷ acqPx 156.33 · mine 1.73 · rendered 1.73 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.6917 (full-stock ratio 1.7292 × 40%) · §10 at-market ratio rendered 1.3301
15. Sources=Uses: sources $46.10B vs uses $46.10B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $23.84B + tgtDebtRepaid $6.29B − excessCashUsed $9M · mine $30.12B · rendered $30.10B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$9.94B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=75.7%[VALUE] · §7=—[DASH] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=— · EPS §2 P/E=22.5x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$6.29B · §16 verif=$6.30B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$45.10B | cash: oracle null · §2 — · §16 $3.00B | shares: oracle 147 · §16 147 | mktcap/equity: §2 30,567
21. Assets/accretion/exch/premium: total assets oracle A/B $110.95B/$29.48B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.7292 · accretion (see #13) · equity/EV token eq="30,567" ev="—"
22. "—" counts by section: comparables:23 profiles:10 targetprofile:6 shareholders:4 plAcquirer:3 plTarget:37 proforma:12 txnstructure:9 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:24 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 75.7% / oracle GP $7.49B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### UL/CL (30% default) — ts 2026-08-07T21:16:46.248Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $7.82B − cash $1.37B − sti 0 · mine $6.45B · rendered $6.45B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $74.71B (px 93.27×801sh) + netdebt $6.45B · mine $81.16B · rendered $81.16B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 121.25 × shares 801 · mine $97.12B · rendered $97.10B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $81.16B ÷ ltmRev $21.05B · mine 3.86x · rendered 3.90x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $81.16B ÷ ltmEBITDA $3.77B · mine 21.52x · rendered 21.50x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 93.27 ÷ ltmEPS 2.54 · mine 36.72x · rendered 36.70x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $0M + B $21.05B (vs §2 $0M+$21.05B) · mine $21.05B · rendered $21.05B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A null + B $3.94B + synY1 $408M · mine null · rendered $0M · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $0M + tgtNI $2.13B + syn $322M(tile) + fin $-2.61B · mine $-157M · rendered $-156M · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-156M ÷ PF shares 2798 (dil 2181+new 617) · mine -0.06 · rendered -0.06 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -0.06 vs standalone 0) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 121.25 ÷ acqPx 62.96 · mine 1.93 · rendered 1.93 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.7703 (full-stock ratio 1.9258 × 40%) · §10 at-market ratio rendered 1.4814
15. Sources=Uses: sources $105.20B vs uses $105.20B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $58.27B + tgtDebtRepaid $7.82B − excessCashUsed $9M · mine $66.09B · rendered $66.10B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$21.05B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=60.4%[VALUE] · §7=$12,717[VALUE] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$3,772 §2 EV/EBITDA=21.5x · EPS §2 P/E=36.7x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$7.82B · §16 verif=$7.80B · §2 net-debt-implied gross≈$7.82B · §2 EV=$81.16B · §txn EV=$103.60B | cash: oracle $1.37B · §2 $1.37B · §16 $1.30B | shares: oracle 801 · §16 801 | mktcap/equity: §2 74,709
21. Assets/accretion/exch/premium: total assets oracle A/B null/$16.79B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.9258 · accretion (see #13) · equity/EV token eq="74,709" ev="81,162"
22. "—" counts by section: comparables:18 profiles:14 targetprofile:5 shareholders:4 plAcquirer:2 plTarget:17 proforma:12 txnstructure:12 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:19 verification:22 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=true · DCF-suppress-signal=false · neg-equity-signal=false

### SONY/EA (30% default) — ts 2026-08-07T22:55:20.816Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $52.63B (px 209.7×251sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 272.61 × shares 251 · mine $68.43B · rendered $68.40B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $7.53B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $1.16B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 209.7 ÷ ltmEPS 3.51 · mine 59.74x · rendered 59.70x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $0M + B $7.53B (vs §2 $0M+$7.53B) · mine $7.53B · rendered $7.53B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A null + B $1.16B + synY1 $151M · mine null · rendered $0M · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $0M + tgtNI $887M + syn $119M(tile) + fin $-1.62B · mine $-616M · rendered $-615M · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-615M ÷ PF shares 2418 (dil 1251+new 1167) · mine -0.25 · rendered -0.25 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -0.25 vs standalone 0) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 272.61 ÷ acqPx 23.46 · mine 11.62 · rendered 11.62 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 4.6481 (full-stock ratio 11.6202 × 40%) · §10 at-market ratio rendered 8.9386
15. Sources=Uses: sources $68.60B vs uses $68.60B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $41.06B + tgtDebtRepaid $0M − excessCashUsed $9M · mine $41.05B · rendered $41.10B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $1.90B (see #20) — new debt understated by ~$1.90B
17. LTM legs: oracle composed LTM rev(B)=$7.53B trusted=false · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=79.0%[VALUE] · §7=$6,497 e[VALUE] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$1,972 §2 EV/EBITDA=— · EPS §2 P/E=59.7x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$1.90B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$68.40B | cash: oracle null · §2 — · §16 $2.90B | shares: oracle 251 · §16 251 | mktcap/equity: §2 52,635
21. Assets/accretion/exch/premium: total assets oracle A/B null/$13.13B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 11.6202 · accretion (see #13) · equity/EV token eq="52,635" ev="—"
22. "—" counts by section: comparables:26 profiles:19 targetprofile:5 shareholders:4 plAcquirer:2 plTarget:16 proforma:12 txnstructure:12 exchange:28 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:19 verification:11 verification2:20 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$1.90B on §16 (see #20) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=true · DCF-suppress-signal=false · neg-equity-signal=false

### VZ/LUMN (30% default) — ts 2026-08-07T21:17:12.282Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $13.15B − cash $1.88B − sti 0 · mine $11.27B · rendered $11.27B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $6.40B (px 6.24×1025sh) + netdebt $11.27B · mine $17.67B · rendered $17.67B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 8.11 × shares 1025 · mine $8.31B · rendered $8.31B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $17.67B ÷ ltmRev $10.66B · mine 1.66x · rendered 1.70x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $17.67B ÷ ltmEBITDA $2.88B · mine 6.14x · rendered 6.10x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 6.24 ÷ ltmEPS -1.02 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $138.90B + B $10.66B (vs §2 $138.90B+$10.66B) · mine $149.56B · rendered $149.56B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $47.61B + B $1.94B + synY1 $227M · mine $49.77B · rendered $49.80B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $17.20B + tgtNI $-1.74B + syn $179M(tile) + fin $-691M · mine $14.95B · rendered $14.90B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $14.90B ÷ PF shares 4302 (dil 4231+new 71) · mine 3.46 · rendered 3.47 · Δ -0.19%
13. Accretion %: mine -14.5% (PF EPS 3.47 vs standalone 4.06) · rendered "-14.6%"
14. Exchange ratio (offer÷acqPx): inputs offer 8.11 ÷ acqPx 47.06 · mine 0.17 · rendered 0.17 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0689 (full-stock ratio 0.1723 × 40%) · §10 at-market ratio rendered 0.1326
15. Sources=Uses: sources $21.50B vs uses $21.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $4.99B + tgtDebtRepaid $13.15B − excessCashUsed $637M · mine $17.50B · rendered $17.50B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$10.66B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=41.4%[VALUE] · §7=—[DASH] · §8tgt=$4,596[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$2,878 §2 EV/EBITDA=6.1x · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$13.15B · §16 verif=$17.40B · §2 net-debt-implied gross≈$13.15B · §2 EV=$17.67B · §txn EV=$19.60B | cash: oracle $1.88B · §2 $1.88B · §16 $1.00B | shares: oracle 1025 · §16 1025 | mktcap/equity: §2 6,396
21. Assets/accretion/exch/premium: total assets oracle A/B $410.19B/$30.78B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.1723 · accretion (see #13) · equity/EV token eq="6,396" ev="17,670"
22. "—" counts by section: comparables:6 profiles:6 targetprofile:5 shareholders:3 plAcquirer:41 plTarget:16 proforma:78 txnstructure:9 exchange:11 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 41.4% / oracle GP $4.69B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=7.2x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### UBER/LYFT (30% default) — ts 2026-08-07T21:36:02.508Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $1.05B − cash $1.13B − sti $705M · mine $-784M · rendered $-784M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $6.95B (px 17.46×398sh) + netdebt $-784M · mine $6.17B · rendered $6.17B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 22.7 × shares 398 · mine $9.03B · rendered $9.04B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $6.17B ÷ ltmRev $5.89B · mine 1.05x · rendered 1.00x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $6.17B ÷ ltmEBITDA $-53M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 17.46 ÷ ltmEPS 6.81 · mine 2.56x · rendered 2.60x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $52.02B + B $5.89B (vs §2 $52.02B+$5.89B) · mine $57.91B · rendered $57.91B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $6.28B + B $-53M + synY1 $118M · mine $6.35B · rendered $6.35B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $10.10B + tgtNI $2.84B + syn $93M(tile) + fin null [component missing → not checked] · mine null · rendered $13.00B · Δ n/a
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $13.00B ÷ PF shares 2168 (dil 2120+new 48) · mine 6.00 · rendered 5.99 · Δ 0.11%
13. Accretion %: mine 26.6% (PF EPS 5.99 vs standalone 4.73) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 22.7 ÷ acqPx 75.02 · mine 0.30 · rendered 0.30 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.1210 (full-stock ratio 0.3026 × 40%) · §10 at-market ratio rendered 0.2327
15. Sources=Uses: sources $10.20B vs uses $10.20B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $5.42B + tgtDebtRepaid $1.05B − excessCashUsed $6.47B · mine $0M · rendered $0M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$5.89B trusted=false · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=37.3%[VALUE] · §7=$2,727 e[VALUE] · §8tgt=$2,727[VALUE]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$2,583 §2 EV/EBITDA=— · EPS §2 P/E=2.6x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$1.05B · §16 verif=$1.10B · §2 net-debt-implied gross≈$348M · §2 EV=$6.17B · §txn EV=$8.25B | cash: oracle $1.13B · §2 $1.13B · §16 $1.10B | shares: oracle 398 · §16 0 | mktcap/equity: §2 6,949
21. Assets/accretion/exch/premium: total assets oracle A/B $61.80B/$9.03B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.3026 · accretion (see #13) · equity/EV token eq="6,949" ev="6,165"
22. "—" counts by section: comparables:7 profiles:6 targetprofile:5 shareholders:10 plAcquirer:34 plTarget:12 proforma:78 txnstructure:9 exchange:6 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=25.2x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### ABNB/EXPE (30% default) — ts 2026-08-07T21:37:11.654Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $5.46B − cash $6.68B − sti $445M · mine $-1.67B · rendered $-1.67B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $36.35B (px 310.68×117sh) + netdebt $-1.67B · mine $34.68B · rendered $34.68B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 403.88 × shares 117 · mine $47.25B · rendered $47.30B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $34.68B ÷ ltmRev $15.70B · mine 2.21x · rendered 2.20x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $34.68B ÷ ltmEBITDA $3.41B · mine 10.18x · rendered 10.20x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 310.68 ÷ ltmEPS 16.45 · mine 18.89x · rendered 18.90x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $13.16B + B $15.70B (vs §2 $13.16B+$15.70B) · mine $28.86B · rendered $28.86B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $2.59B + B $2.76B + synY1 $295M · mine $5.64B · rendered $5.64B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $2.51B + tgtNI $1.29B + syn $233M(tile) + fin $-600M · mine $3.44B · rendered $3.44B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $3.44B ÷ PF shares 729 (dil 623+new 106) · mine 4.72 · rendered 4.72 · Δ 0.00%
13. Accretion %: mine 17.1% (PF EPS 4.72 vs standalone 4.03) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 403.88 ÷ acqPx 178.07 · mine 2.27 · rendered 2.27 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.9072 (full-stock ratio 2.2681 × 40%) · §10 at-market ratio rendered 1.7447
15. Sources=Uses: sources $52.90B vs uses $52.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $28.35B + tgtDebtRepaid $5.46B − excessCashUsed $18.60B · mine $15.21B · rendered $15.20B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$15.70B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=90.1%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 38.5% skips target GP (null) but keeps target revenue → understated; correct ≈ 86.8%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$3,408 §2 EV/EBITDA=10.2x · EPS §2 P/E=18.9x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$5.46B · §16 verif=$6.20B · §2 net-debt-implied gross≈$5.01B · §2 EV=$34.68B · §txn EV=$45.60B | cash: oracle $6.68B · §2 $6.68B · §16 $5.40B | shares: oracle 117 · §16 117 | mktcap/equity: §2 36,350
21. Assets/accretion/exch/premium: total assets oracle A/B $28.75B/$29.06B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 2.2681 · accretion (see #13) · equity/EV token eq="36,350" ev="34,682"
22. "—" counts by section: comparables:11 profiles:5 targetprofile:6 shareholders:13 plAcquirer:24 plTarget:37 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 90.1% / oracle GP $13.28B present (see #18) | target gross profit "—" on §8 but §2 margin 90.1% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### CVS/CI (30% default) — ts 2026-08-07T23:59:07.796Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $29.09B − cash $6.30B − sti $959M · mine $21.83B · rendered $21.83B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $74.29B (px 282.49×263sh) + netdebt $21.83B · mine $96.12B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 367.24 × shares 263 · mine $96.58B · rendered $96.60B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $282.38B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $12.68B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 282.49 ÷ ltmEPS 24.3 · mine 11.63x · rendered 11.60x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $415.09B + B $282.38B (vs §2 $415.09B+$282.38B) · mine $697.47B · rendered $697.47B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $9.27B + B $11.97B + synY1 $5.50B · mine $26.74B · rendered $26.70B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $1.77B + tgtNI $5.96B + syn $4.34B(tile) + fin $-3.15B · mine $8.92B · rendered $8.92B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $8.92B ÷ PF shares 1675 (dil 1271+new 404) · mine 5.32 · rendered 5.32 · Δ 0.00%
13. Accretion %: mine 282.7% (PF EPS 5.32 vs standalone 1.39) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 367.24 ÷ acqPx 95.7 · mine 3.84 · rendered 3.84 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 1.5350 (full-stock ratio 3.8374 × 40%) · §10 at-market ratio rendered 2.9518
15. Sources=Uses: sources $126.00B vs uses $126.00B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $57.95B + tgtDebtRepaid $29.09B − excessCashUsed $7.27B · mine $79.77B · rendered $79.80B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$282.38B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=21.8%[VALUE] · §7=—[DASH] · §8tgt=$62,464[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$12,681 §2 EV/EBITDA=— · EPS §2 P/E=11.6x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$29.09B · §16 verif=$30.90B · §2 net-debt-implied gross≈$28.13B · §2 EV=null · §txn EV=$118.40B | cash: oracle $6.30B · §2 $6.30B · §16 $7.70B | shares: oracle 263 · §16 263 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $253.77B/$157.08B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 3.8374 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:9 profiles:5 targetprofile:5 shareholders:19 plAcquirer:20 plTarget:20 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 21.8% / oracle GP $59.91B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### UNH/HUM (30% default) — ts 2026-08-08T00:00:18.200Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $12.27B − cash $4.95B − sti $17.01B · mine $-9.69B · rendered $-9.69B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $46.59B (px 385×121sh) + netdebt $-9.69B · mine $36.89B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 500.5 × shares 121 · mine $60.56B · rendered $60.60B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $137.20B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $3.12B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 385 ÷ ltmEPS 9.37 · mine 41.09x · rendered 41.10x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $449.71B + B $137.20B (vs §2 $449.71B+$137.20B) · mine $586.91B · rendered $586.91B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $23.32B + B $3.40B + synY1 $2.59B · mine $29.32B · rendered $29.30B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $12.10B + tgtNI $1.19B + syn $2.05B(tile) + fin $-283M · mine $15.05B · rendered $15.00B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $15.00B ÷ PF shares 971 (dil 911+new 60) · mine 15.45 · rendered 15.47 · Δ -0.14%
13. Accretion %: mine 16.9% (PF EPS 15.47 vs standalone 13.23) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 500.5 ÷ acqPx 407.08 · mine 1.23 · rendered 1.23 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.4918 (full-stock ratio 1.2295 × 40%) · §10 at-market ratio rendered 0.9458
15. Sources=Uses: sources $73.00B vs uses $73.00B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $36.34B + tgtDebtRepaid $12.27B − excessCashUsed $41.50B · mine $7.11B · rendered $7.16B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$137.20B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=14.5%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 65% skips target GP (null) but keeps target revenue → understated; correct ≈ 68.9%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$3,122 §2 EV/EBITDA=— · EPS §2 P/E=41.1x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$12.27B · §16 verif=$12.40B · §2 net-debt-implied gross≈$-4.74B · §2 EV=null · §txn EV=$50.90B | cash: oracle $4.95B · §2 $4.95B · §16 $4.20B | shares: oracle 121 · §16 121 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $312.64B/$55.28B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.2295 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:8 profiles:5 targetprofile:6 shareholders:4 plAcquirer:20 plTarget:41 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 14.5% / oracle GP $18.85B present (see #18) | target gross profit "—" on §8 but §2 margin 14.5% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=17.7x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### ET/WMB (30% default) — ts 2026-08-07T23:52:29.822Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $28.12B − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $86.03B (px 70.4×1222sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 91.52 × shares 1222 · mine $111.84B · rendered $111.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $15.43B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $6.99B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 70.4 ÷ ltmEPS 2.51 · mine 28.05x · rendered 28.00x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $107.38B + B $15.43B (vs §2 $107.38B+$15.43B) · mine $122.81B · rendered $122.81B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $14.71B + B $6.54B + synY1 $297M · mine $21.55B · rendered $21.60B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $4.43B + tgtNI $2.62B + syn $235M(tile) + fin $-3.76B · mine $3.52B · rendered $3.52B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $3.52B ÷ PF shares 5662 (dil 3440+new 2222) · mine 0.62 · rendered 0.62 · Δ 0.00%
13. Accretion %: mine -51.9% (PF EPS 0.62 vs standalone 1.29) · rendered "-51.7%" **Δ -0.2pp**
14. Exchange ratio (offer÷acqPx): inputs offer 91.52 ÷ acqPx 20.13 · mine 4.55 · rendered 4.55 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 1.8186 (full-stock ratio 4.5464 × 40%) · §10 at-market ratio rendered 3.4973
15. Sources=Uses: sources $140.30B vs uses $140.30B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $67.10B + tgtDebtRepaid $28.12B − excessCashUsed $9M · mine $95.21B · rendered $95.20B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$15.43B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=34.4%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 23.2% skips target GP (null) but keeps target revenue → understated; correct ≈ 26.6%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$6,993 §2 EV/EBITDA=— · EPS §2 P/E=28.0x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$28.12B · §16 verif=$27.30B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$140.00B | cash: oracle null · §2 — · §16 $63M | shares: oracle 1222 · §16 1222 | mktcap/equity: §2 86,029
21. Assets/accretion/exch/premium: total assets oracle A/B $148.17B/$60.61B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 4.5464 · accretion (see #13) · equity/EV token eq="86,029" ev="—"
22. "—" counts by section: comparables:12 profiles:9 targetprofile:6 shareholders:4 plAcquirer:30 plTarget:42 proforma:78 txnstructure:9 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 34.4% / oracle GP $5.12B present (see #18) | target gross profit "—" on §8 but §2 margin 34.4% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### KMI/OKE (30% default) — ts 2026-08-07T21:46:48.274Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $31.50B − cash $161M − sti 0 · mine $31.34B · rendered $31.34B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $54.44B (px 86.42×630sh) + netdebt $31.34B · mine $85.78B · rendered $85.78B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 112.35 × shares 630 · mine $70.78B · rendered $70.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $85.78B ÷ ltmRev $39.37B · mine 2.18x · rendered 2.20x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $85.78B ÷ ltmEBITDA $7.64B · mine 11.23x · rendered 11.20x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 86.42 ÷ ltmEPS 5.79 · mine 14.93x · rendered 14.90x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $16.28B + B $39.37B (vs §2 $16.28B+$39.37B) · mine $55.65B · rendered $55.65B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $7.18B + B $7.25B + synY1 $673M · mine $15.11B · rendered $15.10B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $3.06B + tgtNI $3.39B + syn $532M(tile) + fin $-2.92B · mine $4.06B · rendered $4.06B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $4.06B ÷ PF shares 3141 (dil 2223+new 918) · mine 1.29 · rendered 1.29 · Δ 0.00%
13. Accretion %: mine -5.8% (PF EPS 1.29 vs standalone 1.37) · rendered "-5.7%"
14. Exchange ratio (offer÷acqPx): inputs offer 112.35 ÷ acqPx 30.85 · mine 3.64 · rendered 3.64 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 1.4567 (full-stock ratio 3.6418 × 40%) · §10 at-market ratio rendered 2.8013
15. Sources=Uses: sources $102.50B vs uses $102.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $42.47B + tgtDebtRepaid $31.50B − excessCashUsed $9M · mine $73.96B · rendered $74.00B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$39.37B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=30.5%[VALUE] · §7=—[DASH] · §8tgt=$12,741[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$7,642 §2 EV/EBITDA=11.2x · EPS §2 P/E=14.9x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$31.50B · §16 verif=$30.80B · §2 net-debt-implied gross≈$31.50B · §2 EV=$85.78B · §txn EV=$102.10B | cash: oracle $161M · §2 $161M · §16 $78M | shares: oracle 630 · §16 630 | mktcap/equity: §2 54,445
21. Assets/accretion/exch/premium: total assets oracle A/B $74.06B/$68.55B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 3.6418 · accretion (see #13) · equity/EV token eq="54,445" ev="85,784"
22. "—" counts by section: comparables:10 profiles:5 targetprofile:5 shareholders:4 plAcquirer:37 plTarget:20 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 30.5% / oracle GP $10.26B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=12.8x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### DAL/ALK (30% default) — ts 2026-08-07T23:05:56.533Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $6.05B − cash $1.06B − sti $1.60B · mine $3.39B · rendered $3.39B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $5.80B (px 49.96×116sh) + netdebt $3.39B · mine $9.18B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 64.95 × shares 116 · mine $7.53B · rendered $7.53B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $14.76B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $589M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 49.96 ÷ ltmEPS -1.55 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $68.29B + B $14.76B (vs §2 $68.29B+$14.76B) · mine $83.05B · rendered $83.05B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $8.27B + B $1.10B + synY1 $285M · mine $9.65B · rendered $9.65B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $5.00B + tgtNI $100M + syn $225M(tile) + fin $-194M · mine $5.14B · rendered $5.14B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $5.14B ÷ PF shares 687 (dil 654+new 33) · mine 7.48 · rendered 7.48 · Δ 0.00%
13. Accretion %: mine -2.3% (PF EPS 7.48 vs standalone 7.66) · rendered "-2.4%"
14. Exchange ratio (offer÷acqPx): inputs offer 64.95 ÷ acqPx 91.34 · mine 0.71 · rendered 0.71 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.2844 (full-stock ratio 0.7111 × 40%) · §10 at-market ratio rendered 0.547
15. Sources=Uses: sources $13.70B vs uses $13.70B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $4.52B + tgtDebtRepaid $6.05B − excessCashUsed $5.67B · mine $4.90B · rendered $4.90B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$14.76B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP EXPECTED(airline: no COGS reporte) [§2gm=59.7%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$589 §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$6.05B · §16 verif=$5.30B · §2 net-debt-implied gross≈$4.45B · §2 EV=null · §txn EV=$10.90B | cash: oracle $1.06B · §2 $1.06B · §16 $627M | shares: oracle 116 · §16 116 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $86.32B/$21.25B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.7111 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:7 profiles:6 targetprofile:6 shareholders:4 plAcquirer:37 plTarget:37 proforma:102 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 59.7% / oracle GP $8.49B present (see #18) | target gross profit "—" on §8 but §2 margin 59.7% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=8.4x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### F/RIVN (30% default) — ts 2026-08-07T22:03:57.147Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $4.44B − cash $3.59B − sti $1.72B · mine $-866M · rendered $-866M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $19.84B (px 16×1240sh) + netdebt $-866M · mine $18.97B · rendered $18.97B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 20.8 × shares 1240 · mine $25.79B · rendered $25.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $18.97B ÷ ltmRev $5.88B · mine 3.23x · rendered 3.20x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $18.97B ÷ ltmEBITDA $-2.71B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 16 ÷ ltmEPS -2.51 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $189.86B + B $5.88B (vs §2 $189.86B+$5.88B) · mine $195.74B · rendered $195.74B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $6.80B + B $-2.80B + synY1 $108M · mine $4.11B · rendered $4.11B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-8.18B + tgtNI $-3.65B + syn $85M(tile) + fin null [component missing → not checked] · mine null · rendered $-11.70B · Δ n/a
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-11.70B ÷ PF shares 4717 (dil 3979+new 738) · mine -2.48 · rendered -2.49 · Δ 0.39%
13. Accretion %: mine n/m (base ≤0) (PF EPS -2.49 vs standalone -2.06) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 20.8 ÷ acqPx 13.98 · mine 1.49 · rendered 1.49 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.5951 (full-stock ratio 1.4878 × 40%) · §10 at-market ratio rendered 1.1445
15. Sources=Uses: sources $30.30B vs uses $30.30B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $15.48B + tgtDebtRepaid $4.44B − excessCashUsed $19.90B · mine $19M · rendered $0M · Δ n/a
17. LTM legs: oracle composed LTM rev(B)=$5.88B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=7.5%[VALUE] · §7=$442[VALUE] · §8tgt=$198[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($2,714) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$4.44B · §16 verif=$4.40B · §2 net-debt-implied gross≈$2.73B · §2 EV=$18.97B · §txn EV=$24.90B | cash: oracle $3.59B · §2 $3.59B · §16 $3.60B | shares: oracle 1240 · §16 1240 | mktcap/equity: §2 19,840
21. Assets/accretion/exch/premium: total assets oracle A/B $282.43B/$15.14B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.4878 · accretion (see #13) · equity/EV token eq="19,840" ev="18,974"
22. "—" counts by section: comparables:15 profiles:9 targetprofile:5 shareholders:4 plAcquirer:17 plTarget:17 proforma:70 txnstructure:8 exchange:16 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=2.8x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### PLTR/SNOW (30% default) — ts 2026-08-07T22:05:05.975Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $2.28B − cash $2.08B − sti $870M · mine $-673M · rendered $-673M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $114.35B (px 330.49×346sh) + netdebt $-673M · mine $113.68B · rendered $113.68B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 429.64 × shares 346 · mine $148.66B · rendered $148.70B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $113.68B ÷ ltmRev $5.03B · mine 22.59x · rendered 22.60x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $113.68B ÷ ltmEBITDA $-1.07B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 330.49 ÷ ltmEPS -3.47 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $6.16B + B $5.03B (vs §2 $6.16B+$5.03B) · mine $11.19B · rendered $11.19B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $1.44B + B $-1.22B + synY1 $94M · mine $319M · rendered $319M · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $1.63B + tgtNI $-1.33B + syn $74M(tile) + fin $-3.13B · mine $-2.77B · rendered $-2.77B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-2.77B ÷ PF shares 2911 (dil 2565+new 346) · mine -0.95 · rendered -0.95 · Δ 0.00%
13. Accretion %: mine -250.8% (PF EPS -0.95 vs standalone 0.63) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 429.64 ÷ acqPx 172.01 · mine 2.50 · rendered 2.50 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.9991 (full-stock ratio 2.4978 × 40%) · §10 at-market ratio rendered 1.9213
15. Sources=Uses: sources $151.40B vs uses $151.40B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $89.19B + tgtDebtRepaid $2.28B − excessCashUsed $12.10B · mine $79.38B · rendered $79.30B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$5.03B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=67.1%[VALUE] · §7=$3,379[VALUE] · §8tgt=$4,096[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($1,075) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$2.28B · §16 verif=$2.70B · §2 net-debt-implied gross≈$1.41B · §2 EV=$113.68B · §txn EV=$148.00B | cash: oracle $2.08B · §2 $2.08B · §16 $2.80B | shares: oracle 346 · §16 346 | mktcap/equity: §2 114,350
21. Assets/accretion/exch/premium: total assets oracle A/B $11.68B/$8.55B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 2.4978 · accretion (see #13) · equity/EV token eq="114,350" ev="113,677"
22. "—" counts by section: comparables:10 profiles:15 targetprofile:5 shareholders:16 plAcquirer:18 plTarget:17 proforma:70 txnstructure:8 exchange:1 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:22 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### NET/DDOG (30% default) — ts 2026-08-07T22:06:16.447Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash $435M − sti $4.55B · mine null · rendered $-4.99B · Δ n/a
4. Current EV (target §2): inputs mktcap $81.17B (px 233.93×347sh) + netdebt (oracle null) · mine $76.19B · rendered $76.19B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 304.11 × shares 347 · mine $105.53B · rendered $105.50B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $76.19B ÷ ltmRev $3.97B · mine 19.21x · rendered 19.20x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $76.19B ÷ ltmEBITDA $78M · mine 976.78x · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 233.93 ÷ ltmEPS 0.48 · mine 487.35x · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $2.51B + B $3.97B (vs §2 $2.51B+$3.97B) · mine $6.48B · rendered $6.48B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $-17M + B $5M + synY1 $70M · mine $58M · rendered $57M · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-102M + tgtNI $108M + syn $55M(tile) + fin $-2.15B · mine $-2.08B · rendered $-2.08B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-2.08B ÷ PF shares 489 (dil 348+new 141) · mine -4.26 · rendered -4.27 · Δ 0.19%
13. Accretion %: mine n/m (base ≤0) (PF EPS -4.27 vs standalone -0.29) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 304.11 ÷ acqPx 300.27 · mine 1.01 · rendered 1.01 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.4051 (full-stock ratio 1.0128 × 40%) · §10 at-market ratio rendered 0.7791
15. Sources=Uses: sources $105.80B vs uses $105.80B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $63.32B + tgtDebtRepaid $0M − excessCashUsed $9.02B · mine $54.30B · rendered $54.30B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $1.50B (see #20) — new debt understated by ~$1.50B
17. LTM legs: oracle composed LTM rev(B)=$3.97B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=79.5%[VALUE] · §7=$3,154[VALUE] · §8tgt=$3,497[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$78 §2 EV/EBITDA=n/m · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$1.50B · §2 net-debt-implied gross≈$-4.55B · §2 EV=$76.19B · §txn EV=$100.50B | cash: oracle $435M · §2 $435M · §16 $401M | shares: oracle 347 · §16 0 | mktcap/equity: §2 81,174
21. Assets/accretion/exch/premium: total assets oracle A/B $6.47B/$7.55B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.0128 · accretion (see #13) · equity/EV token eq="81,174" ev="76,189"
22. "—" counts by section: comparables:16 profiles:8 targetprofile:5 shareholders:4 plAcquirer:13 plTarget:18 proforma:72 txnstructure:8 exchange:26 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:22 verification2:22 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$1.50B on §16 (see #20) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### CRWD/S (30% default) — ts 2026-08-07T22:07:30.423Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash $153M − sti $504M · mine null · rendered $-657M · Δ n/a
4. Current EV (target §2): inputs mktcap $7.06B (px 21.4×330sh) + netdebt (oracle null) · mine $6.40B · rendered $6.41B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 27.82 × shares 330 · mine $9.18B · rendered $9.18B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $6.41B ÷ ltmRev $1.05B · mine 6.11x · rendered 6.10x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $6.41B ÷ ltmEBITDA $-253M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 21.4 ÷ ltmEPS -0.95 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $5.09B + B $1.05B (vs §2 $5.09B+$1.05B) · mine $6.14B · rendered $6.14B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $-293M + B $-266M + synY1 $20M · mine $-539M · rendered $-539M · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-163M + tgtNI $-451M + syn $16M(tile) + fin $-17M · mine $-615M · rendered $-615M · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-615M ÷ PF shares 268 (dil 251+new 17) · mine -2.29 · rendered -2.29 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -2.29 vs standalone -0.65) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 27.82 ÷ acqPx 214.42 · mine 0.13 · rendered 0.13 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0519 (full-stock ratio 0.1297 × 40%) · §10 at-market ratio rendered 0.0998
15. Sources=Uses: sources $9.27B vs uses $9.27B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $5.51B + tgtDebtRepaid $0M − excessCashUsed $5.09B · mine $421M · rendered $421M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$1.05B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=73.2%[VALUE] · §7=$768[VALUE] · §8tgt=$890[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($253) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$15M · §2 net-debt-implied gross≈$-504M · §2 EV=$6.41B · §txn EV=$8.52B | cash: oracle $153M · §2 $153M · §16 $170M | shares: oracle 330 · §16 330 | mktcap/equity: §2 7,062
21. Assets/accretion/exch/premium: total assets oracle A/B $11.27B/$2.36B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.1297 · accretion (see #13) · equity/EV token eq="7,062" ev="6,405"
22. "—" counts by section: comparables:15 profiles:8 targetprofile:5 shareholders:4 plAcquirer:18 plTarget:18 proforma:70 txnstructure:12 exchange:26 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:22 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### HOOD/COIN (30% default) — ts 2026-08-07T22:08:40.831Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $5.90B − cash $8.61B − sti $175M · mine $-2.89B · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $41.16B (px 153.6×268sh) + netdebt $-2.89B · mine $38.28B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 199.68 × shares 268 · mine $53.51B · rendered $53.50B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $6.28B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $873M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 153.6 ÷ ltmEPS -3.74 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $4.47B + B $6.28B (vs §2 null+null) · mine $10.76B · rendered null/— · Δ n/a
10. Combined EBITDA (A+B+synY1): inputs A null + B $1.62B + synY1 ? · mine null · rendered null/— · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $1.88B + tgtNI $1.26B + syn $114M(narrative×0.79) + fin $-1.69B · mine $1.57B · rendered $1.57B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $1.57B ÷ PF shares 1034 (dil 919+new 115) · mine 1.51 · rendered 1.51 · Δ 0.00%
13. Accretion %: mine -26.3% (PF EPS 1.51 vs standalone 2.05) · rendered "-26.1%" **Δ -0.2pp**
14. Exchange ratio (offer÷acqPx): inputs offer 199.68 ÷ acqPx 93.29 · mine 2.14 · rendered 2.14 · Δ 0.00%
14. Stock-leg ratio (offer×20%÷acqPx): mine 0.4281 (full-stock ratio 2.1404 × 20%) · §10 at-market ratio rendered 1.6465
15. Sources=Uses: sources $53.70B vs uses $53.70B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $42.81B + tgtDebtRepaid $5.90B − excessCashUsed null · mine null · rendered $42.80B · Δ n/a
17. LTM legs: oracle composed LTM rev(B)=$6.28B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ n/a · GP ok [§2gm=∅[ABSENT] · §7=∅[ABSENT] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=null · EPS §2 P/E=null
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$5.90B · §16 verif=$7.20B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$50.60B | cash: oracle $8.61B · §2 — · §16 $11.30B | shares: oracle 268 · §16 268 | mktcap/equity: §2 null
21. Assets/accretion/exch/premium: total assets oracle A/B $38.14B/$26.46B (rendered on a comparable surface: yes) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 2.1404 · accretion (see #13) · equity/EV token eq="" ev=""
22. "—" counts by section: comparables:8 profiles:11 targetprofile:6 shareholders:4 plAcquirer:4 plTarget:3 proforma:103 txnstructure:4 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=true (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### RBLX/U (30% default) — ts 2026-08-07T22:09:50.207Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $2.24B − cash $2.35B − sti 0 · mine $-115M · rendered $-115M · Δ 0.00%
4. Current EV (target §2): inputs mktcap null (px undefined×433sh) + netdebt $-115M · mine null · rendered $18.50B · Δ n/a
5. Equity value (offer×shares): inputs offer 55.9 × shares 433 · mine $24.20B · rendered $24.20B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $18.50B ÷ ltmRev $2.03B · mine 9.12x · rendered 9.10x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $18.50B ÷ ltmEBITDA $-135M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px undefined ÷ ltmEPS -1.35 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $5.69B + B $2.03B (vs §2 $5.69B+$2.03B) · mine $7.71B · rendered $7.71B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $-1.01B + B $-18M + synY1 $37M · mine $-988M · rendered $-988M · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-1.06B + tgtNI $-403M + syn $29M(tile) + fin $-456M · mine $-1.90B · rendered $-1.90B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-1.90B ÷ PF shares 946 (dil 690+new 256) · mine -2.00 · rendered -2.00 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -2 vs standalone -1.54) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 55.9 ÷ acqPx 37.79 · mine 1.48 · rendered 1.48 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.5917 (full-stock ratio 1.4792 × 40%) · §10 at-market ratio rendered 1.1379
15. Sources=Uses: sources $26.50B vs uses $26.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $14.52B + tgtDebtRepaid $2.24B − excessCashUsed $5.21B · mine $11.55B · rendered $11.50B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$2.03B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=64.8%[VALUE] · §7=$1,315[VALUE] · §8tgt=$1,586[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($135) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$2.24B · §16 verif=$2.40B · §2 net-debt-implied gross≈$2.24B · §2 EV=$18.50B · §txn EV=$24.10B | cash: oracle $2.35B · §2 $2.35B · §16 $2.10B | shares: oracle 433 · §16 433 | mktcap/equity: §2 18,619
21. Assets/accretion/exch/premium: total assets oracle A/B $9.74B/$6.66B (rendered on a comparable surface: NO — not shown in deck) · premium mine ?% vs rendered 30% (Δ ?) · exch ratio 1.4792 · accretion (see #13) · equity/EV token eq="18,619" ev="18,504"
22. "—" counts by section: comparables:16 profiles:5 targetprofile:5 shareholders:1 plAcquirer:20 plTarget:17 proforma:73 txnstructure:12 exchange:6 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:22 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### BRK.B/PGR (30% default) — ts 2026-08-07T23:07:11.518Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash null − sti $1.98B · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $126.18B (px 215.33×586sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 279.93 × shares 586 · mine $164.04B · rendered $164.00B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $91.06B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA null · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 215.33 ÷ ltmEPS 19.97 · mine 10.78x · rendered 10.80x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $0M + B $91.06B (vs §2 $0M+$91.06B) · mine $91.06B · rendered $91.06B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $0M + B null + synY1 $1.75B · mine null · rendered $0M · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $0M + tgtNI $11.30B + syn $1.39B(tile) + fin $-3.89B · mine $8.80B · rendered $8.80B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $8.80B ÷ PF shares ? (dil undefined+new 126) · mine null · rendered 70.02 · Δ n/a
13. Accretion %: mine n/m (base ≤0) (PF EPS 70.02 vs standalone 0) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 279.93 ÷ acqPx 521.8 · mine 0.54 · rendered null/— · Δ n/a
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.2146 (full-stock ratio 0.5365 × 40%) · §10 at-market ratio rendered n/a
15. Sources=Uses: sources $164.50B vs uses $164.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $98.42B + tgtDebtRepaid $0M − excessCashUsed $9M · mine $98.41B · rendered $98.40B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $6.90B (see #20) — new debt understated by ~$6.90B
17. LTM legs: oracle composed LTM rev(B)=$91.06B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=29.5%[VALUE] · §7=—[DASH] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=— · EPS §2 P/E=10.8x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$6.90B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$162.10B | cash: oracle null · §2 — · §16 $125M | shares: oracle 586 · §16 586 | mktcap/equity: §2 126,183
21. Assets/accretion/exch/premium: total assets oracle A/B null/$124.92B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio null · accretion (see #13) · equity/EV token eq="126,183" ev=""
22. "—" counts by section: comparables:26 profiles:31 targetprofile:7 shareholders:4 plAcquirer:1 plTarget:58 proforma:12 txnstructure:12 exchange:26 exchangeratio:1 equity:7 contribution:3 analyst:2 sources:17 verification:24 verification2:23 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$6.90B on §16 (see #20) | target gross profit "—" on §7 but §2 margin 29.5% / oracle GP $25.83B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### AMT/CCI (30% default) — ts 2026-08-07T23:08:23.710Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $15.98B − cash $1.04B − sti 0 · mine $14.94B · rendered $14.94B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $32.88B (px 75.59×435sh) + netdebt $14.94B · mine $47.82B · rendered $47.82B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 98.27 × shares 435 · mine $42.75B · rendered $42.70B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $47.82B ÷ ltmRev $203M · mine 235.56x · rendered 235.60x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $47.82B ÷ ltmEBITDA $2.66B · mine 17.95x · rendered 17.90x · Δ 0.28%
8. P/E (target §2 LTM): inputs px 75.59 ÷ ltmEPS 1.98 · mine 38.18x · rendered 38.20x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $926M + B $203M (vs §2 $926M+$203M) · mine $1.13B · rendered $1.13B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $4.85B + B $2.08B + synY1 $4M · mine $6.92B · rendered $6.92B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $2.53B + tgtNI $444M + syn $3M(tile) + fin $-1.54B · mine $1.44B · rendered $1.44B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $1.44B ÷ PF shares 568 (dil 469+new 99) · mine 2.53 · rendered 2.53 · Δ 0.00%
13. Accretion %: mine -53.1% (PF EPS 2.53 vs standalone 5.4) · rendered "-53.2%"
14. Exchange ratio (offer÷acqPx): inputs offer 98.27 ÷ acqPx 172.54 · mine 0.57 · rendered 0.57 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.2278 (full-stock ratio 0.5695 × 40%) · §10 at-market ratio rendered 0.4381
15. Sources=Uses: sources $58.90B vs uses $58.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $25.65B + tgtDebtRepaid $15.98B − excessCashUsed $2.63B · mine $39.00B · rendered $39.00B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$203M trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=47.4%[VALUE] · §7=—[DASH] · §8tgt=$1,917[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$2,664 §2 EV/EBITDA=17.9x · EPS §2 P/E=38.2x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$15.98B · §16 verif=$24.30B · §2 net-debt-implied gross≈$15.98B · §2 EV=$47.82B · §txn EV=$57.70B | cash: oracle $1.04B · §2 $1.04B · §16 $99M | shares: oracle 435 · §16 435 | mktcap/equity: §2 32,882
21. Assets/accretion/exch/premium: total assets oracle A/B $63.23B/$21.51B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.5695 · accretion (see #13) · equity/EV token eq="32,882" ev="47,819"
22. "—" counts by section: comparables:8 profiles:6 targetprofile:5 shareholders:17 plAcquirer:37 plTarget:20 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 47.4% / oracle GP $102M present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=15.9x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### MMC/AON (30% default) — ts 2026-08-07T22:18:19.871Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $12.95B − cash $1.06B − sti $205M · mine $11.68B · rendered $11.68B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $76.68B (px 358.3×214sh) + netdebt $11.68B · mine $88.36B · rendered $88.36B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 465.79 × shares 214 · mine $99.68B · rendered $99.70B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $88.36B ÷ ltmRev $17.58B · mine 5.03x · rendered 5.00x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $88.36B ÷ ltmEBITDA $4.65B · mine 18.98x · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 358.3 ÷ ltmEPS 18.24 · mine 19.64x · rendered 19.60x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $26.98B + B $17.58B (vs §2 $26.98B+$17.58B) · mine $44.56B · rendered $44.56B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $7.13B + B $4.52B + synY1 $344M · mine $12.00B · rendered $12.00B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $4.16B + tgtNI $3.69B + syn $272M(tile) + fin $-2.73B · mine $5.39B · rendered $5.39B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $5.39B ÷ PF shares 712 (dil 494+new 218) · mine 7.58 · rendered 7.58 · Δ 0.00%
13. Accretion %: mine -10.6% (PF EPS 7.58 vs standalone 8.48) · rendered "-10.7%"
14. Exchange ratio (offer÷acqPx): inputs offer 465.79 ÷ acqPx 182.7 · mine 2.55 · rendered 2.55 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 1.0198 (full-stock ratio 2.5495 × 40%) · §10 at-market ratio rendered 1.9611
15. Sources=Uses: sources $112.90B vs uses $112.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $59.81B + tgtDebtRepaid $12.95B − excessCashUsed $3.60B · mine $69.15B · rendered $69.20B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$17.58B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=47.7%[VALUE] · §7=—[DASH] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$4,654 d §2 EV/EBITDA=n/mᵇ · EPS §2 P/E=19.6x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$12.95B · §16 verif=$15.20B · §2 net-debt-implied gross≈$12.74B · §2 EV=$88.36B · §txn EV=$111.40B | cash: oracle $1.06B · §2 $1.06B · §16 $1.20B | shares: oracle 214 · §16 270 | mktcap/equity: §2 76,676
21. Assets/accretion/exch/premium: total assets oracle A/B null/$53.35B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 2.5495 · accretion (see #13) · equity/EV token eq="76,676" ev="88,356"
22. "—" counts by section: comparables:14 profiles:7 targetprofile:6 shareholders:4 plAcquirer:2 plTarget:42 proforma:12 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:17 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 47.7% / oracle GP $8.20B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=15.2x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### SPGI/MSCI (30% default) — ts 2026-08-07T22:19:31.917Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $6.38B − cash $356M − sti 0 · mine $6.02B · rendered $6.02B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $41.67B (px 563.17×74sh) + netdebt $6.02B · mine $47.70B · rendered $47.70B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 732.12 × shares 74 · mine $54.18B · rendered $54.20B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $47.70B ÷ ltmRev $3.33B · mine 14.31x · rendered 14.30x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $47.70B ÷ ltmEBITDA $1.88B · mine 25.36x · rendered 25.40x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 563.17 ÷ ltmEPS 18.58 · mine 30.31x · rendered 30.30x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $15.73B + B $3.33B (vs §2 $15.73B+$3.33B) · mine $19.06B · rendered $19.06B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $7.66B + B $1.74B + synY1 $63M · mine $9.46B · rendered $9.46B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $4.47B + tgtNI $1.20B + syn $50M(tile) + fin $-1.47B · mine $4.26B · rendered $4.26B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $4.26B ÷ PF shares 358 (dil 305+new 53) · mine 11.89 · rendered 11.89 · Δ 0.00%
13. Accretion %: mine -18.9% (PF EPS 11.89 vs standalone 14.66) · rendered "-18.9%"
14. Exchange ratio (offer÷acqPx): inputs offer 732.12 ÷ acqPx 408.19 · mine 1.79 · rendered 1.79 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.7174 (full-stock ratio 1.7936 × 40%) · §10 at-market ratio rendered 1.3797
15. Sources=Uses: sources $60.70B vs uses $60.70B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $32.51B + tgtDebtRepaid $6.38B − excessCashUsed $1.78B · mine $37.10B · rendered $37.10B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$3.33B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=82.5%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 56.8% skips target GP (null) but keeps target revenue → understated; correct ≈ 72.6%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$1,881 §2 EV/EBITDA=25.4x · EPS §2 P/E=30.3x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$6.38B · §16 verif=$6.20B · §2 net-debt-implied gross≈$6.38B · §2 EV=$47.70B · §txn EV=$60.20B | cash: oracle $356M · §2 $356M · §16 $515M | shares: oracle 74 · §16 74 | mktcap/equity: §2 41,675
21. Assets/accretion/exch/premium: total assets oracle A/B $60.79B/$5.60B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.7936 · accretion (see #13) · equity/EV token eq="41,675" ev="47,699"
22. "—" counts by section: comparables:8 profiles:5 targetprofile:6 shareholders:3 plAcquirer:21 plTarget:37 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 82.5% / oracle GP $2.58B present (see #18) | target gross profit "—" on §8 but §2 margin 82.5% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### BX/APO (30% default) — ts 2026-08-07T23:10:46.341Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $14.22B − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $73.79B (px 127.44×579sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 165.67 × shares 579 · mine $95.92B · rendered $95.90B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $31.56B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA null · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 127.44 ÷ ltmEPS 1.92 · mine 66.38x · rendered 66.40x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $16.11B + B $31.56B (vs §2 $16.11B+$31.56B) · mine $47.67B · rendered $47.67B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A null + B null + synY1 $641M · mine null · rendered $3.02B · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $3.02B + tgtNI $3.49B + syn $506M(tile) + fin $-2.83B · mine $4.18B · rendered $4.18B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $4.18B ÷ PF shares 1060 (dil 780+new 280) · mine 3.95 · rendered 3.95 · Δ 0.00%
13. Accretion %: mine 2.1% (PF EPS 3.95 vs standalone 3.87) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 165.67 ÷ acqPx 137.13 · mine 1.21 · rendered 1.21 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.4832 (full-stock ratio 1.2081 × 40%) · §10 at-market ratio rendered 0.9293
15. Sources=Uses: sources $110.40B vs uses $110.40B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $57.55B + tgtDebtRepaid $14.22B − excessCashUsed $9M · mine $71.76B · rendered $71.80B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$31.56B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=83.6%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc **ASYM** · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=— · EPS §2 P/E=66.4x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$14.22B · §16 verif=$13.40B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$110.10B | cash: oracle null · §2 — · §16 $19.20B | shares: oracle 579 · §16 579 | mktcap/equity: §2 73,788
21. Assets/accretion/exch/premium: total assets oracle A/B $49.89B/$467.53B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.2081 · accretion (see #13) · equity/EV token eq="73,788" ev="—"
22. "—" counts by section: comparables:12 profiles:11 targetprofile:7 shareholders:1 plAcquirer:57 plTarget:58 proforma:102 txnstructure:13 exchange:26 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:24 verification2:23 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 83.6% / oracle GP $26.80B present (see #18) | target gross profit "—" on §8 but §2 margin 83.6% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### NVDA/AMD (30% default) — ts 2026-08-07T22:21:52.959Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $3.23B − cash $5.09B − sti $8.03B · mine $-9.88B · rendered $-9.88B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $787.88B (px 483.36×1630sh) + netdebt $-9.88B · mine $777.99B · rendered $777.99B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 628.37 × shares 1630 · mine $1024.24B · rendered $1024.20B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $777.99B ÷ ltmRev $41.30B · mine 18.84x · rendered 18.80x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $777.99B ÷ ltmEBITDA $6.49B · mine 119.91x · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 483.36 ÷ ltmEPS 3.89 · mine 124.26x · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $215.94B + B $41.30B (vs §2 $215.94B+$41.30B) · mine $257.24B · rendered $257.24B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $133.23B + B $3.92B + synY1 $692M · mine $137.84B · rendered $137.80B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $120.10B + tgtNI $4.33B + syn $547M(tile) + fin $-23.50B · mine $101.48B · rendered $101.50B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $101.50B ÷ PF shares 26343 (dil 24514+new 1829) · mine 3.85 · rendered 3.85 · Δ 0.00%
13. Accretion %: mine -21.4% (PF EPS 3.85 vs standalone 4.9) · rendered "-21.4%"
14. Exchange ratio (offer÷acqPx): inputs offer 628.37 ÷ acqPx 223.96 · mine 2.81 · rendered 2.81 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 1.1223 (full-stock ratio 2.8057 × 40%) · §10 at-market ratio rendered 2.1582
15. Sources=Uses: sources $1030.50B vs uses $1030.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $614.55B + tgtDebtRepaid $3.23B − excessCashUsed $22.90B · mine $594.87B · rendered $594.90B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$41.30B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=53.2%[VALUE] · §7=$21,976[VALUE] · §8tgt=$25,261[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$6,488 d §2 EV/EBITDA=n/mᵇ · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$3.23B · §16 verif=$2.30B · §2 net-debt-implied gross≈$-4.80B · §2 EV=$777.99B · §txn EV=$1014.40B | cash: oracle $5.09B · §2 $5.09B · §16 $5.50B | shares: oracle 1630 · §16 1630 | mktcap/equity: §2 787,877
21. Assets/accretion/exch/premium: total assets oracle A/B $206.80B/$84.46B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 2.8057 · accretion (see #13) · equity/EV token eq="787,877" ev="777,992"
22. "—" counts by section: comparables:7 profiles:13 targetprofile:5 shareholders:2 plAcquirer:12 plTarget:18 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=40.8x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### LLY/SRPT (30% default) — ts 2026-08-07T22:23:03.391Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $848M − cash $571M − sti $217M · mine $60M · rendered $60M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $1.76B (px 16.78×105sh) + netdebt $60M · mine $1.82B · rendered $1.82B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 21.81 × shares 105 · mine $2.29B · rendered $2.29B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $1.82B ÷ ltmRev $1.40B · mine 1.30x · rendered 1.30x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $1.82B ÷ ltmEBITDA $-99M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 16.78 ÷ ltmEPS -1.12 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $79.67B + B $1.40B (vs §2 $79.67B+$1.40B) · mine $81.06B · rendered $81.06B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A null + B $-655M + synY1 $37M · mine null · rendered $20.60B · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $20.60B + tgtNI $-412M + syn $29M(tile) + fin null [component missing → not checked] · mine null · rendered $20.30B · Δ n/a
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $20.30B ÷ PF shares 900 (dil 899+new 1) · mine 22.56 · rendered 22.51 · Δ 0.20%
13. Accretion %: mine -1.9% (PF EPS 22.51 vs standalone 22.95) · rendered "-1.9%"
14. Exchange ratio (offer÷acqPx): inputs offer 21.81 ÷ acqPx 1185.71 · mine 0.02 · rendered 0.02 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0074 (full-stock ratio 0.0184 × 40%) · §10 at-market ratio rendered 0.0142
15. Sources=Uses: sources $3.16B vs uses $3.16B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $1.37B + tgtDebtRepaid $848M − excessCashUsed $2.22B · mine $0M · rendered $0M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$1.40B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=-1.6%[VALUE] · §7=—[DASH] · §8tgt=$1,818[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($99) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$848M · §16 verif=$829M · §2 net-debt-implied gross≈$631M · §2 EV=$1.82B · §txn EV=$2.35B | cash: oracle $571M · §2 $571M · §16 $801M | shares: oracle 105 · §16 105 | mktcap/equity: §2 1,762
21. Assets/accretion/exch/premium: total assets oracle A/B $142.28B/$3.19B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.0184 · accretion (see #13) · equity/EV token eq="1,762" ev="1,822"
22. "—" counts by section: comparables:17 profiles:7 targetprofile:5 shareholders:4 plAcquirer:35 plTarget:24 proforma:69 txnstructure:13 exchange:6 exchangeratio:6 equity:7 contribution:5 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin -1.6% / oracle GP $-29M present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### COST/BJ (30% default) — ts 2026-08-07T23:11:56.082Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $399M − cash $28M − sti 0 · mine $371M · rendered $371M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $12.54B (px 96.48×130sh) + netdebt $371M · mine $12.91B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 125.42 × shares 130 · mine $16.30B · rendered $16.30B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $21.96B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $1.12B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 96.48 ÷ ltmEPS 4.42 · mine 21.83x · rendered 21.80x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $293.59B + B $21.96B (vs §2 $293.59B+$21.96B) · mine $315.55B · rendered $315.55B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $12.81B + B $1.10B + synY1 $429M · mine $14.34B · rendered $14.30B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $8.10B + tgtNI $578M + syn $339M(tile) + fin null [component missing → not checked] · mine null · rendered $9.02B · Δ n/a
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $9.02B ÷ PF shares 452 (dil 445+new 7) · mine 19.95 · rendered 19.95 · Δ 0.00%
13. Accretion %: mine 9.6% (PF EPS 19.95 vs standalone 18.21) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 125.42 ÷ acqPx 947.82 · mine 0.13 · rendered 0.13 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0529 (full-stock ratio 0.1323 × 40%) · §10 at-market ratio rendered 0.1018
15. Sources=Uses: sources $16.80B vs uses $16.80B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $9.78B + tgtDebtRepaid $399M − excessCashUsed $10.20B · mine $0M · rendered $0M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$21.96B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=18.6%[VALUE] · §7=—[DASH] · §8tgt=$4,409[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$1,116 §2 EV/EBITDA=— · EPS §2 P/E=21.8x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$399M · §16 verif=$399M · §2 net-debt-implied gross≈$399M · §2 EV=null · §txn EV=$16.70B | cash: oracle $28M · §2 $28M · §16 $46M | shares: oracle 130 · §16 130 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $86.43B/$7.93B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.1323 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:12 profiles:5 targetprofile:5 shareholders:4 plAcquirer:20 plTarget:20 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:21 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 18.6% / oracle GP $4.00B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=29.4x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### HD/FND (30% default) — ts 2026-08-07T23:53:41.273Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $195M − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $6.77B (px 62.69×108sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 81.5 × shares 108 · mine $8.80B · rendered $8.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $4.71B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $546M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 62.69 ÷ ltmEPS 2.14 · mine 29.29x · rendered 29.30x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $166.59B + B $4.71B (vs §2 $166.59B+$4.71B) · mine $171.30B · rendered $171.30B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $24.40B + B $511M + synY1 $94M · mine $25.01B · rendered $25.00B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $14.20B + tgtNI $209M + syn $74M(tile) + fin $-216M · mine $14.27B · rendered $14.20B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $14.20B ÷ PF shares 1005 (dil 995+new 10) · mine 14.13 · rendered 14.15 · Δ -0.15%
13. Accretion %: mine -0.6% (PF EPS 14.15 vs standalone 14.23) · rendered "-0.5%"
14. Exchange ratio (offer÷acqPx): inputs offer 81.5 ÷ acqPx 355.62 · mine 0.23 · rendered 0.23 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0917 (full-stock ratio 0.2292 × 40%) · §10 at-market ratio rendered 0.1763
15. Sources=Uses: sources $9.09B vs uses $9.09B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $5.28B + tgtDebtRepaid $195M − excessCashUsed $9M · mine $5.47B · rendered $5.48B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$4.71B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=44.9%[VALUE] · §7=$2,114[VALUE] · §8tgt=$2,118[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$546 §2 EV/EBITDA=— · EPS §2 P/E=29.3x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$195M · §16 verif=$194M · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$9.00B | cash: oracle null · §2 — · §16 $249M | shares: oracle 108 · §16 108 | mktcap/equity: §2 6,771
21. Assets/accretion/exch/premium: total assets oracle A/B $107.90B/$5.71B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.2292 · accretion (see #13) · equity/EV token eq="6,771" ev="—"
22. "—" counts by section: comparables:11 profiles:10 targetprofile:5 shareholders:1 plAcquirer:13 plTarget:18 proforma:69 txnstructure:9 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:23 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=16.4x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### RDDT/PINS (30% default) — ts 2026-08-07T23:41:34.284Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $981M − cash $422M − sti $852M · mine $-293M · rendered $-293M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $15.98B (px 23.68×675sh) + netdebt $-293M · mine $15.69B · rendered $15.69B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 30.78 × shares 675 · mine $20.78B · rendered $20.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $15.69B ÷ ltmRev $4.56B · mine 3.44x · rendered 3.40x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $15.69B ÷ ltmEBITDA $258M · mine 60.82x · rendered 60.80x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 23.68 ÷ ltmEPS 0.42 · mine 56.38x · rendered 56.40x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $2.78B + B $4.56B (vs §2 $2.78B+$4.56B) · mine $7.33B · rendered $7.33B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $458M + B $345M + synY1 $84M · mine $887M · rendered $887M · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $530M + tgtNI $417M + syn $66M(tile) + fin $-377M · mine $636M · rendered $637M · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $637M ÷ PF shares 253 (dil 202+new 51) · mine 2.52 · rendered 2.51 · Δ 0.31%
13. Accretion %: mine -4.2% (PF EPS 2.51 vs standalone 2.62) · rendered "-4.1%"
14. Exchange ratio (offer÷acqPx): inputs offer 30.78 ÷ acqPx 161.7 · mine 0.19 · rendered 0.19 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0761 (full-stock ratio 0.1904 × 40%) · §10 at-market ratio rendered 0.1464
15. Sources=Uses: sources $21.80B vs uses $21.80B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $12.47B + tgtDebtRepaid $981M − excessCashUsed $3.91B · mine $9.53B · rendered $9.53B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$4.56B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=80.1%[VALUE] · §7=—[DASH] · §8tgt=$3,929[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$258 §2 EV/EBITDA=60.8x · EPS §2 P/E=56.4x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$981M · §16 verif=$262M · §2 net-debt-implied gross≈$129M · §2 EV=$15.69B · §txn EV=$20.50B | cash: oracle $422M · §2 $422M · §16 $969M | shares: oracle 675 · §16 0 | mktcap/equity: §2 15,984
21. Assets/accretion/exch/premium: total assets oracle A/B $3.64B/$4.76B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.1904 · accretion (see #13) · equity/EV token eq="15,984" ev="15,691"
22. "—" counts by section: comparables:10 profiles:8 targetprofile:5 shareholders:40 plAcquirer:17 plTarget:20 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 80.1% / oracle GP $3.38B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=34x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### ARM/SNPS (30% default) — ts 2026-08-07T23:42:43.235Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $10.04B − cash $2.41B − sti $72M · mine $7.55B · rendered $7.55B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $77.37B (px 415.99×186sh) + netdebt $7.55B · mine $84.93B · rendered $84.93B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 540.79 × shares 186 · mine $100.59B · rendered $100.60B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $84.93B ÷ ltmRev $8.68B · mine 9.79x · rendered 9.80x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $84.93B ÷ ltmEBITDA $2.08B · mine 40.81x · rendered 40.80x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 415.99 ÷ ltmEPS 4.04 · mine 102.97x · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $4.92B + B $8.68B (vs §2 $4.92B+$8.68B) · mine $13.60B · rendered $13.60B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $1.15B + B $1.57B + synY1 $141M · mine $2.86B · rendered $2.87B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $904M + tgtNI $1.33B + syn $111M(tile) + fin $-2.55B · mine $-200M · rendered $-199M · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-199M ÷ PF shares 1210 (dil 1068+new 142) · mine -0.16 · rendered -0.16 · Δ 0.00%
13. Accretion %: mine -118.8% (PF EPS -0.16 vs standalone 0.85) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 540.79 ÷ acqPx 282.57 · mine 1.91 · rendered 1.91 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.7655 (full-stock ratio 1.9138 × 40%) · §10 at-market ratio rendered 1.4722
15. Sources=Uses: sources $110.90B vs uses $110.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $60.35B + tgtDebtRepaid $10.04B − excessCashUsed $5.91B · mine $64.48B · rendered $64.50B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$8.68B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=73.5%[VALUE] · §7=$6,377[VALUE] · §8tgt=$7,454[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$2,081 §2 EV/EBITDA=40.8x · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$10.04B · §16 verif=$13.50B · §2 net-debt-implied gross≈$9.96B · §2 EV=$84.93B · §txn EV=$108.10B | cash: oracle $2.41B · §2 $2.41B · §16 $2.90B | shares: oracle 186 · §16 186 | mktcap/equity: §2 77,374
21. Assets/accretion/exch/premium: total assets oracle A/B $10.70B/$46.89B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.9138 · accretion (see #13) · equity/EV token eq="77,374" ev="84,926"
22. "—" counts by section: comparables:10 profiles:8 targetprofile:5 shareholders:11 plAcquirer:16 plTarget:13 proforma:70 txnstructure:8 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### CART/DASH (30% default) — ts 2026-08-07T22:33:36.800Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash $4.42B − sti $923M · mine null · rendered $-5.35B · Δ n/a
4. Current EV (target §2): inputs mktcap $92.34B (px 216.26×427sh) + netdebt (oracle null) · mine $87.00B · rendered $87.00B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 281.14 × shares 427 · mine $120.05B · rendered $120.00B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $87.00B ÷ ltmRev $15.89B · mine 5.47x · rendered 5.50x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $87.00B ÷ ltmEBITDA $1.71B · mine 50.82x · rendered 50.80x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 216.26 ÷ ltmEPS 1.91 · mine 113.23x · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $3.99B + B $15.89B (vs §2 $3.99B+$15.89B) · mine $19.88B · rendered $19.88B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $589M + B $1.47B + synY1 $273M · mine $2.33B · rendered $2.33B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $447M + tgtNI $935M + syn $216M(tile) + fin $-2.62B · mine $-1.02B · rendered $-1.02B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-1.02B ÷ PF shares 1237 (dil 280+new 957) · mine -0.82 · rendered -0.82 · Δ 0.00%
13. Accretion %: mine -151.3% (PF EPS -0.82 vs standalone 1.6) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 281.14 ÷ acqPx 50.17 · mine 5.60 · rendered 5.60 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 2.2415 (full-stock ratio 5.6037 × 40%) · §10 at-market ratio rendered 4.3105
15. Sources=Uses: sources $120.40B vs uses $120.40B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $72.03B + tgtDebtRepaid $0M − excessCashUsed $5.80B · mine $66.23B · rendered $66.20B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $3.30B (see #20) — new debt understated by ~$3.30B
17. LTM legs: oracle composed LTM rev(B)=$15.89B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=50.9%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 14.1% skips target GP (null) but keeps target revenue → understated; correct ≈ 55.3%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$1,712 §2 EV/EBITDA=50.8x · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$3.30B · §2 net-debt-implied gross≈$-923M · §2 EV=$87.00B · §txn EV=$114.70B | cash: oracle $4.42B · §2 $4.42B · §16 $4.40B | shares: oracle 427 · §16 427 | mktcap/equity: §2 92,343
21. Assets/accretion/exch/premium: total assets oracle A/B $3.51B/$19.56B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 5.6037 · accretion (see #13) · equity/EV token eq="92,343" ev="86,996"
22. "—" counts by section: comparables:13 profiles:11 targetprofile:6 shareholders:40 plAcquirer:18 plTarget:42 proforma:80 txnstructure:8 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$3.30B on §16 (see #20) | target gross profit "—" on §7 but §2 margin 50.9% / oracle GP $6.98B present (see #18) | target gross profit "—" on §8 but §2 margin 50.9% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=16.2x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### MSTR/COIN (30% default) — ts 2026-08-07T22:35:10.265Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $5.90B − cash $8.61B − sti $175M · mine $-2.89B · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $41.16B (px 153.6×268sh) + netdebt $-2.89B · mine $38.28B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 199.68 × shares 268 · mine $53.51B · rendered $53.50B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $6.28B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $873M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 153.6 ÷ ltmEPS -3.74 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $498M + B $6.28B (vs §2 null+null) · mine $6.78B · rendered null/— · Δ n/a
10. Combined EBITDA (A+B+synY1): inputs A $-5.42B + B $1.62B + synY1 ? · mine $-3.79B · rendered null/— · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-3.85B + tgtNI $1.26B + syn $114M(narrative×0.79) + fin $-1.69B · mine $-4.17B · rendered $-4.17B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-4.17B ÷ PF shares 385 (dil 278+new 107) · mine -10.82 · rendered -10.82 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -10.82 vs standalone -15.23) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 199.68 ÷ acqPx 100.01 · mine 2.00 · rendered 2.00 · Δ 0.00%
14. Stock-leg ratio (offer×20%÷acqPx): mine 0.3993 (full-stock ratio 1.9966 × 20%) · §10 at-market ratio rendered 1.5358
15. Sources=Uses: sources $53.70B vs uses $53.70B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $42.81B + tgtDebtRepaid $5.90B − excessCashUsed null · mine null · rendered $42.80B · Δ n/a
17. LTM legs: oracle composed LTM rev(B)=$6.28B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ n/a · GP ok [§2gm=∅[ABSENT] · §7=∅[ABSENT] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 5.8% skips target GP (null) but keeps target revenue → understated; correct ≈ ?%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=null · EPS §2 P/E=null
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$5.90B · §16 verif=$7.20B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$50.60B | cash: oracle $8.61B · §2 — · §16 $11.30B | shares: oracle 268 · §16 268 | mktcap/equity: §2 null
21. Assets/accretion/exch/premium: total assets oracle A/B $52.56B/$26.46B (rendered on a comparable surface: yes) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.9966 · accretion (see #13) · equity/EV token eq="" ev=""
22. "—" counts by section: comparables:8 profiles:11 targetprofile:6 shareholders:4 plAcquirer:3 plTarget:3 proforma:80 txnstructure:4 exchange:1 exchangeratio:6 equity:7 contribution:3 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=false
24. Sector: bankMode=true (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### MRNA/BNTX (30% default) — ts 2026-08-07T23:22:32.542Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt null − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $22.48B (px 93.67×240sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 121.77 × shares 240 · mine $29.22B · rendered $29.20B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $0M · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA null · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 93.67 ÷ ltmEPS 0 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $2.23B + B $0M (vs §2 $2.23B+$0M) · mine $2.23B · rendered $2.23B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $-2.86B + B null + synY1 $0M · mine null · rendered $-2.82B · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $-2.82B + tgtNI $0M + syn $0M(tile) + fin $-693M · mine $-3.52B · rendered $-3.52B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $-3.52B ÷ PF shares 587 (dil 389+new 198) · mine -5.99 · rendered -5.99 · Δ 0.00%
13. Accretion %: mine n/m (base ≤0) (PF EPS -5.99 vs standalone -7.26) · rendered "N/A" · suppressed by design (neg base)
14. Exchange ratio (offer÷acqPx): inputs offer 121.77 ÷ acqPx 59.17 · mine 2.06 · rendered 2.06 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.8232 (full-stock ratio 2.0580 × 40%) · §10 at-market ratio rendered 1.5831
15. Sources=Uses: sources $29.30B vs uses $29.30B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $17.53B + tgtDebtRepaid $0M − excessCashUsed $9M · mine $17.53B · rendered $17.50B · Δ 0.00%
16.   ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows $309M (see #20) — new debt understated by ~$309M
17. LTM legs: oracle composed LTM rev(B)=$0M trusted=false · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ n/a · GP ok [§2gm=—[DASH] · §7=∅[ABSENT] · §8tgt=∅[ABSENT]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=**null** · §16 verif=$309M · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$29.20B | cash: oracle null · §2 — · §16 $8.90B | shares: oracle 240 · §16 240 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $10.96B/null (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 2.058 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠"
22. "—" counts by section: comparables:21 profiles:14 targetprofile:6 shareholders:4 plAcquirer:20 plTarget:2 proforma:12 txnstructure:12 exchange:38 exchangeratio:6 equity:7 contribution:4 analyst:2 sources:19 verification:27 verification2:17 · HIDES-A-FIGURE: target debt "—" on §2/§3/§7 but $$309M on §16 (see #20) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=true → accretion % correctly suppressed=YES · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=true · DCF-suppress-signal=false · neg-equity-signal=false

### GME/BBWI (30% default) — ts 2026-08-07T23:23:43.523Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $3.61B − cash $820M − sti 0 · mine $2.79B · rendered $2.79B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $4.09B (px 20.36×201sh) + netdebt $2.79B · mine $6.89B · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 26.47 × shares 201 · mine $5.32B · rendered $5.32B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $7.25B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $1.15B · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 20.36 ÷ ltmEPS 3.6 · mine 5.66x · rendered 5.70x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $3.73B + B $7.25B (vs §2 $3.73B+$7.25B) · mine $10.98B · rendered $10.98B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $288M + B $1.65B + synY1 $146M · mine $2.08B · rendered $2.08B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $418M + tgtNI $649M + syn $115M(tile) + fin null [component missing → not checked] · mine null · rendered $1.18B · Δ n/a
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $1.18B ÷ PF shares 660 (dil 549+new 111) · mine 1.79 · rendered 1.79 · Δ 0.00%
13. Accretion %: mine 132.5% (PF EPS 1.79 vs standalone 0.77) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 26.47 ÷ acqPx 19.16 · mine 1.38 · rendered 1.38 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.5526 (full-stock ratio 1.3815 × 40%) · §10 at-market ratio rendered 1.0626
15. Sources=Uses: sources $8.99B vs uses $8.99B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $3.19B + tgtDebtRepaid $3.61B − excessCashUsed $6.80B · mine $0M · rendered $0M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$7.25B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=43.2%[VALUE] · §7=$3,130[VALUE] · §8tgt=$3,102[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$1,148 d §2 EV/EBITDA=— · EPS §2 P/E=5.7x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$3.61B · §16 verif=$3.90B · §2 net-debt-implied gross≈$3.61B · §2 EV=null · §txn EV=$8.11B | cash: oracle $820M · §2 $820M · §16 $953M | shares: oracle 201 · §16 201 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $10.97B/$4.96B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 1.3815 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:13 profiles:8 targetprofile:5 shareholders:4 plAcquirer:17 plTarget:18 proforma:50 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=true
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### AAPL/VZ (30% default) — ts 2026-08-07T22:39:50.471Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $143.45B − cash $1.75B − sti 0 · mine $141.70B · rendered $141.70B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $198.50B (px 47.06×4218sh) + netdebt $141.70B · mine $340.20B · rendered $340.19B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 61.18 × shares 4218 · mine $258.06B · rendered $258.10B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $340.19B ÷ ltmRev $138.90B · mine 2.45x · rendered 2.40x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $340.19B ÷ ltmEBITDA $47.57B · mine 7.15x · rendered 7.20x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 47.06 ÷ ltmEPS 3.86 · mine 12.19x · rendered 12.20x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $466.82B + B $138.90B (vs §2 $466.82B+$138.90B) · mine $605.72B · rendered $605.72B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $144.75B + B $47.61B + synY1 $2.76B · mine $195.12B · rendered $195.10B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $112.00B + tgtNI $17.20B + syn $2.18B(tile) + fin $-9.73B · mine $121.66B · rendered $121.60B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $121.60B ÷ PF shares 15334 (dil 15005+new 329) · mine 7.93 · rendered 7.93 · Δ 0.00%
13. Accretion %: mine 6.3% (PF EPS 7.93 vs standalone 7.46) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 61.18 ÷ acqPx 313.33 · mine 0.20 · rendered 0.20 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0781 (full-stock ratio 0.1953 × 40%) · §10 at-market ratio rendered 0.1502
15. Sources=Uses: sources $402.30B vs uses $402.30B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $154.83B + tgtDebtRepaid $143.45B − excessCashUsed $52.00B · mine $246.28B · rendered $246.20B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$138.90B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=45.6%[VALUE] · §7=—[DASH] · §8tgt=—[DASH]] · COGS ok · **§8 combined GM 36.2% skips target GP (null) but keeps target revenue → understated; correct ≈ 46.6%**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$47,567 §2 EV/EBITDA=7.2x · EPS §2 P/E=12.2x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$143.45B · §16 verif=$139.50B · §2 net-debt-implied gross≈$143.45B · §2 EV=$340.19B · §txn EV=$399.80B | cash: oracle $1.75B · §2 $1.75B · §16 $19.00B | shares: oracle 4218 · §16 4218 | mktcap/equity: §2 198,499
21. Assets/accretion/exch/premium: total assets oracle A/B $383.27B/$410.19B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.1953 · accretion (see #13) · equity/EV token eq="198,499" ev="340,195"
22. "—" counts by section: comparables:6 profiles:6 targetprofile:6 shareholders:4 plAcquirer:13 plTarget:41 proforma:78 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 45.6% / oracle GP $63.08B present (see #18) | target gross profit "—" on §8 but §2 margin 45.6% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=27.7x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### GOOGL/AMZN (30% default) — ts 2026-08-07T22:41:00.313Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $133.00B − cash $78.21B − sti $44.77B · mine $10.01B · rendered $10.01B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $2945.44B (px 274.48×10731sh) + netdebt $10.01B · mine $2955.45B · rendered $2955.45B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 356.82 × shares 10731 · mine $3829.04B · rendered $3829.00B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $2955.45B ÷ ltmRev $775.68B · mine 3.81x · rendered 3.80x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $2955.45B ÷ ltmEBITDA $168.91B · mine 17.50x · rendered 17.50x · Δ 0.00%
8. P/E (target §2 LTM): inputs px 274.48 ÷ ltmEPS 12.42 · mine 22.10x · rendered 22.10x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $445.87B + B $775.68B (vs §2 $445.87B+$775.68B) · mine $1221.55B · rendered $1221.55B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $129.04B + B $145.73B + synY1 $14.30B · mine $289.07B · rendered $289.10B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $132.20B + tgtNI $77.70B + syn $11.30B(tile) + fin $-82.50B · mine $138.70B · rendered $138.60B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $138.60B ÷ PF shares 16553 (dil 12230+new 4323) · mine 8.37 · rendered 8.38 · Δ -0.08%
13. Accretion %: mine -22.5% (PF EPS 8.38 vs standalone 10.81) · rendered "-22.5%"
14. Exchange ratio (offer÷acqPx): inputs offer 356.82 ÷ acqPx 354.3 · mine 1.01 · rendered 1.01 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.4028 (full-stock ratio 1.0071 × 40%) · §10 at-market ratio rendered 0.7747
15. Sources=Uses: sources $3973.50B vs uses $3973.50B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $2297.42B + tgtDebtRepaid $133.00B − excessCashUsed $341.00B · mine $2089.42B · rendered $2089.40B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$775.68B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=50.3%[VALUE] · §7=—[DASH] · §8tgt=$415,634[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$168,912 §2 EV/EBITDA=17.5x · EPS §2 P/E=22.1xᵃ
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$133.00B · §16 verif=$68.80B · §2 net-debt-implied gross≈$88.22B · §2 EV=$2955.45B · §txn EV=$3839.00B | cash: oracle $78.21B · §2 $78.21B · §16 $86.80B | shares: oracle 10731 · §16 10731 | mktcap/equity: §2 2,945,445
21. Assets/accretion/exch/premium: total assets oracle A/B $921.98B/$1095.69B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.0071 · accretion (see #13) · equity/EV token eq="2,945,445" ev="2,955,452"
22. "—" counts by section: comparables:8 profiles:4 targetprofile:5 shareholders:4 plAcquirer:17 plTarget:16 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:23 verification2:22 · HIDES-A-FIGURE: target gross profit "—" on §7 but §2 margin 50.3% / oracle GP $360.51B present (see #18) · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### CRM/TEAM (30% default) — ts 2026-08-07T23:25:05.751Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $989M − cash $1.14B − sti $0M · mine $-147M · rendered $-147M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $39.06B (px 149.07×262sh) + netdebt $-147M · mine $38.91B · rendered $38.91B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 193.79 × shares 262 · mine $50.77B · rendered $50.80B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $38.91B ÷ ltmRev $6.19B · mine 6.29x · rendered 6.30x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $38.91B ÷ ltmEBITDA $-104M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 149.07 ÷ ltmEPS -0.83 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $42.83B + B $6.19B (vs §2 $42.83B+$6.19B) · mine $49.02B · rendered $49.02B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $9.53B + B $-38M + synY1 $104M · mine $9.60B · rendered $9.60B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $12.00B + tgtNI $976M + syn $82M(tile) + fin $-769M · mine $12.29B · rendered $12.30B · Δ 0.00%
11.   ↳ note: deck acquirer NI $12.00B vs oracle $7.46B (basis/period differs — informational)
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $12.30B ÷ PF shares 1061 (dil 956+new 105) · mine 11.59 · rendered 11.55 · Δ 0.37%
13. Accretion %: mine -7.7% (PF EPS 11.55 vs standalone 12.52) · rendered "-7.8%"
14. Exchange ratio (offer÷acqPx): inputs offer 193.79 ÷ acqPx 192.74 · mine 1.01 · rendered 1.01 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.4022 (full-stock ratio 1.0054 × 40%) · §10 at-market ratio rendered 0.7734
15. Sources=Uses: sources $51.90B vs uses $51.90B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $30.46B + tgtDebtRepaid $989M − excessCashUsed $12.00B · mine $19.45B · rendered $19.50B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$6.19B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=84.0%[VALUE] · §7=$5,197[VALUE] · §8tgt=$5,360[VALUE]] · COGS **ASYMMETRY**
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=($104) §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$989M · §16 verif=$988M · §2 net-debt-implied gross≈$989M · §2 EV=$38.91B · §txn EV=$50.60B | cash: oracle $1.14B · §2 $1.14B · §16 $2.50B | shares: oracle 262 · §16 262 | mktcap/equity: §2 39,056
21. Assets/accretion/exch/premium: total assets oracle A/B $106.68B/$5.65B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 1.0054 · accretion (see #13) · equity/EV token eq="39,056" ev="38,909"
22. "—" counts by section: comparables:9 profiles:5 targetprofile:7 shareholders:48 plAcquirer:19 plTarget:18 proforma:69 txnstructure:9 exchange:1 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### MCD/RRGB (30% default) — ts 2026-08-07T23:26:32.025Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $171M − cash $24M − sti 0 · mine $147M · rendered $147M · Δ 0.00%
4. Current EV (target §2): inputs mktcap $148M (px 8.2×18sh) + netdebt $147M · mine $295M · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 10.66 × shares 18 · mine $192M · rendered $192M · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $1.20B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA $50M · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 8.2 ÷ ltmEPS -1.47 · mine null · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $27.70B + B $1.20B (vs §2 $27.70B+$1.20B) · mine $28.90B · rendered $28.90B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $12.85B + B $54M + synY1 $24M · mine $12.93B · rendered $12.90B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $8.56B + tgtNI $-23M + syn $19M(tile) + fin $-1M · mine $8.56B · rendered $8.56B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $8.56B ÷ PF shares 0 (dil 0+new 0) · mine null · rendered 11.94 · Δ n/a
13. Accretion %: mine -0.1% (PF EPS 11.94 vs standalone 11.95) · rendered "-0.1%"
14. Exchange ratio (offer÷acqPx): inputs offer 10.66 ÷ acqPx 274.48 · mine 0.04 · rendered 0.04 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.0155 (full-stock ratio 0.0388 × 40%) · §10 at-market ratio rendered 0.0299
15. Sources=Uses: sources $369M vs uses $369M · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $115M + tgtDebtRepaid $171M − excessCashUsed $268M · mine $18M · rendered $18M · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$1.20B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP **ASYMMETRY** [§2gm=67.9%[VALUE] · §7=∅[ABSENT] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$50 §2 EV/EBITDA=— · EPS §2 P/E=n/m
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$171M · §16 verif=$170M · §2 net-debt-implied gross≈$171M · §2 EV=null · §txn EV=$339M | cash: oracle $24M · §2 $24M · §16 $20M | shares: oracle 18 · §16 18 | mktcap/equity: §2 ⚠
21. Assets/accretion/exch/premium: total assets oracle A/B $59.92B/$544M (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 0.0388 · accretion (see #13) · equity/EV token eq="⚠" ev="⚠" **WITHHELD despite computable**
22. "—" counts by section: comparables:8 profiles:5 targetprofile:6 shareholders:15 plAcquirer:10 plTarget:14 proforma:102 txnstructure:9 exchange:6 exchangeratio:6 equity:7 contribution:3 analyst:4 sources:16 verification:23 verification2:23 · HIDES-A-FIGURE: target gross profit "—" on §8 but §2 margin 67.9% present · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=17.6x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### JPM/BAC (30% default) — ts 2026-08-07T23:27:43.108Z
1. Builds? YES · pages=17 · consoleErrors=0 · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $339.86B − cash null − sti 0 · mine null · rendered null/— · Δ n/a
4. Current EV (target §2): inputs mktcap $455.58B (px 63.17×7212sh) + netdebt (oracle null) · mine null · rendered null/— · Δ n/a
5. Equity value (offer×shares): inputs offer 82.12 × shares 7212 · mine $592.25B · rendered $592.20B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV null ÷ ltmRev $119.24B · mine null · rendered null/— · Δ n/a
7. EV/EBITDA (target §2): inputs EV null ÷ ltmEBITDA null · mine null · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 63.17 ÷ ltmEPS 4.57 · mine 13.82x · rendered null/— · Δ n/a
9. Combined revenue (A+B LTM): inputs A $182.45B + B $119.24B (vs §2 null+null) · mine $301.68B · rendered null/— · Δ n/a
10. Combined EBITDA (A+B+synY1): inputs A null + B null + synY1 ? · mine null · rendered null/— · Δ n/a
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $57.00B + tgtNI $30.50B + syn $2.77B(narrative×0.79) + fin $-18.70B · mine $71.56B · rendered $71.60B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $71.60B ÷ PF shares 3113 (dil 2782+new 331) · mine 23.00 · rendered 23.00 · Δ 0.00%
13. Accretion %: mine 14.9% (PF EPS 23 vs standalone 20.02) · rendered "?"
14. Exchange ratio (offer÷acqPx): inputs offer 82.12 ÷ acqPx 357.52 · mine 0.23 · rendered 0.23 · Δ 0.00%
14. Stock-leg ratio (offer×20%÷acqPx): mine 0.0459 (full-stock ratio 0.2297 × 20%) · §10 at-market ratio rendered 0.1767
15. Sources=Uses: sources $594.00B vs uses $594.00B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $473.80B + tgtDebtRepaid $339.86B − excessCashUsed null · mine null · rendered $473.80B · Δ n/a
17. LTM legs: oracle composed LTM rev(B)=$119.24B trusted=true · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ n/a · GP ok [§2gm=∅[ABSENT] · §7=∅[ABSENT] · §8tgt=—[DASH]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=— §2 EV/EBITDA=null · EPS §2 P/E=null
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$339.86B · §16 verif=$317.80B · §2 net-debt-implied gross≈— · §2 EV=null · §txn EV=$932.10B | cash: oracle null · §2 — · §16 $231.80B | shares: oracle 7212 · §16 7212 | mktcap/equity: §2 null
21. Assets/accretion/exch/premium: total assets oracle A/B $4424.90B/$3499.19B (rendered on a comparable surface: yes) · premium mine 30.0% vs rendered 30% (Δ -0.0pp) · exch ratio 0.2297 · accretion (see #13) · equity/EV token eq="" ev=""
22. "—" counts by section: comparables:7 profiles:6 targetprofile:7 shareholders:4 plAcquirer:4 plTarget:4 proforma:102 txnstructure:4 exchange:26 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:24 verification2:23 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=true (EV/EBITDA acq §2=suppressed/—) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false

### AMZN/MSFT (30% default) — ts 2026-08-07T22:50:22.869Z
1. Builds? YES · pages=17 · consoleErrors=1 (benign nongaap-429; GAAP fallback) · pageErrors=0
2. Bad tokens: none
3. Net debt (target): inputs debt $40.29B − cash $20.93B − sti $55.91B · mine $-36.55B · rendered $-36.55B · Δ 0.00%
4. Current EV (target §2): inputs mktcap $3713.43B (px 499.99×7427sh) + netdebt $-36.55B · mine $3676.88B · rendered $3676.88B · Δ 0.00%
5. Equity value (offer×shares): inputs offer 649.99 × shares 7427 · mine $4827.48B · rendered $4827.50B · Δ 0.00%
6. EV/Revenue (target §2): inputs EV $3676.88B ÷ ltmRev $331.84B · mine 11.08x · rendered 11.10x · Δ 0.00%
7. EV/EBITDA (target §2): inputs EV $3676.88B ÷ ltmEBITDA $155.24B · mine 23.69x · rendered null/— · Δ n/a
8. P/E (target §2 LTM): inputs px 499.99 ÷ ltmEPS 17.95 · mine 27.85x · rendered 27.90x · Δ 0.00%
9. Combined revenue (A+B LTM): inputs A $775.68B + B $331.84B (vs §2 $775.68B+$331.84B) · mine $1107.52B · rendered $1107.52B · Δ 0.00%
10. Combined EBITDA (A+B+synY1): inputs A $145.73B + B $155.24B + synY1 $6.64B · mine $307.60B · rendered $307.60B · Δ 0.00%
11. Pro forma NI (acqNI+tgtNI+syn+fin): inputs acqNI $77.70B + tgtNI $133.70B + syn $5.24B(tile) + fin $-108.70B · mine $107.94B · rendered $107.90B · Δ 0.00%
12. Pro forma EPS (PFNI÷PFsh): inputs PF NI $107.90B ÷ PF shares 17862 (dil 10827+new 7035) · mine 6.04 · rendered 6.04 · Δ 0.00%
13. Accretion %: mine -15.8% (PF EPS 6.04 vs standalone 7.17) · rendered "-15.7%"
14. Exchange ratio (offer÷acqPx): inputs offer 649.99 ÷ acqPx 274.48 · mine 2.37 · rendered 2.37 · Δ 0.00%
14. Stock-leg ratio (offer×40%÷acqPx): mine 0.9472 (full-stock ratio 2.3681 × 40%) · §10 at-market ratio rendered 1.8216
15. Sources=Uses: sources $4882.30B vs uses $4882.30B · Δ 0.00% ✓
16. New acq. debt (cashConsid+debtRepaid−excessCash): inputs cashConsid $2896.49B + tgtDebtRepaid $40.29B − excessCashUsed $184.30B · mine $2752.48B · rendered $2752.50B · Δ 0.00%
17. LTM legs: oracle composed LTM rev(B)=$331.84B trusted=false · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)
18. Rev/COGS/GP/GM cross-surface (target): rev Δ 0.00% · GP ok [§2gm=67.9%[VALUE] · §7=$264,688 e[VALUE] · §8tgt=$264,688[VALUE]] · COGS ok
19. OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ok · NI ok · EBITDA(info) §7=$213,343 §2 EV/EBITDA=n/mᵇ · EPS §2 P/E=27.9x
20. **Cross-surface (target)** — debt: oracle/quote(pref)=$40.29B · §16 verif=$40.30B · §2 net-debt-implied gross≈$-15.61B · §2 EV=$3676.88B · §txn EV=$4790.90B | cash: oracle $20.93B · §2 $20.93B · §16 $20.90B | shares: oracle 7427 · §16 7427 | mktcap/equity: §2 3,713,426
21. Assets/accretion/exch/premium: total assets oracle A/B $1095.69B/$758.38B (rendered on a comparable surface: NO — not shown in deck) · premium mine 30.0% vs rendered 30% (Δ 0.0pp) · exch ratio 2.3681 · accretion (see #13) · equity/EV token eq="3,713,426" ev="3,676,877"
22. "—" counts by section: comparables:8 profiles:4 targetprofile:5 shareholders:3 plAcquirer:16 plTarget:12 proforma:69 txnstructure:9 exchange:6 exchangeratio:6 equity:7 contribution:2 analyst:2 sources:16 verification:22 verification2:21 · HIDES-A-FIGURE: none detected · (n/m states are deliberate, not counted as missing)
23. Neg/zero-base claims: acquirer loss-making=false → accretion % correctly suppressed=n/a · combined-EBITDA non-positive claim=false
24. Sector: bankMode=false (EV/EBITDA acq §2=17.5x) · FX-rate-stated=false · DCF-suppress-signal=false · neg-equity-signal=false
