'use strict';
const https = require('https');
const zlib  = require('zlib');

function get(url, extraHeaders = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'EasyMandA contact@easymanda.com',
          'Accept-Encoding': 'gzip',
          ...extraHeaders,
        },
      },
      (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`));
        }
        const stream = res.headers['content-encoding'] === 'gzip'
          ? res.pipe(zlib.createGunzip())
          : res;
        let data = '';
        stream.on('data', (chunk) => (data += chunk));
        stream.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('JSON parse error from ' + parsed.hostname)); }
        });
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
    // Never let a stuck external source hang /api/verified — bound every request.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms from ${parsed.hostname}`)));
  });
}

module.exports = { get };
