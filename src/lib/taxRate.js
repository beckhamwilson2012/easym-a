// The app's one tax-rate assumption. dealCalc re-exports it (synergies are taxed, financing interest is tax-shielded), and the
// computed non-GAAP calculation (computedAdjusted.js) uses it when a company discloses no non-GAAP rate of its own.
// No imports: it must load without the deal model.
export const TAX_RATE = 0.21;  // US federal statutory rate
