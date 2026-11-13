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
});

test('quizhelp é verificado antes do comando genérico de quiz', () => {
  const ajuda = router.indexOf("matchCmd(cmdWord, 'quizhelp')");
  const generico = router.indexOf("matchCmdStart(cmd, 'quiz')");
  assert.notEqual(ajuda, -1, 'a rota específica de ajuda precisa existir');
  assert.notEqual(generico, -1, 'a rota geral de quiz precisa existir');
  assert.ok(ajuda < generico, '/quizhelp deve ser verificado antes do /quiz');
});

test('a condição do estado ativo deixa prefixados seguirem para os handlers de comando', () => {
  const inicio = router.indexOf('// ── Quiz ativo');
  const fim = router.indexOf('// ── Resposta pendente de !saquear', inicio);
  const trecho = router.slice(inicio, fim);
  assert.match(trecho, /&& !isAnyCmd\(raw\)/);
  assert.match(trecho, /handleQuiz\(sock, msg, jid, author, senderJid, caption\)/);
});


test('a rota chama o handler de ajuda, com o prefixo do grupo, antes do quiz genérico', () => {
  assert.match(
    router,
    /if \(matchCmd\(cmdWord, 'quizhelp'\)\) \{ await diversaoHandler\.handleQuizHelp\(sock, msg, jid, getPrefix\(jid\)\); return; \}/
  );
  assert.ok(
    router.indexOf("matchCmd(cmdWord, 'quizhelp')") < router.indexOf("matchCmdStart(cmd, 'quiz')"),
    'a rota específica precisa vir antes da rota genérica'
  );
});

test('o handler de /quizhelp é exportado para o roteador', () => {
  const diversaoIndex = fs.readFileSync(path.join(__dirname, 'handlers', 'diversao', 'index.js'), 'utf8');
  assert.ok(diversaoIndex.includes("const { handleQuizHelp } = require('./quizHelp')"));
  assert.ok(diversaoIndex.includes('handleQuizHelp,'));
});
