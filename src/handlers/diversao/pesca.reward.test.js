'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG_PESCA, valorBaseRecompensaPesca, calcularPrecoVendaPesca, CATALOGO_PESCA, NOVOS_ACHADOS_PESCA } = require('./pesca');

test('as recompensas dos itens pescados são multiplicadas por 20', () => {
  assert.equal(CONFIG_PESCA.MULTIPLICADOR_RECOMPENSA, 20);
  assert.equal(valorBaseRecompensaPesca({ gold: 18 }), 360);
  assert.equal(valorBaseRecompensaPesca({ gold: 750 }), 15000);
  assert.equal(valorBaseRecompensaPesca({ gold: 1300 }), 26000);
});


test('adiciona exactamente 100 novos achados distribuídos pelas cinco raridades', () => {
  const esperados = { comum: 30, incomum: 25, raro: 20, epico: 15, lendario: 10 };
  const entradas = Object.entries(NOVOS_ACHADOS_PESCA);
  assert.equal(entradas.length, 100);
  assert.equal(Object.keys(CATALOGO_PESCA).length, 176);
  assert.deepEqual(
    Object.fromEntries(Object.keys(esperados).map(raridade => [
      raridade, entradas.filter(([, item]) => item.raridade === raridade).length,
    ])),
    esperados,
  );

  for (const [key, item] of entradas) {
    assert.ok(!Object.prototype.hasOwnProperty.call(CATALOGO_PESCA, key) || Object.prototype.hasOwnProperty.call(NOVOS_ACHADOS_PESCA, key));
    assert.ok(item.nome, `${key} precisa de nome`);
    assert.ok(Number.isFinite(item.peso) && item.peso > 0, `${key} precisa de peso válido`);
    assert.ok(Number.isFinite(item.gold) && item.gold >= 0, `${key} precisa de gold válido`);
    assert.ok(valorBaseRecompensaPesca(item) === item.gold * 20, `${key} deve respeitar o multiplicador ×20`);
  }
});

test('as raridades mantêm a proporção geral de sorteio após a expansão do catálogo', () => {
  const pesos = Object.fromEntries(['comum', 'incomum', 'raro', 'epico', 'lendario'].map(raridade => [
    raridade,
    Object.values(CATALOGO_PESCA).filter(item => item.raridade === raridade)
      .reduce((total, item) => total + item.peso, 0),
  ]));
  const total = Object.values(pesos).reduce((sum, peso) => sum + peso, 0);
  const percentuais = Object.fromEntries(Object.entries(pesos).map(([raridade, peso]) => [raridade, peso / total * 100]));
  assert.ok(percentuais.comum > 60 && percentuais.comum < 63);
  assert.ok(percentuais.incomum > 23 && percentuais.incomum < 27);
  assert.ok(percentuais.raro > 8 && percentuais.raro < 12);
  assert.ok(percentuais.epico > 2 && percentuais.epico < 4);
  assert.ok(percentuais.lendario > 0.5 && percentuais.lendario < 2);
});

test('itens sem valor continuam sem recompensa monetária', () => {
  assert.equal(valorBaseRecompensaPesca({ gold: 0 }), 0);
  assert.equal(valorBaseRecompensaPesca({}), 0);
  assert.equal(valorBaseRecompensaPesca(null), 0);
});

test('os valores multiplicados alimentam também o preço de venda dos achados', () => {
  const pequeno = valorBaseRecompensaPesca(CATALOGO_PESCA.peixe_pequeno);
  const dourado = valorBaseRecompensaPesca(CATALOGO_PESCA.peixe_dourado);
  assert.equal(calcularPrecoVendaPesca(pequeno), 252);
  assert.equal(calcularPrecoVendaPesca(dourado), 10500);
  assert.equal(calcularPrecoVendaPesca(101, 0.50), 50);
});
