'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarDominio,
  extrairDominiosDeLinks,
  dominioEstaPermitido,
  todosLinksPermitidos,
  isGroupMigrationSpam,
  isPaymentMessageContent,
} = require('./links');

test('normaliza domínio e remove esquema, www e caminho', () => {
  assert.equal(normalizarDominio('https://www.YouTube.com/watch?v=123'), 'youtube.com');
  assert.equal(normalizarDominio('youtube.com'), 'youtube.com');
  assert.equal(normalizarDominio('não é um domínio'), null);
});

test('extrai links com e sem protocolo sem confundir e-mail com URL', () => {
  assert.deepEqual(
    extrairDominiosDeLinks('Veja https://www.youtube.com/watch?v=1 e example.com, mas não envie para pessoa@example.com'),
    ['youtube.com', 'example.com'],
  );
});

test('domínio autorizado permite subdomínios, mas não domínios parecidos', () => {
  assert.equal(dominioEstaPermitido('m.youtube.com', ['youtube.com']), true);
  assert.equal(dominioEstaPermitido('youtube.com.evil.test', ['youtube.com']), false);
});

test('uma mensagem com link permitido e outro bloqueado não passa', () => {
  assert.equal(todosLinksPermitidos('youtube.com e https://evil.test/x', ['youtube.com']), false);
  assert.equal(todosLinksPermitidos('youtube.com e m.youtube.com', ['youtube.com']), true);
  assert.equal(todosLinksPermitidos('sem link aqui', ['youtube.com']), false);
});


test('classifica anúncios falsos de migração com convite para outro grupo', () => {
  const mensagem = [
    'PESSOAL, ESTAMOS TROCANDO DE GRUPO!',
    'ESSE GRUPO SERÁ APAGADO! ENTREM NO NOVO GRUPO ANTES DESTE SER APAGADO!',
    'https://chat.whatsapp.com/ABC123',
    'https://chat.whatsapp.com/DEF456',
    'https://whatsapp.com/channel/XYZ',
    'https://t.me/ExemploBot?start=ref',
  ].join(' ');

  assert.equal(isGroupMigrationSpam(mensagem), true);
  assert.equal(todosLinksPermitidos(mensagem, ['chat.whatsapp.com', 'whatsapp.com', 't.me']), true);
});

test('não classifica links comuns ou anúncios sem link de convite', () => {
  assert.equal(isGroupMigrationSpam('Veja nosso vídeo: https://youtube.com/watch?v=123'), false);
  assert.equal(isGroupMigrationSpam('Estamos trocando de grupo; avisaremos em reunião.'), false);
  assert.equal(isGroupMigrationSpam('Entre no grupo de estudo: https://example.com/estudo'), false);
});


test('reconhece mensagens nativas de pagamento do WhatsApp', () => {
  assert.equal(isPaymentMessageContent({
    requestPaymentMessage: { noteMessage: { conversation: 'convite suspeito' } },
  }), true);
  assert.equal(isPaymentMessageContent({
    sendPaymentMessage: { noteMessage: { conversation: 'texto' } },
  }), true);
  assert.equal(isPaymentMessageContent({
    ephemeralMessage: {
      message: { requestPaymentMessage: { amount1000: 0 } },
    },
  }), true);
  assert.equal(isPaymentMessageContent({
    viewOnceMessageV2: {
      message: { paymentInviteMessage: { serviceType: 1 } },
    },
  }), true);
  assert.equal(isPaymentMessageContent({
    extendedTextMessage: { text: 'Mensagem comum com um link https://example.com' },
  }), false);
});
