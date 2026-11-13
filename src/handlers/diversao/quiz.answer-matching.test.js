'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { respostaCorresponde, perguntasQuiz } = require('./quiz');

const resposta = 'Cristiano Ronaldo';
const aliases = ['CR7'];

test('aceita variações de maiúsculas, acentos e espaços', () => {
  for (const tentativa of [
    'Cristiano Ronaldo',
    'cristiano Ronaldo',
    'CRISTIANO RONALDO',
    '  cristiano   ronaldo  ',
  ]) {
    assert.equal(respostaCorresponde(tentativa, resposta), true, tentativa);
  }
});

test('aceita partes do nome e palavras em ordem diferente', () => {
  for (const tentativa of ['Cristiano', 'Ronaldo', 'RONALDO CRISTIANO']) {
    assert.equal(respostaCorresponde(tentativa, resposta), true, tentativa);
  }
});

test('tolera pequenos erros de digitação em palavras longas', () => {
  assert.equal(respostaCorresponde('Cristiando Ronaldo', resposta), true);
  assert.equal(respostaCorresponde('Cristiano Ronalddo', resposta), true);
});

test('aceita abreviações declaradas para a pergunta', () => {
  assert.equal(respostaCorresponde('CR7', resposta, aliases), true);
  assert.equal(respostaCorresponde('cr7', resposta, aliases), true);
  assert.equal(respostaCorresponde('CR', resposta, aliases), false);
});

test('não aceita respostas alheias nem palavras extras', () => {
  assert.equal(respostaCorresponde('Messi', resposta, aliases), false);
  assert.equal(respostaCorresponde('Cristiano Ronaldo Messi', resposta, aliases), false);
});

test('mantém respostas curtas e numéricas exactas', () => {
  assert.equal(respostaCorresponde('8', '8'), true);
  assert.equal(respostaCorresponde('um', 'um'), true);
  assert.equal(respostaCorresponde('u', 'um'), false);
});


test('perguntas sobre Cristiano Ronaldo reconhecem CR7 como abreviação', () => {
  const perguntasCristiano = perguntasQuiz.filter(q => q.r === 'cristiano ronaldo');
  assert.ok(perguntasCristiano.length > 0);
  assert.ok(perguntasCristiano.every(q => q.aliases?.includes('CR7')));
});


test('aceita abreviações de capitais e cidades brasileiras', () => {
  const casos = [
    ['SP', 'São Paulo'],
    ['RJ', 'Rio de Janeiro'],
    ['BH', 'Belo Horizonte'],
    ['BSB', 'Brasília'],
    ['POA', 'Porto Alegre'],
    ['CWB', 'Curitiba'],
    ['SSA', 'Salvador'],
    ['REC', 'Recife'],
    ['CGB', 'Cuiabá'],
  ];
  for (const [sigla, nome] of casos) {
    assert.equal(respostaCorresponde(sigla, nome), true, sigla);
  }
});

test('aceita siglas de estados brasileiros e códigos de países', () => {
  const casos = [
    ['MT', 'Mato Grosso'],
    ['MS', 'Mato Grosso do Sul'],
    ['MG', 'Minas Gerais'],
    ['BA', 'Bahia'],
    ['PR', 'Paraná'],
    ['EUA', 'Estados Unidos'],
    ['USA', 'Estados Unidos'],
    ['US', 'Estados Unidos'],
    ['BR', 'Brasil'],
    ['BRA', 'Brasil'],
    ['UK', 'Reino Unido'],
    ['GB', 'Reino Unido'],
    ['DE', 'Alemanha'],
    ['JP', 'Japão'],
    ['AR', 'Argentina'],
  ];
  for (const [sigla, nome] of casos) {
    assert.equal(respostaCorresponde(sigla, nome), true, sigla);
  }
  assert.equal(respostaCorresponde('RJ', 'São Paulo'), false);
});

test('aceita grafias numéricas alternativas para a velocidade da luz', () => {
  const pergunta = perguntasQuiz.find(q => q.p.startsWith('Qual é a velocidade da luz no vácuo'));
  assert.ok(pergunta);
  assert.equal(respostaCorresponde('300000', pergunta.r, pergunta.aliases), true);
  assert.equal(respostaCorresponde('300 mil quilometros por segundo', pergunta.r, pergunta.aliases), true);
});


test('aceita nomes internacionais de capitais como alternativas', () => {
  assert.equal(respostaCorresponde('Helsinki', 'Helsinque'), true);
  assert.equal(respostaCorresponde('Reykjavik', 'Reiquiavique'), true);
  assert.equal(respostaCorresponde('Tehran', 'Teerã'), true);
});


test('preserva frações e ainda reconhece sinônimos separados por barra ou pipe', () => {
  assert.equal(respostaCorresponde('1/4', '1/4'), true);
  assert.equal(respostaCorresponde('3/4', '3/4'), true);
  assert.equal(respostaCorresponde('santos', 'sao paulo/santos'), true);
  assert.equal(respostaCorresponde('santos', 'sao paulo | santos'), true);
});
