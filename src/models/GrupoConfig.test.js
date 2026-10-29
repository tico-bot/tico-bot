'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const GrupoConfig = require('./GrupoConfig');

test('sistema de XP/níveis começa desativado por padrão', () => {
  const config = new GrupoConfig({ idGrupo: '120363000000000000@g.us' });
  assert.equal(config.xpAtivo, false);
});

test('boot desativa XP/níveis em todas as configurações de grupo existentes', async () => {
  const original = GrupoConfig.updateMany;
  let args;
  GrupoConfig.updateMany = (...values) => {
    args = values;
    return Promise.resolve({ matchedCount: 5, modifiedCount: 3 });
  };
  try {
    const result = await GrupoConfig.desativarTodosNoBoot();
    assert.deepEqual(args, [{}, { $set: { xpAtivo: false } }]);
    assert.equal(result.matchedCount, 5);
    assert.equal(result.modifiedCount, 3);
  } finally {
    GrupoConfig.updateMany = original;
  }
});
