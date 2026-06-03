'use strict';

// Given a field spec and an object {sourceName: rawValue|null}, return a verified result.
function reconcile(field, values) {
  const present = Object.entries(values).filter(([, v]) => v != null && !Number.isNaN(v));
  if (present.length === 0) return { status: 'missing', value: null, sources: values };

  // chosen value = source-of-truth if present, else first available
  const sot = present.find(([s]) => s === field.sot);
  const chosen = sot ? sot[1] : present[0][1];
  const chosenSource = sot ? field.sot : present[0][0];

  if (present.length === 1) {
    return {
      status: field.single ? 'verified' : 'single',
      value: chosen,
      chosenSource,
      sources: values,
    };
  }

  // pairwise compare against chosen within tolerance
  const maxDev = Math.max(
    ...present.map(([, v]) => Math.abs(v - chosen) / (Math.abs(chosen) || 1))
  );
  const status = maxDev <= field.tol ? 'verified' : 'flagged';
  return { status, value: chosen, chosenSource, maxDev, sources: values };
}

module.exports = { reconcile };
