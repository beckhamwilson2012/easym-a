'use strict';

/**
 * Hand-curated peer sets for major tickers.
 * Key: target ticker (uppercase). Value: array of peer tickers.
 * An entry replaces the automatic candidates and the industry test of the peer screen (server/services/peerSelect.js):
 * the list IS the industry judgment. Since Fix 24 it passes through every other keep-filter: 0.2×–5× the target's
 * market cap, US-listed, Fix 21's registration check, the data Comparables needs, never the acquirer or the target.
 * A name that fails is dropped from the slide (listed in /api/peers `dropped`), so a list can show fewer than it holds.
 *
 * Dead tickers removed, with the reason:
 *   TWTR — Twitter, taken private and delisted in 2022 (FIX7A).
 *   BK   — not a current ticker: Bank of New York Mellon trades as BNY (SEC company_tickers.json lists BNY and BNY-PK
 *          for CIK 1390777, and no BK). Replaced by BNY, the same company, in every list and as the key (Fix 24).
 */
const PEER_OVERRIDES = {
  // Major investment banks / broker-dealers (SIC 6211)
  MS:   ['GS', 'JPM', 'BAC', 'C', 'BNY'],
  GS:   ['MS', 'JPM', 'BAC', 'C', 'BNY'],
  JPM:  ['BAC', 'C', 'WFC', 'GS', 'MS'],
  BAC:  ['JPM', 'C', 'WFC', 'GS', 'MS'],
  C:    ['JPM', 'BAC', 'WFC', 'GS', 'MS'],
  WFC:  ['JPM', 'BAC', 'C', 'USB', 'PNC'],
  BNY:  ['STT', 'JPM', 'MS', 'GS', 'C'],
  STT:  ['BNY', 'JPM', 'MS', 'GS', 'C'],
  USB:  ['PNC', 'WFC', 'TFC', 'RF', 'CFG'],
  PNC:  ['USB', 'WFC', 'TFC', 'RF', 'CFG'],

  // Large-cap tech / cloud (SIC 7372)
  MSFT: ['GOOGL', 'AMZN', 'ORCL', 'CRM', 'ADBE'],
  GOOGL:['MSFT', 'META', 'AMZN', 'SNAP', 'PINS'],
  META: ['GOOGL', 'SNAP', 'PINS', 'MTCH'],   // TWTR removed: delisted 2022 (FIX7A)
  AMZN: ['MSFT', 'GOOGL', 'WMT', 'SHOP', 'EBAY'],

  // Semiconductors (SIC 3674)
  NVDA: ['AMD', 'INTC', 'QCOM', 'AVGO', 'TXN'],
  AMD:  ['NVDA', 'INTC', 'QCOM', 'AVGO', 'TXN'],
  INTC: ['AMD', 'NVDA', 'QCOM', 'TXN', 'AVGO'],
  AVGO: ['QCOM', 'TXN', 'NVDA', 'AMD', 'MRVL'],
  QCOM: ['AVGO', 'TXN', 'NVDA', 'AMD', 'MRVL'],

  // SaaS / enterprise software (SIC 7372). ~7 peers (target + 7 ≈ 8 screening columns). WDAY is
  // intentionally NOT used as a peer: its EDGAR shares-outstanding is badly under-reported
  // (~36M vs ~265M) → implausible market cap / EV-Revenue (see diag(comps)); SNOW takes the slot.
  CRM:  ['NOW', 'ADBE', 'SAP', 'ORCL', 'INTU', 'SNOW', 'TEAM'],
  NOW:  ['CRM', 'ADBE', 'SAP', 'ORCL', 'INTU', 'SNOW', 'TEAM'],
  WDAY: ['CRM', 'NOW', 'ADBE', 'SAP', 'ORCL', 'INTU', 'SNOW'],
  TEAM: ['CRM', 'NOW', 'ADBE', 'SAP', 'ORCL', 'INTU', 'SNOW'],
  ADBE: ['CRM', 'NOW', 'TEAM', 'SAP', 'ORCL', 'INTU', 'SNOW'],

  // Retail / big box (SIC 5331 / 5411)
  WMT:  ['TGT', 'COST', 'AMZN', 'KR', 'DG'],
  TGT:  ['WMT', 'COST', 'AMZN', 'KR', 'DG'],
  COST: ['WMT', 'TGT', 'BJ', 'AMZN', 'KR'],

  // Large-cap pharma (SIC 2836)
  PFE:  ['MRK', 'JNJ', 'LLY', 'ABBV', 'BMY'],
  MRK:  ['PFE', 'JNJ', 'LLY', 'ABBV', 'BMY'],
  JNJ:  ['PFE', 'MRK', 'LLY', 'ABBV', 'ABT'],
  LLY:  ['PFE', 'MRK', 'JNJ', 'ABBV', 'BMY'],

  // Digital musculoskeletal care. Hinge (SIC 7374), Omada (8000), Teladoc (8011) and Progyny (8090) sit in
  // four SIC codes and two FMP industries, so no automatic screen pairs them (CHECK5). Set by hand.
  HNGE: ['OMDA', 'TDOC', 'PGNY'],
  // Omada (Fix 17 Task 4): the brief's four candidates, each run through the automatic stock-peer filters of the time
  // (Fix 8: SEC filer, FMP market cap 0.1×–10× OMDA's, 10-K/10-Q in the past 12 months, revenue in the app's /quote;
  // HNGE excluded as the acquirer) on Nov 16 2026, OMDA cap $899M (CNBC $14.49 × 62.04M). All three also sit inside
  // Fix 24's 0.2×–5× band:
  //   TDOC — Teladoc Health, SIC 8011, 1.76× OMDA's cap: passes.
  //   PGNY — Progyny, SIC 8090, 3.04×: passes.
  //   HIMS — Hims & Hers Health, SIC 8011, 4.67×: passes.
  //   TALK — Talkspace: fails "not-sec-filer" (not in SEC company_tickers.json), so it is left out.
  // Three pass, the screen's minimum. Fix 14's list was TDOC, AMWL, HIMS.
  OMDA: ['TDOC', 'PGNY', 'HIMS'],
};

module.exports = { PEER_OVERRIDES };
