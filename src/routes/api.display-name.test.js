'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-for-display-name-route';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.CONTAS_KEY = 'test-contas-key';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const apiRouter = require('./api');

const originalFindOne = Usuario.findOne;
const originalFindOneAndUpdate = Usuario.findOneAndUpdate;
const idWhatsApp = '5511999999999@s.whatsapp.net';
let server;
let baseUrl;
let lastUpdate = null;

Usuario.findOne = () => ({
  select() { return this; },
  async lean() {
    return { idWhatsApp, username: 'test-user', passwordHash: 'hash', tokenVersion: 0 };
  },
});

Usuario.findOneAndUpdate = (filtro, atualizacao, opcoes) => {
  lastUpdate = { filtro, atualizacao, opcoes };
  return {
    select() { return this; },
    async lean() { return { displayName: atualizacao.$set.displayName }; },
  };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

test.after(async () => {
  Usuario.findOne = originalFindOne;
  Usuario.findOneAndUpdate = originalFindOneAndUpdate;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function patchName(displayName) {
  const token = jwt.sign({ idWhatsApp, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1m' });
  return fetch(`${baseUrl}/user/display-name`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ displayName }),
  });
}

test('persists a trimmed display name for the authenticated user', async () => {
  lastUpdate = null;
  const response = await patchName('  Meu nome novo  ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { displayName: 'Meu nome novo' });
  assert.deepEqual(lastUpdate.filtro, { idWhatsApp });
  assert.deepEqual(lastUpdate.atualizacao, { $set: { displayName: 'Meu nome novo' } });
  assert.equal(lastUpdate.opcoes.runValidators, true);
  assert.equal(lastUpdate.opcoes.new, true);
});

test('rejects empty, multiline and overlong display names', async () => {
  const inválidos = ['', '   ', 'nome\nquebrado', 'x'.repeat(41)];
  for (const displayName of inválidos) {
    lastUpdate = null;
    const response = await patchName(displayName);
    assert.equal(response.status, 400, `deveria rejeitar ${JSON.stringify(displayName)}`);
    assert.equal(lastUpdate, null, 'não deve persistir um nome inválido');
  }
});

test('rejects an unauthenticated display-name update', async () => {
  const response = await fetch(`${baseUrl}/user/display-name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Novo nome' }),
  });
  assert.equal(response.status, 401);
});
