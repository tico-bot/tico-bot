'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LidMapping = require('../models/LidMapping');
const Usuario = require('../models/Usuario');
const { resolveDisplayName, resolveUsuarioInfo, resolvePhoneAndJid, resolveGlobalId, sameWhatsAppIdentity } = require('./identity');

const lid = '104535947214891@lid';
const pn = '5561999999999@s.whatsapp.net';

function mockIdentity({ profile = null, map = true } = {}) {
  const originalLidFindOne = LidMapping.findOne;
  const originalUsuarioFindOne = Usuario.findOne;

  LidMapping.findOne = (query) => ({
    lean: async () => {
      if (!map) return null;
      if (query?.lid === lid) return { lid, pn };
      if (query?.pn === pn) return { lid, pn };
      return null;
    },
  });
  Usuario.findOne = () => ({ lean: async () => profile });

  return () => {
    LidMapping.findOne = originalLidFindOne;
    Usuario.findOne = originalUsuarioFindOne;
  };
}

test('resolve nome pelo contacto PN quando a menção chega como LID', async () => {
  const restore = mockIdentity({ profile: { idWhatsApp: pn, nome: 'Nome do perfil' } });
  try {
    const nome = await resolveDisplayName(lid, null, new Map([[pn, '𝐂ecília 🪽']]));
    assert.equal(nome, '𝐂ecília 🪽');
  } finally {
    restore();
  }
});

test('usa o nome do perfil persistido quando o cache de contactos não tem nome', async () => {
  const restore = mockIdentity({
    profile: { idWhatsApp: pn, displayName: 'Cecília pública', nome: 'Cecília' },
  });
  try {
    assert.equal(await resolveDisplayName(lid), 'Cecília pública');
  } finally {
    restore();
  }
});

test('rejeita números e JIDs como nomes e nunca expõe o identificador no fallback', async () => {
  const restore = mockIdentity({
    profile: { idWhatsApp: pn, displayName: '104535947214891', nome: lid },
  });
  try {
    assert.equal(
      await resolveDisplayName(lid, null, { [pn]: '104535947214891' }),
      'Usuário'
    );
  } finally {
    restore();
  }
});

test('aceita nome preferido do pushName e fallback explícito', async () => {
  const restore = mockIdentity({ map: false });
  try {
    assert.equal(
      await resolveDisplayName(lid, null, {}, { preferredName: 'Nome do WhatsApp' }),
      'Nome do WhatsApp'
    );
    assert.equal(
      await resolveDisplayName(lid, null, {}, { fallback: 'Participante' }),
      'Participante'
    );
  } finally {
    restore();
  }
});

test('usa aliases PN/LID fornecidos pelo chamador mesmo sem mapeamento no Mongo', async () => {
  const restore = mockIdentity({ map: false });
  try {
    assert.equal(
      await resolveDisplayName(pn, null, { [lid]: 'Nome pelo LID' }, { candidateJids: [lid] }),
      'Nome pelo LID'
    );
  } finally {
    restore();
  }
});

test('reconhece que PN e LID mapeados pertencem à mesma pessoa', async () => {
  const restore = mockIdentity();
  try {
    assert.equal(await sameWhatsAppIdentity(lid, pn), true);
    assert.equal(await sameWhatsAppIdentity(pn, lid), true);
  } finally {
    restore();
  }
});

test('não confunde LID sem mapeamento com PN que só tem os mesmos dígitos', async () => {
  const restore = mockIdentity({ map: false });
  try {
    assert.equal(await sameWhatsAppIdentity(lid, pn), false);
  } finally {
    restore();
  }
});

test('consulta o cache do Baileys pelo PN equivalente quando a entrada é LID', async () => {
  const restore = mockIdentity({ map: true });
  try {
    const sock = { getName: jid => jid === pn ? 'Nome do cache PN' : null };
    assert.equal(await resolveDisplayName(lid, sock), 'Nome do cache PN');
  } finally {
    restore();
  }
});

test('resolveGlobalId só aceita PN/LID ou número puro, nunca domínios desconhecidos', () => {
  assert.equal(resolveGlobalId(pn.split('@')[0]), pn);
  assert.equal(resolveGlobalId(lid), lid);
  assert.equal(resolveGlobalId('123456789012345@dominio-invalido'), null);
  assert.equal(resolveGlobalId('abc123xyz'), null);
});

test('resolve números puros como PN sem aceitar identificadores opacos', async () => {
  const restore = mockIdentity({ map: false });
  try {
    const info = await resolvePhoneAndJid(pn.split('@')[0]);
    assert.equal(info.resolvedJid, pn);
    assert.equal(info.pnJid, pn);
    assert.equal(info.number, pn.split('@')[0]);
    const invalido = await resolvePhoneAndJid('abc123xyz');
    assert.equal(invalido.resolvedJid, '');
    assert.equal(invalido.number, 'N/D');
  } finally {
    restore();
  }
});

test('não transforma dígitos de LID salvos em nome/telefone do perfil', async () => {
  const lidDigits = lid.split('@')[0];
  const restore = mockIdentity({
    map: false,
    profile: { idWhatsApp: lid, nome: lidDigits, telefone: lidDigits },
  });
  try {
    const info = await resolveUsuarioInfo(lid);
    assert.equal(info.nome, 'Usuário');
    assert.equal(info.number, 'N/D');
    assert.equal(info.formattedNumber, 'N/D');
  } finally {
    restore();
  }
});

test('não infere PN a partir do campo telefone de um perfil identificado somente por LID', async () => {
  const restore = mockIdentity({
    map: false,
    profile: { idWhatsApp: lid, nome: 'Pessoa LID', telefone: '5511888888888' },
  });
  try {
    const identidade = await resolvePhoneAndJid(lid);
    assert.equal(identidade.resolvedJid, lid);
    assert.equal(identidade.pnJid, null);
    assert.equal(identidade.number, 'N/D');
    const info = await resolveUsuarioInfo(lid);
    assert.equal(info.resolvedJid, lid);
    assert.equal(info.pnJid, null);
    assert.equal(info.number, '5511888888888', 'telefone explícito do perfil pode ser apresentado sem criar alias PN');
  } finally {
    restore();
  }
});
