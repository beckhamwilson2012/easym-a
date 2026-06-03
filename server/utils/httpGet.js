'use strict';
const https = require('https');
const zlib  = require('zlib');

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get(
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
    ).on('error', reject);
  });
}

module.exports = { get };
