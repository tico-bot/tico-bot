const https = require('https');
const http  = require('http');

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * fetchBuffer — baixa qualquer URL e retorna um Buffer.
 * Segue redirecionamentos automaticamente (até 5).
 */
function fetchBuffer(url, options = {}, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) return reject(new Error('fetchBuffer: muitos redirecionamentos'));

    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      timeout: options.timeout || DEFAULT_TIMEOUT,
      headers: { 'User-Agent': DEFAULT_UA, ...(options.headers || {}) },
    }, res => {
      // Segue redirect 301/302/303/307/308
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, options, _redirects + 1));
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`fetchBuffer: HTTP ${res.statusCode} em ${url}`));
      }

      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`fetchBuffer: timeout em ${url}`)); });
  });
}

/**
 * fetchJson — GET ou POST, retorna objeto JS parseado.
 * @param {string} url
 * @param {object} options — { method, headers, body, timeout }
 */
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const method  = (options.method || 'GET').toUpperCase();
    const headers = {
      'User-Agent': DEFAULT_UA,
      'Accept':     'application/json',
      ...(options.headers || {}),
    };
    const body = options.body ? Buffer.from(options.body) : null;
    if (body) headers['Content-Length'] = body.length;

    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname : parsed.hostname,
      port     : parsed.port || undefined,
      path     : parsed.pathname + parsed.search,
      method,
      headers,
      timeout  : options.timeout || DEFAULT_TIMEOUT,
    }, res => {
      // Segue redirect em GET
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location && method === 'GET') {
        res.resume();
        return resolve(fetchJson(res.headers.location, options));
      }

      let str = '';
      res.setEncoding('utf8');
      res.on('data',  chunk => str += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(str)); }
        catch { reject(new Error(`fetchJson: JSON inválido (HTTP ${res.statusCode}): ${str.slice(0, 300)}`)); }
      });
      res.on('error', reject);
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`fetchJson: timeout em ${url}`)); });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { fetchBuffer, fetchJson };