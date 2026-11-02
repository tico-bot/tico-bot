'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getCarteira } = require(path.join(__dirname, '..', '..', '..', 'utils', 'carteira'));
const identidade = require(path.join(__dirname, '..', '..', '..', 'utils', 'identity'));
const { resolveUserFromMsg } = identidade;
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
// Aceita menção formatada (@número[@domínio]) e JID cru (número@domínio).
const JID_REFERENCE_REGEX = /(?:@(\d+)(?:@(s\.whatsapp\.net|lid))?|(\d+)@(s\.whatsapp\.net|lid))/g;

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
  return texto.replace(JID_REFERENCE_REGEX, (match, numeroMenção, dominioMenção, numeroCru, dominioCru) => {
    const numero = numeroMenção || numeroCru;
    const dominio = dominioMenção || dominioCru;
    const jidCompleto = `${numero}@${dominio || 's.whatsapp.net'}`;
    const nome = obterNomeContato(contactNames, jidCompleto)
      || obterNomeContato(contactNames, `${numero}@lid`)
      || obterNomeContato(contactNames, numero);
    return nome ? `*${nome.replace(/\*/g, '')}*` : `@${numero}`;
  });
}

function nomeExibicaoValido(value) {
  if (typeof value !== 'string') return null;
  const nome = value.trim().replace(/[\r\n]/g, ' ');
  if (!nome || /^\+?[\d\s().-]+$/.test(nome)) return null;
  return nome;
}

function extrairReferenciasDeTransacoes(transacoes = []) {
  const referencias = new Map();
  for (const transacao of transacoes) {
    const item = String(transacao?.item ?? '');
    const regex = new RegExp(JID_REFERENCE_REGEX.source, 'g');
    let match;
    while ((match = regex.exec(item)) !== null) {
      const numero = match[1] || match[3];
      const dominio = match[2] || match[4] || null;
      const chave = `${numero}${dominio || ''}`;
      if (!referencias.has(chave)) referencias.set(chave, { numero, dominio: dominio ? `@${dominio}` : null });
    }
  }
  return [...referencias.values()];
}

// Complementa o cache volátil de contactos com Usuario + LidMapping. Isso também
// recupera o nome de lançamentos antigos, que guardavam somente @número.
async function carregarNomesHistorico(transacoes, sock, contactNames = {}) {
  const nomes = Object.create(null);
  if (contactNames instanceof Map) {
    for (const [jid, nome] of contactNames) nomes[jid] = nome;
  } else if (contactNames && typeof contactNames === 'object') {
    Object.assign(nomes, contactNames);
  }

  const referencias = extrairReferenciasDeTransacoes(transacoes);
  await Promise.all(referencias.map(async ({ numero, dominio }) => {
    const pnJid = `${numero}@s.whatsapp.net`;
    const lidJid = `${numero}@lid`;
    const candidatos = dominio === '@lid'
      ? [lidJid, pnJid]
      : dominio === '@s.whatsapp.net'
        ? [pnJid, lidJid]
        : [pnJid, lidJid];

    let nome = candidatos.map(jid => obterNomeContato(nomes, jid)).find(Boolean) || null;
    const infos = nome ? [] : await Promise.all(candidatos.map(jid =>
      identidade.resolveUsuarioInfo(jid, sock, nomes).catch(() => null)
    ));

    if (!nome) {
      for (const info of infos) {
        nome = nomeExibicaoValido(info?.userData?.nome)
          || nomeExibicaoValido(info?.userData?.displayName);
        if (nome) break;
      }
    }

    if (!nome) return;

    const aliases = new Set([pnJid, lidJid, `${numero}`]);
    for (const info of infos) {
      for (const alias of [info?.resolvedJid, info?.pnJid, info?.lidJid, info?.userData?.idWhatsApp]) {
        if (typeof alias === 'string' && alias.includes('@')) aliases.add(alias);
      }
    }
    for (const alias of aliases) nomes[alias] = nome;
  }));

  return nomes;
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
    const nomesHistorico = await carregarNomesHistorico(ultimas, sock, contactNames);
    const linhas = ultimas.map((t, i) => buildLinhaTransacao(t, i, nomesHistorico, carteira || {}));

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

module.exports = { handleExtrato, formatarDataHora, resolverNomesNoItem, extrairReferenciasDeTransacoes, carregarNomesHistorico, buildLinhaTransacao, resumirTransacoes };
