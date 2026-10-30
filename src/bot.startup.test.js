'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const startupSource = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');

test('startup does not overwrite persisted group XP/level activation', () => {
  assert.match(startupSource, /PetSpawn\.desativarTodosNoBoot\(\)/);
  assert.doesNotMatch(startupSource, /GrupoConfig\.desativarTodosNoBoot\(\)/);
  assert.doesNotMatch(startupSource, /CarteiraGrupo\.desativarXpTodosNoBoot\(\)/);
});
