'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const identidade = require('../../../utils/identity');
const transferencia = require('../../../utils/carteira/transferencia');
const {
  carregarNomesHistorico,
  extrairReferenciasDeTransacoes,
  resolverNomesNoItem,
} = require('./extrato');

test('novas referências do histórico preservam se o identificador é PN ou LID', () => {
  assert.equal(
    transferencia.formatarReferenciaHistorico('5511999999999@s.whatsapp.net'),
    '@5511999999999@s.whatsapp.net'
  );
  assert.equal(
    transferencia.formatarReferenciaHistorico('123456789012345@lid'),
    '@123456789012345@lid'
  );
});

test('extrai referências completas e legadas sem duplicar o mesmo identificador', () => {
  const refs = extrairReferenciasDeTransacoes([
    { item: 'PIX para @5511999999999@s.whatsapp.net' },
    { item: 'PIX de @123456789012345@lid' },
    { item: 'PIX antigo para @5511999999999' },
    { item: 'Roubou de 5511888888888@s.whatsapp.net' },
    { item: 'Recuperado pela polícia de 123456789012345@lid' },
  ]);

  assert.deepEqual(refs, [
    { numero: '5511999999999', dominio: '@s.whatsapp.net' },
    { numero: '123456789012345', dominio: '@lid' },
    { numero: '5511999999999', dominio: null },
    { numero: '5511888888888', dominio: '@s.whatsapp.net' },
  ]);
});

test('extrato resolve nomes de registros antigos que guardaram somente o número', async t => {
  const consultas = [];
  t.mock.method(identidade, 'resolveUsuarioInfo', async jid => {
    consultas.push(jid);
    if (jid === '123456789012345@s.whatsapp.net') {
      return {
        resolvedJid: jid,
        pnJid: jid,
        lidJid: null,
        nome: 'Pessoa PN',
        userData: { idWhatsApp: jid, nome: 'Pessoa PN' },
      };
    }
    if (jid === '123456789012345@lid') {
      return {
        resolvedJid: '5511888888888@s.whatsapp.net',
        pnJid: '5511888888888@s.whatsapp.net',
        lidJid: '123456789012345@lid',
        nome: 'Mariana',
        userData: { idWhatsApp: '123456789012345@lid', nome: 'Mariana' },
      };
    }
    return { userData: null };
  });

  const nomes = await carregarNomesHistorico([
    { item: 'PIX para @123456789012345' },
    { item: 'PIX separado para @123456789012345@lid' },
  ], {}, {});

  assert.ok(consultas.includes('123456789012345@s.whatsapp.net'));
  assert.ok(consultas.includes('123456789012345@lid'));
  assert.equal(resolverNomesNoItem('PIX para @123456789012345', nomes), 'PIX para *Pessoa PN*');
  assert.equal(resolverNomesNoItem('PIX de @123456789012345@lid', nomes), 'PIX de *Mariana*');
  assert.equal(resolverNomesNoItem('PIX para @123456789012345@s.whatsapp.net', nomes), 'PIX para *Pessoa PN*');
});

test('extrato também resolve JIDs crus gravados por roubo, assalto e polícia', async t => {
  const consultas = [];
  t.mock.method(identidade, 'resolveUsuarioInfo', async jid => {
    consultas.push(jid);
    if (jid === '5511888888888@s.whatsapp.net') {
      return {
        resolvedJid: jid,
        pnJid: jid,
        lidJid: null,
        userData: { idWhatsApp: jid, nome: 'Rafael' },
      };
    }
    if (jid === '123456789012345@lid') {
      return {
        resolvedJid: '5511777777777@s.whatsapp.net',
        pnJid: '5511777777777@s.whatsapp.net',
        lidJid: jid,
        userData: { idWhatsApp: jid, nome: 'Mariana' },
      };
    }
    return { userData: null };
  });

  const historico = [
    { item: 'Roubado por 5511888888888@s.whatsapp.net' },
    { item: 'Roubou de 123456789012345@lid' },
    { item: 'Apreensão policial para 5511888888888@s.whatsapp.net' },
    { item: 'Recuperado pela polícia de 123456789012345@lid' },
    { item: 'Assaltou banco de 5511888888888@s.whatsapp.net' },
  ];
  const nomes = await carregarNomesHistorico(historico, {}, {});

  assert.ok(consultas.includes('5511888888888@s.whatsapp.net'));
  assert.ok(consultas.includes('123456789012345@lid'));
  assert.equal(resolverNomesNoItem(historico[0].item, nomes), 'Roubado por *Rafael*');
  assert.equal(resolverNomesNoItem(historico[1].item, nomes), 'Roubou de *Mariana*');
  assert.equal(resolverNomesNoItem(historico[2].item, nomes), 'Apreensão policial para *Rafael*');
  assert.equal(resolverNomesNoItem(historico[3].item, nomes), 'Recuperado pela polícia de *Mariana*');
  assert.equal(resolverNomesNoItem(historico[4].item, nomes), 'Assaltou banco de *Rafael*');
});

test('usa o cache de contactos no alias PN/LID após resolver o vínculo da conta', async t => {
  let consultas = 0;
  t.mock.method(identidade, 'resolveUsuarioInfo', async (jid, sock, contactNames) => {
    consultas++;
    const alias = '5511999999999@lid';
    const nome = contactNames instanceof Map ? contactNames.get(alias) : contactNames?.[alias];
    return {
      resolvedJid: jid,
      pnJid: jid,
      lidJid: alias,
      nome: nome || 'Usuário',
      userData: null,
    };
  });

  const nomes = await carregarNomesHistorico(
    [{ item: 'PIX para @5511999999999@s.whatsapp.net' }],
    {},
    new Map([['5511999999999@lid', 'Carlos']])
  );

  assert.equal(resolverNomesNoItem('PIX para @5511999999999@s.whatsapp.net', nomes), 'PIX para *Carlos*');
  assert.equal(consultas, 1, 'consulta a identidade para confirmar o alias antes de usar o nome do contacto');
});
