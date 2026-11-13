'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleQuizHelp } = require('./quizHelp');
const { perguntasQuiz } = require('./quiz');

test('/quizhelp explica os temas, os comandos e as regras', async () => {
  const sent = [];
  const sock = { sendMessage: async (_jid, payload, options) => sent.push({ payload, options }) };
  const msg = { key: { id: 'quizhelp-test' } };

  await handleQuizHelp(sock, msg, 'grupo@g.us', '/');

  assert.equal(sent.length, 1);
  const text = sent[0].payload.text;
  assert.match(text, /AJUDA DO QUIZ/);
  assert.ok(text.includes(perguntasQuiz.length.toLocaleString('pt-BR')));
  for (const command of ['/quiz', '/quizfut', '/quizhis', '/quizgeo', '/quizmat', '/quizctec', '/quizbsq', '/quizanime']) {
    assert.ok(text.includes(command), 'faltou ' + command);
  }
  for (const theme of ['Futebol', 'História', 'Geografia', 'Basquete', 'Anime', 'Astronomia', 'Biologia', 'Química', 'Física', 'Geometria', 'Cálculo', 'Estatística']) {
    assert.ok(text.includes(theme), 'faltou o tema ' + theme);
  }
  assert.match(text, /30 segundos/);
  assert.match(text, /30 quizzes a cada 30 minutos/);
  assert.match(text, /10 pontos/);
  assert.match(text, /15 Pratas/);
  assert.match(text, /500 Pratas extras/);
  assert.match(text, /18h30/);
  assert.equal(sent[0].options.quoted, msg);
});

test('/quizhelp respeita o prefixo configurado no grupo', async () => {
  let output = '';
  const sock = { sendMessage: async (_jid, payload) => { output = payload.text; } };
  await handleQuizHelp(sock, {}, 'grupo@g.us', '#');
  assert.match(output, /#quizfut/);
  assert.match(output, /#quizhelp/);
  assert.doesNotMatch(output, /\/quizfut/);
});
