'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getCarteira } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const { resolveUserFromMsg } = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const { formatWalletAmount } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira', 'wallet'));

const EXTRATO_LIMITE = 10;
const TIME_ZONE = 'America/Cuiaba';
const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', timeZone: TIME_ZONE,
});
const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE,
});

const EXTRATO_ICONES = Object.freeze({
  recebido: '📈',
  enviado: '📤',
  gasto: '📉',
});
const JID_MENTION_REGEX = /@(\d+)(@(?:s\.whatsapp\.net|lid))?/g;

function numeroSeguro(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatarDataHora(value) {
  if (value === null || value === undefined || value === '') {
    return { data: '??/??', hora: '??:??' };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return { data: '??/??', hora: '??:??' };
  try {
    return { data: DATE_FORMATTER.format(date), hora: TIME_FORMATTER.format(date) };
  } catch {
    return { data: '??/??', hora: '??:??' };
  }
}

function obterNomeContato(contactNames, jid) {
  if (!contactNames || typeof contactNames !== 'object') return null;
  const value = contactNames instanceof Map ? contactNames.get(jid) : contactNames[jid];
  return typeof value === 'string' && value.trim() ? value.trim().replace(/[\r\n]/g, ' ') : null;
}

function resolverNomesNoItem(item = '', contactNames = {}) {
  const texto = String(item ?? 'Transação sem descrição');
  return texto.replace(JID_MENTION_REGEX, (match, numero, dominio) => {
    const jidCompleto = `${numero}${dominio || '@s.whatsapp.net'}`;
    const nome = obterNomeContato(contactNames, jidCompleto)
      || obterNomeContato(contactNames, `${numero}@lid`);
    return nome ? `*${nome.replace(/\*/g, '')}*` : `@${numero}`;
  });
}

function buildLinhaTransacao(transacao, index, contactNames = {}, wallet = {}) {
  const t = transacao && typeof transacao === 'object' ? transacao : {};
  const { data, hora } = formatarDataHora(t.date ?? t.createdAt ?? t.timestamp);
  const type = String(t.type || '').toLowerCase();
  const icone = EXTRATO_ICONES[type] || '💱';
  const sinal = type === 'recebido' ? '+' : type === 'enviado' || type === 'gasto' ? '−' : '';
  const numero = String(index + 1).padStart(2, '0');
  const valor = formatWalletAmount(Math.abs(numeroSeguro(t.amount)), wallet);
  const item = resolverNomesNoItem(t.item, contactNames);
  return `  ${numero}. ${icone} *${sinal}${valor}* — ${item}\n      🕐 ${data} às ${hora}`;
}

function resumirTransacoes(transacoes) {
  return transacoes.reduce((resumo, transacao) => {
    const t = transacao && typeof transacao === 'object' ? transacao : {};
    const amount = Math.abs(numeroSeguro(t.amount));
    const type = String(t.type || '').toLowerCase();
    if (type === 'recebido') resumo.entradas += amount;
    else if (type === 'enviado' || type === 'gasto') resumo.saidas += amount;
    else resumo.outros += 1;
    return resumo;
  }, { entradas: 0, saidas: 0, outros: 0 });
}

// !extrato
async function handleExtrato(sock, msg, jid, contactNames = {}) {
  try {
    const resolvedUser = resolveUserFromMsg(msg);
    if (!resolvedUser) {
      await sock.sendMessage(jid, { text: '⚠️ Não consegui identificar sua conta para consultar o extrato.' }, { quoted: msg });
      return;
    }

    const userId = jidNormalizedUser(resolvedUser);
    const carteira = await getCarteira(userId, jid);
    const historico = Array.isArray(carteira?.goldHistory) ? carteira.goldHistory : [];
    const saldo = numeroSeguro(carteira?.gold);

    if (historico.length === 0) {
      await sock.sendMessage(jid, {
        text: `📊 *EXTRATO DE TRANSAÇÕES* 📊\n\n` +
          `😔 Nenhuma transação registrada ainda.\n\n` +
          `💰 Saldo atual: *${formatWalletAmount(saldo, carteira || {})}*`,
      }, { quoted: msg });
      return;
    }

    // Mantém a ordem de gravação: as transações mais recentes ficam primeiro.
    const ultimas = historico.slice(-EXTRATO_LIMITE).reverse();
    const { entradas, saidas, outros } = resumirTransacoes(ultimas);
    const balanco = entradas - saidas;
    const sinalBalanco = balanco > 0 ? '+' : balanco < 0 ? '−' : '';
    const iconeBalanco = balanco > 0 ? '📈' : balanco < 0 ? '📉' : '⚖️';
    const linhas = ultimas.map((t, i) => buildLinhaTransacao(t, i, contactNames, carteira || {}));

    let texto = `📊 ═══ EXTRATO DE TRANSAÇÕES ═══ 📊\n\n` +
      `*ÚLTIMAS ${ultimas.length} MOVIMENTAÇÕES*\n` +
      `━━━━━━━━━━━━━━━━\n` + linhas.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━\n` +
      `📋 *RESUMO DO PERÍODO*\n` +
      `  📈 Entradas: *+${formatWalletAmount(entradas, carteira || {})}*\n` +
      `  📉 Saídas: *−${formatWalletAmount(saidas, carteira || {})}*\n` +
      `  ${iconeBalanco} Balanço: *${sinalBalanco}${formatWalletAmount(Math.abs(balanco), carteira || {})}*\n`;
    if (outros) texto += `  ℹ️ Outras movimentações: *${outros}*\n`;
    texto += `━━━━━━━━━━━━━━━━\n` +
      `  💰 Saldo atual: *${formatWalletAmount(saldo, carteira || {})}*`;

    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
  } catch (error) {
    console.error('[Extrato] Falha ao consultar histórico:', error?.message || error);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui consultar seu extrato agora. Tente novamente em instantes.',
    }, { quoted: msg });
  }
}

module.exports = { handleExtrato, formatarDataHora, resolverNomesNoItem, buildLinhaTransacao, resumirTransacoes };
