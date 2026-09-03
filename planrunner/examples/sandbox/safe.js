'use strict';
// FIXTURE — already correct. Absent stays absent; a real zero stays zero. Used by the
// plan phase that is ALREADY satisfied at HEAD, to exercise RESOLVED_UPSTREAM.
function normalize(v) { return (v === null || v === undefined) ? null : v; }
module.exports = { normalize };
