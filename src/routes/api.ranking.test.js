'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-for-ranking-route';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.CONTAS_KEY = 'test-contas-key';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping = require('../models/LidMapping');
const apiRouter = require('./api');

const idWhatsApp = '279319674941659@lid';
const idGrupo = '120363409568918044@g.us';
const nomeGrupo = 'Resenha obscura';
const mensagensGlobais = 1528;
let mostrarTelefonePublico = true;
const telefoneTeste = '5511888777666';
const pnJidTeste = `${telefoneTeste}@s.whatsapp.net`;
let walletJid = idWhatsApp;
let resolverAliasPn = false;
const bioTeste = 'Gosto de jogos e filosofia.';

const originals = {
  usuarioAggregate: Usuario.aggregate,
  usuarioFind: Usuario.find,
  usuarioFindOne: Usuario.findOne,
  carteiraAggregate: CarteiraGrupo.aggregate,
  carteiraFind: CarteiraGrupo.find,
  lidMappingFind: LidMapping.find,
};

let server;
let baseUrl;

Usuario.aggregate = async () => [{ _id: null, totalMensagens: mensagensGlobais }];
Usuario.find = query => ({
  select() { return this; },
  async lean() {
    if (Array.isArray(query?.idWhatsApp?.$in) && !query.idWhatsApp.$in.includes(idWhatsApp)) return [];
    return [{
      idWhatsApp,
      nome: 'Usuário de teste',
      displayName: 'Nome público',
      telefone: telefoneTeste,
      bio: bioTeste,
      mostrarTelefonePublico,
      username: null,
      mensagens: mensagensGlobais,
    }];
  },
});
Usuario.findOne = () => ({
  select() { return this; },
  async lean() { return { idWhatsApp, tokenVersion: 0, username: null, passwordHash: null }; },
});
LidMapping.find = () => ({ async lean() { return resolverAliasPn ? [{ lid: idWhatsApp, pn: pnJidTeste }] : []; } });
CarteiraGrupo.aggregate = async pipeline => {
  const match = pipeline[0]?.$match || {};
  if (Array.isArray(match.idGrupo?.$in)) {
    return [{ _id: idGrupo, nomeCustom: null, nomeGrupo }];
  }
  if (match.idGrupo?.$regex) {
    const group = pipeline.find(stage => stage.$group)?.$group || {};
    if (group._id === '$idWhatsApp') {
      return [{ _id: walletJid, xp: 9150, gold: 59516006427, mensagens: 0 }];
    }
    return [{ _id: null, totalMensagens: 0, totalUsuarios: [walletJid] }];
  }
  return [];
};
CarteiraGrupo.find = query => {
  if (query?.$or) {
    return {
      sort() { return this; },
      async lean() {
        return [{ idWhatsApp, idGrupo, xp: 9150, level: 30, gold: 59516006427, mensagens: 0 }];
      },
    };
  }
  if (query?.idGrupo === idGrupo) {
    return {
      sort() { return this; },
      async lean() {
        return [{ idWhatsApp: walletJid, idGrupo, xp: 9150, level: 30, gold: 59516006427, mensagens: 0 }];
      },
    };
  }
  return { select() { return this; }, async lean() { return []; } };
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/api';
});

test.after(async () => {
  Usuario.aggregate = originals.usuarioAggregate;
  Usuario.find = originals.usuarioFind;
  Usuario.findOne = originals.usuarioFindOne;
  CarteiraGrupo.aggregate = originals.carteiraAggregate;
  CarteiraGrupo.find = originals.carteiraFind;
  LidMapping.find = originals.lidMappingFind;
  if (server) await new Promise(resolve => server.close(resolve));
});

test('ranking global usa mensagens do Usuario quando as carteiras antigas têm zero', async () => {
  const response = await fetch(baseUrl + '/user/ranking?limit=10');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ranking[0].mensagens, mensagensGlobais);
  assert.equal(data.totalMensagens, mensagensGlobais);
});

test('ranking público inclui telefone e bio quando a pessoa permite exibição', async () => {
  mostrarTelefonePublico = true;
  const response = await fetch(baseUrl + '/user/ranking?limit=10');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ranking[0].nome, 'Nome público');
  assert.equal(data.ranking[0].telefone, telefoneTeste);
  assert.equal(data.ranking[0].telefoneOculto, false);
  assert.equal(data.ranking[0].bio, bioTeste);
  assert.equal(Object.hasOwn(data.ranking[0], 'idWhatsApp'), false, 'não deve expor o identificador interno');
});

test('ranking público respeita a preferência de ocultar telefone sem apagar a bio', async () => {
  mostrarTelefonePublico = false;
  const response = await fetch(baseUrl + '/user/ranking?limit=10');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ranking[0].telefone, null);
  assert.equal(data.ranking[0].telefoneOculto, true);
  assert.equal(data.ranking[0].bio, bioTeste);
  mostrarTelefonePublico = true;
});

test('rankings resolvem PN-backed wallets até o perfil LID e respeitam telefone oculto e bio', async () => {
  walletJid = pnJidTeste;
  resolverAliasPn = true;
  mostrarTelefonePublico = false;
  try {
    const globalResponse = await fetch(baseUrl + '/user/ranking?limit=10');
    assert.equal(globalResponse.status, 200);
    const globalData = await globalResponse.json();
    assert.equal(globalData.ranking[0].nome, 'Nome público');
    assert.equal(globalData.ranking[0].telefone, null);
    assert.equal(globalData.ranking[0].telefoneOculto, true);
    assert.equal(globalData.ranking[0].bio, bioTeste);

    const groupResponse = await fetch(baseUrl + '/user/ranking/grupo?jid=' + encodeURIComponent(idGrupo));
    assert.equal(groupResponse.status, 200);
    const groupData = await groupResponse.json();
    assert.equal(groupData.ranking[0].telefone, null);
    assert.equal(groupData.ranking[0].telefoneOculto, true);
    assert.equal(groupData.ranking[0].bio, bioTeste);
  } finally {
    walletJid = idWhatsApp;
    resolverAliasPn = false;
    mostrarTelefonePublico = true;
  }
});

test('ranking de grupos mostra nomeGrupo salvo, não o JID numérico', async () => {
  const token = jwt.sign({ idWhatsApp, tokenVersion: 0, tokenType: 'profile' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const response = await fetch(baseUrl + '/user/grupos/' + encodeURIComponent(idWhatsApp), {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.grupos[0].nome, nomeGrupo);
  assert.equal(data.grupos[0].nome, 'Resenha obscura');
});
