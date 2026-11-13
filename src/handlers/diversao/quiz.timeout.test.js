'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mensagemQuizTempoEsgotado } = require('./quiz');

test('ao esgotar o tempo, o quiz avisa sem revelar a resposta correta', () => {
  const mensagem = mensagemQuizTempoEsgotado('Jogador');

  assert.equal(mensagem, '⏰ *Tempo esgotado*, *Jogador*! Você não conseguiu responder a tempo. 😬');
  assert.doesNotMatch(mensagem, /resposta correta|gabarito/i);
});
