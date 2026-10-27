'use strict';

const Usuario     = require('../../models/Usuario');
const DailyStreak = require('../../models/DailyStreak');
const { hojeStr, diffDias } = require('../../utils/tempo');
const { getUserId, creditarGold, requestIdDe, formatarSaldo } = require('./_shared');

// ─── Recompensa (mesma escala das missões: valores em "centavos") ────────────
const BASE            = 100;  // dia 1
const POR_DIA         = 20;   // + por dia de sequência
const TETO_DIAS       = 15;   // a partir daqui a recompensa para de crescer
const BONUS_7_DIAS    = 300;  // bônus a cada múltiplo de 7
const BONUS_30_DIAS   = 1000; // bônus extra a cada múltiplo de 30

function calcularRecompensa(streak) {
  const dias = Math.min(streak, TETO_DIAS);
  let total  = BASE + (dias - 1) * POR_DIA;
  const bonus = [];
  if (streak % 7 === 0)  { total += BONUS_7_DIAS;  bonus.push(`🎁 Bônus de ${streak} dias seguidos: +${formatarSaldo(BONUS_7_DIAS, {})}`); }
  if (streak % 30 === 0) { total += BONUS_30_DIAS; bonus.push(`👑 Bônus mensal: +${formatarSaldo(BONUS_30_DIAS, {})}`); }
  return { total, bonus };
}

// ─── Conquistas (calculadas a partir de dados que já existem) ────────────────
const CONQUISTAS = [
  { id: 'tagarela',     emoji: '💬', nome: 'Tagarela',          desc: 'Mande 500 mensagens',            ok: (u)       => (u.mensagens || 0) >= 500 },
  { id: 'lenda_chat',   emoji: '🗣️', nome: 'Lenda do Chat',     desc: 'Mande 5.000 mensagens',          ok: (u)       => (u.mensagens || 0) >= 5000 },
  { id: 'nivel10',      emoji: '⭐', nome: 'Em Ascensão',       desc: 'Chegue ao nível 10',             ok: (u)       => (u.level || 1) >= 10 },
  { id: 'nivel25',      emoji: '🌟', nome: 'Veterano',          desc: 'Chegue ao nível 25',             ok: (u)       => (u.level || 1) >= 25 },
  { id: 'nivel50',      emoji: '👑', nome: 'Lendário',          desc: 'Chegue ao nível 50',             ok: (u)       => (u.level || 1) >= 50 },
  { id: 'rico',         emoji: '💰', nome: 'Endinheirado',      desc: 'Acumule 50.000 de saldo',        ok: (u)       => (u.gold || 0) >= 50000 },
  { id: 'sabichao',     emoji: '🧠', nome: 'Sabichão',          desc: 'Faça 100 pontos de quiz',        ok: (u)       => (u.quizPoints || 0) >= 100 },
  { id: 'cupido',       emoji: '💘', nome: 'Coração Ocupado',   desc: 'Tenha um namoro ou casamento',   ok: (u)       => !!u.casadoCom },
  { id: 'dono_pet',     emoji: '🐾', nome: 'Amigo dos Bichos',  desc: 'Capture um pet',                 ok: (u)       => !!u.pet?.type },
  { id: 'dedicado',     emoji: '📅', nome: 'Dedicado',          desc: 'Resgate o diário 15 vezes',      ok: (_u, s)   => (s.totalClaims || 0) >= 15 },
  { id: 'fiel',         emoji: '🔥', nome: 'Fiel',              desc: 'Sequência diária de 7 dias',     ok: (_u, s)   => (s.best || 0) >= 7 },
  { id: 'maratonista',  emoji: '🏅', nome: 'Maratonista',       desc: 'Sequência diária de 30 dias',    ok: (_u, s)   => (s.best || 0) >= 30 },
];

async function avaliarConquistas(userId) {
  const [usuario, streakDoc] = await Promise.all([
    Usuario.findOne({ idWhatsApp: userId }).lean(),
    DailyStreak.findOne({ idWhatsApp: userId }).lean(),
  ]);
  const u = usuario  || {};
  const s = streakDoc || {};

  const jaTinha  = new Set(s.achievements || []);
  const agora    = CONQUISTAS.filter(c => { try { return c.ok(u, s); } catch { return false; } });
  const novas    = agora.filter(c => !jaTinha.has(c.id));

  if (novas.length) {
    await DailyStreak.updateOne(
      { idWhatsApp: userId },
      { $addToSet: { achievements: { $each: novas.map(c => c.id) } } },
      { upsert: true }
    ).catch(() => {});
  }

  return { desbloqueadas: new Set([...jaTinha, ...agora.map(c => c.id)]), novas, streak: s };
}

function textoNovas(novas) {
  if (!novas.length) return '';
  return `\n\n🏆 *Nova${novas.length > 1 ? 's' : ''} conquista${novas.length > 1 ? 's' : ''}!*\n` +
    novas.map(c => `${c.emoji} *${c.nome}* — _${c.desc}_`).join('\n');
}

// ─── !diario ────────────────────────────────────────────────────────────────
async function handleDiario(sock, msg, jid) {
  const userId = await getUserId(msg);
  const hoje   = hojeStr();

  const anterior = await DailyStreak.findOne({ idWhatsApp: userId }).lean();

  if (anterior?.lastClaim === hoje) {
    await sock.sendMessage(jid, {
      text: `⏳ Você já resgatou o diário de hoje!\n🔥 Sequência atual: *${anterior.streak} dia(s)*\n\n_Volte amanhã para manter a sequência._`,
    }, { quoted: msg });
    return;
  }

  const seguiu = anterior?.lastClaim && diffDias(anterior.lastClaim, hoje) === 1;
  const streak = seguiu ? (anterior.streak || 0) + 1 : 1;
  const perdeu = anterior && !seguiu && (anterior.streak || 0) > 1;

  // 1) Reivindica o dia de forma atômica. Dois comandos simultâneos: só um passa.
  let reivindicado;
  try {
    reivindicado = await DailyStreak.findOneAndUpdate(
      { idWhatsApp: userId, lastClaim: { $ne: hoje } },
      {
        $set: { lastClaim: hoje, streak },
        $max: { best: streak },
        $inc: { totalClaims: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    if (e?.code === 11000) {
      await sock.sendMessage(jid, { text: '⏳ Você já resgatou o diário de hoje!' }, { quoted: msg });
      return;
    }
    throw e;
  }

  // 2) Credita (idempotente por usuário+dia). Se falhar, desfaz a reivindicação.
  const { total, bonus } = calcularRecompensa(streak);
  let credito;
  try {
    credito = await creditarGold(userId, jid, total, `Recompensa diária (${streak}º dia)`, requestIdDe('diario', userId, hoje));
  } catch (e) {
    console.error('[diario] Erro ao creditar:', e.message);
    await DailyStreak.updateOne(
      { idWhatsApp: userId, lastClaim: hoje },
      {
        $set: { lastClaim: anterior?.lastClaim ?? null, streak: anterior?.streak ?? 0 },
        $inc: { totalClaims: -1 },
      }
    ).catch(() => {});
    await sock.sendMessage(jid, { text: '❌ Não consegui creditar sua recompensa agora. Tente novamente em instantes!' }, { quoted: msg });
    return;
  }

  const { novas } = await avaliarConquistas(userId);

  const proximoBonus = 7 - (streak % 7);
  const linhas = [
    `🎁 *RECOMPENSA DIÁRIA*`,
    ``,
    `🔥 Sequência: *${streak} dia(s)*${reivindicado?.best > streak ? ` _(recorde: ${reivindicado.best})_` : streak === reivindicado?.best && streak > 1 ? ' 🏅 _novo recorde!_' : ''}`,
    `💰 Ganhou: *${formatarSaldo(total, {})}*`,
    ...bonus,
  ];
  if (perdeu) linhas.push(``, `💔 Sua sequência anterior de *${anterior.streak} dias* foi perdida, mas você recomeçou!`);
  if (proximoBonus !== 7) linhas.push(``, `📆 Faltam *${proximoBonus}* dia(s) para o bônus de 7 dias.`);
  if (credito.linked) linhas.push(``, `_Creditado na sua conta do app._`);

  await sock.sendMessage(jid, { text: linhas.join('\n') + textoNovas(novas) }, { quoted: msg });
}

// ─── !conquistas ────────────────────────────────────────────────────────────
async function handleConquistas(sock, msg, jid) {
  const userId = await getUserId(msg);
  const { desbloqueadas, novas, streak } = await avaliarConquistas(userId);

  const linhas = CONQUISTAS.map(c =>
    desbloqueadas.has(c.id)
      ? `✅ ${c.emoji} *${c.nome}* — _${c.desc}_`
      : `🔒 ${c.emoji} ${c.nome} — _${c.desc}_`
  );

  await sock.sendMessage(jid, {
    text:
      `🏆 *SUAS CONQUISTAS* (${desbloqueadas.size}/${CONQUISTAS.length})\n\n` +
      linhas.join('\n') +
      `\n\n🔥 Sequência diária: *${streak.streak || 0}* | Recorde: *${streak.best || 0}*` +
      textoNovas(novas),
  }, { quoted: msg });
}

module.exports = { handleDiario, handleConquistas, CONQUISTAS };
