'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularTotalMensagens, calcularMensagensPerfil, calcularTotalAcumulado, somarContagensIdentidades } = require('./message-count');
const { normalizarJid } = require('./jid');

test('consolida contagens divididas entre perfis PN e LID sem somar duas fontes duplicadas', () => {
  const total = calcularTotalMensagens({
    usuarios: [
      { idWhatsApp: '5511999999999@s.whatsapp.net', mensagens: 12 },
      { idWhatsApp: '123456789@lid', mensagens: 18 },
    ],
    carteiras: [
      { idWhatsApp: '5511999999999@s.whatsapp.net', mensagens: 20 },
      { idWhatsApp: '123456789@lid', mensagens: 25 },
    ],
  });
  assert.equal(total, 45);
});

test('usa o contador legado quando os registros agregados ainda não têm mensagens', () => {
  assert.equal(calcularTotalMensagens({ usuarios: [{ mensagens: 0 }], carteiras: [], fallback: 31 }), 31);
});

test('não deixa valores inválidos ou negativos aumentarem a contagem', () => {
  assert.equal(calcularTotalMensagens({ usuarios: [{ mensagens: -5 }, { mensagens: 'inválido' }], carteiras: [{ mensagens: 4 }] }), 4);
});

test('soma contadores locais de identidades equivalentes e normaliza sufixo de dispositivo', () => {
  const map = new Map([
    ['5511999999999:3@s.whatsapp.net', { count: 4 }],
    ['123456789@lid', { count: 2 }],
    ['5511888888888@s.whatsapp.net', { count: 99 }],
  ]);
  assert.equal(somarContagensIdentidades(
    map,
    new Set(['5511999999999@s.whatsapp.net', '123456789@lid']),
    normalizarJid,
    'count',
  ), 6);
});

test('perfil usa o contador local quando o registro salvo no Mongo é zero', () => {
  assert.equal(calcularMensagensPerfil({
    usuarios: [{ idWhatsApp: '123@lid', mensagens: 0 }],
    fallback: 0,
    contadorLocal: 73,
  }), 73);
});

test('quiz points recover from PN/LID user docs and group wallets when primary user is zero', () => {
  assert.equal(calcularTotalAcumulado({
    campo: 'quizPoints',
    usuarios: [
      { idWhatsApp: '5511999999999@s.whatsapp.net', quizPoints: 0 },
      { idWhatsApp: '123456789@lid', quizPoints: 30 },
    ],
    carteiras: [
      { idWhatsApp: '5511999999999@s.whatsapp.net', idGrupo: 'grupo-a@g.us', quizPoints: 20 },
      { idWhatsApp: '123456789@lid', idGrupo: 'grupo-a@g.us', quizPoints: 25 },
      { idWhatsApp: '5511999999999@s.whatsapp.net', idGrupo: 'grupo-b@g.us', quizPoints: 15 },
    ],
  }), 40);
});

test('quiz fallback does not double-count user total and group wallets', () => {
  assert.equal(calcularTotalAcumulado({
    campo: 'quizPoints',
    usuarios: [{ quizPoints: 75 }],
    carteiras: [
      { idGrupo: 'grupo-a@g.us', quizPoints: 50 },
      { idGrupo: 'grupo-b@g.us', quizPoints: 15 },
    ],
  }), 75);
});
