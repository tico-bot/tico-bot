'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MINERIOS, EVENTOS_GARIMPO, NARRATIVAS, FALAS_GARIMPO } = require('../config/economia');
const {
  sortearMinerio,
  sortearEvento,
  getRaridadeKey,
  getRaridadeLabel,
  narrativaAleatoria,
  falaAleatoria,
  mensagemEvento,
  calcularResultadoGarimpo,
  formatarCatalogoMinerios,
} = require('./garimpo');

const soma = (itens) => itens.reduce((total, item) => total + item.chance, 0);

test('as probabilidades dos minérios somam exatamente 100%', () => {
  assert.equal(Number(soma(MINERIOS).toFixed(8)), 100);
  assert.equal(new Set(MINERIOS.map((item) => item.nome)).size, MINERIOS.length);
  assert.ok(MINERIOS.length >= 25);
  assert.ok(MINERIOS.every((item) => item.gold > 0 && item.xp > 0 && item.raridade));
});

test('as faixas de raridade têm minérios e narrativas próprias', () => {
  for (const raridade of ['mitico', 'lendario', 'epico', 'raro', 'incomum', 'comum']) {
    assert.ok(MINERIOS.some((item) => item.raridade === raridade), `sem minério ${raridade}`);
    assert.ok(NARRATIVAS[raridade]?.length >= 3, `sem narrativas ${raridade}`);
    assert.ok(FALAS_GARIMPO[raridade]?.length >= 2, `sem falas ${raridade}`);
  }
});

test('o sorteio alcança o primeiro e o último minério sem deixar itens inalcançáveis', () => {
  let limite = 0;
  for (const minerio of MINERIOS) {
    const pontoMedio = (limite + minerio.chance / 2) / 100;
    assert.equal(sortearMinerio(() => pontoMedio), minerio, `${minerio.nome} deve ser sorteável`);
    limite += minerio.chance;
  }
  assert.equal(sortearMinerio(() => 0), MINERIOS[0]);
  assert.equal(sortearMinerio(() => 0.999999), MINERIOS[MINERIOS.length - 1]);
});

test('o total de eventos é inferior a 100% e existe chance real de nenhum evento', () => {
  assert.equal(soma(EVENTOS_GARIMPO), 24.5);
  let limite = 0;
  for (const evento of EVENTOS_GARIMPO) {
    const pontoMedio = (limite + evento.chance / 2) / 100;
    assert.equal(sortearEvento(() => pontoMedio), evento, `${evento.id} deve ser sorteável`);
    limite += evento.chance;
  }
  assert.ok(soma(EVENTOS_GARIMPO) < 100);
  assert.equal(sortearEvento(() => 0), EVENTOS_GARIMPO[0]);
  assert.equal(sortearEvento(() => 0.999999), null);
  assert.ok(EVENTOS_GARIMPO.every((evento) => Array.isArray(evento.mensagens) && evento.mensagens.length >= 2));
});

test('a raridade exibida respeita o campo explícito do minério', () => {
  const minerio = MINERIOS.find((item) => item.raridade === 'mitico');
  assert.equal(getRaridadeKey(minerio), 'mitico');
  assert.match(getRaridadeLabel(minerio), /MÍTICO/);
  assert.equal(getRaridadeKey({ chance: 0.2, gold: 1 }), 'lendario');
});

test('narrativas e falas são escolhidas de forma determinística', () => {
  assert.equal(narrativaAleatoria('comum', () => 0), NARRATIVAS.comum[0]);
  assert.deepEqual(falaAleatoria('raro', () => 0), FALAS_GARIMPO.raro[0]);
  assert.equal(typeof mensagemEvento(EVENTOS_GARIMPO[0], () => 0), 'string');
  assert.equal(mensagemEvento(null), '');
});

test('eventos aplicam multiplicadores de prata e XP sem resultados negativos', () => {
  const minerio = { gold: 100, xp: 40 };
  assert.deepEqual(calcularResultadoGarimpo(minerio), { goldFinal: 100, xpFinal: 40 });
  assert.deepEqual(calcularResultadoGarimpo(minerio, { multiplicador: 0, xpMultiplicador: 0.5 }), { goldFinal: 0, xpFinal: 20 });
  assert.deepEqual(calcularResultadoGarimpo(minerio, { multiplicador: 2.5, xpMultiplicador: 1.75 }), { goldFinal: 250, xpFinal: 70 });
  assert.deepEqual(calcularResultadoGarimpo(minerio, { multiplicador: 0.25 }), { goldFinal: 25, xpFinal: 20 });
});


test('o catálogo lista todos os minérios, raridades, probabilidades, valores e XP', () => {
  const texto = formatarCatalogoMinerios('?');
  assert.match(texto, /CATÁLOGO DE MINÉRIOS/);
  assert.match(texto, /\?garimpar/);
  assert.match(texto, /24,5%/);
  for (const minerio of MINERIOS) {
    assert.ok(texto.includes(minerio.nome), `catálogo não contém ${minerio.nome}`);
    const chanceExibida = minerio.chance < 1
      ? minerio.chance.toFixed(2).replace('.', ',')
      : String(minerio.chance).replace('.', ',');
    assert.ok(texto.includes(`${chanceExibida}%`), `catálogo não mostra a chance de ${minerio.nome}`);
  }
  for (const titulo of ['MÍTICOS', 'LENDÁRIOS', 'ÉPICOS', 'RAROS', 'INCOMUNS', 'COMUNS']) {
    assert.ok(texto.includes(titulo), `catálogo não contém ${titulo}`);
  }
  assert.ok(texto.length < 4096, `mensagem demasiado grande: ${texto.length} caracteres`);
});
