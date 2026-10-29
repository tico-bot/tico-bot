'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'test-secret-user-me-message-count';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.CONTAS_KEY = 'test-contas-key';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping = require('../models/LidMapping');
const apiRouter = require('./api');

const pn = '5511999999999@s.whatsapp.net';
const lid = '123456789@lid';
const idGrupo = '120363000000000000@g.us';
let server;
let baseUrl;

const originals = {
  usuarioFindOne: Usuario.findOne,
  usuarioFind: Usuario.find,
  carteiraFind: CarteiraGrupo.find,
  carteiraAggregate: CarteiraGrupo.aggregate,
  lidFind: LidMapping.find,
  lidFindOne: LidMapping.findOne,
};

const usuarioPrincipal = {
  idWhatsApp: pn, tokenVersion: 0, nome: 'Usuário Teste', xp: 0, level: 1,
  mensagens: 0, gold: 0, quizPoints: 0, xpHistory: {}, atividadeSemanal: Array(7).fill(0),
  inventory: {}, goldHistory: [], pet: null, mostrarTelefonePublico: true,
};

function queryResult(result) {
  return {
    select() { return this; },
    sort() { return this; },
    async lean() { return result; },
  };
}

Usuario.findOne = () => queryResult(usuarioPrincipal);
Usuario.find = query => queryResult(
  Array.isArray(query?.idWhatsApp?.$in) && query.idWhatsApp.$in.includes(lid)
    ? [
        { idWhatsApp: pn, mensagens: 12 },
        { idWhatsApp: lid, mensagens: 18 },
      ]
    : [],
);

CarteiraGrupo.find = query => {
  if (Array.isArray(query?.idWhatsApp?.$in) && query.idWhatsApp.$in.includes(lid)) {
    const regex = query.idGrupo?.$regex;
    if (!regex || !regex.test(idGrupo)) return queryResult([]);
    return queryResult([
      { idWhatsApp: pn, idGrupo, mensagens: 20 },
      { idWhatsApp: lid, idGrupo, mensagens: 25 },
    ]);
  }
  return queryResult([]);
};
CarteiraGrupo.aggregate = async () => [];
LidMapping.find = () => ({
  select() { return this; },
  async lean() { return [{ lid, pn }]; },
});
LidMapping.findOne = query => ({
  async lean() {
    const candidatos = query?.pn?.$in || [];
    return query?.lid === lid || candidatos.includes(pn) ? { lid, pn } : null;
  },
});

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
  Usuario.find = originals.usuarioFind;
  CarteiraGrupo.find = originals.carteiraFind;
  CarteiraGrupo.aggregate = originals.carteiraAggregate;
  LidMapping.find = originals.lidFind;
  LidMapping.findOne = originals.lidFindOne;
  if (server) await new Promise(resolve => server.close(resolve));
});

test('GET /user/me consolida mensagens divididas entre os aliases PN e LID', async () => {
  const token = jwt.sign({ idWhatsApp: pn, tokenType: 'profile', tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const response = await fetch(`${baseUrl}/user/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const data = await response.json();
  // Usuários: 12 + 18 = 30; carteiras: 20 + 25 = 45. Usa a fonte mais completa,
  // sem somar as duas fontes e duplicar as mesmas mensagens.
  assert.equal(data.mensagens, 45);
});
