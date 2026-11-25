'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleAceitar, handleRecusar } = require('./solicitacoes');

const group = '120363111111111111@g.us';
const admin = '5511888888888@s.whatsapp.net';
const member = '5511999999999@s.whatsapp.net';

function makeHarness({
  isAdmin = true,
  requests = Array.from({ length: 10 }, (_, index) => ({
    jid: `551199999${String(index).padStart(4, '0')}@s.whatsapp.net`,
  })),
  statuses,
} = {}) {
  global._groupMetadataCache?.delete(group);
  const updates = [];
  const replies = [];
  const sock = {
    async groupMetadata() {
      return {
        participants: [
          { id: admin, admin: isAdmin ? 'admin' : null },
          { id: member, admin: null },
        ],
      };
    },
    async groupRequestParticipantsList(jid) {
      assert.equal(jid, group);
      return requests;
    },
    async groupRequestParticipantsUpdate(jid, jids, action) {
      updates.push({ jid, jids, action });
      return jids.map((participantJid, index) => ({
        jid: participantJid,
        status: statuses?.[index] ?? '200',
      }));
    },
    async sendMessage(_jid, payload) {
      replies.push(payload);
    },
  };
  const msg = {
    key: { remoteJid: group, participant: admin },
    message: {},
  };
  const content = {
    extendedTextMessage: { text: '/aceitar 5' },
  };
  return { sock, msg, content, updates, replies };
}

test('/aceitar 5 aprova exactamente cinco pedidos', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/aceitar 5';

  await handleAceitar(h.sock, h.msg, h.content, group);

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].jid, group);
  assert.equal(h.updates[0].jids.length, 5);
  assert.equal(h.updates[0].action, 'approve');
  assert.match(h.replies.at(-1).text, /5 solicitações aceitas/);
});

test('/aceitar sem quantidade aprova todos os pedidos pendentes', async () => {
  const h = makeHarness({ requests: Array.from({ length: 7 }, (_, index) => ({
    jid: `5511888000${index}@s.whatsapp.net`,
  })) });
  h.content.extendedTextMessage.text = '/aceitar';

  await handleAceitar(h.sock, h.msg, h.content, group);

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].jids.length, 7);
  assert.equal(h.updates[0].action, 'approve');
  assert.match(h.replies.at(-1).text, /7 solicitações aceitas com sucesso! \(todos os pedidos pendentes\)/);
});

test('/recusar sem quantidade rejeita todos os pedidos pendentes', async () => {
  const h = makeHarness({ requests: Array.from({ length: 4 }, (_, index) => ({
    jid: `5511888111${index}@s.whatsapp.net`,
  })) });
  h.content.extendedTextMessage.text = '/recusar';

  await handleRecusar(h.sock, h.msg, h.content, group);

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].jids.length, 4);
  assert.equal(h.updates[0].action, 'reject');
  assert.match(h.replies.at(-1).text, /4 solicitações recusadas com sucesso! \(todos os pedidos pendentes\)/);
});

test('/recusar 3 rejeita apenas três pedidos', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/recusar 3';

  await handleRecusar(h.sock, h.msg, h.content, group);

  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].jids.length, 3);
  assert.equal(h.updates[0].action, 'reject');
  assert.match(h.replies.at(-1).text, /3 solicitações recusadas/);
});

test('não executa a ação quando a quantidade excede os pedidos pendentes', async () => {
  const h = makeHarness({ requests: [{ jid: member }, { jid: '5511666666666@s.whatsapp.net' }] });
  h.content.extendedTextMessage.text = '/aceitar 3';

  await handleAceitar(h.sock, h.msg, h.content, group);

  assert.deepEqual(h.updates, []);
  assert.match(h.replies.at(-1).text, /apenas \*2\*/);
  assert.match(h.replies.at(-1).text, /Nenhuma ação foi realizada/);
});

test('avisa quando não há solicitações pendentes', async () => {
  const h = makeHarness({ requests: [] });
  h.content.extendedTextMessage.text = '/recusar 1';

  await handleRecusar(h.sock, h.msg, h.content, group);

  assert.deepEqual(h.updates, []);
  assert.match(h.replies.at(-1).text, /Não há solicitações pendentes/);
});

test('exige uma quantidade inteira positiva', async () => {
  const h = makeHarness();
  h.content.extendedTextMessage.text = '/aceitar cinco';

  await handleAceitar(h.sock, h.msg, h.content, group);

  assert.deepEqual(h.updates, []);
  assert.match(h.replies.at(-1).text, /quantidade inteira positiva/);
  assert.match(h.replies.at(-1).text, /Sem quantidade.*todos os pedidos pendentes/);
});

test('membro que não é administrador não pode aceitar solicitações', async () => {
  const h = makeHarness({ isAdmin: false });
  h.msg.key.participant = member;
  h.content.extendedTextMessage.text = '/aceitar 1';

  await handleAceitar(h.sock, h.msg, h.content, group);

  assert.deepEqual(h.updates, []);
  assert.match(h.replies.at(-1).text, /Apenas admins podem usar/);
});

test('contabiliza falhas retornadas pelo WhatsApp', async () => {
  const h = makeHarness({ statuses: ['200', '403', '200', '200', '200'] });
  h.content.extendedTextMessage.text = '/recusar 5';

  await handleRecusar(h.sock, h.msg, h.content, group);

  assert.match(h.replies.at(-1).text, /4 solicitações recusadas/);
  assert.match(h.replies.at(-1).text, /Não foi possível processar: \*1\*/);
});
