import { composeSourceLine, ASSUMPTION_FIELDS } from '../composeSourceLine';

// ── Stub builders ────────────────────────────────────────────────────────────

function makeVerified(chosenSource, sourceMeta, asOf = '2026-06-03') {
  return {
    status: 'verified', chosenSource,
    sourceMeta: Object.fromEntries(
      Object.entries(sourceMeta).map(([s, v]) => [s, { value: v, asOf }])
    ),
  };
}
function makeSingle(chosenSource, value, asOf = '2025-06-30') {
  return { status: 'single', chosenSource, sourceMeta: { [chosenSource]: { value, asOf } } };
}
function makeFlagged(chosenSource, sourceMeta, asOf = '2026-06-03') {
  return {
    status: 'flagged', chosenSource,
    sourceMeta: Object.fromEntries(
      Object.entries(sourceMeta).map(([s, v]) => [s, { value: v, asOf }])
    ),
  };
}
function makeMissing() { return { status: 'missing', chosenSource: null, sourceMeta: {} }; }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('composeSourceLine()', () => {

  test('EDGAR-only slide: cites EDGAR, assumption clause, no "as of" date', () => {
    const fields = {
      revenue:         makeSingle('edgar', 5215),
      operatingIncome: makeSingle('edgar', 312),
      netIncome:       makeSingle('edgar', -257),
      sharesOutstanding: makeSingle('edgar', 262),
    };
    const result = composeSourceLine(
      ['revenue', 'operatingIncome', 'netIncome', 'sharesOutstanding', 'synergiesY1'],
      fields, '2026-06-03'
    );
    expect(result).toContain('SEC EDGAR');
    expect(result).toContain('transaction assumptions');
    expect(result).not.toContain('Finnhub');
    expect(result).not.toContain('Market data as of');
  });

  test('non-headline feeds (Finnhub/Yahoo) verify the price but are NOT named by the allowlist', () => {
    // price verifies via Finnhub cross-checked by Yahoo — both are opportunistic feeds excluded from
    // HEADLINE_SOURCES (they rate-limit / 403, so naming them would make the same deck cite different
    // sources run-to-run). Neither is surfaced by name; with no headline source among the used fields
    // there is no "Source:" prefix and no market "as of" clause — only the assumption clause remains.
    const fields = {
      price:      makeVerified('finnhub', { finnhub: 189.30, yahoo: 189.28 }),
      week52High: makeVerified('finnhub', { finnhub: 198.23, yahoo: 198.10 }),
      week52Low:  makeVerified('finnhub', { finnhub: 164.08, yahoo: 164.00 }),
    };
    const result = composeSourceLine(
      ['price', 'week52High', 'week52Low', 'dcfRange', 'precedentRange'],
      fields, '2026-06-03'
    );
    expect(result).not.toContain('Finnhub');
    expect(result).not.toContain('Yahoo');
    expect(result).not.toContain('Source:');             // no headline source among the used fields
    expect(result).toContain('transaction assumptions'); // dcfRange / precedentRange
    expect(result).not.toContain('Market data as of');   // no headline market source cited
  });

  test('pure-assumption slide: no Source: prefix, only assumption clause', () => {
    const result = composeSourceLine(
      ['offerPrice', 'premium', 'cashPercent', 'synergiesY1'],
      {}, '2026-06-03'
    );
    expect(result).not.toContain('Source:');
    expect(result).toContain('transaction assumptions');
  });

  test('missing analyst targets → assumption clause, source NOT cited', () => {
    const fields = {
      revenue:           makeSingle('edgar', 5215),
      analystTargetMean: makeMissing(),
      analystTargetHigh: makeMissing(),
      analystTargetLow:  makeMissing(),
    };
    const result = composeSourceLine(
      ['revenue', 'analystTargetMean', 'analystTargetHigh', 'analystTargetLow'],
      fields, '2026-06-03'
    );
    expect(result).toContain('SEC EDGAR');
    expect(result).toContain('transaction assumptions');
    expect(result).not.toContain('Finnhub');
    expect(result).not.toContain('Market data as of');
  });

  test('flagged field: SOT source still cited', () => {
    const fields = { revenue: makeFlagged('edgar', { edgar: 5215, fmp: 5300 }) };
    const result = composeSourceLine(['revenue'], fields, '2026-06-03');
    expect(result).toContain('SEC EDGAR');
  });

  test('citation order: EDGAR (fundamental) before market-data (CNBC); Yahoo cross-check not named', () => {
    const fields = {
      revenue: makeSingle('edgar', 5215),
      // price verifies via CNBC (SOT, a headline source) cross-checked against Yahoo (non-headline)
      price:   makeVerified('cnbc', { cnbc: 189.30, yahoo: 189.28 }),
    };
    const result = composeSourceLine(['revenue', 'price'], fields, '2026-06-03');
    const ei = result.indexOf('SEC EDGAR');
    const ci = result.indexOf('CNBC');
    expect(ei).toBeGreaterThan(-1);
    expect(ci).toBeGreaterThan(-1);
    expect(ei).toBeLessThan(ci);            // EDGAR (fundamental) cited before market data
    expect(result).not.toContain('Yahoo');  // opportunistic cross-check feed is not surfaced by name
  });

  test('null fields object → assumption only', () => {
    const result = composeSourceLine(['revenue', 'price'], null, '2026-06-03');
    expect(result).not.toContain('Source:');
    expect(result).toContain('transaction assumptions');
  });

  test('no used fields → empty string', () => {
    expect(composeSourceLine([], {}, '2026-06-03')).toBe('');
  });

});
