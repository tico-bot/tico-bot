'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');

test('/minerar encaminha para o mesmo handler e sistema de /garimpar', () => {
  assert.match(
    router,
    /matchCmd\(cmdWord, 'garimpar'\)[\s\S]*?matchCmd\(cmdWord, 'minerar'\)[\s\S]*?handleGarimpar\(sock, msg, jid, getPrefix\)/
  );
});

test('os menus de jogos e Prata apresentam /minerar como alias de /garimpar', () => {
  const jogos = fs.readFileSync(path.join(__dirname, 'handlers', 'menus', 'jogos.js'), 'utf8');
  const prata = fs.readFileSync(path.join(__dirname, 'handlers', 'menus', 'prata.js'), 'utf8');

  assert.match(jogos, /garimpar \/ .*minerar/);
  assert.match(prata, /garimpar \/ .*minerar/);
});

test('o catálogo de minérios e o cooldown também orientam a usar /minerar', () => {
  const catalogo = fs.readFileSync(path.join(__dirname, 'utils', 'garimpo.js'), 'utf8');
  const handler = fs.readFileSync(path.join(__dirname, 'handlers', 'diversao', 'economia', 'garimpo.js'), 'utf8');

  assert.match(catalogo, /\$\{prefix\}minerar/);
  assert.match(handler, /\$\{prefix\}minerar/);
});
