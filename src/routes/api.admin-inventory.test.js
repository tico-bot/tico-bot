'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'admin-inventory-test-secret-with-sufficient-length';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping = require('../models/LidMapping');
const apiRouter = require('./api');

const userId = '5511999999999@s.whatsapp.net';
const groupId = '120363000000000001@g.us';
const adminToken = jwt.sign(
  { tokenType: 'admin-session', role: 'admin', sessionId: 'inventory-test-session' },
  process.env.JWT_SECRET,
  { expiresIn: '5m' }
);

const originals = {
  usuarioFindOne: Usuario.findOne,
  usuarioFindOneAndUpdate: Usuario.findOneAndUpdate,
  usuarioUpdateOne: Usuario.updateOne,
  carteiraFindOne: CarteiraGrupo.findOne,
  carteiraFindOneAndUpdate: CarteiraGrupo.findOneAndUpdate,
  carteiraUpdateOne: CarteiraGrupo.updateOne,
  lidFind: LidMapping.find,
};

let server;
let baseUrl;
let updatesGlobal;
let updatesGrupo;
let usuarioDoc;
let carteiraDoc;

function queryResult(value) {
  return { select() { return this; }, lean: async () => value };
}

function aplicarIncrementos(target, update) {
  for (const [path, increment] of Object.entries(update?.$inc || {})) {
    const partes = path.split('.');
    let atual = target;
    for (const parte of partes.slice(0, -1)) atual = atual[parte] ||= {};
    atual[partes.at(-1)] = (Number(atual[partes.at(-1)]) || 0) + Number(increment);
  }
}

function removerCampos(target, update) {
  for (const path of Object.keys(update?.$unset || {})) {
    const partes = path.split('.');
    let atual = target;
    for (const parte of partes.slice(0, -1)) atual = atual?.[parte];
    if (atual) delete atual[partes.at(-1)];
  }
}

test.before(async () => {
  updatesGlobal = [];
  updatesGrupo = [];
  usuarioDoc = { idWhatsApp: userId, inventory: {} };
  carteiraDoc = { idWhatsApp: userId, idGrupo: groupId, itensPets: {}, itensPesca: {}, itensRoubo: {}, itensRouboBanco: {}, itensSec: {}, inventario: {} };

  Usuario.findOne = () => queryResult({ ...usuarioDoc, inventory: { ...usuarioDoc.inventory } });
  Usuario.findOneAndUpdate = (filter, update) => {
    updatesGlobal.push({ filter, update });
    aplicarIncrementos(usuarioDoc, update);
    return queryResult({ ...usuarioDoc, inventory: { ...usuarioDoc.inventory } });
  };
  Usuario.updateOne = (filter, update) => {
    removerCampos(usuarioDoc, update);
    return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
  };
  CarteiraGrupo.findOne = filter => queryResult(
    filter?.idWhatsApp?.$in ? { idWhatsApp: userId } : { ...carteiraDoc }
  );
  CarteiraGrupo.findOneAndUpdate = (filter, update) => {
    updatesGrupo.push({ filter, update });
    aplicarIncrementos(carteiraDoc, update);
    return queryResult({ ...carteiraDoc });
  };
  CarteiraGrupo.updateOne = (filter, update) => {
    removerCampos(carteiraDoc, update);
    removerCampos(usuarioDoc, update);
    return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
  };
  LidMapping.find = () => queryResult([]);

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
  Usuario.updateOne = originals.usuarioUpdateOne;
  CarteiraGrupo.findOne = originals.carteiraFindOne;
  CarteiraGrupo.findOneAndUpdate = originals.carteiraFindOneAndUpdate;
  CarteiraGrupo.updateOne = originals.carteiraUpdateOne;
  LidMapping.find = originals.lidFind;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function request(method, body, idGrupo = groupId) {
  return fetch(`${baseUrl}/admin/usuario/${encodeURIComponent(userId)}/inventario`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify({ idGrupo, ...body }),
  });
}

test('admin adds fishing loot to itensPesca using the canonical item key', async () => {
  const response = await request('POST', {
    area: 'pesca-achados', item: 'peixe_pequeno', nome: '🐟 Peixe Pequeno', quantidade: 3,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.nome, '🐟 Peixe Pequeno');
  assert.equal(carteiraDoc.itensPesca.peixe_pequeno, 3);
  assert.deepEqual(updatesGrupo.at(-1).update, { $inc: { 'itensPesca.peixe_pequeno': 3 } });
  assert.equal(carteiraDoc.inventario.peixe_pequeno, undefined);
});

test('admin adds pets items to itensPets and global store items to Usuario.inventory', async () => {
  const petResponse = await request('POST', {
    area: 'loja-petcomida', item: 'racao', nome: 'Ração Normal', quantidade: 2,
  });
  assert.equal(petResponse.status, 200);
  assert.equal(carteiraDoc.itensPets.racao, 2);
  assert.deepEqual(updatesGrupo.at(-1).update, { $inc: { 'itensPets.racao': 2 } });

  const globalResponse = await request('POST', {
    area: 'loja-comida', item: 'pizza', nome: 'Pizza Margherita', quantidade: 4,
  }, 'global');
  assert.equal(globalResponse.status, 200);
  assert.equal(usuarioDoc.inventory.pizza, 4);
  assert.deepEqual(updatesGlobal.at(-1).update, { $inc: { 'inventory.pizza': 4 } });
});


test('admin lists global and group inventories separately and removes from the actual group field', async () => {
  usuarioDoc.inventory = { pizza: 2 };
  carteiraDoc.itensPets.racao = 4;
  carteiraDoc.itensPesca.peixe_pequeno = 5;

  const getResponse = await fetch(
    `${baseUrl}/admin/usuario/${encodeURIComponent(userId)}/inventario?idGrupo=${encodeURIComponent(groupId)}`,
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert.equal(getResponse.status, 200);
  const { inventario } = await getResponse.json();
  assert.ok(inventario.some(item => item.key === 'pizza' && item.escopo === 'global'));
  assert.ok(inventario.some(item => item.key === 'racao' && item.campo === 'itensPets'));
  assert.ok(inventario.some(item => item.key === 'peixe_pequeno' && item.campo === 'itensPesca'));

  const deleteResponse = await request('DELETE', {
    area: 'pesca-achados', item: 'peixe_pequeno',
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(carteiraDoc.itensPesca.peixe_pequeno, undefined);
});


test('admin removes a legacy custom global item whose old key contains spaces', async () => {
  usuarioDoc.inventory['Poção Rara'] = 1;
  const response = await request('DELETE', { area: '__personalizado__', item: 'Poção Rara' }, 'global');
  assert.equal(response.status, 200);
  assert.equal(usuarioDoc.inventory['Poção Rara'], undefined);
});

test('admin cannot submit an item from a different catalog area', async () => {
  const before = updatesGrupo.length;
  const response = await request('POST', {
    area: 'pesca-varas', item: 'peixe_pequeno', quantidade: 1,
  });
  assert.equal(response.status, 400);
  assert.equal(updatesGrupo.length, before);
});
