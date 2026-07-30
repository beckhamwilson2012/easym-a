'use strict';
const { get } = require('../utils/httpGet');

// ── FX-rate helper (FX BUILD Stage 0) ──────────────────────────────────────────────────────────────────
// Supplies BOTH conversion bases for the currency work: SPOT (as-of a date — for market values & the
// balance sheet) and PERIOD-AVERAGE (over a fiscal year — for P&L flows). This module produces RATES ONLY;
// it converts no figures and wires no consumer. All rates are live from FMP forex — nothing hardcoded.
//
// SYMBOLOGY + DIRECTION (verified live): FMP forex pairs are `${FROM}${TO}` (e.g. CHFUSD, EURUSD) and the
// /stable/quote price is the value of 1 FROM in TO units — i.e. CHFUSD ≈ 1.23 = USD per 1 CHF. Therefore
//   amount_FROM × rate = amount_TO   (85,467 CHF × 1.23 ≈ $105B — franc worth MORE than a dollar).
// If a deployment ever returns the inverted pair (USDCHF ≈ 0.81), invert before use — the self-test guards
// this by asserting the direction against a known-larger USD result.

const FMP_KEY = process.env.FMP_KEY || '';
const BASE    = 'https://financialmodelingprep.com/stable';

// In-memory cache — FX is stable within a deck render; keyed by (kind, pair, date/window) so a figure-heavy
// slide never refetches the same rate. 1h TTL: intraday drift is immaterial for a comps deck.
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;
const getCached = (k) => { const c = cache.get(k); return c && Date.now() - c.ts < CACHE_TTL ? c.val : undefined; };
const setCached = (k, val) => { cache.set(k, { ts: Date.now(), val }); };

const pair = (from, to) => `${from}${to}`.toUpperCase();

// SPOT rate as-of a date (current if no date / date is today-or-future). USD→USD short-circuits to 1 (no
// fetch). Historical asOfDate uses the nearest PRIOR trading-day row (weekends/holidays have no FX row).
// Returns { rate, source, asOf } or null on failure — the caller decides the fallback, never fabricated.
async function getSpotRate(fromCcy, toCcy = 'USD', asOfDate = null) {
  const from = (fromCcy || 'USD').toUpperCase();
  const to   = (toCcy   || 'USD').toUpperCase();
  if (from === to) return { rate: 1, source: 'identity' };
  const key = `spot:${pair(from, to)}:${asOfDate || 'current'}`;
  const hit = getCached(key); if (hit !== undefined) return hit;
  try {
    const today = new Date().toISOString().slice(0, 10);
    let out = null;
    if (!asOfDate || asOfDate >= today) {
      const q  = await get(`${BASE}/quote?symbol=${pair(from, to)}&apikey=${FMP_KEY}`);
      const q0 = Array.isArray(q) ? q[0] : q;
      const r  = q0 ? parseFloat(q0.price) : NaN;
      if (Number.isFinite(r) && r > 0) out = { rate: r, source: 'fmp-quote', asOf: today };
    } else {
      const hist = await get(`${BASE}/historical-price-eod/light?symbol=${pair(from, to)}&apikey=${FMP_KEY}`);
      const rows = (Array.isArray(hist) ? hist : hist?.historical) || [];
      const onOrBefore = rows
        .map(x => ({ date: x.date, price: x.price ?? x.close }))
        .filter(x => x.date && x.date <= asOfDate && x.price > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      if (onOrBefore.length) out = { rate: onOrBefore[0].price, source: 'fmp-historical', asOf: onOrBefore[0].date, requested: asOfDate };
    }
    setCached(key, out);
    return out;
  } catch (_) { return null; }
}

// PERIOD-AVERAGE rate over [fyStart, fyEnd] — the FILER's fiscal year (NOT a calendar guess). Averages the
// daily closes PRESENT in that window (missing weekend/holiday days are simply absent; `days` exposes the
// count so a data gap is visible). USD→USD short-circuits to 1. Returns { rate, days, window, source } or null.
async function getPeriodAverageRate(fromCcy, toCcy = 'USD', fyStart, fyEnd) {
  const from = (fromCcy || 'USD').toUpperCase();
  const to   = (toCcy   || 'USD').toUpperCase();
  if (from === to) return { rate: 1, days: 0, source: 'identity' };
  if (!fyStart || !fyEnd) return null;
  const key = `avg:${pair(from, to)}:${fyStart}:${fyEnd}`;
  const hit = getCached(key); if (hit !== undefined) return hit;
  try {
    const hist = await get(`${BASE}/historical-price-eod/light?symbol=${pair(from, to)}&apikey=${FMP_KEY}`);
    const rows = (Array.isArray(hist) ? hist : hist?.historical) || [];
    const vals = rows
      .map(x => ({ date: x.date, price: x.price ?? x.close }))
      .filter(x => x.date >= fyStart && x.date <= fyEnd && x.price > 0)
      .map(x => x.price);
    if (!vals.length) { setCached(key, null); return null; }
    const rate = vals.reduce((a, b) => a + b, 0) / vals.length;
    const out = { rate, days: vals.length, window: [fyStart, fyEnd], source: 'fmp-historical-avg' };
    setCached(key, out);
    return out;
  } catch (_) { return null; }
}

// Resolve the conversion rates + FY-average window for an FMP filer (Stage 1). Given the raw income &
// balance records (for reporting currency + fiscal-year end) and the price currency, returns the three
// basis rates ready to multiply onto figures:
//   avgRate   — PERIOD-AVERAGE over the filer's fiscal year (income.date → FY window) — for P&L flows
//   spotRate  — SPOT (current) for the balance-sheet reporting currency — for debt/cash
//   priceRate — SPOT for the price/market currency — for price/market cap (skip when already USD, e.g. ADR)
// USD filer → all rates 1 with NO fetches (strict no-op, no latency). Rates default to 1 on any fetch
// failure (fail-open: value stays as reported rather than mis-converted; `converted`/`avgWindow` expose it).
async function resolveFmpRates(income, balance, priceCcy = 'USD') {
  const finCcy = (income?.reportedCurrency  || 'USD').toUpperCase();
  const balCcy = (balance?.reportedCurrency || finCcy).toUpperCase();
  const pCcy   = (priceCcy || 'USD').toUpperCase();
  let avgWindow = null, avgRate = 1, avgDays = 0;
  if (finCcy !== 'USD' && income?.date) {
    const fyEnd = String(income.date).slice(0, 10);
    const d = new Date(fyEnd + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    d.setUTCDate(d.getUTCDate() + 1);                 // FY-end back one year, +1 day → FY start
    const fyStart = d.toISOString().slice(0, 10);
    avgWindow = [fyStart, fyEnd];
    const a = await getPeriodAverageRate(finCcy, 'USD', fyStart, fyEnd);
    avgRate = a?.rate ?? 1; avgDays = a?.days ?? 0;
  }
  const spotRate  = balCcy !== 'USD' ? ((await getSpotRate(balCcy, 'USD'))?.rate ?? 1) : 1;
  const priceRate = pCcy   !== 'USD' ? ((await getSpotRate(pCcy,   'USD'))?.rate ?? 1) : 1;
  return {
    reportedCurrency: finCcy, priceCurrency: pCcy,
    avgRate, spotRate, priceRate, avgWindow, avgDays,
    converted: finCcy !== 'USD' || balCcy !== 'USD' || pCcy !== 'USD',
  };
}

module.exports = { getSpotRate, getPeriodAverageRate, resolveFmpRates };
