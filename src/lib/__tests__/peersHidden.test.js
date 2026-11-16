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
