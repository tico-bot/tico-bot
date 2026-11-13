'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const extras = require('./quiz.extra-questions.json');
const { perguntasQuiz, respostaCorresponde } = require('./quiz');

const temas = [
  'Futebol', 'História', 'Geografia', 'Ciência', 'Astronomia',
  'Tecnologia', 'Biologia', 'Química', 'Física', 'Matemática',
  'Geometria', 'Cálculo', 'Estatística', 'Basquete', 'Anime',
];

test('adiciona exactamente 50 perguntas novas para cada um dos 15 temas', () => {
  assert.equal(extras.length, 750);
  for (const tema of temas) {
    const quantidade = extras.filter(q => q.d === tema).length;
    assert.equal(quantidade, 50, tema);
  }
});

test('o banco completo contém 1.099 perguntas e todos os temas originais', () => {
  assert.equal(perguntasQuiz.length, 1099);
  for (const tema of temas) {
    assert.ok(perguntasQuiz.some(q => q.d === tema), tema);
  }
});

test('os comandos gerais de Ciência e Matemática continuam a agrupar os subtemas', () => {
  const ciencia = perguntasQuiz.filter(q =>
    ['Ciência', 'Química', 'Física', 'Biologia', 'Astronomia', 'Tecnologia'].includes(q.d)
  );
  const matematica = perguntasQuiz.filter(q =>
    ['Matemática', 'Geometria', 'Cálculo', 'Estatística'].includes(q.d)
  );
  assert.equal(ciencia.length, 335);
  assert.equal(matematica.length, 227);
});

test('todas as perguntas novas têm enunciado, resposta e tema', () => {
  for (const [index, q] of extras.entries()) {
    assert.ok(q.p?.trim(), `enunciado na posição ${index}`);
    assert.ok(q.r?.trim(), `resposta na posição ${index}`);
    assert.ok(temas.includes(q.d), `tema na posição ${index}`);
  }
});


test('todas as respostas oficiais do banco novo são reconhecidas pelo validador', () => {
  for (const [index, q] of extras.entries()) {
    assert.equal(
      respostaCorresponde(q.r, q.r, q.aliases || []),
      true,
      `resposta ${index}: ${q.p}`
    );
  }
});
