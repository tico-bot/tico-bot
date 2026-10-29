'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CarteiraGrupo = require('./CarteiraGrupo');

test('uses the documented XP thresholds at exact level boundaries', () => {
  assert.equal(CarteiraGrupo.xpParaLevel(1), 0);
  assert.equal(CarteiraGrupo.xpParaLevel(2), 80);
  assert.equal(CarteiraGrupo.xpParaLevel(3), 211);
  assert.equal(CarteiraGrupo.levelFromXp(0), 1);
  assert.equal(CarteiraGrupo.levelFromXp(79), 1);
  assert.equal(CarteiraGrupo.levelFromXp(80), 2);
  assert.equal(CarteiraGrupo.levelFromXp(210), 2);
  assert.equal(CarteiraGrupo.levelFromXp(211), 3);
});

test('every tested threshold starts the matching level with zero progress', () => {
  for (let level = 2; level <= 200; level++) {
    const threshold = CarteiraGrupo.xpParaLevel(level);
    assert.equal(CarteiraGrupo.levelFromXp(threshold), level, `threshold for level ${level}`);
    assert.equal(CarteiraGrupo.levelFromXp(threshold - 1), level - 1, `XP just before level ${level}`);
  }
});

test('incrementXp counts messages and records the daily group XP atomically', async () => {
  let chamada;
  const carteira = {
    _id: 'carteira-teste',
    xp: 5,
    level: 1,
    mensagens: 1,
    toObject() {
      return { xp: this.xp, level: this.level, mensagens: this.mensagens };
    },
  };
  const modeloFalso = {
    async findOneAndUpdate(filtro, atualizacao, opcoes) {
      chamada = { filtro, atualizacao, opcoes };
      return carteira;
    },
    async updateOne() {},
  };

  const resultado = await CarteiraGrupo.incrementXp.call(
    modeloFalso,
    'usuario@s.whatsapp.net',
    'grupo@g.us',
    5
  );

  assert.deepEqual(chamada.filtro, {
    idWhatsApp: 'usuario@s.whatsapp.net',
    idGrupo: 'grupo@g.us',
  });
  assert.equal(chamada.atualizacao.$inc.xp, 5);
  assert.equal(chamada.atualizacao.$inc.mensagens, 1);
  const chaveHistorico = `xpHistory.${new Date().toISOString().slice(0, 10)}`;
  assert.equal(chamada.atualizacao.$inc[chaveHistorico], 5);
  assert.deepEqual(chamada.opcoes, { upsert: true, new: true });
  assert.equal(resultado.mensagens, 1);
});

test('XP/níveis da carteira começam desativados por padrão', () => {
  const carteira = new CarteiraGrupo({
    idWhatsApp: 'usuario@s.whatsapp.net',
    idGrupo: 'grupo@g.us',
  });
  assert.equal(carteira.config.xpAtivo, false);
});

test('boot desativa XP/níveis nas configurações de todas as carteiras', async () => {
  const original = CarteiraGrupo.updateMany;
  let args;
  CarteiraGrupo.updateMany = (...values) => {
    args = values;
    return Promise.resolve({ matchedCount: 8, modifiedCount: 4 });
  };
  try {
    const result = await CarteiraGrupo.desativarXpTodosNoBoot();
    assert.deepEqual(args, [{}, { $set: { 'config.xpAtivo': false } }]);
    assert.equal(result.matchedCount, 8);
    assert.equal(result.modifiedCount, 4);
  } finally {
    CarteiraGrupo.updateMany = original;
  }
});
