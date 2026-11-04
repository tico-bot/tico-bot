'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'admin-gold-route-test-secret-with-sufficient-length';
process.env.ADMIN_KEY = 'admin-gold-route-test-key';

const apiRouter = require('./api');

const hashJid = 'd23b8219b6e190895ed5fa806b1bd870dca466ac21a89b0d@s.whatsapp.net';
const adminToken = jwt.sign(
  { tokenType: 'admin-session', role: 'admin', sessionId: 'gold-route-test' },
  process.env.JWT_SECRET,
  { expiresIn: '5m' },
);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('admin gold adjustment rejects opaque hexadecimal PN IDs before touching the database', async () => {
  const response = await fetch(`${baseUrl}/admin/usuario/${encodeURIComponent(hashJid)}/gold`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ idGrupo: '120363000000000000@g.us', valor: 100000, operacao: 'dar' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Identificador inválido/);
});
