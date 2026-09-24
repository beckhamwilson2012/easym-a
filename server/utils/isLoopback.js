// Is this request coming from the machine itself?
//
// The `general` limiter exists to stop PUBLIC traffic from draining the FMP and Anthropic quota — one
// deck build is ~83 requests against a 500/15-min ceiling, i.e. about 6 builds per window per IP. The
// sweep harness is not public traffic: it drives 50 deck builds back to back from 127.0.0.1, so it blew
// that budget every run and the capture saw OUR OWN 429 as a failed ticker load (11 of the 12 failed
// decks in run 20260922-194237 — `loadTicker …: rate-limited, gave up after 3 attempts`, with a bare
// same-origin `429 (Too Many Requests)` in the console and no upstream involved).
//
// Loopback cannot be spoofed from outside: with `trust proxy` off, req.ip is the socket peer address,
// so a remote client cannot present itself as 127.0.0.1. If this app is ever put behind a proxy that
// sets trust proxy, revisit — req.ip would then come from X-Forwarded-For, which a client controls.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function isLoopback(ip) {
  if (!ip) return false;                          // unknown origin is NOT local
  return LOOPBACK.has(String(ip).trim());
}

module.exports = { isLoopback, LOOPBACK };
