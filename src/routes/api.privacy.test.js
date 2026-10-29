'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-for-privacy-route-2026';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.CONTAS_KEY = 'test-contas-key';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping = require('../models/LidMapping');
const apiRouter = require('./api');

const idWhatsApp = '5511999999999@s.whatsapp.net';
const outroUsuario = '5511888888888@s.whatsapp.net';
const originals = {
  usuarioFindOne: Usuario.findOne,
  usuarioFindOneAndUpdate: Usuario.findOneAndUpdate,
  carteiraFind: CarteiraGrupo.find,
  lidFindOne: LidMapping.findOne,
};
let server;
let baseUrl;
let lastUpdate = null;
let carteiraLookups = 0;
let lidLookups = 0;
let showPhone = true;
let mappingToReturn = null;
let lastUpdateMany = null;

Usuario.findOne = query => ({
  select() { return this; },
  async lean() {
    const requested = query?.idWhatsApp;
    if (typeof requested === 'string' && requested !== idWhatsApp) return null;
    return { idWhatsApp, username: 'privacy-user', passwordHash: 'hash', tokenVersion: 0, mostrarTelefonePublico: showPhone };
  },
});
Usuario.findOneAndUpdate = (filter, update, options) => {
  lastUpdate = { filter, update, options };
  return {
    select() { return this; },
    async lean() { return { mostrarTelefonePublico: update.$set?.mostrarTelefonePublico }; },
  };
};
CarteiraGrupo.find = () => {
  carteiraLookups++;
  throw new Error('A checagem de autorização deve acontecer antes de consultar carteiras.');
};
LidMapping.findOne = query => ({
  select() { return this; },
  async lean() {
    lidLookups++;
    if (query?.pn && mappingToReturn) return { ...mappingToReturn };
    if (query?.lid && mappingToReturn) return { ...mappingToReturn };
    return null;
  },
});
Usuario.updateMany = async (filter, update) => { lastUpdateMany = { filter, update }; return { modifiedCount: 2 }; };

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
  Usuario.findOne = originals.usuarioFindOne;
  Usuario.findOneAndUpdate = originals.usuarioFindOneAndUpdate;
  CarteiraGrupo.find = originals.carteiraFind;
  LidMapping.findOne = originals.lidFindOne;
  if (server) await new Promise(resolve => server.close(resolve));
});
function token(id = idWhatsApp) {
  return jwt.sign({ idWhatsApp: id, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1m' });
}
async function patchPrivacy(value, authToken = token()) {
  return fetch(`${baseUrl}/user/privacy`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ mostrarTelefonePublico: value }),
  });
}

test('privacy preference can be enabled and disabled by the authenticated user', async () => {
  mappingToReturn = null;
  for (const value of [false, true]) {
    lastUpdate = null;
    lastUpdateMany = null;
    const response = await patchPrivacy(value);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mostrarTelefonePublico: value });
    assert.deepEqual(lastUpdate.filter, { idWhatsApp });
    assert.deepEqual(lastUpdate.update, { $set: { mostrarTelefonePublico: value } });
    assert.equal(lastUpdate.options.runValidators, true);
  }
});

test('privacy choice propagates to the linked LID alias document', async () => {
  mappingToReturn = { lid: '123456789@lid', pn: idWhatsApp };
  lastUpdateMany = null;
  const response = await patchPrivacy(false);
  assert.equal(response.status, 200);
  assert.deepEqual(lastUpdateMany.filter, { idWhatsApp: { $in: [idWhatsApp, '123456789@lid'] } });
  assert.deepEqual(lastUpdateMany.update, { $set: { mostrarTelefonePublico: false } });
  mappingToReturn = null;
});

test('privacy endpoint rejects non-boolean input and unauthenticated changes', async () => {
  for (const value of ['false', 0, null, {}, undefined]) {
    lastUpdate = null;
    const response = await patchPrivacy(value);
    assert.equal(response.status, 400);
    assert.equal(lastUpdate, null);
  }
  const response = await fetch(`${baseUrl}/user/privacy`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mostrarTelefonePublico: false }) });
  assert.equal(response.status, 401);
});

test('authenticated profile cannot use the phone resolver to retrieve another user phone', async () => {
  lidLookups = 0;
  const response = await fetch(`${baseUrl}/user/telefone/${encodeURIComponent(outroUsuario)}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  assert.equal(response.status, 403);
  assert.equal(lidLookups, 0);
});

test('authenticated profile cannot query another user group list (IDOR protection)', async () => {
  carteiraLookups = 0;
  const response = await fetch(`${baseUrl}/user/grupos/${encodeURIComponent(outroUsuario)}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  assert.equal(response.status, 403);
  assert.equal(carteiraLookups, 0);
});
