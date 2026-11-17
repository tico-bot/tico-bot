'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AdocaoSolicitacao = require('../../models/AdocaoSolicitacao');
const Filho = require('../../models/Filho');
const RepublicaLicenca = require('../../models/RepublicaLicenca');
const social = require('../republica/social');
const filhosHandler = require('./filhos');

test('o pedido de adoção exige os dois responsáveis, prazo, código e criança', () => {
  const doc = new AdocaoSolicitacao({
    idGrupo: 'grupo@g.us',
    codigo: 'A1B2C3D4',
    solicitanteId: 'a@s.whatsapp.net',
    parceiroId: 'b@s.whatsapp.net',
    chaveCasal: 'a@s.whatsapp.net|b@s.whatsapp.net',
    nome: 'Luna',
    sexo: 'menina',
    personalidade: 'carinhosa',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(doc.validateSync(), undefined);
  assert.deepEqual(AdocaoSolicitacao.schema.path('status').enumValues,
    ['pendente', 'processando', 'aceita', 'recusada', 'cancelada', 'expirada']);
  assert.ok(AdocaoSolicitacao.schema.path('codigo').options.unique);
  const indiceCasal = AdocaoSolicitacao.schema.indexes().find(([keys]) =>
    keys.idGrupo === 1 && keys.chaveCasal === 1
  );
  assert.ok(indiceCasal);
  assert.equal(indiceCasal[1].unique, true);
  assert.deepEqual(indiceCasal[1].partialFilterExpression.status.$in, ['pendente', 'processando']);
});

test('o registo de uma criança identifica adoção sem alterar o padrão biológico', () => {
  const doc = new Filho({
    jidA: 'a@s.whatsapp.net',
    jidB: 'b@s.whatsapp.net',
    idGrupo: 'grupo@g.us',
    nome: 'Luna',
    sexo: 'menina',
    personalidade: 'carinhosa',
  });
  assert.equal(doc.adotado, false);
  doc.adotado = true;
  doc.adotadoEm = new Date();
  assert.equal(doc.adotado, true);
  assert.equal(doc.validateSync(), undefined);
  assert.ok(Filho.schema.path('adocaoSolicitacaoId'));
  assert.ok(Filho.schema.indexes().some(([keys, options]) =>
    keys.adocaoSolicitacaoId === 1 && options.unique === true
  ));
});

test('a licença parental aceita adoção e mantém exactamente 48 horas', () => {
  assert.ok(RepublicaLicenca.schema.path('tipo').enumValues.includes('adocao'));
  assert.equal(social.LICENCA_MS, 48 * 60 * 60 * 1000);
  assert.equal(typeof social.registrarLicencasAdocao, 'function');
});

test('o handler de adoção está exportado para o router', () => {
  assert.equal(typeof filhosHandler.handleAdotarFilho, 'function');
});
