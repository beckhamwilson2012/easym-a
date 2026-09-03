'use strict';
// FIXTURE — deliberately defective. Absent is coerced to zero, which is CLAUDE.md's
// named Pattern B: a null coerced to zero inside a sum or ratio, producing a plausible
// wrong number. A phase in small.plan.md fixes it; its verify fails here at HEAD.
function normalize(v) { return v || 0; }
module.exports = { normalize };
