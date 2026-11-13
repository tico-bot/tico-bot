'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INTERVALO_NECESSIDADES_MS,
  atualizarNecessidades,
  obterEstagioPet,
  calcularHumorPet,
  gerarPetId,
} = require('./petNeeds');

const base = new Date('2026-11-13T12:00:00.000Z');
const pet = {
  level: 1,
  fullness: 100,
  energy: 100,
  happiness: 100,
  hygiene: 100,
  health: 100,
  lastNeedsUpdate: base,
};

test('necessidades diminuem em blocos de seis horas', () => {
  const result = atualizarNecessidades(pet, new Date(base.getTime() + INTERVALO_NECESSIDADES_MS * 2));
  assert.equal(result.fullness, 88);
  assert.equal(result.energy, 96);
  assert.equal(result.happiness, 98);
  assert.equal(result.hygiene, 95);
  assert.equal(result.health, 100);
});

test('consultas frequentes preservam o restante do intervalo', () => {
  const first = atualizarNecessidades(pet, new Date(base.getTime() + 5 * 60 * 60 * 1000));
  assert.equal(first.fullness, 100);
  assert.equal(first.lastNeedsUpdate.getTime(), base.getTime());
  const second = atualizarNecessidades(first, new Date(base.getTime() + INTERVALO_NECESSIDADES_MS));
  assert.equal(second.fullness, 94);
});

test('fome e higiene críticas reduzem a saúde, sem matar ou gerar valor negativo', () => {
  const result = atualizarNecessidades({ ...pet, fullness: 10, hygiene: 10, health: 2 }, new Date(base.getTime() + INTERVALO_NECESSIDADES_MS * 4));
  assert.equal(result.health, 1);
  assert.ok(result.fullness >= 0);
  assert.ok(result.hygiene >= 0);
});

test('estágio evolui conforme o nível', () => {
  assert.equal(obterEstagioPet({ level: 1 }), 'Filhote');
  assert.equal(obterEstagioPet({ level: 10 }), 'Jovem');
  assert.equal(obterEstagioPet({ level: 25 }), 'Adulto');
  assert.equal(obterEstagioPet({ level: 50 }), 'Lendário');
});

test('humor considera todos os atributos e petId é único', () => {
  assert.equal(calcularHumorPet({ happiness: 100, energy: 100, fullness: 100, health: 100, hygiene: 100 }), '😄 Muito feliz');
  assert.notEqual(gerarPetId(), gerarPetId());
});
