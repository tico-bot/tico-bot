'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorsMiddleware, resolveOrigins } = require('./cors');

function runMiddleware(env, { origin, method = 'GET' } = {}) {
  const middleware = createCorsMiddleware(env);
  const headers = {};
  let nextCalls = 0;
  let statusCode = 200;
  const req = { method, headers: origin ? { origin } : {} };
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    sendStatus(code) { statusCode = code; return this; },
  };
  middleware(req, res, () => { nextCalls++; });
  return { headers, nextCalls, statusCode };
}

test('a safe default allowlist is used when CORS_ORIGINS and NODE_ENV are missing', () => {
  assert.deepEqual(resolveOrigins({}), ['https://tico-bot.github.io']);
  const allowed = runMiddleware({}, { origin: 'https://tico-bot.github.io' });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://tico-bot.github.io');
  const rejected = runMiddleware({}, { origin: 'https://attacker.example' });
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  assert.equal(rejected.nextCalls, 1, 'CORS is not an authorisation substitute for non-browser clients');
});

test('legacy SITE_ORIGINS remains supported alongside CORS_ORIGINS', () => {
  assert.deepEqual(resolveOrigins({ SITE_ORIGINS: 'https://old.example, https://other.example/' }), ['https://old.example', 'https://other.example']);
  assert.deepEqual(resolveOrigins({ CORS_ORIGINS: 'https://current.example', SITE_ORIGINS: 'https://old.example' }), ['https://current.example', 'https://old.example']);
});

test('unapproved browser preflight is rejected, while explicit production origins are honoured', () => {
  const rejected = runMiddleware({ NODE_ENV: 'production', CORS_ORIGINS: 'https://tico-bot.github.io' }, {
    origin: 'https://attacker.example', method: 'OPTIONS',
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.nextCalls, 0);
  const allowed = runMiddleware({ NODE_ENV: 'production', CORS_ORIGINS: 'https://tico-bot.github.io, https://example.com/' }, {
    origin: 'https://example.com', method: 'OPTIONS',
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://example.com');
  assert.match(allowed.headers['access-control-allow-headers'], /x-contas-token/);
});

test('localhost is accepted only in development when not explicitly configured', () => {
  const dev = runMiddleware({ NODE_ENV: 'development' }, { origin: 'http://localhost:5500' });
  assert.equal(dev.headers['access-control-allow-origin'], 'http://localhost:5500');
  const prod = runMiddleware({ NODE_ENV: 'production' }, { origin: 'http://localhost:5500' });
  assert.equal(prod.headers['access-control-allow-origin'], undefined);
});
