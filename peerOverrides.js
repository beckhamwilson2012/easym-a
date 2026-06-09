'use strict';

/**
 * Hand-curated peer sets for major tickers.
 * Key: target ticker (uppercase). Value: array of peer tickers.
 * These override the SIC-based fallback when a ticker is present.
 */
const PEER_OVERRIDES = {
  // Major investment banks / broker-dealers (SIC 6211)
  MS:   ['GS', 'JPM', 'BAC', 'C', 'BK'],
  GS:   ['MS', 'JPM', 'BAC', 'C', 'BK'],
  JPM:  ['BAC', 'C', 'WFC', 'GS', 'MS'],
  BAC:  ['JPM', 'C', 'WFC', 'GS', 'MS'],
  C:    ['JPM', 'BAC', 'WFC', 'GS', 'MS'],
  WFC:  ['JPM', 'BAC', 'C', 'USB', 'PNC'],
  BK:   ['STT', 'JPM', 'MS', 'GS', 'C'],
  STT:  ['BK', 'JPM', 'MS', 'GS', 'C'],
  USB:  ['PNC', 'WFC', 'TFC', 'RF', 'CFG'],
  PNC:  ['USB', 'WFC', 'TFC', 'RF', 'CFG'],

  // Large-cap tech / cloud (SIC 7372)
  MSFT: ['GOOGL', 'AMZN', 'ORCL', 'CRM', 'ADBE'],
  GOOGL:['MSFT', 'META', 'AMZN', 'SNAP', 'PINS'],
  META: ['GOOGL', 'SNAP', 'PINS', 'TWTR', 'MTCH'],
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
};

module.exports = { PEER_OVERRIDES };
