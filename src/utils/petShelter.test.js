'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ABRIGO_TEMPO_MAXIMO_MS,
  filtroAbrigoDoGrupo,
  limparPetsExpiradosDoAbrigo,
} = require('./petShelter');

test('abrigo mantém personagens por exatamente 20 minutos', () => {
  assert.equal(ABRIGO_TEMPO_MAXIMO_MS, 20 * 60 * 1000);
});

test('filtro de abrigo sempre restringe a consulta ao grupo informado', () => {
  const agora = new Date('2026-11-13T19:00:00.000Z');
  assert.deepEqual(filtroAbrigoDoGrupo('120363000000000000@g.us', agora), {
    idGrupo: '120363000000000000@g.us',
    'petShelter.isSheltered': true,
    'petShelter.leftAt': { $gt: new Date(agora.getTime() - ABRIGO_TEMPO_MAXIMO_MS) },
  });
  assert.throws(() => filtroAbrigoDoGrupo(''), /idGrupo é obrigatório/i);
});

test('limpeza inicializa prazo de registros antigos e remove apenas os expirados', async () => {
  const agora = new Date('2026-11-13T19:00:00.000Z');
  const chamadas = [];
  const CarteiraGrupo = {
    async updateMany(filtro, atualizacao) {
      chamadas.push({ filtro, atualizacao });
      return chamadas.length === 1 ? { modifiedCount: 3 } : { modifiedCount: 2 };
    },
  };

  const removidos = await limparPetsExpiradosDoAbrigo(CarteiraGrupo, agora);

  assert.equal(removidos, 2);
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[0], {
    filtro: {
      'petShelter.isSheltered': true,
      $or: [
        { 'petShelter.leftAt': { $exists: false } },
        { 'petShelter.leftAt': null },
      ],
    },
    atualizacao: { $set: { 'petShelter.leftAt': agora } },
  });
  assert.deepEqual(chamadas[1], {
    filtro: {
      'petShelter.isSheltered': true,
      'petShelter.leftAt': { $lte: new Date(agora.getTime() - ABRIGO_TEMPO_MAXIMO_MS) },
    },
    atualizacao: {
      $set: {
        'petShelter.isSheltered': false,
        'petShelter.shelteredPet': null,
        'petShelter.leftAt': null,
      },
    },
  });
});

test('limpeza rejeita referência de data inválida', async () => {
  await assert.rejects(
    limparPetsExpiradosDoAbrigo({ updateMany: async () => ({ modifiedCount: 0 }) }, 'data-invalida'),
    /data de referência.*inválida/i
  );
});
