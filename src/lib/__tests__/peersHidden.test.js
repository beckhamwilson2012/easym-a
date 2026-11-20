// Fix 14 Task 6: whenever Comparables shows no peer column, the slide says why. And OMDA's hand-set peer list.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SectionComparables } from '../../components/deck/sections/SectionComparables';
const { PEER_OVERRIDES } = require('../../../peerOverrides');

const target = { ticker: 'OMDA', name: 'Omada Health, Inc.' };
const acquirer = { ticker: 'HNGE', name: 'Hinge Health, Inc.' };
const deal = { _inputs: { companyABasis: 'ltm' }, _results: {} };

function mockFetch(peersResponse) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/peers/')) return peersResponse();
    return Promise.resolve({ json: () => Promise.resolve(null) });
  });
}

afterEach(() => { delete global.fetch; });

test('a failed peer request shows the reason, not a bare two-company table', async () => {
  mockFetch(() => Promise.reject(new Error('HTTP 429')));
  render(<SectionComparables target={target} acquirer={acquirer} deal={deal} />);
  await waitFor(() => expect(screen.getAllByTestId('peers-hidden').length).toBeGreaterThan(0));
  expect(screen.getAllByTestId('peers-hidden')[0].textContent).toMatch(/The peer screen request failed \(HTTP 429\)/);
});

test('a trusted list holding only the deal’s own companies is a hidden peer set too, with why', async () => {
  mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ peers: ['HNGE'], trust: 'trusted', source: 'fmp', reason: null }) }));
  render(<SectionComparables target={target} acquirer={acquirer} deal={deal} />);
  await waitFor(() => expect(screen.getAllByTestId('peers-hidden').length).toBeGreaterThan(0));
  expect(screen.getAllByTestId('peers-hidden')[0].textContent).toMatch(/returned only HNGE, the deal's own companies/);
});

test('OMDA has a hand-set peer list of US-listed digital-health companies, without its acquirer', () => {
  expect(PEER_OVERRIDES.OMDA).toEqual(['TDOC', 'PGNY', 'HIMS']);   // Fix 17 Task 4
  expect(PEER_OVERRIDES.OMDA).not.toContain('HNGE');
});

test('Fix 24: fewer than 3 peers passing still shows the ones that passed, with the reason in the footnote', async () => {
  const reason = 'Only 2 companies passed the peer screen (need 3): 3 outside 0.2×–5× the target\'s market cap (F, HMC, TSLA)';
  mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ peers: ['RACE', 'PCAR'], peerSources: { RACE: 'industry-sic', PCAR: 'sic' }, trust: 'untrusted', source: 'fmp', reason }) }));
  const { container } = render(<SectionComparables target={{ ticker: 'TM', name: 'Toyota' }} acquirer={{ ticker: 'GM', name: 'General Motors' }} deal={deal} />);
  await waitFor(() => expect(container.textContent).toMatch(/Peers: RACE \(industry \+ SIC match\); PCAR \(SIC match\)\. Only 2 companies passed/));
  expect(screen.queryAllByTestId('peers-hidden')).toHaveLength(0);
});

test('Fix 24: a hand-set peer set says so in the header, not "Auto-selected"', async () => {
  mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ peers: ['TDOC', 'PGNY', 'HIMS'], peerSources: { TDOC: 'override', PGNY: 'override', HIMS: 'override' }, trust: 'trusted', source: 'override', reason: null }) }));
  const { container } = render(<SectionComparables target={target} acquirer={acquirer} deal={deal} />);
  await waitFor(() => expect(container.textContent).toMatch(/Set by hand/));
  expect(container.textContent).toMatch(/Peers: TDOC, PGNY, HIMS \(hand-set\)/);
  expect(container.textContent).not.toMatch(/Auto-selected/);
});
