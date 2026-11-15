'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');

test('quiz ativo só intercepta respostas sem prefixo, nunca comandos', () => {
  assert.match(
    router,
    /if \(diversaoHandler\.quizState\?\.has\(senderJid\) && !isAnyCmd\(raw\)\)/
  );
  assert.match(router, /matchCmd\(cmdWord, 'quizhelp'\)/);
  assert.match(router, /matchCmd\(cmdWord, 'quiztiktok'\)/);
  assert.match(router, /matchCmd\(cmdWord, 'quizmoda'\)/);
  assert.match(router, /matchCmd\(cmdWord, 'quizfutebol'\)/);
});

test('os comandos de quiz são reconhecidos por nome completo, sem capturar prefixos desconhecidos', () => {
  const ajuda = router.indexOf("matchCmd(cmdWord, 'quizhelp')");
  const quizGeral = router.indexOf("matchCmd(cmdWord, 'quiz')");
  assert.notEqual(ajuda, -1, 'a rota específica de ajuda precisa existir');
  assert.notEqual(quizGeral, -1, 'a rota exacta de /quiz precisa existir');
  assert.ok(ajuda < quizGeral, '/quizhelp deve ser verificado antes do /quiz');
  assert.doesNotMatch(router, /matchCmdStart\(cmd, 'quiz'\)/);
  assert.match(router, /identificarQuizDesconhecido\(cmdWord, VALID_PREFIXES\)/);
});

test('a condição do estado ativo deixa prefixados seguirem para os handlers de comando', () => {
  const inicio = router.indexOf('// ── Quiz ativo');
  const fim = router.indexOf('// ── Resposta pendente de !saquear', inicio);
  const trecho = router.slice(inicio, fim);
  assert.match(trecho, /&& !isAnyCmd\(raw\)/);
  assert.match(trecho, /handleQuiz\(sock, msg, jid, author, senderJid, caption\)/);
});

test('a rota chama o handler de ajuda antes dos comandos de quiz', () => {
  assert.match(
    router,
    /if \(matchCmd\(cmdWord, 'quizhelp'\)\) \{ await diversaoHandler\.handleQuizHelp\(sock, msg, jid, getPrefix\(jid\)\); return; \}/
  );
  assert.ok(
    router.indexOf("matchCmd(cmdWord, 'quizhelp')") < router.indexOf("matchCmd(cmdWord, 'quiz')"),
    'a rota específica precisa vir antes da rota geral'
  );
});

test('o handler de /quizhelp é exportado para o roteador', () => {
  const diversaoIndex = fs.readFileSync(path.join(__dirname, 'handlers', 'diversao', 'index.js'), 'utf8');
  assert.ok(diversaoIndex.includes("const { handleQuizHelp } = require('./quizHelp')"));
  assert.ok(diversaoIndex.includes('handleQuizHelp,'));
});
