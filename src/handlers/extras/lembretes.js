'use strict';

const Lembrete = require('../../models/Lembrete');
const { parseDuracao, formatarDuracao, agoraLocal } = require('../../utils/tempo');
const { menc } = require('./_shared');

const MIN_MS         = 60_000;                 // 1 minuto
const MAX_MS         = 30 * 24 * 3_600_000;    // 30 dias
const MAX_PENDENTES  = 10;
const MAX_TENTATIVAS = 5;

function quandoFmt(date) {
  const l = agoraLocal(date);
  const p = n => String(n).padStart(2, '0');
  return `${p(l.dia)}/${p(l.mes)} às ${p(l.hora)}:${p(l.minuto)}`;
}

/**
 * !lembrete <tempo> <texto>      ex.: !lembrete 30m comprar pão | !lembrete 1h30m reunião
 * !lembrete lista                (ou !lembretes)
 * !lembrete cancelar <número>
 */
async function handleLembrete(sock, msg, jid, senderJid, args, P) {
  const partes = args.trim().split(/\s+/).filter(Boolean);
  const sub    = (partes[0] || '').toLowerCase();

  // ── Lista ───────────────────────────────────────────────────
  if (!sub || sub === 'lista' || sub === 'listar') {
    return listar(sock, msg, jid, senderJid, P, !sub);
  }

  // ── Cancelar ────────────────────────────────────────────────
  if (['cancelar', 'cancela', 'remover', 'apagar'].includes(sub)) {
    const n = parseInt(partes[1], 10);
    const pendentes = await Lembrete.find({ idWhatsApp: senderJid, enviado: false }).sort({ quando: 1 }).limit(MAX_PENDENTES).lean();
    if (!n || n < 1 || n > pendentes.length) {
      await sock.sendMessage(jid, { text: `⚠️ Informe o número do lembrete. Veja a lista com *${P}lembretes*.` }, { quoted: msg });
      return;
    }
    await Lembrete.deleteOne({ _id: pendentes[n - 1]._id });
    await sock.sendMessage(jid, { text: `🗑️ Lembrete *#${n}* cancelado.` }, { quoted: msg });
    return;
  }

  // ── Criar ───────────────────────────────────────────────────
  const ms = parseDuracao(sub);
  const texto = partes.slice(1).join(' ').trim();

  if (ms === null || !texto) {
    await sock.sendMessage(jid, {
      text:
        `⏰ *LEMBRETES*\n\n` +
        `Crie: *${P}lembrete <tempo> <texto>*\n` +
        `Ex.: *${P}lembrete 30m tirar o bolo do forno*\n` +
        `Ex.: *${P}lembrete 2h reunião com o cliente*\n` +
        `Ex.: *${P}lembrete 1d30m pagar a conta*\n\n` +
        `📋 *${P}lembretes* — ver os seus\n` +
        `🗑️ *${P}lembrete cancelar <nº>* — remover\n\n` +
        `_Tempo: de 1 minuto até 30 dias (d, h, m)._`,
    }, { quoted: msg });
    return;
  }

  if (ms < MIN_MS) {
    await sock.sendMessage(jid, { text: '⚠️ O tempo mínimo é *1 minuto* (ex.: 1m).' }, { quoted: msg });
    return;
  }
  if (ms > MAX_MS) {
    await sock.sendMessage(jid, { text: '⚠️ O tempo máximo é *30 dias*.' }, { quoted: msg });
    return;
  }
  if (texto.length > 300) {
    await sock.sendMessage(jid, { text: '⚠️ O texto do lembrete pode ter no máximo *300 caracteres*.' }, { quoted: msg });
    return;
  }

  const pendentes = await Lembrete.countDocuments({ idWhatsApp: senderJid, enviado: false });
  if (pendentes >= MAX_PENDENTES) {
    await sock.sendMessage(jid, { text: `⚠️ Você já tem *${MAX_PENDENTES}* lembretes pendentes. Cancele algum com *${P}lembrete cancelar <nº>*.` }, { quoted: msg });
    return;
  }

  const quando = new Date(Date.now() + ms);
  await Lembrete.create({ idWhatsApp: senderJid, idChat: jid, texto, quando });

  await sock.sendMessage(jid, {
    text: `⏰ Combinado! Vou te lembrar em *${formatarDuracao(ms)}* (${quandoFmt(quando)}):\n_${texto}_`,
  }, { quoted: msg });
}

async function listar(sock, msg, jid, senderJid, P, semArgs) {
  const lista = await Lembrete.find({ idWhatsApp: senderJid, enviado: false }).sort({ quando: 1 }).limit(MAX_PENDENTES).lean();
  if (!lista.length) {
    await sock.sendMessage(jid, {
      text: semArgs
        ? `⏰ Use *${P}lembrete <tempo> <texto>* — ex.: *${P}lembrete 30m tirar o bolo do forno*\n\nVocê não tem lembretes pendentes.`
        : '📭 Você não tem lembretes pendentes.',
    }, { quoted: msg });
    return;
  }
  const linhas = lista.map((l, i) => `*${i + 1}.* ${quandoFmt(l.quando)} — _${l.texto}_`);
  await sock.sendMessage(jid, {
    text: `⏰ *SEUS LEMBRETES*\n\n${linhas.join('\n')}\n\n🗑️ Cancele com *${P}lembrete cancelar <nº>*`,
  }, { quoted: msg });
}

/** Chamado pelo agendador a cada minuto. */
async function entregarLembretesVencidos(sock) {
  const vencidos = await Lembrete.find({ enviado: false, tentativas: { $lt: MAX_TENTATIVAS }, quando: { $lte: new Date() } })
    .sort({ quando: 1 }).limit(20).lean();

  for (const l of vencidos) {
    // Marca primeiro (atômico) para nunca enviar duas vezes.
    const marcado = await Lembrete.findOneAndUpdate({ _id: l._id, enviado: false }, { $set: { enviado: true } });
    if (!marcado) continue;

    try {
      await sock.sendMessage(l.idChat, {
        text: `⏰ *LEMBRETE* ${menc(l.idWhatsApp)}\n\n${l.texto}`,
        mentions: [l.idWhatsApp],
      });
    } catch (e) {
      console.error('[lembrete] falha ao enviar:', e?.message || e);
      await Lembrete.updateOne({ _id: l._id }, { $set: { enviado: false }, $inc: { tentativas: 1 } }).catch(() => {});
    }
  }
}

module.exports = { handleLembrete, entregarLembretesVencidos };
