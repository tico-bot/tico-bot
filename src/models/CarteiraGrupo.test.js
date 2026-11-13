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

test('cópia de XP da carteira mantém o estado explicitamente ativado', () => {
  const carteira = new CarteiraGrupo({
    idWhatsApp: 'usuario@s.whatsapp.net',
    idGrupo: 'grupo@g.us',
    config: { xpAtivo: true },
  });
  assert.equal(carteira.config.xpAtivo, true);
});

test('schema permite persistir os campos usados pelo sistema de roubo e polícia', () => {
  for (const campo of [
    'ultimoRouboBanco',
    'prestoAte',
    'imunidadeRouboAte',
    'lastRobbedBy',
    'lastRobbedAmount',
    'lastRobbedAt',
    'ultimaPolicia',
  ]) {
    assert.ok(CarteiraGrupo.schema.path(campo), `campo ${campo} deve existir no schema`);
  }
});


test('schema guarda o abrigo de personagens dentro da carteira do grupo', () => {
  const abrigo = CarteiraGrupo.schema.path('petShelter');
  assert.ok(abrigo, 'petShelter deve existir em CarteiraGrupo');
  for (const campo of ['isSheltered', 'shelteredPet', 'leftAt']) {
    assert.ok(abrigo.schema.path(campo), `petShelter.${campo} deve existir no schema`);
  }
});


test('pet collection stores several characters and all evolution attributes', () => {
  const wallet = new CarteiraGrupo({
    idWhatsApp: '5511999999999@s.whatsapp.net',
    idGrupo: '120363000000000000@g.us',
    pet: {
      petId: 'active-pet', type: 'lula', name: 'Lula', rarity: 'LENDÁRIO',
      xpMult: 2, pontMult: 2, health: 87, hygiene: 76,
      accessories: ['coroa'], skills: ['Truques'],
    },
    pets: [
      { petId: 'active-pet', type: 'lula', name: 'Lula', rarity: 'LENDÁRIO', xpMult: 2, pontMult: 2, health: 87, hygiene: 76 },
      { petId: 'pet-2', type: 'arrogante', name: 'Arrogante', rarity: 'COMUM' },
    ],
  });

  assert.equal(wallet.pet.xpMult, 2);
  assert.equal(wallet.pet.pontMult, 2);
  assert.equal(wallet.pet.health, 87);
  assert.equal(wallet.pet.hygiene, 76);
  assert.deepEqual(wallet.pet.accessories, ['coroa']);
  assert.equal(wallet.pets.length, 2);
  assert.equal(wallet.pets[1].petId, 'pet-2');
});
