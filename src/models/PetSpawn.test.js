'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const PetSpawn = require('./PetSpawn');

test('pet spawn starts disabled by default', () => {
  const registro = new PetSpawn({ idGrupo: '120363000000000000@g.us' });
  assert.equal(registro.spawnAtivo, false);
});

test('obterOuCriar inserts new groups with automatic spawn disabled', async () => {
  const original = PetSpawn.findOneAndUpdate;
  let args;
  PetSpawn.findOneAndUpdate = (...values) => {
    args = values;
    return Promise.resolve({ idGrupo: '120363000000000000@g.us', spawnAtivo: false });
  };
  try {
    await PetSpawn.obterOuCriar('120363000000000000@g.us');
    assert.equal(args[1].$setOnInsert.spawnAtivo, false);
    assert.equal(args[2].upsert, true);
    assert.equal(args[2].new, true);
  } finally {
    PetSpawn.findOneAndUpdate = original;
  }
});

test('startup disables automatic spawn for every existing group', async () => {
  const original = PetSpawn.updateMany;
  let args;
  PetSpawn.updateMany = (...values) => {
    args = values;
    return Promise.resolve({ matchedCount: 4, modifiedCount: 2 });
  };

  try {
    const result = await PetSpawn.desativarTodosNoBoot();
    assert.deepEqual(args, [{}, { $set: { spawnAtivo: false } }]);
    assert.equal(result.matchedCount, 4);
    assert.equal(result.modifiedCount, 2);
  } finally {
    PetSpawn.updateMany = original;
  }
});
