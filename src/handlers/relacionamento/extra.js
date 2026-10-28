'use strict';

const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

const Usuario       = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CasalEstado   = require(path.join(__dirname, '..', '..', 'models', 'CasalEstado'));
const { getNivelInfo }  = require(path.join(__dirname, '..', '..', 'utils', 'levelUtils'));
const { normalizarJid } = require(path.join(__dirname, '..', '..', 'utils', 'identity'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));
const { alterarGold, getCarteira, formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));

// ═══════════════════════════════════════════════════════════════
// ─── CONFIGURAÇÃO ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  CUSTO_XP_DOBRO:       200,
  DURACAO_XP_DOBRO_MS:  60 * 60 * 1000,
  CUSTO_SURPRESA:       50,
  COOLDOWN_CIUMENTO_MS: 60 * 60 * 1000,
  LIMITE_DECLARACAO:    500,
  RANK_CASAIS_TOP:      10,
  FUSO:                 'America/Cuiaba',
};

const SURPRESAS = [
  { text: '🎁 Preparou um picnic surpresa no parque!',                xp: 15 },
  { text: '🍫 Comprou uma caixa gigante de bombons finos!',           xp: 20 },
  { text: '🎟️ Comprou ingressos VIP para o show favorito de vocês!',  xp: 25 },
  { text: '🧸 Deu um urso de pelúcia gigante!',                       xp: 15 },
];

const FRASES_CIUMENTO = [
  (a, b) => `👀 ${a} está de olho em você, ${b}! Quem é essa pessoa que curtiu sua foto? 🤨`,
  (a, b) => `📱 ${a} exige ver seu WhatsApp AGORA, ${b}! Não tenta disfarçar! 😤`,
  (a, b) => `🔪 ${a} ativou o modo detetive! Com quem você estava conversando, ${b}? 🧐`,
];

// Carinhos: nome do handler exportado → parâmetros do handleCarinh (index.js).
// Atenção: 'cmd' define o item exigido no inventário e o cooldown diário
// (ver ITEM_NECESSARIO no index.js).
const CARINHOS = {
  handleFlores:   { cmd: 'flores',   emoji: '🌹', verbo: 'deu flores para',                            xp: 10 },
  handleDoces:    { cmd: 'doces',    emoji: '🍓', verbo: 'deu morango com chocolate para',             xp: 10 },
  handleCarta:    { cmd: 'carta',    emoji: '💌', verbo: 'escreveu uma carta de amor para',            xp: 10 },
  handleMimo:     { cmd: 'mimo',     emoji: '🎁', verbo: 'deu um mimo especial para',                  xp: 15 },
  handleBeijo:    { cmd: 'beijo',    emoji: '💋', verbo: 'deu um beijo apaixonado em',                 xp: 8  },
  handleAbraco:   { cmd: 'abraco',   emoji: '🤗', verbo: 'deu um abraço aconchegante em',              xp: 5  },
  // Reaproveita a chave 'mimo' (item 'caixa' e cooldown compartilhado com !mimo).
  handlePresente: { cmd: 'mimo',     emoji: '🎁', verbo: 'deu um lindo presente para',                 xp: 15 },
  handleJantar:   { cmd: 'jantar',   emoji: '🍷', verbo: 'preparou um jantar romântico para',          xp: 20 },
  handleCinema:   { cmd: 'cinema',   emoji: '🛋️', verbo: 'levou para um cinema juntinhos',             xp: 15 },
  handleViajar:   { cmd: 'viajar',   emoji: '🍾', verbo: 'levará seu par para uma viagem inesquecível', xp: 25 },
  handleSerenata: { cmd: 'serenata', emoji: '🕯️', verbo: 'fez uma linda serenata à luz de velas para',  xp: 20 },
};

// ═══════════════════════════════════════════════════════════════
// ─── ACESSO AO index.js (lazy, evita dependência circular) ────
// ═══════════════════════════════════════════════════════════════

let _rel = null;
function rel() {
  if (!_rel) _rel = require(path.join(__dirname, 'index'));
  return _rel;
}

function findRelByJid(jid, userJid, relacionamentos) { return rel().findRelByJid(jid, userJid, relacionamentos); }
function temXpBonus(key)                             { return rel().temXpBonus(key); }
function formatarTempo(ms)                           { return rel().formatarTempo(ms); }
function handleCarinh(...args)                       { return rel().handleCarinh(...args); }
function prefixo(jid)                                { return rel().prefixo(jid); }

// ═══════════════════════════════════════════════════════════════
// ─── HELPERS ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const numeroDe = (jid) => String(jid || '').split(':')[0].split('@')[0];
const tag      = (jid) => `@${numeroDe(jid)}`;
const sortear  = (lista) => lista[Math.floor(Math.random() * lista.length)];

function responder(sock, msg, jid, text, mentions) {
  const conteudo = mentions?.length ? { text, mentions } : { text };
  return sock.sendMessage(jid, conteudo, { quoted: msg });
}

/** Devolve o JID do parceiro comparando pelo número (tolera diferenças de domínio/dispositivo). */
function parceiroDe(r, senderNorm) {
  const meuNumero = numeroDe(senderNorm);
  return jidNormalizedUser(numeroDe(r.jidA) === meuNumero ? r.jidB : r.jidA);
}

/** Busca o relacionamento; se não existir, avisa o usuário e devolve null. */
async function exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos, textoSemRelacionamento) {
  const found = findRelByJid(jid, senderNorm, relacionamentos);
  if (!found) await responder(sock, msg, jid, textoSemRelacionamento);
  return found;
}

/** Timestamp de início do relacionamento, com fallback seguro. */
function inicioDe(r) {
  const t = new Date(r.desde).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function infoNivel(xp) {
  try {
    const n = getNivelInfo?.(xp);
    if (n) return n;
  } catch { /* usa o fallback */ }
  return { nivel: 1, titulo: 'Casal Iniciante' };
}

/**
 * Debita o saldo local ou compartilhado sem permitir saldo negativo.
 * @returns {Promise<{ok: boolean, saldo: number}>} saldo após o débito (ok) ou saldo atual (falha)
 */
async function debitarGold(jid, senderJid, valor, item) {
  const idWhatsApp = normalizarJid(senderJid);
  if (!idWhatsApp) return { ok: false, carteira: null };
  try {
    const carteira = await alterarGold(idWhatsApp, jid, -valor, item);
    return { ok: true, carteira };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { ok: false, carteira: await getCarteira(idWhatsApp, jid) };
  }
}

// Casais com ativação de XP Dobro em andamento (evita cobrança dupla por mensagens simultâneas)
const ativandoXpDobro = new Set();

// ═══════════════════════════════════════════════════════════════
// ─── PEDIDOS ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleCancelarPedido(sock, msg, jid, senderJid, pedidosPendentes) {
  const senderNorm = jidNormalizedUser(senderJid);
  let cancelado = false;

  for (const [alvoJid, p] of pedidosPendentes.entries()) {
    if (jidNormalizedUser(p.jidPedinte) === senderNorm || jidNormalizedUser(alvoJid) === senderNorm) {
      if (p.timer) clearTimeout(p.timer); // só tem efeito se o index.js guardar o timer no pedido
      pedidosPendentes.delete(alvoJid);
      cancelado = true;
    }
  }

  await responder(sock, msg, jid, cancelado
    ? '✅ Pedido pendente cancelado com sucesso!'
    : '⚠️ Você não possui pedidos pendentes para cancelar.');
}

// ═══════════════════════════════════════════════════════════════
// ─── CARINHOS (gerados a partir da tabela CARINHOS) ───────────
// ═══════════════════════════════════════════════════════════════

const handlersCarinho = {};
for (const [nome, c] of Object.entries(CARINHOS)) {
  handlersCarinho[nome] = (sock, msg, jid, author, senderJid, relacionamentos) =>
    handleCarinh(sock, msg, jid, author, senderJid, relacionamentos, c.cmd, c.emoji, c.verbo, c.xp);
}

// ═══════════════════════════════════════════════════════════════
// ─── OUTROS COMANDOS DE CASAL ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleRankCasais(sock, msg, jid, relacionamentos) {
  const xpCasais = rel().xpCasais;
  const lista = [];

  for (const [key, r] of relacionamentos?.entries?.() ?? []) {
    if (key.startsWith(jid + '|')) {
      lista.push({ ...r, key, xp: xpCasais.get(key) || 0 });
    }
  }

  if (lista.length === 0) {
    await responder(sock, msg, jid, '💔 Nenhum casal registrado neste grupo ainda!');
    return;
  }

  lista.sort((a, b) => b.xp - a.xp);

  const medalhas = ['👑', '🥈', '🥉'];
  let text = `🏆 *RANKING DE CASAIS DO GRUPO* 🏆\n\n`;

  lista.slice(0, CONFIG.RANK_CASAIS_TOP).forEach((c, idx) => {
    const medalha = idx < 3 ? medalhas[idx] : `*${idx + 1}º*`;
    const tipo = c.tipo === 'namoro' ? '💕' : '💍';
    text += `${medalha} ${tipo} *${c.nomeA}* & *${c.nomeB}* — *${c.xp} XP*\n`;
  });

  await responder(sock, msg, jid, text);
}

async function handleDeclarar(sock, msg, content, jid, author, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você precisa estar em um relacionamento para se declarar!');
  if (!found) return;

  // Remove a primeira palavra (o comando), com qualquer prefixo.
  const rawText    = content.extendedTextMessage?.text || content.conversation || '';
  const declaracao = rawText.trim().replace(/^\S+\s*/, '').trim();

  if (!declaracao) {
    await responder(sock, msg, jid, `✍️ Escreva sua declaração! Ex: *${prefixo(jid)}declarar Você é o amor da minha vida!*`);
    return;
  }
  if (declaracao.length > CONFIG.LIMITE_DECLARACAO) {
    await responder(sock, msg, jid, `⚠️ Declaração muito longa! O limite é de *${CONFIG.LIMITE_DECLARACAO} caracteres*.`);
    return;
  }

  const parcJid = parceiroDe(found.rel, senderNorm);

  await responder(sock, msg, jid,
    `📜 *DECLARAÇÃO DE AMOR* 📜\n\nDe ${tag(senderNorm)} para ${tag(parcJid)}:\n\n"${declaracao}"\n\n💖✨`,
    [senderNorm, parcJid]);
}

async function handleCiumento(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm   = jidNormalizedUser(senderJid);
  const ciumentosMap = rel().ciumentosMap;

  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    `💔 Você precisa estar em um relacionamento para usar ${prefixo(jid)}ciumento!`);
  if (!found) return;

  const agora = Date.now();
  const ate   = ciumentosMap.get(senderNorm);
  if (ate && agora < ate) {
    const mins = Math.ceil((ate - agora) / 60000);
    await responder(sock, msg, jid, `⏰ Controle esse ciúme! Aguarde ${mins} minuto(s) para cobrar seu par de novo.`);
    return;
  }

  ciumentosMap.set(senderNorm, agora + CONFIG.COOLDOWN_CIUMENTO_MS);

  const parcJid = parceiroDe(found.rel, senderNorm);
  const frase   = sortear(FRASES_CIUMENTO)(tag(senderNorm), tag(parcJid));

  await responder(sock, msg, jid, frase, [senderNorm, parcJid]);
}

async function handleStatu(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    `💔 Você está solteiro(a)! Use *${prefixo(jid)}casar @alguem* para mudar isso.`);
  if (!found) return;

  const { key, rel: r } = found;
  const xp        = rel().xpCasais.get(key) || 0;
  const tempoStr  = formatarTempo(Date.now() - inicioDe(r));
  const parcJid   = parceiroDe(r, senderNorm);
  const tipoEmoji = r.tipo === 'namoro' ? '💕' : '💍';
  const nivelInfo = infoNivel(xp);

  const texto =
    `${tipoEmoji} *STATUS DO RELACIONAMENTO* ${tipoEmoji}\n\n` +
    `👤 *Parceiro(a):* ${tag(parcJid)}\n` +
    `📅 *Juntos há:* ${tempoStr}\n` +
    `✨ *XP do Casal:* ${xp} XP\n` +
    `🏅 *Nível do Casal:* Nível ${nivelInfo.nivel} (${nivelInfo.titulo})\n\n` +
    `💪 _Continuem trocando carinhos diariamente para subir de nível!_`;

  await responder(sock, msg, jid, texto, [senderNorm, parcJid]);
}

async function handleAniversarioCasal(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você não está em nenhum relacionamento!');
  if (!found) return;

  const { rel: r } = found;
  const desde      = inicioDe(r);
  const dataInicio = new Date(desde).toLocaleDateString('pt-BR', { timeZone: CONFIG.FUSO });
  const tempoStr   = formatarTempo(Date.now() - desde);
  const parcJid    = parceiroDe(r, senderNorm);
  const acao       = r.tipo === 'namoro' ? 'a namorar' : 'a casar';

  await responder(sock, msg, jid,
    `🎉 *ANIVERSÁRIO DO CASAL* 🎉\n\n` +
    `👩‍❤️‍👨 Você e ${tag(parcJid)} começaram ${acao} em *${dataInicio}*!\n` +
    `⏳ Vocês já estão juntos há *${tempoStr}*! Parabéns ao casal! 🥳🥂`,
    [senderNorm, parcJid]);
}

async function handleMeuPar(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você não tem um par no momento!');
  if (!found) return;

  const parcJid = parceiroDe(found.rel, senderNorm);
  const tipo    = found.rel.tipo === 'namoro' ? 'namorado(a)' : 'esposo(a)';

  await responder(sock, msg, jid, `💖 Seu(ua) ${tipo} é ${tag(parcJid)}!`, [parcJid]);
}

async function handleXpDobro(sock, msg, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você precisa estar em um relacionamento para ativar o XP Dobro!');
  if (!found) return;

  const { key } = found;
  if (ativandoXpDobro.has(key)) return; // ativação já em andamento para este casal
  ativandoXpDobro.add(key);

  try {
    const xpBonus = rel().xpBonus;

    if (temXpBonus(key)) {
      const restMins = Math.ceil((xpBonus.get(key).expiry - Date.now()) / 60000);
      await responder(sock, msg, jid, `⚡ O bônus de XP Dobro já está ATIVO por mais ${restMins} minuto(s)!`);
      return;
    }
    const { ok, carteira } = await debitarGold(jid, senderJid, CONFIG.CUSTO_XP_DOBRO, 'XP Dobro');
    if (!ok) {
      await responder(sock, msg, jid,
        `🪙 Você precisa de *${formatarSaldo(CONFIG.CUSTO_XP_DOBRO, carteira)}* para ativar o XP Dobro por 1 hora!\n` +
        `💰 Seu saldo neste grupo: *${formatarSaldo(carteira?.gold ?? 0, carteira)}*`);
      return;
    }

    const expiry = Date.now() + CONFIG.DURACAO_XP_DOBRO_MS;
    xpBonus.set(key, { ativo: true, expiry });
    CasalEstado.updateOne(
      { chave: `bonus:${key}` },
      { $set: { tipo: 'xpBonus', expiry: new Date(expiry) } },
      { upsert: true }
    ).catch(e => console.error('[handleXpDobro] Erro ao persistir XP Dobro:', e.message));

    await responder(sock, msg, jid,
      `⚡ *XP DOBRO ATIVADO!* ⚡\n\n` +
      `Todos os carinhos de vocês renderão o dobro de XP pela próxima *1 hora*! 🎉\n` +
      `💰 Saldo restante: *${formatarSaldo(carteira.gold, carteira)}*`);
  } finally {
    ativandoXpDobro.delete(key);
  }
}

async function handleDueloCasais(sock, msg, content, jid, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const foundA = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você precisa estar em um relacionamento para desafiar outro casal!');
  if (!foundA) return;

  const mentionedJid = content.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentionedJid.length === 0) {
    await responder(sock, msg, jid, `⚔️ Marque alguém do casal adversário!\nEx: *${prefixo(jid)}duelodecasais @adversario*`);
    return;
  }

  const foundB = findRelByJid(jid, jidNormalizedUser(mentionedJid[0]), relacionamentos);
  if (!foundB) {
    await responder(sock, msg, jid, '💔 O adversário marcado não está em um relacionamento!');
    return;
  }
  if (foundA.key === foundB.key) {
    await responder(sock, msg, jid, '🤔 Você não pode duelar contra o seu próprio par!');
    return;
  }

  const xpCasais = rel().xpCasais;
  const xpA = xpCasais.get(foundA.key) || 0;
  const xpB = xpCasais.get(foundB.key) || 0;

  let resultado;
  if (xpA === xpB) {
    resultado = '🤝 *EMPATE!* Os dois casais têm o mesmo XP!';
  } else {
    const v = xpA > xpB ? foundA.rel : foundB.rel;
    resultado = `🏆 *VENCEDOR:* ${v.nomeA} & ${v.nomeB}! 🎉`;
  }

  await responder(sock, msg, jid,
    `⚔️ *DUELO DE CASAIS* ⚔️\n\n` +
    `🥊 *${foundA.rel.nomeA} & ${foundA.rel.nomeB}* (${xpA} XP)\n` +
    `            VS\n` +
    `🥊 *${foundB.rel.nomeA} & ${foundB.rel.nomeB}* (${xpB} XP)\n\n` +
    resultado);
}

async function handleSurpresa(sock, msg, jid, author, senderJid, relacionamentos) {
  const senderNorm = jidNormalizedUser(senderJid);
  const found = await exigirRelacionamento(sock, msg, jid, senderNorm, relacionamentos,
    '💔 Você precisa estar em um relacionamento para dar uma surpresa!');
  if (!found) return;
  const { ok, carteira } = await debitarGold(jid, senderJid, CONFIG.CUSTO_SURPRESA, 'Surpresa romântica');
  if (!ok) {
    await responder(sock, msg, jid,
      `🪙 Você precisa de *${formatarSaldo(CONFIG.CUSTO_SURPRESA, carteira)}* para fazer uma surpresa!\n` +
      `💰 Seu saldo neste grupo: *${formatarSaldo(carteira?.gold ?? 0, carteira)}*`);
    return;
  }

  const { key, rel: r } = found;
  const surpresa = sortear(SURPRESAS);
  const temBonus = temXpBonus(key);
  const ganho    = temBonus ? surpresa.xp * 2 : surpresa.xp;

  const xpCasais = rel().xpCasais;
  const xpAtual  = (xpCasais.get(key) || 0) + ganho;
  xpCasais.set(key, xpAtual);

  const parcJid = parceiroDe(r, senderNorm);

  Usuario.updateMany(
    { idWhatsApp: { $in: [jidNormalizedUser(r.jidA), jidNormalizedUser(r.jidB)] } },
    { $inc: { xpCasal: ganho } }
  ).catch(e => console.error('[handleSurpresa] Erro ao salvar XP no DB:', e.message));

  const bonusStr = temBonus ? ` _(XP Dobro ativo!)_` : '';

  await responder(sock, msg, jid,
    `🎉 *SURPRESA ROMÂNTICA!* 🎉\n\n` +
    `${tag(senderNorm)} fez uma surpresa para ${tag(parcJid)}!\n${surpresa.text}\n\n` +
    `💖 *+${ganho} XP para o casal!*${bonusStr} (Total: ${xpAtual} XP)\n` +
    `💰 Saldo restante: *${formatarSaldo(carteira.gold, carteira)}*`,
    [senderNorm, parcJid]);
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

module.exports = {
  handleCancelarPedido,
  ...handlersCarinho,        // handleFlores, handleDoces, handleCarta, handleMimo, handleBeijo,
                             // handleAbraco, handlePresente, handleJantar, handleCinema,
                             // handleViajar, handleSerenata
  handleRankCasais,
  handleDeclarar,
  handleCiumento,
  handleStatu,
  handleAniversarioCasal,
  handleMeuPar,
  handleXpDobro,
  handleDueloCasais,
  handleSurpresa,
};