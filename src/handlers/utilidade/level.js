'use strict';

const path                  = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const CarteiraGrupo         = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const { resolverJidCarteira } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ IMPORTANTE — Identidade do usuário (idWhatsApp)
//
// O WhatsApp pode enviar o remetente em DOIS formatos de JID:
//   - "5511999999999@s.whatsapp.net"  (número de telefone tradicional)
//   - "73396520337564@lid"            (LID — Linked Identifier, NÃO é telefone)
//
// NUNCA extraia os dígitos de um @lid e monte um "@s.whatsapp.net" falso —
// isso gera um JID inválido que o WhatsApp exibe como "+1 73396520337564".
//
// Regra: usar o JID original em lowercase como idWhatsApp, tanto para
// salvar quanto para consultar e para a menção. O "@<dígitos>" no corpo da
// mensagem funciona para @lid e @s.whatsapp.net porque o WhatsApp casa o
// texto com o JID correspondente em "mentions".
// ─────────────────────────────────────────────────────────────────────────

// ─── Faixas temáticas de nível ────────────────────────────────────────────────
const FAIXAS_NIVEL = [
  { xp: 0,    nome: '🌱 Recém-saído do forno',    titulo: 'Iniciante', emoji: '🌱' },
  { xp: 80,   nome: '💕 Apaixonado de verdade',   titulo: 'Romântico', emoji: '💕' },
  { xp: 210,  nome: '💪 Sólido feito rocha',      titulo: 'Sólido',    emoji: '💪' },
  { xp: 550,  nome: '⭐ Veterano com calo',        titulo: 'Veterano',  emoji: '⭐' },
  { xp: 1200, nome: '🏆 Lenda viva',              titulo: 'Lendário',  emoji: '🏆' },
  { xp: 2300, nome: '👑 IMORTAL DO AMOR',         titulo: 'Imortal',   emoji: '👑' },
  { xp: 4500, nome: '💎 DEUS DO RELACIONAMENTO',  titulo: 'Divino',    emoji: '💎' },
];

function getNivelInfo(xp) {
  let faixa = FAIXAS_NIVEL[0];
  for (const f of FAIXAS_NIVEL) if (xp >= f.xp) faixa = f;
  return faixa;
}

// ─── Barra de progresso ───────────────────────────────────────────────────────
function buildBarra(progresso, tamanho = 10) {
  const preenchido = Math.min(tamanho, Math.max(0, Math.floor(progresso / (100 / tamanho))));
  return '█'.repeat(preenchido) + '░'.repeat(tamanho - preenchido);
}

// ─── Normalização do remetente ────────────────────────────────────────────────
/**
 * Normaliza o JID do remetente de uma mensagem.
 * Retorna { fullJid, numero } ou null se inválido.
 */
function normalizarRemetente(msg) {
  if (!msg || !msg.key) return null;
  const rawSender = (msg.key.participant || msg.key.remoteJid)?.toLowerCase();
  if (!rawSender) return null;

  const numero = rawSender.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!numero) return null;

  return { fullJid: jidNormalizedUser(rawSender), numero };
}

// ─── Helpers de guarda ────────────────────────────────────────────────────────
async function exigirGrupo(sock, msg, jid) {
  if (jid?.endsWith('@g.us')) return true;
  await sock.sendMessage(jid, {
    text: '⚠️ Este comando só pode ser usado em grupos.',
  }, { quoted: msg });
  return false;
}

// ─── !level ───────────────────────────────────────────────────────────────────
/**
 * Mostra o nível e XP atual do próprio usuário NESTE grupo.
 */
async function handleLevel(sock, msg, jid) {
  if (!await exigirGrupo(sock, msg, jid)) return;

  const remetente = normalizarRemetente(msg);
  if (!remetente) return;

  const { numero } = remetente;
  // Resolve para o MESMO jid que a carteira real usa (@lid ↔ @pn) — sem
  // isso, quem tem carteira salva sob o outro formato aparecia como
  // "sem XP registrado" mesmo tendo XP acumulado.
  const fullJid = await resolverJidCarteira(remetente.fullJid, jid);

  try {
    const doc = await CarteiraGrupo.findOne({ idWhatsApp: fullJid, idGrupo: jid });

    const xp = Math.max(0, doc?.xp ?? 0);

    if (!doc || xp === 0) {
      return sock.sendMessage(jid, {
        text:
          `📊 *NÍVEL DE PROGRESSO*\n\n` +
          `@${numero}, você ainda não tem XP registrado neste grupo.\n` +
          `_Continue interagindo para começar a pontuar!_`,
        mentions: [fullJid],
      }, { quoted: msg });
    }

    // ✅ Usa getProgressoXp() do model — fonte única de verdade para cálculos
    const { level, xpNoLevel, xpNecessario, progresso } = doc.getProgressoXp();
    const faixa = getNivelInfo(xp);

    const texto =
      `📊 *SEU STATUS DE NÍVEL*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Usuário:* @${numero}\n` +
      `${faixa.emoji} *Título:* ${faixa.nome}\n` +
      `⭐ *Nível:* ${level}  •  ✨ *XP Total:* ${xp.toLocaleString('pt-BR')}\n\n` +
      `📈 *Progresso para o nível ${level + 1}:*\n` +
      `[${buildBarra(progresso)}] ${progresso}%\n` +
      `${xpNoLevel.toLocaleString('pt-BR')} / ${xpNecessario.toLocaleString('pt-BR')} XP\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_💬 Continue ativo para subir de nível!_`;

    return sock.sendMessage(jid, { text: texto, mentions: [fullJid] }, { quoted: msg });

  } catch (err) {
    console.error('[handleLevel] Erro:', err);
    return sock.sendMessage(jid, {
      text: '⚠️ Não foi possível carregar seu nível. Tente novamente mais tarde.',
    }, { quoted: msg });
  }
}

function normalizarJidBase(id) {
  if (!id || typeof id !== 'string') return '';
  const clean = id.toLowerCase();
  const [user, domain] = clean.split('@');
  if (!user || !domain) return clean;
  return `${user.split(':')[0]}@${domain}`;
}

// ─── !ranklevel ───────────────────────────────────────────────────────────────
/**
 * Top 10 usuários com mais XP ativos no grupo.
 */
async function handleRankLevel(sock, msg, jid) {
  if (!await exigirGrupo(sock, msg, jid)) return;

  try {
    let membrosSet = null;
    try {
      const metadata = await sock.groupMetadata(jid);
      if (metadata?.participants?.length) {
        membrosSet = new Set();
        for (const p of metadata.participants) {
          if (p.id) {
            membrosSet.add(p.id.toLowerCase());
            membrosSet.add(normalizarJidBase(p.id));
          }
          if (p.lid) {
            membrosSet.add(p.lid.toLowerCase());
            membrosSet.add(normalizarJidBase(p.lid));
          }
        }
      }
    } catch (e) {
      console.warn('[handleRankLevel] Aviso: Não foi possível obter groupMetadata, exibindo candidatos da base:', e.message);
    }

    const todosCandidatos = await CarteiraGrupo
      .find({ idGrupo: jid, xp: { $gt: 0 } })
      .sort({ xp: -1 })
      .lean();

    // Remove quem já saiu/foi banido e limita ao top 10
    const candidatos = todosCandidatos
      .filter(u => {
        if (!u.idWhatsApp) return false;
        if (!membrosSet) return true;
        const idLower = u.idWhatsApp.toLowerCase();
        const idBase  = normalizarJidBase(u.idWhatsApp);
        return membrosSet.has(idLower) || membrosSet.has(idBase);
      })
      .slice(0, 10);

    if (candidatos.length === 0) {
      return sock.sendMessage(jid, {
        text: '❌ Nenhum membro deste grupo possui XP registrado ainda.\n_Interaja no grupo para ganhar XP!_',
      }, { quoted: msg });
    }

    const MEDALS   = ['🥇', '🥈', '🥉'];
    const mentions = [];

    const linhas = candidatos.map((user, i) => {
      const fullJid = user.idWhatsApp.toLowerCase();
      const numero  = fullJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      mentions.push(fullJid);

      const xpRaw = Math.max(0, user.xp ?? 0);

      // ✅ Usa as statics do model — sem reimplementar a fórmula localmente
      const level        = CarteiraGrupo.levelFromXp(xpRaw);
      const xpAnterior   = CarteiraGrupo.xpParaLevel(level);
      const xpProximo    = CarteiraGrupo.xpParaLevel(level + 1);
      const xpNoLevel    = Math.max(0, xpRaw - xpAnterior);
      const xpNecessario = Math.max(1, xpProximo - xpAnterior);
      const progresso    = Math.min(100, Math.floor((xpNoLevel / xpNecessario) * 100));

      const faixa  = getNivelInfo(xpRaw);
      const prefix = MEDALS[i] ?? `🔹 *${i + 1}.*`;

      return (
        `${prefix} @${numero} ${faixa.emoji}\n` +
        `┣ 🏅 Nível *${level}* (${faixa.titulo})  •  ✨ *${xpRaw.toLocaleString('pt-BR')} XP*\n` +
        `┗ [${buildBarra(progresso, 5)}] ${progresso}% → nível ${level + 1}`
      );
    });

    const texto =
      `🏆 *RANKING DE XP — TOP ${candidatos.length}* 🏆\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      linhas.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Use *!level* para ver seu progresso pessoal!_`;

    return sock.sendMessage(jid, { text: texto, mentions }, { quoted: msg });

  } catch (err) {
    console.error('[handleRankLevel] Erro:', err);
    return sock.sendMessage(jid, {
      text: '⚠️ Erro ao processar o ranking. Tente novamente.',
    }, { quoted: msg });
  }
}

module.exports = { handleLevel, handleRankLevel, normalizarRemetente };