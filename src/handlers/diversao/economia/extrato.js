'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getCarteira, formatarSaldo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const { resolveUserFromMsg } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const { formatWalletAmount } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));

const EXTRATO_LIMITE   = 10;
const EXTRATO_DATE_FMT = { day: '2-digit', month: '2-digit' };
const EXTRATO_HORA_FMT = { hour: '2-digit', minute: '2-digit' };

const EXTRATO_ICONES = {
  recebido: '📈',
  enviado:  '📤',
  gasto:    '📉',
};

const JID_MENTION_REGEX = /@(\d+)(@(?:s\.whatsapp\.net|lid))?/g;

function formatarDataHora(date) {
  if (!date) return { data: '??/??', hora: '??:??' };
  const d = new Date(date);
  return {
    data: d.toLocaleDateString('pt-BR', EXTRATO_DATE_FMT),
    hora: d.toLocaleTimeString('pt-BR', EXTRATO_HORA_FMT),
  };
}

function resolverNomesNoItem(item = '', contactNames = {}) {
  return item.replace(JID_MENTION_REGEX, (match, numero, dominio) => {
    const jidCompleto = `${numero}${dominio || '@s.whatsapp.net'}`;
    const jidLid      = `${numero}@lid`;

    const nome =
      contactNames[jidCompleto] ||
      contactNames[jidLid]      ||
      null;

    return nome ? `*${nome}*` : `@${numero}`;
  });
}

function buildLinhaTransacao(t, index, contactNames = {}, wallet = {}) {
  const { data, hora } = formatarDataHora(t.date);
  const icone = EXTRATO_ICONES[t.type] ?? '📉';
  const sinal = t.type === 'recebido' ? '+' : '-';
  const num   = String(index + 1).padStart(2, '0');

  const itemFormatado = resolverNomesNoItem(t.item, contactNames);

  return `  ${num}. ${icone} *${sinal}${formatWalletAmount(t.amount, wallet)}* — ${itemFormatado}\n      🕐 ${data} às ${hora}`;
}

// !extrato
async function handleExtrato(sock, msg, jid, contactNames = {}) {
  const userId    = jidNormalizedUser(resolveUserFromMsg(msg));
  const carteira  = await getCarteira(userId, jid);
  const historico = carteira?.goldHistory ?? [];

  if (historico.length === 0) {
    await sock.sendMessage(jid, {
      text:
        `📊 *EXTRATO DE TRANSAÇÕES* 📊\n\n` +
        `😔 Nenhuma transação registrada ainda.\n\n` +
        `💰 Saldo atual: *${formatWalletAmount(carteira?.gold ?? 0, carteira)}*`,
    }, { quoted: msg });
    return;
  }

  const ultimas    = historico.slice(-EXTRATO_LIMITE).reverse();
  let totalEntrada = 0;
  let totalSaida   = 0;

  const linhas = ultimas.map((t, i) => {
    if (t.type === 'recebido') totalEntrada += t.amount;
    else                       totalSaida   += t.amount;

    return buildLinhaTransacao(t, i, contactNames, carteira);
  });

  const saldo        = carteira.gold ?? 0;
  const balanco      = totalEntrada - totalSaida;
  const iconeBalanco = balanco >= 0 ? '📈' : '📉';
  const sinalBalanco = balanco >= 0 ? '+' : '-';

  await sock.sendMessage(jid, {
    text:
      `📊 ═══ EXTRATO DE TRANSAÇÕES ═══ 📊\n\n` +
      `*ÚLTIMAS ${ultimas.length} MOVIMENTAÇÕES:*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      linhas.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━\n` +
      `📋 *RESUMO DO PERÍODO*\n` +
      `  📈 Entradas:  *+${formatWalletAmount(totalEntrada, carteira)}*\n` +
      `  📉 Saídas:    *-${formatWalletAmount(totalSaida, carteira)}*\n` +
      `  ${iconeBalanco} Balanço:   *${sinalBalanco}${formatWalletAmount(Math.abs(balanco), carteira)}*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `  💰 Saldo atual: *${formatWalletAmount(saldo, carteira)}*`,
  }, { quoted: msg });
}

module.exports = { handleExtrato };
