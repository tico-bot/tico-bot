'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarJidUsuario, normalizarJidComDominio } = require('./jid');

test('accepts a numeric phone as a PN JID', () => {
  assert.equal(normalizarJidUsuario('558299483834'), '558299483834@s.whatsapp.net');
});

test('accepts numeric PN and LID JIDs', () => {
  assert.equal(normalizarJidUsuario('558299483834@s.whatsapp.net'), '558299483834@s.whatsapp.net');
  assert.equal(normalizarJidUsuario('22909590466787@lid'), '22909590466787@lid');
});

test('removes a device suffix before validating a PN JID', () => {
  assert.equal(normalizarJidUsuario('558299483834:12@s.whatsapp.net'), '558299483834@s.whatsapp.net');
});

test('rejects opaque hexadecimal identifiers masquerading as PN JIDs', () => {
  assert.equal(normalizarJidUsuario('d23b8219b6e190895ed5fa806b1bd870dca466ac21a89b0d@s.whatsapp.net'), null);
});

test('rejects groups, unsupported domains, malformed identifiers, and empty values', () => {
  assert.equal(normalizarJidUsuario('120363412598798040@g.us'), null);
  assert.equal(normalizarJidUsuario('558299483834@c.us'), null);
  assert.equal(normalizarJidUsuario('abc123'), null);
  assert.equal(normalizarJidUsuario(''), null);
  assert.equal(normalizarJidUsuario(null), null);
});

test('normalises known PN/LID metadata fields using their declared domains', () => {
  assert.equal(normalizarJidComDominio('123456789012345', 'lid'), '123456789012345@lid');
  assert.equal(normalizarJidComDominio('5565993354137', 's.whatsapp.net'), '5565993354137@s.whatsapp.net');
  assert.equal(normalizarJidComDominio('123456789012345@lid', 's.whatsapp.net'), null);
  assert.equal(normalizarJidComDominio('5565993354137@s.whatsapp.net', 'lid'), null);
  assert.equal(normalizarJidComDominio('not-a-number', 'lid'), null);
});

test('rejects PN/LID values outside plausible identifier lengths', () => {
  assert.equal(normalizarJidUsuario('123@s.whatsapp.net'), null);
  assert.equal(normalizarJidUsuario('123@lid'), null);
  assert.equal(normalizarJidUsuario('123456789012345678901@lid'), null);
  assert.equal(normalizarJidUsuario('1234567890123456@s.whatsapp.net'), null);
});
