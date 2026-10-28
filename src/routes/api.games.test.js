'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-for-game-routes';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.CONTAS_KEY = 'test-contas-key';

const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const LidMapping = require('../models/LidMapping');
const JogoRequest = require('../models/JogoRequest');
const apiRouter = require('./api');

const idWhatsApp = '5511999999999@s.whatsapp.net';
const idGrupo = '120363409568918044@g.us';
const originals = {
  usuarioFindOne: Usuario.findOne,
  carteiraFind: CarteiraGrupo.find,
  lidFindOne: LidMapping.findOne,
};

let server;
let baseUrl;
let databaseLookups = 0;

Usuario.findOne = () => ({
  select() { return this; },
  async lean() {
    return { idWhatsApp, username: null, passwordHash: null, tokenVersion: 0 };
  },
});
CarteiraGrupo.find = () => {
  databaseLookups++;
  throw new Error('A validação inválida não deveria consultar carteiras.');
};
LidMapping.findOne = () => {
  databaseLookups++;
  throw new Error('A validação inválida não deveria consultar mapeamentos LID.');
};

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
  CarteiraGrupo.find = originals.carteiraFind;
  LidMapping.findOne = originals.lidFindOne;
  if (server) await new Promise(resolve => server.close(resolve));
});

async function post(path, body) {
  const token = jwt.sign({ idWhatsApp, tokenVersion: 0, tokenType: 'profile' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test('slots rejeita aposta abaixo do mínimo e números não inteiros/ambíguos', async () => {
  for (const aposta of [0, 9, 10.5, '10abc', '1e2']) {
    const response = await post('/cassino/slots', { idGrupo, aposta });
    assert.equal(response.status, 400, `deveria rejeitar aposta ${JSON.stringify(aposta)}`);
  }
});

test('slots rejeita grupos inválidos e aposta acima do limite', async () => {
  const grupoResponse = await post('/cassino/slots', { idGrupo: 'não-é-um-grupo', aposta: 10 });
  assert.equal(grupoResponse.status, 400);
  const limiteResponse = await post('/cassino/slots', { idGrupo, aposta: 100001 });
  assert.equal(limiteResponse.status, 400);
});

test('corrida rejeita escolhas inválidas e não aceita apostas truncadas', async () => {
  for (const escolha of [-1, 6, 1.5, '1x', '']) {
    const response = await post('/corrida/apostar', { idGrupo, escolha, aposta: 10 });
    assert.equal(response.status, 400, `deveria rejeitar escolha ${JSON.stringify(escolha)}`);
  }
  for (const aposta of [9, 10.5, '10abc']) {
    const response = await post('/corrida/apostar', { idGrupo, escolha: 0, aposta });
    assert.equal(response.status, 400, `deveria rejeitar aposta ${JSON.stringify(aposta)}`);
  }
  assert.equal(databaseLookups, 0, 'inputs inválidos não devem atingir as carteiras ou mexer em saldo');
});

test('apostas válidas exigem um UUID de requisição', async () => {
  const slots = await post('/cassino/slots', { idGrupo, aposta: 10 });
  assert.equal(slots.status, 400);
  const corrida = await post('/corrida/apostar', { idGrupo, escolha: 0, aposta: 10, requestId: 'nao-e-uuid' });
  assert.equal(corrida.status, 400);
  assert.equal(databaseLookups, 0);
});

test('odds da corrida mantêm retorno teórico próximo de 90% para cada animal', async () => {
  const response = await fetch(`${baseUrl}/corrida/bichos`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.bichos.length, 6);
  const totalPeso = data.bichos.reduce((sum, bicho) => sum + bicho.velocidade, 0);
  assert.equal(totalPeso, 37);
  for (const bicho of data.bichos) {
    const retorno = (bicho.velocidade / totalPeso) * bicho.odds;
    assert.ok(Math.abs(retorno - 0.9) < 0.002, `${bicho.nome}: retorno teórico ${(retorno * 100).toFixed(2)}%`);
  }
});

test('consulta o estado da rodada autenticada e não expõe pedidos de outro usuário', async () => {
  const anterior = JogoRequest.findOne;
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  let queryVista = null;
  JogoRequest.findOne = query => {
    queryVista = query;
    return { async lean() {
      return {
        idWhatsApp,
        requestId,
        jogo: 'slots',
        idGrupo,
        status: 'completed',
        httpStatus: 500,
        response: { error: 'Erro interno.' },
      };
    } };
  };
  try {
    const token = jwt.sign({ idWhatsApp, tokenVersion: 0, tokenType: 'profile' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${baseUrl}/games/request/${requestId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 'completed');
    assert.equal(data.httpStatus, 500);
    assert.deepEqual(queryVista, { idWhatsApp, requestId });

    const invalid = await fetch(`${baseUrl}/games/request/not-a-uuid`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(invalid.status, 400);
    const invalidGroup = await fetch(`${baseUrl}/games/wallet/not-a-group`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(invalidGroup.status, 400);
    assert.equal(databaseLookups, 0);
  } finally {
    JogoRequest.findOne = anterior;
  }
});

test('repetir a mesma rodada devolve o resultado salvo sem consultar carteiras', async () => {
  const anterior = JogoRequest.findOne;
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  const resultadoSalvo = {
    resultado: ['🍒', '🍒', '🍒'], tipo: 'tres_iguais', mult: 4,
    premio: 40, lucroLiq: 30, aposta: 10, saldoFinal: 120,
  };
  const registro = {
    idWhatsApp, requestId, jogo: 'slots', idGrupo, aposta: 10, escolha: null,
    status: 'completed', httpStatus: 200, response: resultadoSalvo,
  };
  JogoRequest.findOne = () => ({ async lean() { return registro; } });
  try {
    const response = await post('/cassino/slots', { idGrupo, aposta: 10, requestId });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), resultadoSalvo);
    const mismatch = await post('/cassino/slots', { idGrupo, aposta: 20, requestId });
    assert.equal(mismatch.status, 409);
    assert.equal(databaseLookups, 0, 'replays não devem consultar carteiras nem debitar saldo');
  } finally {
    JogoRequest.findOne = anterior;
  }
});
