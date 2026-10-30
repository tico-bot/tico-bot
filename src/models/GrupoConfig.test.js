'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const GrupoConfig = require('./GrupoConfig');

test('sistema de XP/níveis começa desativado por padrão', () => {
  const config = new GrupoConfig({ idGrupo: '120363000000000000@g.us' });
  assert.equal(config.xpAtivo, false);
});

test('configuração de XP explicitamente ativada é mantida como ativa', () => {
  const config = new GrupoConfig({ idGrupo: '120363000000000000@g.us', xpAtivo: true });
  assert.equal(config.xpAtivo, true);
});
