'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LidMapping = require('../../models/LidMapping');
const Usuario = require('../../models/Usuario');
const { findRelByJid } = require('./index');

const group = '120363000000000000@g.us';
const digits = '5565993354137';
const pn = `${digits}@s.whatsapp.net`;
const lid = `${digits}@lid`;
const partner = '5511999999999@s.whatsapp.net';

function relationMap() {
  const key = [group, pn, partner].join('|');
  return new Map([[key, { jidA: pn, jidB: partner, idGrupo: group }]]);
}

function mockIdentity(t, mapping) {
  const originalFindOne = LidMapping.findOne;
  const originalUsuarioFindOne = Usuario.findOne;
  LidMapping.findOne = query => ({
    lean: async () => query?.lid === lid ? mapping : null,
  });
  Usuario.findOne = () => ({ lean: async () => null });
  t.after(() => {
    LidMapping.findOne = originalFindOne;
    Usuario.findOne = originalUsuarioFindOne;
  });
}

test('encontra o relacionamento PN quando o remetente chega como LID e o par está mapeado', async t => {
  mockIdentity(t, { lid, pn });
  const found = await findRelByJid(group, lid, relationMap());
  assert.ok(found);
  assert.equal(found.rel.jidA, pn);
});

test('não associa LID a PN com os mesmos dígitos quando não existe mapeamento', async t => {
  mockIdentity(t, null);
  const found = await findRelByJid(group, lid, relationMap());
  assert.equal(found, null);
});

test('aceita PN alternativo explícito do Baileys mesmo antes de o mapeamento ser persistido', async t => {
  mockIdentity(t, null);
  const found = await findRelByJid(group, lid, relationMap(), [pn]);
  assert.ok(found);
  assert.equal(found.rel.jidA, pn);
});
