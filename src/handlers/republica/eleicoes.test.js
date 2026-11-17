'use strict';

process.env.REPUBLICA_VOTO_SECRET = process.env.REPUBLICA_VOTO_SECRET || 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DURACAO_ELEICAO_MS,
  DURACAO_CANDIDATURA_MS,
  DURACAO_CAMPANHA_MS,
  DURACAO_VOTACAO_MS,
  DURACAO_SEGUNDO_TURNO_MS,
  DURACAO_MANDATO_MS,
  EMPATE_PRORROGACAO_MS,
  calcularQuorumMinimo,
  selecionarFinalistasSegundoTurno,
  idCandidatoEleicao,
  nomeCandidatoEleicao,
  chapasElegiveis,
  hashPublicoEleitor,
  hashCedulaEleitor,
} = require('./eleicoes');
const RepublicaVoto = require('../../models/RepublicaVoto');
const RepublicaEleicao = require('../../models/RepublicaEleicao');

test('o mandato presidencial dura 24 horas', () => {
  assert.equal(DURACAO_MANDATO_MS, 24 * 60 * 60 * 1000);
});

test('as fases de candidatura, campanha e votação somam 15 minutos', () => {
  assert.equal(DURACAO_CANDIDATURA_MS, 5 * 60 * 1000);
  assert.equal(DURACAO_CAMPANHA_MS, 5 * 60 * 1000);
  assert.equal(DURACAO_VOTACAO_MS, 5 * 60 * 1000);
  assert.equal(DURACAO_ELEICAO_MS, 15 * 60 * 1000);
});

test('o segundo turno dispõe de cinco minutos', () => {
  assert.equal(DURACAO_SEGUNDO_TURNO_MS, 5 * 60 * 1000);
  assert.equal(EMPATE_PRORROGACAO_MS, DURACAO_SEGUNDO_TURNO_MS);
});

test('o quórum mínimo corresponde a 25% do eleitorado, arredondado para cima', () => {
  assert.equal(calcularQuorumMinimo(0), 0);
  assert.equal(calcularQuorumMinimo(1), 1);
  assert.equal(calcularQuorumMinimo(4), 1);
  assert.equal(calcularQuorumMinimo(10), 3);
  assert.equal(calcularQuorumMinimo(101), 26);
});

test('a lista de finalistas usa o cargo correcto também no segundo turno complementar', () => {
  const eleicaoVice = {
    tipoEleicao: 'vice',
    rodadaAtual: 2,
    candidaturasSegundoTurnoIds: ['vice-B'],
    candidaturas: [
      { presidenteId: 'presidente', viceId: 'vice-A', viceAceitou: true },
      { presidenteId: 'presidente', viceId: 'vice-B', viceAceitou: true },
    ],
  };
  assert.deepEqual(chapasElegiveis(eleicaoVice).map(c => c.viceId), ['vice-B']);

  const eleicaoGeral = {
    tipoEleicao: 'geral',
    rodadaAtual: 2,
    candidaturasSegundoTurnoIds: ['presidente-B'],
    candidaturas: [
      { presidenteId: 'presidente-A', viceId: 'vice-A', viceAceitou: true },
      { presidenteId: 'presidente-B', viceId: 'vice-B', viceAceitou: true },
    ],
  };
  assert.deepEqual(chapasElegiveis(eleicaoGeral).map(c => c.presidenteId), ['presidente-B']);
});

test('eleição complementar identifica e apresenta apenas os candidatos a vice', () => {
  const eleicao = { tipoEleicao: 'vice' };
  const candidatura = {
    presidenteId: 'presidente@s.whatsapp.net',
    presidenteNome: 'Presidente em exercício',
    viceId: 'candidato@s.whatsapp.net',
    viceNome: 'Novo vice',
  };
  assert.equal(idCandidatoEleicao(eleicao, candidatura), candidatura.viceId);
  assert.equal(nomeCandidatoEleicao(eleicao, candidatura), candidatura.viceNome);
  assert.equal(idCandidatoEleicao({ tipoEleicao: 'geral' }, candidatura), candidatura.presidenteId);
});

test('o segundo turno reúne as duas chapas mais votadas se ninguém tiver maioria absoluta', () => {
  assert.deepEqual(
    selecionarFinalistasSegundoTurno([['A', 4], ['B', 3], ['C', 3]], 10),
    ['A', 'B', 'C']
  );
  assert.deepEqual(
    selecionarFinalistasSegundoTurno([['A', 4], ['B', 4], ['C', 2]], 10),
    ['A', 'B']
  );
  assert.deepEqual(
    selecionarFinalistasSegundoTurno([['A', 6], ['B', 3], ['C', 1]], 10),
    []
  );
});

test('identificadores de elegibilidade e de cédula são hashes distintos e estáveis', () => {
  const elegibilidade = hashPublicoEleitor('grupo@g.us', 'eleicao-1', '5511999999999@s.whatsapp.net');
  const cedula = hashCedulaEleitor('grupo@g.us', 'eleicao-1', '5511999999999@s.whatsapp.net');
  assert.equal(elegibilidade.length, 64);
  assert.equal(cedula.length, 64);
  assert.notEqual(elegibilidade, cedula);
  assert.equal(elegibilidade, hashPublicoEleitor('grupo@g.us', 'eleicao-1', '5511999999999@s.whatsapp.net'));
  assert.equal(cedula, hashCedulaEleitor('grupo@g.us', 'eleicao-1', '5511999999999@s.whatsapp.net'));
  assert.equal(elegibilidade.includes('5511999999999'), false);
});

test('o modelo de cédula não contém o JID bruto do eleitor', () => {
  assert.equal(RepublicaVoto.schema.path('eleitorId'), undefined);
  assert.equal(RepublicaVoto.schema.path('eleitorHash').isRequired, true);
  assert.equal(Boolean(RepublicaVoto.schema.path('candidatoId').isRequired), false);
  assert.deepEqual(RepublicaEleicao.schema.path('tipoEleicao').enumValues, ['geral', 'vice']);
  assert.deepEqual(RepublicaEleicao.schema.path('tipoVotacao').enumValues, ['chapas', 'aprovacao']);
  assert.ok(RepublicaEleicao.schema.path('resultadoPrimeiraRodada'));
  assert.equal(RepublicaEleicao.schema.path('resultado.cargo').enumValues.length, 2);
});
