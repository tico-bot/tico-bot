/**
 * Sistema de Missões Diárias — Tico Bot
 * Comando: !missao
 */

const path = require('path');
const Usuario    = require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const LidMapping = require(path.join(__dirname, '..', '..', 'models', 'LidMapping'));
const { normalizarJid } = require(path.join(__dirname, '..', '..', 'utils', 'jid'));
const { formatarSaldo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));

// ─── DEFINIÇÃO DAS MISSÕES ──────────────────────────────────────────────────

const dailyMissionDefinitions = [
  { id: 'xp100',   label: 'Ganhe 100 XP',       target: 100, reward: 50,  emoji: '⭐', desc: 'Suba de level' },
  { id: 'msg50',   label: 'Mande 50 mensagens',  target: 50,  reward: 30,  emoji: '💬', desc: 'Seja ativo!' },
  { id: 'quiz5',   label: 'Acerte 5 quiz',       target: 5,   reward: 75,  emoji: '🧠', desc: 'Mostre inteligência' },
  { id: 'gold500', label: 'Ganhe 500 em saldo',  target: 500, reward: 100, emoji: '💰', desc: 'Fique rico' },
  { id: 'pet10',   label: 'Cuide do pet 10x',    target: 10,  reward: 60,  emoji: '🐾', desc: 'Ame seu pet' },
  { id: 'roubo3',  label: 'Faça 3 roubos',       target: 3,   reward: 80,  emoji: '🎭', desc: 'Seja um ladrão!' },
];

// IDs válidos para validação rápida
const MISSION_IDS = new Set(dailyMissionDefinitions.map(m => m.id));

// ─── UTILITÁRIOS ────────────────────────────────────────────────────────────

// Resolve o mesmo Usuario global que addUserXp() usa em bot.js: se o
// remetente vier como @s.whatsapp.net mas já existir um Usuario salvo sob
// o @lid mapeado, usa o @lid. Sem isso, "!missao" podia ler/gravar um
// documento diferente do que addUserXp estava de fato atualizando, e o
// progresso "sumia" para quem usa @lid.
async function getUserId(msg) {
  const raw  = msg.key.participant || msg.key.remoteJid;
  const norm = normalizarJid(raw) || raw;

  if (!norm.endsWith('@lid')) {
    try {
      const lidMap = await LidMapping.findOne({ pn: norm }).lean();
      if (lidMap?.lid && await Usuario.exists({ idWhatsApp: lidMap.lid })) {
        return lidMap.lid;
      }
    } catch {
      // Falha na consulta de mapeamento não deve travar o comando —
      // segue com o JID normalizado mesmo.
    }
  }

  return norm;
}

// Data de hoje no fuso de Brasília, não UTC — com UTC, as missões
// "viravam o dia" às 21h de Brasília (meia-noite UTC) em vez de à meia-noite
// local, 3h antes do que o texto "Missões renovam à meia-noite" promete.
function getTodayStr(ts = Date.now()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts));
  const map = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function buildDefaultMissions() {
  return {
    date:      getTodayStr(),
    progress:  { xp100: 0, msg50: 0, quiz5: 0, gold500: 0, pet10: 0, roubo3: 0 },
    completed: { xp100: false, msg50: false, quiz5: false, gold500: false, pet10: false, roubo3: false },
    claimed:   { xp100: false, msg50: false, quiz5: false, gold500: false, pet10: false, roubo3: false },
  };
}

function buildProgressBar(current, target, length = 10) {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 1;
  const safeLength = Number.isFinite(length) ? Math.max(1, Math.floor(length)) : 10;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const filled = Math.max(0, Math.min(Math.floor((safeCurrent / safeTarget) * safeLength), safeLength));
  return '█'.repeat(filled) + '░'.repeat(safeLength - filled);
}

// ─── prepareDailyMissionState ────────────────────────────────────────────────

async function prepareDailyMissionState(userId) {
  const todayStr = getTodayStr();

  try {
    // Leitura rápida (sem escrita) — cobre o caminho mais comum: usuário
    // já existe e as missões de hoje já foram preparadas.
    const existing = await Usuario.findOne(
      { idWhatsApp: userId },
      { dailyMissions: 1 }
    ).lean();

    if (existing?.dailyMissions?.date === todayStr) {
      return existing.dailyMissions;
    }

    // Usuário novo ou o dia virou — upsert atômico. A versão anterior fazia
    // findOne() e só depois Usuario.create() se não achasse nada; duas
    // mensagens quase simultâneas do mesmo usuário novo passavam as duas
    // pelo "não existe" e a segunda Usuario.create() explodia com erro de
    // chave única em idWhatsApp. upsert:true resolve isso em uma operação.
    const fresh = buildDefaultMissions();
    const updated = await Usuario.findOneAndUpdate(
      { idWhatsApp: userId },
      {
        $set: { dailyMissions: fresh },
        $setOnInsert: { idWhatsApp: userId, gold: 0, xp: 0, level: 1 },
      },
      { upsert: true, new: true }
    );

    return updated?.dailyMissions ?? fresh;
  } catch (e) {
    console.error('⚠️ Erro ao preparar missões:', e.message);
    // Não devolver um estado fictício: isso faria o comando exibir progresso
    // zerado e poderia esconder falhas reais de persistência.
    throw e;
  }
}

// ─── incrementMission ────────────────────────────────────────────────────────

async function incrementMission(userId, missionId, amount = 1) {
  if (typeof userId !== 'string' || !userId.trim()) return;
  if (!MISSION_IDS.has(missionId)) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  const mission = dailyMissionDefinitions.find(m => m.id === missionId);
  if (!mission) return;
  amount = Math.floor(amount);
  if (amount <= 0) return;

  try {
    // Garante que as missões de hoje existem — se o dia virou, isso já
    // reseta o progresso antes de incrementar.
    const state = await prepareDailyMissionState(userId);
    if (state?.completed?.[missionId]) return; // já bateu a meta hoje

    // $inc é atômico. A versão anterior lia o progresso, somava na
    // memória e gravava de volta — duas chamadas concorrentes (ex: duas
    // ações quase simultâneas do mesmo usuário) liam o mesmo valor de
    // partida, e a segunda gravação apagava o incremento da primeira
    // ("lost update"). $inc nunca perde incremento sob concorrência.
    const incrementado = await Usuario.findOneAndUpdate(
      { idWhatsApp: userId, 'dailyMissions.date': state.date },
      { $inc: { [`dailyMissions.progress.${missionId}`]: amount } },
      { new: true }
    );
    if (!incrementado) return;

    const progresso = incrementado.dailyMissions?.progress?.[missionId] ?? 0;
    if (progresso < mission.target) return;

    // Passou da meta (ex: um incremento em lote maior que o que faltava)
    // — $min trava o valor exibido no teto sem nova corrida, e completed
    // só é marcado true uma vez que a meta realmente foi atingida.
    await Usuario.updateOne(
      { idWhatsApp: userId, 'dailyMissions.date': state.date },
      {
        $min: { [`dailyMissions.progress.${missionId}`]: mission.target },
        $set: { [`dailyMissions.completed.${missionId}`]: true },
      }
    );
  } catch (e) {
    console.error(`⚠️ Erro ao incrementar missão ${missionId}:`, e.message);
  }
}

function findDailyMission(missionKey) {
  if (typeof missionKey !== 'string' || !missionKey.trim()) return undefined;
  const key = missionKey.trim().toLowerCase();
  return dailyMissionDefinitions.find(m => m.id === key);
}

// !missao
async function handleMissao(sock, msg, jid, caption, getPrefix) {
  const userId = await getUserId(msg);
  const P      = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  // ── Detectar prefixo e extrair args ──────────────────────────
  const semPrefix = caption.replace(/^[!.,/]\S+\s*/i, '').trim();
  const args      = semPrefix ? semPrefix.split(/\s+/) : [];

  const ALIASES_RESGATE = ['resgatar', 'claim', 'pegar', 'receber'];
  let missionKey = null;

  if (args.length >= 1 && ALIASES_RESGATE.includes(args[0].toLowerCase())) {
    if (args.length < 2) {
      const ids = dailyMissionDefinitions.map(m => `\`${m.id}\``).join(', ');
      await sock.sendMessage(jid, {
        text: `⚠️ Diga qual missão resgatar!\nExemplo: *${P}missao resgatar xp100*\n\n📋 IDs válidos: ${ids}`
      }, { quoted: msg });
      return;
    }
    missionKey = args[1].toLowerCase();
  } else if (args.length >= 1 && args[0].toLowerCase() !== 'listar') {
    missionKey = args[0].toLowerCase();
  }

  // ── Carregar estado ───────────────────────────────────────────
  let state;
  try {
    state = await prepareDailyMissionState(userId);
  } catch (e) {
    console.error('[missao] Erro ao preparar estado:', e.message);
    await sock.sendMessage(jid, { text: '❌ Erro interno ao carregar missões. Tente novamente!' }, { quoted: msg });
    return;
  }

  if (!state?.progress || !state?.completed || !state?.claimed) {
    await sock.sendMessage(jid, { text: '⚠️ Erro ao carregar suas missões! Tente novamente.' }, { quoted: msg });
    return;
  }

  // ── Resgate de recompensa ─────────────────────────────────────
  if (missionKey) {
    const mission = findDailyMission(missionKey);

    if (!mission) {
      const ids = dailyMissionDefinitions.map(m => `\`${m.id}\``).join(', ');
      await sock.sendMessage(jid, {
        text: `⚠️ Missão *${missionKey}* não encontrada!\n\n📋 IDs válidos: ${ids}`
      }, { quoted: msg });
      return;
    }

    const progress    = state.progress?.[mission.id] ?? 0;
    const isCompleted = progress >= mission.target || !!state.completed?.[mission.id];
    const isClaimed   = !!state.claimed?.[mission.id];

    if (isClaimed) {
      await sock.sendMessage(jid, {
        text:
          `✅ Você já resgatou *${mission.label}* hoje!\n\n` +
          `🔄 Missões renovam à meia-noite.`
      }, { quoted: msg });
      return;
    }

    if (!isCompleted) {
      const bar = buildProgressBar(progress, mission.target);
      const pct = Math.min(Math.floor((progress / mission.target) * 100), 99); // nunca mostra 100% sem completar
      const walletInfo = null;
      await sock.sendMessage(jid, {
        text:
          `⏳ *Missão em andamento!*\n\n` +
          `${mission.emoji} *${mission.label}*\n` +
          `    └ ID: \`${mission.id}\`\n` +
          `[${bar}] ${pct}%\n` +
          `📊 Progresso: *${mission.id === 'gold500'
            ? `${formatarSaldo(progress, walletInfo || {})}/${formatarSaldo(mission.target, walletInfo || {})}`
            : `${progress}/${mission.target}`}*\n\n` +
          `_${mission.desc}_`
      }, { quoted: msg });
      return;
    }

    // ── Concede recompensa atomicamente ───────────────────────────
    try {
      const updated = await Usuario.findOneAndUpdate(
        {
          idWhatsApp: userId,
          'dailyMissions.date': state.date,
          [`dailyMissions.claimed.${mission.id}`]: { $ne: true }, // evita duplo resgate em race condition
          $or: [
            { [`dailyMissions.progress.${mission.id}`]: { $gte: mission.target } },
            { [`dailyMissions.completed.${mission.id}`]: true },
          ],
        },
        {
          $set: {
            [`dailyMissions.completed.${mission.id}`]: true,
            [`dailyMissions.claimed.${mission.id}`]:   true,
          },
          $inc: { gold: mission.reward },
        },
        { new: true }
      );

      if (!updated) {
        // O estado pode ter mudado entre a leitura e a gravação (ex.: duas
        // tentativas simultâneas ou virada do dia). Não afirmar que já
        // resgatou se a atualização falhou por outro motivo.
        const atual = await Usuario.findOne(
          { idWhatsApp: userId },
          { dailyMissions: 1 }
        ).lean();
        const missaoAtual = atual?.dailyMissions;
        const jaResgatou = missaoAtual?.date === state.date && missaoAtual?.claimed?.[mission.id] === true;
        await sock.sendMessage(jid, {
          text: jaResgatou
            ? `✅ Você já resgatou *${mission.label}* hoje!\n\n🔄 Missões renovam à meia-noite.`
            : '⚠️ O estado da missão mudou. Use o comando novamente para atualizar o progresso.'
        }, { quoted: msg });
        return;
      }

      await sock.sendMessage(jid, {
        text:
          `🎉 *MISSÃO CONCLUÍDA!* 🎉\n\n` +
          `${mission.emoji} *${mission.label}*\n` +
          `💰 Recompensa: *${formatarSaldo(mission.reward)}* adicionada!\n` +
          `💵 Seu saldo atual: *${formatarSaldo(updated.gold)}*\n\n` +
          `_${mission.desc}_`
      }, { quoted: msg });
    } catch (e) {
      console.error('[missao] Erro ao dar recompensa:', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro interno ao computar sua recompensa. Tente novamente!' }, { quoted: msg });
    }
    return;
  }

  // ── Listagem de todas as missões ──────────────────────────────
  const walletInfo = null;
  let totalGoldDisponivel = 0;
  const lines = [];

  for (const mission of dailyMissionDefinitions) {
    const progress    = state.progress?.[mission.id] ?? 0;
    const isCompleted = progress >= mission.target || !!state.completed?.[mission.id];
    const isClaimed   = !!state.claimed?.[mission.id];

    let statusEmoji = '⏳';
    if (isClaimed) {
      statusEmoji = '✅';
    } else if (isCompleted) {
      statusEmoji = '🎁';
      totalGoldDisponivel += mission.reward;
    }

    const bar = buildProgressBar(progress, mission.target, 8);
    const pct = Math.min(Math.floor((progress / mission.target) * 100), 100);

    lines.push(
      `${statusEmoji} ${mission.emoji} *${mission.label}* — _+${formatarSaldo(mission.reward, walletInfo || {})}_\n` +
      `    └ ID: \`${mission.id}\`\n` +
      `    [${bar}] ${pct}% | ${mission.id === 'gold500' ? `${formatarSaldo(progress, walletInfo || {})}/${formatarSaldo(mission.target, walletInfo || {})}` : `${progress}/${mission.target}`} | _${mission.desc}_`
    );
  }

  const allClaimed = dailyMissionDefinitions.every(m => !!state.claimed?.[m.id]);
  const rodape     = allClaimed
    ? `🏆 *Parabéns! Você completou todas as missões de hoje!*`
    : totalGoldDisponivel > 0
      ? `🎁 *Você tem ${formatarSaldo(totalGoldDisponivel, walletInfo || {})} para resgatar!*\n💡 Use *${P}missao <id>* para resgatar.`
      : `💪 Continue jogando para completar suas missões!`;

  const comoResgatar = dailyMissionDefinitions
    .map(m => `  *${P}missao ${m.id}* — resgata "${m.label}"`)
    .join('\n');

  const texto =
    `🎯 *MISSÕES DIÁRIAS* 🎯\n` +
    `📅 _${getTodayStr()}_\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━\n` +
    `${rodape}\n\n` +
    `📌 *Como resgatar:*\n` +
    comoResgatar;

  await sock.sendMessage(jid, { text: texto }, { quoted: msg });
}

// ─── Exportar ────────────────────────────────────────────────────────────────

module.exports = {
  handleMissao,
  prepareDailyMissionState,
  incrementMission,
  findDailyMission,
  dailyMissionDefinitions,
  getTodayStr,
};