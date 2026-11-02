'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../../models/Usuario');
const LidMapping = require('../../models/LidMapping');
const {
  handleReportar,
  handleRemoverReporte,
  handleLimparWarns,
} = require('./moderacao');

const group = '120363222222222222@g.us';
const admin = '5511888888888@s.whatsapp.net';
const adminLid = '123456789012345@lid';
const target = '5511999999999@s.whatsapp.net';
const bot = '5511777777777@s.whatsapp.net';
const groupKey = group.replace(/\./g, '_');

function queryResult(value) {
  return { lean: async () => value };
}

function mockModels(t, {
  findOne = null,
  findOneAndUpdate = async () => null,
  updateOne = async () => ({ modifiedCount: 1 }),
  updateMany = async () => ({ modifiedCount: 1 }),
} = {}) {
  const originals = {
    usuarioFindOne: Usuario.findOne,
    usuarioFindOneAndUpdate: Usuario.findOneAndUpdate,
    usuarioUpdateOne: Usuario.updateOne,
    usuarioUpdateMany: Usuario.updateMany,
    lidFindOne: LidMapping.findOne,
  };

  Usuario.findOne = () => queryResult(typeof findOne === 'function' ? findOne() : findOne);
  Usuario.findOneAndUpdate = findOneAndUpdate;
  Usuario.updateOne = updateOne;
  Usuario.updateMany = updateMany;
  LidMapping.findOne = () => queryResult(null);

  t.after(() => {
    Usuario.findOne = originals.usuarioFindOne;
    Usuario.findOneAndUpdate = originals.usuarioFindOneAndUpdate;
    Usuario.updateOne = originals.usuarioUpdateOne;
    Usuario.updateMany = originals.usuarioUpdateMany;
    LidMapping.findOne = originals.lidFindOne;
  });
}

function makeHarness({ sender = admin, senderPn = null, command = '', targetJid = target } = {}) {
  global._groupMetadataCache?.delete(group);
  const replies = [];
  const sock = {
    async groupMetadata() {
      return {
        participants: [
          { id: admin, lid: adminLid, admin: 'admin' },
          { id: target, admin: null },
        ],
      };
    },
    async sendMessage(_jid, payload) { replies.push(payload); },
    async groupParticipantsUpdate() {},
  };
  const msg = {
    key: {
      remoteJid: group,
      participant: sender,
      ...(senderPn ? { participantPn: senderPn } : {}),
    },
    message: {},
  };
  const content = {
    extendedTextMessage: {
      text: command,
      contextInfo: { mentionedJid: [targetJid] },
    },
  };
  return { sock, msg, content, replies };
}

test('ADM pode usar /reportar em outro membro', async t => {
  let increment = null;
  mockModels(t, {
    findOne: null,
    findOneAndUpdate: async (filter, update, options) => {
      increment = { filter, update, options };
      return { warnings: { [groupKey]: 1 } };
    },
  });
  const h = makeHarness({ command: '/reportar @5511999999999' });

  await handleReportar(h.sock, h.msg, h.content, group, {}, bot);

  assert.deepEqual(increment.update, { $inc: { ['warnings.' + groupKey]: 1 } });
  assert.match(h.replies.at(-1).text, /ADVERTÊNCIA PRIMEIRA/);
});

test('ADM não consegue reportar a si mesmo mesmo quando a mensagem chega como LID', async t => {
  let incremented = false;
  mockModels(t, {
    findOne: null,
    findOneAndUpdate: async () => { incremented = true; return null; },
  });
  const h = makeHarness({
    sender: adminLid,
    senderPn: admin,
    command: '/reportar @5511888888888',
    targetJid: admin,
  });

  await handleReportar(h.sock, h.msg, h.content, group, {}, bot);

  assert.equal(incremented, false);
  assert.match(h.replies.at(-1).text, /não pode se reportar/);
});

test('ADM pode usar /removerreporte em outro membro', async t => {
  let update = null;
  mockModels(t, {
    findOne: { idWhatsApp: target, warnings: { [groupKey]: 2 } },
    updateOne: async (...args) => { update = args; return { modifiedCount: 1 }; },
  });
  const h = makeHarness({ command: '/removerreporte @5511999999999' });

  await handleRemoverReporte(h.sock, h.msg, h.content, group, {}, bot);

  assert.deepEqual(update[1], { $set: { ['warnings.' + groupKey]: 1 } });
  assert.match(h.replies.at(-1).text, /ADVERTÊNCIA REMOVIDA/);
});

test('ADM não consegue remover a própria advertência usando /removerreporte', async t => {
  let updated = false;
  mockModels(t, {
    findOne: { idWhatsApp: admin, warnings: { [groupKey]: 2 } },
    updateOne: async () => { updated = true; return { modifiedCount: 1 }; },
  });
  const h = makeHarness({
    sender: adminLid,
    senderPn: admin,
    command: '/removerreporte @5511888888888',
    targetJid: admin,
  });

  await handleRemoverReporte(h.sock, h.msg, h.content, group, {}, bot);

  assert.equal(updated, false);
  assert.match(h.replies.at(-1).text, /não pode remover suas próprias advertências/);
});

test('ADM pode usar /limparwarns em outro membro', async t => {
  let update = null;
  mockModels(t, {
    findOne: { idWhatsApp: target, warnings: { [groupKey]: 2 } },
    updateOne: async (...args) => { update = args; return { modifiedCount: 1 }; },
  });
  const h = makeHarness({ command: '/limparwarns @5511999999999' });

  await handleLimparWarns(h.sock, h.msg, h.content, group, bot);

  assert.deepEqual(update[1], { $unset: { ['warnings.' + groupKey]: '' } });
  assert.match(h.replies.at(-1).text, /foram totalmente zeradas/);
});

test('ADM não consegue limpar as próprias advertências individualmente', async t => {
  let updated = false;
  mockModels(t, {
    findOne: { idWhatsApp: admin, warnings: { [groupKey]: 2 } },
    updateOne: async () => { updated = true; return { modifiedCount: 1 }; },
  });
  const h = makeHarness({
    sender: adminLid,
    senderPn: admin,
    command: '/limparwarns @5511888888888',
    targetJid: admin,
  });

  await handleLimparWarns(h.sock, h.msg, h.content, group, bot);

  assert.equal(updated, false);
  assert.match(h.replies.at(-1).text, /não pode limpar suas próprias advertências/);
});

test('limparwarns @all preserva advertências do próprio administrador', async t => {
  let update = null;
  mockModels(t, {
    updateMany: async (...args) => { update = args; return { modifiedCount: 4 }; },
  });
  const h = makeHarness({
    sender: adminLid,
    senderPn: admin,
    command: '/limparwarns @all',
    targetJid: target,
  });
  h.content.extendedTextMessage.contextInfo.mentionedJid = [];

  await handleLimparWarns(h.sock, h.msg, h.content, group, bot);

  assert.deepEqual(update[0], {
    ['warnings.' + groupKey]: { $exists: true },
    idWhatsApp: { $nin: [adminLid, admin] },
  });
  assert.match(h.replies.at(-1).text, /As suas foram preservadas/);
});
