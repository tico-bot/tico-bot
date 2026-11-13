'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarNomeComando,
  resolverChaveCatalogo,
  extrairArgumentosComando,
} = require('./commandItem');

const { ITENS_LOJA } = require('../config/economia');
const { VARAS_PESCA, ISCAS } = require('../handlers/diversao/pesca');
const medievalUtils = require('../utils/medievalUtils');

const catalogo = {
  vara_amaldiçoada: { nome: '💀 Vara Amaldiçoada' },
  vara_reforçada: { nome: '🔧 Vara Reforçada' },
  isca_vulcânica: { nome: '🌋 Isca Vulcânica' },
  peixe_pequeno: { nome: '🐟 Peixe Pequeno' },
};

test('normaliza espaços, underscores, cedilha, acentos e emojis', () => {
  assert.equal(normalizarNomeComando('Vara_Amaldiçoada'), 'varaamaldicoada');
  assert.equal(normalizarNomeComando('💀 Vara Amaldiçoada'), normalizarNomeComando('vara amaldicoada'));
});

test('resolve nomes amigáveis com ou sem espaços, underscores e acentos', () => {
  for (const entrada of [
    'vara_amaldiçoada',
    'vara amaldiçoada',
    'vara amaldicoada',
    'Vara_Amaldicoada',
    '💀 Vara Amaldiçoada',
  ]) {
    assert.equal(resolverChaveCatalogo(entrada, catalogo), 'vara_amaldiçoada', entrada);
  }
  assert.equal(resolverChaveCatalogo('vara reforcada', catalogo), 'vara_reforçada');
  assert.equal(resolverChaveCatalogo('isca vulcanica', catalogo), 'isca_vulcânica');
  assert.equal(resolverChaveCatalogo('peixe pequeno', catalogo), 'peixe_pequeno');
});

test('não escolhe arbitrariamente em caso de nomes ambíguos', () => {
  const ambiguo = {
    espada_rara: { nome: 'Espada Rara' },
    espada_rare: { nome: 'Espada Rara' },
  };
  assert.equal(resolverChaveCatalogo('Espada Rara', ambiguo), null);
});

test('extrai argumentos preservando todos os espaços do nome', () => {
  assert.equal(extrairArgumentosComando('/buypesca Vara Amaldiçoada 2', 'buypesca'), 'Vara Amaldiçoada 2');
  assert.equal(extrairArgumentosComando('!sellpesca Peixe Pequeno', 'sellpesca'), 'Peixe Pequeno');
});


test('os catálogos reais da loja e da pesca aceitam nomes apresentados com/sem acento', () => {
  const pesca = { ...VARAS_PESCA, ...ISCAS };
  assert.equal(resolverChaveCatalogo('Vara Amaldiçoada', pesca), 'vara_amaldiçoada');
  assert.equal(resolverChaveCatalogo('vara amaldicoada', pesca), 'vara_amaldiçoada');
  assert.equal(resolverChaveCatalogo('vara_amaldiçoada', pesca), 'vara_amaldiçoada');
  assert.equal(resolverChaveCatalogo('Isca Vulcânica', pesca), 'isca_vulcânica');
  assert.equal(resolverChaveCatalogo('isca vulcanica', pesca), 'isca_vulcânica');
  assert.equal(resolverChaveCatalogo('Ração Premium', ITENS_LOJA), 'racaopremium');
});


test('a loja medieval também aceita nomes com espaços e sem acentos', () => {
  assert.equal(medievalUtils.getArma('Espada Runica')?.nome, 'Espada Rúnica');
  assert.equal(medievalUtils.getArma('espada_runica')?.nome, 'Espada Rúnica');
  assert.equal(medievalUtils.getPocao('Pocao de Cura')?.nome, 'Poção de Cura');
  assert.equal(medievalUtils.getPocao('pocao_de_cura')?.nome, 'Poção de Cura');
  assert.equal(medievalUtils.itemKeyParaNome('espada_runica'), 'Espada Rúnica');
});
