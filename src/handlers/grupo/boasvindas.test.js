'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extrairArgumentosBoasVindas,
  substituirMarcadoresBoasVindas,
} = require('./configuracao');

test('aceita atalhos curtos para os comandos de ativação e personalização', () => {
  assert.equal(extrairArgumentosBoasVindas('!bv ajuda', 'boasvindas'), 'ajuda');
  assert.equal(extrairArgumentosBoasVindas('!bvtexto off', 'boasvindastexto'), 'off');
  assert.equal(extrairArgumentosBoasVindas('!legendabv E aí #numerodele#', 'legendaboasvindas'), 'E aí #numerodele#');
  assert.equal(extrairArgumentosBoasVindas('!legendabvtexto Olá, #nomedogp#', 'legendaboasvindastexto'), 'Olá, #nomedogp#');
});

test('continua aceitando os comandos com nomes completos', () => {
  assert.equal(extrairArgumentosBoasVindas('!boasvindas on', 'boasvindas'), 'on');
  assert.equal(extrairArgumentosBoasVindas('!legendaboasvindastexto Teste', 'legendaboasvindastexto'), 'Teste');
});

test('substitui os marcadores de número, nome e descrição do grupo', () => {
  const texto = substituirMarcadoresBoasVindas(
    'Oi #numerodele#! Bem-vindo ao #nomedogp#! Regras: #descrição#',
    '5511999999999',
    'Grupo Tico',
    'Respeite todos'
  );

  assert.equal(
    texto,
    'Oi @5511999999999! Bem-vindo ao Grupo Tico! Regras: Respeite todos'
  );
});

test('aceita a variante sem acento do marcador de descrição e o marcador legado {nome}', () => {
  const texto = substituirMarcadoresBoasVindas(
    'Olá {nome}! Leia: #descricao#',
    '5511888888888',
    'Grupo',
    'Sem spam'
  );

  assert.equal(texto, 'Olá @5511888888888! Leia: Sem spam');
});

test('usa valores de fallback quando não há metadados do grupo', () => {
  const texto = substituirMarcadoresBoasVindas(
    '#nomedogp# — #descrição#',
    '',
    '',
    ''
  );

  assert.equal(texto, 'este grupo — Descrição não definida.');
});
