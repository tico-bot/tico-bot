'use strict';

const Aniversario   = require('../../models/Aniversario');
const GrupoConfig   = require('../../models/GrupoConfig');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const ExtraState    = require('../../models/ExtraState');
const { agoraLocal } = require('../../utils/tempo');
const { getGroupMetadataCached, isAdmin, normalizeJidBase } = require('../grupo/helpers');
const { getAlternateSenderJids } = require('../../utils/identity');
const { getSock } = require('./_shared');
const { entregarLembretesVencidos } = require('./lembretes');

const HORA_ANIVERSARIO = 9;   // a partir das 09:00 (Cuiabá)
const HORA_RANKING     = 20;  // domingo a partir das 20:00 (Cuiabá)

const MEDALHAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

async function getEstado(chave) {
  const doc = await ExtraState.findById(chave).lean();
  return doc?.value ?? null;
}
async function setEstado(chave, value) {
  await ExtraState.updateOne({ _id: chave }, { $set: { value } }, { upsert: true });
}

// ─── Aniversários ───────────────────────────────────────────────────────────
async function anunciarAniversarios(sock, agora) {
  const dd = String(agora.dia).padStart(2, '0');
  const mm = String(agora.mes).padStart(2, '0');

  const aniversariantes = await Aniversario.find({ date: new RegExp(`^${dd}/${mm}/`) }).lean();
  if (!aniversariantes.length) return;

  const grupos = await GrupoConfig.find({ sistemaAniversario: true, botAtivo: { $ne: false } }).select('idGrupo').lean();

  for (const { idGrupo } of grupos) {
    try {
      const meta = await getGroupMetadataCached(sock, idGrupo);
      if (!meta?.participants?.length) continue;

      const bases = new Map(); // base numérica -> jid real do participante
      for (const p of meta.participants) {
        bases.set(normalizeJidBase(p.id), p.id);
        if (p.lid) bases.set(normalizeJidBase(p.lid), p.id);
      }

      const doGrupo = aniversariantes
        .map(a => ({ a, jid: bases.get(normalizeJidBase(a.idWhatsApp)) }))
        .filter(x => x.jid);
      if (!doGrupo.length) continue;

      const linhas = doGrupo.map(({ a, jid }) => {
        const anoNasc = Number(a.date.split('/')[2]);
        const idade   = agora.ano - anoNasc;
        return `🎂 @${jid.split('@')[0]}${idade > 0 && idade < 120 ? ` — *${idade} anos*` : ''}`;
      });

      await sock.sendMessage(idGrupo, {
        text: `🎉 *HOJE TEM ANIVERSÁRIO!* 🎉\n\n${linhas.join('\n')}\n\nDeem os parabéns! 🥳🎈`,
        mentions: doGrupo.map(x => x.jid),
      });
    } catch (e) {
      console.error(`[aniversário] falha no grupo ${idGrupo}:`, e?.message || e);
    }
  }
}

// ─── Ranking semanal ────────────────────────────────────────────────────────
async function postarRankingSemanal(sock) {
  const grupos = await GrupoConfig.find({ rankingSemanal: true, botAtivo: { $ne: false } }).select('idGrupo').lean();

  for (const { idGrupo } of grupos) {
    try {
      const membros = await CarteiraGrupo.find({ idGrupo }).select('idWhatsApp xp mensagens').lean();
      if (!membros.length) continue;

      const chaveSnap = `rank_snap:${idGrupo}`;
      const snap      = await getEstado(chaveSnap);          // { jid: { xp, msg } } da semana anterior
      const temSnap   = !!snap && typeof snap === 'object';

      const placar = membros.map(m => ({
        jid: m.idWhatsApp,
        xp:  Math.max(0, (m.xp || 0)        - (temSnap ? (snap[m.idWhatsApp]?.xp  || 0) : 0)),
        msg: Math.max(0, (m.mensagens || 0) - (temSnap ? (snap[m.idWhatsApp]?.msg || 0) : 0)),
      }));

      const topXp  = placar.filter(p => p.xp  > 0).sort((a, b) => b.xp  - a.xp ).slice(0, 5);
      const topMsg = placar.filter(p => p.msg > 0).sort((a, b) => b.msg - a.msg).slice(0, 3);

      if (topXp.length) {
        const mencoes = [...new Set([...topXp, ...topMsg].map(p => p.jid))];
        const tag = j => `@${j.split(':')[0].split('@')[0]}`;
        let texto = `🏆 *RANKING SEMANAL* 🏆\n_${temSnap ? 'XP ganho nesta semana' : 'XP total (primeira edição)'}_\n\n`;
        texto += topXp.map((p, i) => `${MEDALHAS[i]} ${tag(p.jid)} — *${p.xp} XP*`).join('\n');
        if (topMsg.length) {
          texto += `\n\n💬 *Mais ativos da semana*\n` + topMsg.map((p, i) => `${MEDALHAS[i]} ${tag(p.jid)} — *${p.msg}* msgs`).join('\n');
        }
        texto += `\n\n_Nova semana começando — bora subir no ranking!_ 🚀`;
        await sock.sendMessage(idGrupo, { text: texto, mentions: mencoes });
      }

      // Guarda o snapshot (limita o tamanho do documento).
      const novoSnap = {};
      for (const m of membros.sort((a, b) => (b.xp || 0) - (a.xp || 0)).slice(0, 1000)) {
        novoSnap[m.idWhatsApp] = { xp: m.xp || 0, msg: m.mensagens || 0 };
      }
      await setEstado(chaveSnap, novoSnap);
    } catch (e) {
      console.error(`[ranking semanal] falha no grupo ${idGrupo}:`, e?.message || e);
    }
  }
}

// ─── !rankingsemanal on|off (admin) ─────────────────────────────────────────
async function handleRankingSemanal(sock, msg, jid, senderJid, args, P) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '❌ Este comando funciona apenas em grupos.' }, { quoted: msg });
    return;
  }
  if (!await isAdmin(sock, jid, senderJid, getAlternateSenderJids(msg))) {
    await sock.sendMessage(jid, { text: '❌ Apenas admins podem usar este comando.' }, { quoted: msg });
    return;
  }

  const opcao = (args.split(/\s+/)[0] || '').toLowerCase();
  const cfg   = await GrupoConfig.findOne({ idGrupo: jid }).lean();

  if (opcao !== 'on' && opcao !== 'off') {
    await sock.sendMessage(jid, {
      text:
        `🏆 *Ranking semanal:* ${cfg?.rankingSemanal ? '✅ ligado' : '❌ desligado'}\n\n` +
        `Todo domingo, por volta das ${HORA_RANKING}h, o bot posta os mais ativos da semana.\n` +
        `Use *${P}rankingsemanal on* ou *${P}rankingsemanal off*.`,
    }, { quoted: msg });
    return;
  }

  await GrupoConfig.updateOne({ idGrupo: jid }, { $set: { rankingSemanal: opcao === 'on' } }, { upsert: true });
  try { require('../../router').invalidateGrupoConfigCache(jid); } catch { /* cache expira sozinho em 60s */ }

  await sock.sendMessage(jid, {
    text: opcao === 'on'
      ? `✅ Ranking semanal *ligado*! O primeiro será postado no próximo domingo às ${HORA_RANKING}h.`
      : '✅ Ranking semanal *desligado*.',
  }, { quoted: msg });
}

// ─── Agendador (1 tick por minuto) ──────────────────────────────────────────
let timer = null;
let rodando = false;

async function tick() {
  if (rodando) return;
  const sock = getSock();
  if (!sock?.user) return;           // desconectado / reconectando
  rodando = true;
  try {
    await entregarLembretesVencidos(sock).catch(e => console.error('[agendador] lembretes:', e?.message || e));

    const agora = agoraLocal();

    if (agora.hora >= HORA_ANIVERSARIO && await getEstado('aniversario_ultimo_dia') !== agora.iso) {
      await setEstado('aniversario_ultimo_dia', agora.iso);   // marca antes: nunca duplica
      await anunciarAniversarios(sock, agora).catch(e => console.error('[agendador] aniversários:', e?.message || e));
    }

    if (agora.diaSemana === 0 && agora.hora >= HORA_RANKING && await getEstado('ranking_semanal_ultimo') !== agora.iso) {
      await setEstado('ranking_semanal_ultimo', agora.iso);
      await postarRankingSemanal(sock).catch(e => console.error('[agendador] ranking semanal:', e?.message || e));
    }
  } finally {
    rodando = false;
  }
}

function iniciarAgendadores() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(e => console.error('[agendador] erro:', e?.message || e)); }, 60_000);
  timer.unref?.();
  console.log('[Extras] Agendadores (lembretes, aniversários, ranking semanal) iniciados.');
}

function pararAgendadores() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { iniciarAgendadores, pararAgendadores, handleRankingSemanal };
