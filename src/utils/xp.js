'use strict';

const Usuario       = require('../models/Usuario');
const LidMapping    = require('../models/LidMapping');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const { normalizarJid } = require('./jid');
const { prepareDailyMissionState, incrementMission } = require('../handlers/diversao/missoes');

/**
 * Retorna a hora atual no fuso horário oficial de Brasília (America/Cuiaba / UTC-3).
 *
 * @param {Date} [date]
 * @returns {number} hora de 0 a 23
 */
function getHorarioBrasilia(date = new Date()) {
  try {
    const horaStr = date.toLocaleTimeString('pt-BR', { timeZone: 'America/Cuiaba', hour: '2-digit', hour12: false });
    const hora = parseInt(horaStr, 10);
    return Number.isNaN(hora) ? date.getHours() : hora;
  } catch {
    return date.getHours();
  }
}

/**
 * Retorna as informações do bônus de XP do período do dia (Manhã, Tarde, Noite, Madrugada).
 *
 * Horários e Recompensas:
 * Recompensa reduzida para tornar a progressão mais lenta:
 * - ☀️ Manhã     (06h - 11h59): +2 XP por mensagem
 * - 🌤️ Tarde     (12h - 17h59): +3 XP por mensagem
 * - 🌙 Noite     (18h - 23h59): +4 XP por mensagem
 * - 🦉 Madrugada (00h - 05h59): +5 XP por mensagem (Bônus Corujão)
 *
 * @param {Date} [date]
 * @returns {{ periodo: string, emoji: string, bonusName: string, xp: number }}
 */
function getBonusHorario(date = new Date()) {
  const hora = getHorarioBrasilia(date);

  if (hora >= 6 && hora < 12) {
    return { periodo: 'Manhã', emoji: '☀️', bonusName: 'Bônus do Dia', xp: 2 };
  }
  if (hora >= 12 && hora < 18) {
    return { periodo: 'Tarde', emoji: '🌤️', bonusName: 'Bônus da Tarde', xp: 3 };
  }
  if (hora >= 18 && hora < 24) {
    return { periodo: 'Noite', emoji: '🌙', bonusName: 'Bônus da Noite', xp: 4 };
  }
  return { periodo: 'Madrugada', emoji: '🦉', bonusName: 'Bônus Corujão', xp: 5 };
}

/**
 * Fórmula rápida e balanceada de Nível a partir de XP.
 * (Nível 2 = 80 XP, Nível 3 = 211 XP, Nível 5 = 554 XP, Nível 10 = 1.757 XP)
 *
 * @param {number} xp
 * @returns {number}
 */
function levelFromXpGlobal(xp) {
  return CarteiraGrupo.levelFromXp(xp);
}

// XP de grupo/nível só deve ser concedido quando a configuração do grupo estiver explicitamente ativa.
// Mensagens privadas continuam usando o XP global do perfil, que não depende de um grupo.
function isXpEnabledForMessage(isGroup, groupConfig) {
  return !isGroup || groupConfig?.xpAtivo === true;
}

/**
 * Adiciona XP global ao Usuário, aplicando o bônus do horário do dia.
 *
 * @param {string} userId
 * @param {number|null} [xpOverride]
 * @param {string|null} [pushName]
 * @returns {Promise<object|null>}
 */
// ── Cache de resolução LID → idAlvo (evita 2 queries por mensagem) ──
const _lidResolveCache = new Map();  // userIdNorm → { idAlvo, ts }
const LID_CACHE_TTL    = 5 * 60_000; // 5 minutos

async function resolveIdAlvo(userIdNorm) {
  const cached = _lidResolveCache.get(userIdNorm);
  if (cached && (Date.now() - cached.ts) < LID_CACHE_TTL) return cached.idAlvo;

  let idAlvo = userIdNorm;
  if (!userIdNorm.endsWith('@lid')) {
    const lidMap = await LidMapping.findOne({ pn: userIdNorm }).lean();
    if (lidMap?.lid && await Usuario.exists({ idWhatsApp: lidMap.lid })) {
      idAlvo = lidMap.lid;
    }
  }

  _lidResolveCache.set(userIdNorm, { idAlvo, ts: Date.now() });
  // Limitar tamanho do cache
  if (_lidResolveCache.size > 5000) {
    const first = _lidResolveCache.keys().next().value;
    _lidResolveCache.delete(first);
  }
  return idAlvo;
}

async function addUserXp(userId, xpOverride = null, pushName = null) {
  if (!userId) return null;

  const userIdNorm = normalizarJid(userId);
  if (!userIdNorm) return null;

  const bonus = getBonusHorario();
  const xpGanho = (typeof xpOverride === 'number' && xpOverride > 0) ? xpOverride : bonus.xp;

  try {
    const idAlvo = await resolveIdAlvo(userIdNorm);

    // prepareDailyMissionState + missões podem rodar em paralelo com o update de XP
    const dailyPromise = prepareDailyMissionState(idAlvo).catch(() => {});

    const hojeISO = new Date().toISOString().slice(0, 10);

    const update = {
      $inc: {
        xp: xpGanho,
        mensagens: 1,
        [`xpHistory.${hojeISO}`]: xpGanho,
      },
      $setOnInsert: { level: 1, idWhatsApp: idAlvo, createdAt: new Date() },
    };
    if (pushName) update.$set = { nome: pushName };

    const [updated] = await Promise.all([
      Usuario.findOneAndUpdate(
        { idWhatsApp: idAlvo },
        update,
        { new: true, upsert: true }
      ),
      dailyPromise,
    ]);

    // Missões em paralelo (fire-and-forget)
    Promise.all([
      incrementMission(idAlvo, 'xp100', xpGanho),
      incrementMission(idAlvo, 'msg50', 1),
    ]).catch(() => {});

    const xpAtual   = updated?.xp ?? 0;
    const levelNovo = levelFromXpGlobal(xpAtual);

    if ((updated?.level ?? 1) !== levelNovo) {
      Usuario.findOneAndUpdate(
        { idWhatsApp: idAlvo },
        { $set: { level: levelNovo } }
      ).catch(() => {});
      updated.level = levelNovo;
    }

    return {
      ...updated.toObject(),
      xpGanho,
      bonusHorario: bonus,
    };
  } catch (e) {
    console.error('⚠️ Erro ao atualizar XP do usuário:', e.message);
    return null;
  }
}

module.exports = {
  addUserXp,
  isXpEnabledForMessage,
  getBonusHorario,
  getHorarioBrasilia,
  levelFromXpGlobal,
};