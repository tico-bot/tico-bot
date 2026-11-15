'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { identificarQuizDesconhecido } = require('./quiz-commands');

const prefixes = ['!', '.', '/', ',', '#'];

test('identifica quizzes inexistentes sem executar o quiz geral', () => {
  assert.deepEqual(identificarQuizDesconhecido('/quizgremio', prefixes), {
    prefix: '/',
    comando: 'quizgremio',
  });
  assert.deepEqual(identificarQuizDesconhecido('/quizxyz', prefixes), {
    prefix: '/',
    comando: 'quizxyz',
  });
});

test('comandos de quiz existentes não são considerados desconhecidos', () => {
  for (const command of [
    '/quiz', '/quizhelp', '/quizfut', '/quizfutebol', '/quizctec',
    '/quizgeo', '/quizmat', '/quizhis', '/quizbsq', '/quizanime',
    '/quiztiktok', '/quizmoda',
  ]) {
    assert.equal(identificarQuizDesconhecido(command, prefixes), null, command);
  }
});

test('a verificação de comandos inexistentes ignora maiúsculas e respeita prefixos alternativos', () => {
  assert.deepEqual(identificarQuizDesconhecido('/QUIZGREMIO', prefixes), {
    prefix: '/',
    comando: 'quizgremio',
  });
  assert.deepEqual(identificarQuizDesconhecido('#quizgremio teste', prefixes), {
    prefix: '#',
    comando: 'quizgremio',
  });
  assert.equal(identificarQuizDesconhecido('quizgremio', prefixes), null);
  assert.deepEqual(identificarQuizDesconhecido('/quizzgremio', prefixes), {
    prefix: '/',
    comando: 'quizzgremio',
  });
});
