'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { criarMensagemConfirmacaoDoacao } = require('./transferencia');

test('confirma doação sem revelar o remetente e menciona apenas o destinatário', () => {
  const destinatarioJid = '5511999999999@s.whatsapp.net';
  const mensagem = criarMensagemConfirmacaoDoacao({
    quantia: 125,
    resultado: { de: { gold: 875 } },
    destinatarioJid,
  });

  assert.match(mensagem.text, /DOAÇÃO ANÔNIMA DE PRATA/);
  assert.match(mensagem.text, /125 prata/);
  assert.match(mensagem.text, /@5511999999999/);
  assert.match(mensagem.text, /875 prata/);
  assert.doesNotMatch(mensagem.text, /undefined|null/);
  assert.deepEqual(mensagem.mentions, [destinatarioJid]);
});

test('monta confirmação mesmo quando o resultado não contém a carteira do remetente', () => {
  const mensagem = criarMensagemConfirmacaoDoacao({
    quantia: 20,
    resultado: null,
    destinatarioJid: '123456789012345@lid',
  });

  assert.match(mensagem.text, /20 prata/);
  assert.match(mensagem.text, /@123456789012345/);
  assert.match(mensagem.text, /0 prata/);
  assert.doesNotMatch(mensagem.text, /undefined|null/);
  assert.deepEqual(mensagem.mentions, ['123456789012345@lid']);
});

const { obterStatusPixMulti } = require('./transferencia');

test('PIX múltiplo só informa sucesso quando todas as transferências são concluídas', () => {
  assert.equal(obterStatusPixMulti(3, 0), 'success');
  assert.equal(obterStatusPixMulti(2, 1), 'partial');
  assert.equal(obterStatusPixMulti(0, 3), 'failed');
  assert.equal(obterStatusPixMulti(0, 0), 'success');
});
