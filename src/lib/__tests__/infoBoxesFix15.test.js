// Fix 15: the "Highest premium still accretive" suggestion and the reporting-basis notes sit behind the input
// page's ⓘ toggle (the Fix 4 infoButton / infoBox), closed by default, with the old text word for word.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestedPremiumBox } from '../../components/shared/SuggestedPremiumBox';
import { ReportingBasisToggle } from '../../components/shared/ReportingBasisToggle';
import { GAAP, NON_GAAP } from '../reportingBasis';

const solved = { premium: 42, offer: 20.3486, atLimit: false, reason: null };
const unsolved = { premium: null, offer: null, atLimit: false, reason: 'Year 2 needs both companies\' forward EPS' };

describe('SuggestedPremiumBox', () => {
  test('Default stays visible; the accretive row is closed by default, labelled, and opens with the same text', () => {
    const onUse = jest.fn();
    render(<SuggestedPremiumBox spot={14.33} solve={solved} onUse={onUse} />);
    expect(screen.getByTestId('premium-default').textContent).toBe('Default · 30%$18.63/shareUse this');
    expect(screen.getByTestId('premium-accretive-short').textContent).toBe('Highest premium still accretiveⓘ');
    expect(screen.queryByTestId('premium-accretive')).toBeNull();
    expect(screen.getByTestId('premium-accretive-info-toggle').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('premium-accretive-info-toggle'));
    expect(screen.getByTestId('premium-accretive-info-toggle').getAttribute('aria-expanded')).toBe('true');
    // the text the old always-visible row printed
    expect(screen.getByTestId('premium-accretive').textContent)
      .toBe('Highest premium still accretive in Year 2 · 42%$20.35/share · Solved from this deal\'s model, in whole percents.Use this');

    fireEvent.click(screen.getByTestId('premium-accretive-info-toggle'));
    expect(screen.queryByTestId('premium-accretive')).toBeNull();
  });

  test('[Use this] inside the box calls onUse with the solved premium, exactly as before', () => {
    const onUse = jest.fn();
    render(<SuggestedPremiumBox spot={14.33} solve={solved} onUse={onUse} />);
    fireEvent.click(screen.getByTestId('premium-accretive-info-toggle'));
    fireEvent.click(screen.getByTestId('premium-accretive').querySelector('button'));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(42);
    fireEvent.click(screen.getByTestId('premium-default').querySelector('button'));
    expect(onUse).toHaveBeenLastCalledWith(30);
  });

  test('unsolved: the box shows "—" and the reason, with no button', () => {
    render(<SuggestedPremiumBox spot={14.33} solve={unsolved} onUse={() => {}} />);
    fireEvent.click(screen.getByTestId('premium-accretive-info-toggle'));
    expect(screen.getByTestId('premium-accretive').textContent)
      .toBe('Highest premium still accretive in Year 2 · —Year 2 needs both companies\' forward EPS');
    expect(screen.getByTestId('premium-accretive').querySelector('button')).toBeNull();
  });
});

describe('ReportingBasisToggle', () => {
  const available = { state: 'ready', available: true, reason: null };
  const omdaPlan = {
    selected: NON_GAAP, noChange: null,
    eps: { nonGaap: false, note: 'Year 1 non-GAAP EPS not available: OMDA doesn\'t report adjusted EPS' },
    ebitda: { A: { nonGaap: true, name: 'Adjusted EBITDA', note: null }, B: { nonGaap: false }, combinable: false },
  };
  const oldNotes = [
    'EPS, pro forma EPS and accretion: Year 1 non-GAAP EPS not available: OMDA doesn\'t report adjusted EPS.',
    'Acquirer EBITDA: Adjusted EBITDA (non-GAAP, company reported).',
    'Combined EBITDA: — (companies on different bases).',
  ];

  test('notes are closed by default, with a count beside the switch; opening shows them word for word', () => {
    render(<ReportingBasisToggle value={NON_GAAP} availability={available} plan={omdaPlan} onChange={() => {}} />);
    expect(screen.getByTestId('basis-notes-count').textContent).toBe('⚠ 3 notes on this basisⓘ');
    expect(screen.queryByTestId('basis-toggle-notes')).toBeNull();
    expect(screen.getByTestId('basis-notes-info-toggle').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('basis-notes-info-toggle'));
    const lines = [...screen.getByTestId('basis-toggle-notes').children].map((d) => d.textContent);
    expect(lines).toEqual(oldNotes);
  });

  test('one note reads "1 note"', () => {
    const plan = { ...omdaPlan, noChange: 'Non-GAAP changes no figure for this pair.' };
    render(<ReportingBasisToggle value={NON_GAAP} availability={available} plan={plan} onChange={() => {}} />);
    expect(screen.getByTestId('basis-notes-count').textContent).toBe('⚠ 1 note on this basisⓘ');
    fireEvent.click(screen.getByTestId('basis-notes-info-toggle'));
    expect(screen.getByTestId('basis-toggle-notes').textContent).toBe('Non-GAAP changes no figure for this pair.');
  });

  test('no notes (GAAP): no count line, no toggle, no box', () => {
    const gaapPlan = { selected: GAAP, eps: { nonGaap: false, note: null }, ebitda: { A: { nonGaap: false }, B: { nonGaap: false }, combinable: true } };
    render(<ReportingBasisToggle value={GAAP} availability={available} plan={gaapPlan} onChange={() => {}} />);
    expect(screen.queryByTestId('basis-notes-count')).toBeNull();
    expect(screen.queryByTestId('basis-notes-info-toggle')).toBeNull();
    expect(screen.queryByTestId('basis-notes-info')).toBeNull();
    expect(screen.queryByTestId('basis-toggle-notes')).toBeNull();
  });

  test('the GAAP | Non-GAAP buttons still switch', () => {
    const onChange = jest.fn();
    render(<ReportingBasisToggle value={NON_GAAP} availability={available} plan={omdaPlan} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('basis-toggle-gaap'));
    expect(onChange).toHaveBeenCalledWith(GAAP);
  });
});
