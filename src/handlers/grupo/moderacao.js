'use strict';

const fs   = require('fs');
const path = require('path');
const Usuario = require('../../models/Usuario');
const GrupoConfig = require('../../models/GrupoConfig');
const LidMapping = require('../../models/LidMapping');
const { normalizarJid } = require('../../utils/jid');
const { resolveUsuarioInfo } = require('../../utils/identity');

const {
  somenteGrupo,
  checkAdmin,
  isBotJid,
  normalizeJidBase,
  resolveTargetJid,
  muteUser,
  unmuteUser,
  isMuted,
  mutedCount,
  clearMuted,
  getGroupMetadataCached,
  isAdmin,
} = require('./helpers');
const { getAlternateSenderJids } = require('../../utils/identity');
const { isOwnerIdentity } = require('../extras/_shared');

const BAN_IMAGE_PATH = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'imageban.jpg');
const BAN_VIDEO_PATH = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'ban.mp4');
const BAN_AUDIO_PATH = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'audioban.mp4');

// ═══════════════════════════════════════════════════════════════
// ─── !ban ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleBan(sock, msg, content, jid, botJid, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'ban')) return;

  const senderJid  = msg.key.participant || msg.key.remoteJid;
  const senderBases = new Set([senderJid, ...getAlternateSenderJids(msg)].map(normalizeJidBase).filter(Boolean));
  const textCmd    = (content.conversation || content.extendedTextMessage?.text || '').toLowerCase();
  const isAll      = /@all/.test(textCmd);

  // ── Ban em massa (@all) — Proteção aos admins do grupo ────────
  if (isAll) {
    let meta;
    try {
      meta = await getGroupMetadataCached(sock, jid);
    } catch (err) {
      console.error('[handleBan @all] Erro ao buscar metadata:', err.message);
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg });
      return;
    }

    if (!meta?.participants) {
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg });
      return;
    }

    const targets = meta.participants
      .filter(p => {
        if (!p) return false;
        if (isBotJid(p.id, botJid)) return false;
        if (p.admin) return false; // Proteção: ignora outros admins!
        const base    = normalizeJidBase(p.id);
        const baseLid = normalizeJidBase(p.lid || '');
        return !senderBases.has(base) && !senderBases.has(baseLid);
      })
      .map(p => p.id);

    if (targets.length === 0) {
      await sock.sendMessage(jid, { text: '⚠️ Nenhum membro comum para remover.' }, { quoted: msg });
      return;
    }

    await sock.sendMessage(jid, {
      text: `🔨 *Removendo ${targets.length} membro(s) (admins preservados)...*\n_Aguarde um momento._`,
    }, { quoted: msg });

    let ok = 0, fail = 0;

    for (let i = 0; i < targets.length; i += 5) {
      const lote = targets.slice(i, i + 5);
      try {
        await sock.groupParticipantsUpdate(jid, lote, 'remove');
        ok += lote.length;
      } catch {
        for (const t of lote) {
          try {
            await sock.groupParticipantsUpdate(jid, [t], 'remove');
            ok++;
          } catch (err) {
            console.warn('[handleBan @all] Falha ao remover', t, err.message);
            fail++;
          }
        }
      }

      if (i + 5 < targets.length) await new Promise(r => setTimeout(r, 1500));
    }

    for (const t of targets) unmuteUser(jid, t);

    await sock.sendMessage(jid, {
      text:
        `✅ *Ban em massa concluído!*\n\n` +
        `🔨 Removidos: *${ok}*` +
        `${fail > 0 ? `\n❌ Falhas: *${fail}*\n⚠️ Confira se o *Tico Bot é administrador* do grupo e pode remover participantes.` : ''}\n` +
        `_(Admins e o bot foram preservados)_`,
    }, { quoted: msg });
    return;
  }

  // ── Ban individual ─────────────────────────────────────────
  const targetJid = await resolveTargetJid(sock, msg, content, jid);
  if (!targetJid) {
    await sock.sendMessage(jid, {
      text: '⚠️ Marque alguém.\nExemplo: *!ban @fulano* ou *!ban @all*',
    }, { quoted: msg });
    return;
  }

  if (senderBases.has(normalizeJidBase(targetJid))) {
    await sock.sendMessage(jid, { text: '🤡 Você não pode banir a si mesmo.' }, { quoted: msg });
    return;
  }

  if (isBotJid(targetJid, botJid)) {
    await sock.sendMessage(jid, { text: '🤖 Não é possível banir o bot!' }, { quoted: msg });
    return;
  }

  // Tenta enviar mídias sem deixar falhas de mídia abortarem o banimento
  try {
    const banCaption = `🔨 @${normalizeJidBase(targetJid)} foi banido(a) do grupo! Tchau! 👋`;
    if (fs.existsSync(BAN_VIDEO_PATH)) {
      await sock.sendMessage(jid, {
        video:    fs.readFileSync(BAN_VIDEO_PATH),
        gifPlayback: true,
        caption:  banCaption,
        mentions: [targetJid],
      }).catch(async () => {
        if (fs.existsSync(BAN_IMAGE_PATH)) {
          await sock.sendMessage(jid, { image: fs.readFileSync(BAN_IMAGE_PATH), caption: banCaption, mentions: [targetJid] }).catch(() => {});
        }
      });
    } else if (fs.existsSync(BAN_IMAGE_PATH)) {
      await sock.sendMessage(jid, {
        image:    fs.readFileSync(BAN_IMAGE_PATH),
        caption:  banCaption,
        mentions: [targetJid],
      }).catch(() => {});
    }

    if (fs.existsSync(BAN_AUDIO_PATH)) {
      await sock.sendMessage(jid, {
        audio:    fs.readFileSync(BAN_AUDIO_PATH),
        mimetype: 'audio/mp4',
        ptt:      false,
      }).catch(() => {});
    }

    await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
    unmuteUser(jid, targetJid);
  } catch (err) {
    console.error('[handleBan] Erro ao remover:', err.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui remover o participante. O *Tico Bot precisa ser administrador do grupo* para banir membros.',
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !mute ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleMute(sock, msg, content, jid, botJid, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'mute')) return;

  const senderJid  = msg.key.participant || msg.key.remoteJid;
  const senderBases = new Set([senderJid, ...getAlternateSenderJids(msg)].map(normalizeJidBase).filter(Boolean));
  const textCmd    = (content.conversation || content.extendedTextMessage?.text || '').toLowerCase();
  const isAll      = /@all/.test(textCmd);

  // ── Mute em massa (@all) — Proteção aos admins do grupo ──────
  if (isAll) {
    let meta;
    try {
      meta = await getGroupMetadataCached(sock, jid);
    } catch (err) {
      console.error('[handleMute @all] Erro:', err.message);
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg });
      return;
    }

    if (!meta?.participants) {
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg });
      return;
    }

    const targets = meta.participants
      .filter(p => {
        if (!p) return false;
        if (isBotJid(p.id, botJid)) return false;
        if (p.admin) return false; // Proteção: ignora admins!
        const base    = normalizeJidBase(p.id);
        const baseLid = normalizeJidBase(p.lid || '');
        return !senderBases.has(base) && !senderBases.has(baseLid);
      })
      .map(p => p.id);

    if (targets.length === 0) {
      await sock.sendMessage(jid, {
        text: '⚠️ Nenhum membro comum para mutar.',
      }, { quoted: msg });
      return;
    }

    for (const t of targets) muteUser(jid, t);

    await sock.sendMessage(jid, {
      text: `🔇 *${targets.length} membro(s) mutados (admins preservados)!*\n_Se falarem, o Tico tentará removê-los em 20s. Para isso, precisa ser administrador do grupo._`,
    }, { quoted: msg });
    return;
  }

  // ── Mute individual ────────────────────────────────────────
  const targetJid = await resolveTargetJid(sock, msg, content, jid);
  if (!targetJid) {
    await sock.sendMessage(jid, {
      text: '⚠️ Marque alguém.\nExemplo: *!mute @fulano* ou *!mute @all*',
    }, { quoted: msg });
    return;
  }

  if (isBotJid(targetJid, botJid)) {
    await sock.sendMessage(jid, { text: '🤖 Não é possível mutar o bot.' }, { quoted: msg });
    return;
  }

  const tag = `@${normalizeJidBase(targetJid)}`;

  if (isMuted(jid, targetJid)) {
    await sock.sendMessage(jid, {
      text: `ℹ️ *${tag}* já está mutado(a).`,
      mentions: [targetJid],
    }, { quoted: msg });
    return;
  }

  muteUser(jid, targetJid);

  await sock.sendMessage(jid, {
    text: `🔇 *${tag}* foi mutado(a)!\n_Se falar, o Tico tentará removê-lo(a) em 20s. Para isso, precisa ser administrador do grupo._`,
    mentions: [targetJid],
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !desmute ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleDesmute(sock, msg, content, jid, botJid, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'desmute')) return;

  const textCmd = (content.conversation || content.extendedTextMessage?.text || '').toLowerCase();
  const isAll   = /@all/.test(textCmd);

  // ── Desmute em massa (@all) ────────────────────────────────
  if (isAll) {
    const count = mutedCount(jid);
    if (count === 0) {
      await sock.sendMessage(jid, {
        text: 'ℹ️ Nenhum membro está mutado neste grupo.',
      }, { quoted: msg });
      return;
    }

    clearMuted(jid);
    await sock.sendMessage(jid, {
      text: `🔊 *${count} membro(s) desmutados!* Podem falar! 🎤`,
    }, { quoted: msg });
    return;
  }

  // ── Desmute individual ─────────────────────────────────────
  const targetJid = await resolveTargetJid(sock, msg, content, jid);
  if (!targetJid) {
    await sock.sendMessage(jid, {
      text: '⚠️ Marque alguém.\nExemplo: *!desmute @fulano* ou *!desmute @all*',
    }, { quoted: msg });
    return;
  }

  const nome = contactNames?.[targetJid] || `@${normalizeJidBase(targetJid)}`;

  if (!unmuteUser(jid, targetJid)) {
    await sock.sendMessage(jid, {
      text: `ℹ️ *${nome}* não está mutado(a) neste grupo.`,
    }, { quoted: msg });
    return;
  }

  if (global._muteTimers) {
    const chaveTimer = `mute:${jid}:${normalizarJid(targetJid)}`;
    const timer = global._muteTimers.get(chaveTimer);
    if (timer) {
      clearTimeout(timer);
      global._muteTimers.delete(chaveTimer);
    }
  }

  await sock.sendMessage(jid, {
    text: `🔊 *${nome}* foi desmutado(a)! Pode falar! 🎤`,
    mentions: [targetJid],
  });
}

// ═══════════════════════════════════════════════════════════════
// ─── !promover / !rebaixar ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handlePromoverRebaixar(sock, msg, content, jid, acao, botJid, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  const comando = acao === 'promote' ? 'promover' : 'rebaixar';
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderAlternateJids = getAlternateSenderJids(msg);
  const isGlobalOwner = await isOwnerIdentity(senderJid, senderAlternateJids);
  if (!await isAdmin(sock, jid, senderJid, senderAlternateJids)) {
    await checkAdmin(sock, msg, jid, comando);
    return;
  }

  // A permissão especial vale apenas para este grupo. O dono do grupo tem
  // autorização automática; um ADM comum sem permissão é rebaixado ao tentar.
  let metaPermissao;
  try {
    metaPermissao = await getGroupMetadataCached(sock, jid, true);
  } catch {
    await sock.sendMessage(jid, {
      text: '❌ Não consegui verificar as permissões do grupo. A ação foi cancelada por segurança.',
    }, { quoted: msg });
    return;
  }
  if (!metaPermissao?.participants) {
    await sock.sendMessage(jid, {
      text: '❌ Não consegui verificar os administradores. A ação foi cancelada por segurança.',
    }, { quoted: msg });
    return;
  }

  const senderBases = new Set([senderJid, ...senderAlternateJids].map(normalizeJidBase).filter(Boolean));
  let senderPart = metaPermissao.participants.find(p => p && (
    senderBases.has(normalizeJidBase(p.id)) || senderBases.has(normalizeJidBase(p.lid))
  ));
  if (!senderPart) {
    const mapping = await LidMapping.findOne({ $or: [{ pn: senderJid }, { lid: senderJid }] }).lean().catch(() => null);
    const alternateJid = mapping
      ? (normalizarJid(mapping.pn) === normalizarJid(senderJid) ? mapping.lid : mapping.pn)
      : null;
    if (alternateJid) {
      const alternateBase = normalizeJidBase(alternateJid);
      senderPart = metaPermissao.participants.find(p => p && (
        normalizeJidBase(p.id) === alternateBase || normalizeJidBase(p.lid) === alternateBase
      ));
    }
  }
  if (!senderPart?.admin && !isGlobalOwner) {
    await sock.sendMessage(jid, {
      text: '❌ Não consegui confirmar que você é administrador deste grupo. A ação foi cancelada.',
    }, { quoted: msg });
    return;
  }

  if (senderPart?.admin === 'admin' && !isGlobalOwner) {
    const cfgPermissao = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    const basesSender = new Set([senderJid, senderPart.id, senderPart.lid]
      .filter(Boolean).map(normalizeJidBase));
    const autorizado = (Array.isArray(cfgPermissao?.admsPermissao) ? cfgPermissao.admsPermissao : [])
      .some(id => basesSender.has(normalizeJidBase(id)));

    if (!autorizado) {
      let rebaixado = false;
      try {
        await sock.groupParticipantsUpdate(jid, [senderPart.id || senderJid], 'demote');
        rebaixado = true;
      } catch (err) {
        console.error('[handlePromoverRebaixar] Falha ao rebaixar ADM sem permissão:', err.message);
      }
      await sock.sendMessage(jid, {
        text: rebaixado
          ? `🚫 *@${normalizeJidBase(senderPart.id || senderJid)}* tentou usar !${comando} sem permissão especial e foi rebaixado automaticamente.`
          : `🚫 *@${normalizeJidBase(senderPart.id || senderJid)}* não tem permissão especial para !${comando}. Não consegui rebaixá-lo. O *Tico Bot precisa ser administrador do grupo* para rebaixar participantes.`,
        mentions: [senderPart.id || senderJid],
      }, { quoted: msg });
      return;
    }
  }

  const textMsg   = content.conversation || content.extendedTextMessage?.text || '';
  const isAll     = /@all\b/i.test(textMsg);
  if (isAll) {
    let meta;
    try {
      meta = await getGroupMetadataCached(sock, jid);
    } catch (err) {
      console.error('[handlePromoverRebaixar @all] Erro:', err.message);
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg }); return;
    }

    if (!meta?.participants) {
      await sock.sendMessage(jid, { text: '❌ Não consegui buscar membros.' }, { quoted: msg }); return;
    }

    const alvos = acao === 'promote'
      ? meta.participants
          .filter(p => p && !p.admin && !isBotJid(p.id, botJid))
          .map(p => p.id)
      : meta.participants
          .filter(p =>
            p &&
            p.admin &&
            !isBotJid(p.id, botJid) &&
            !senderBases.has(normalizeJidBase(p.id)) &&
            !senderBases.has(normalizeJidBase(p.lid))
          )
          .map(p => p.id);

    if (alvos.length === 0) {
      await sock.sendMessage(jid, {
        text: '⚠️ Nenhum membro disponível para esta ação.',
      }, { quoted: msg }); return;
    }

    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

    let ok = 0, fail = 0;
    for (let i = 0; i < alvos.length; i += 5) {
      const chunk = alvos.slice(i, i + 5);
      try {
        await sock.groupParticipantsUpdate(jid, chunk, acao);
        ok += chunk.length;
      } catch { fail += chunk.length; }
      if (i + 5 < alvos.length) await new Promise(r => setTimeout(r, 800));
    }

    const emoji = acao === 'promote' ? '⬆️' : '⬇️';
    await sock.sendMessage(jid, {
      text:
        `${emoji} *@all ${acao === 'promote' ? 'promovidos' : 'rebaixados'}!*\n` +
        `✔️ *${ok}*${fail > 0 ? `\n❌ Falhas: *${fail}*\n⚠️ Confira se o *Tico Bot é administrador* do grupo e pode promover/rebaixar participantes.` : ''}`,
    }, { quoted: msg });
    return;
  }

  // ── Ação individual ────────────────────────────────────────
  const targetJid = await resolveTargetJid(sock, msg, content, jid);
  if (!targetJid) {
    await sock.sendMessage(jid, { text: '⚠️ Marque alguém ou use @all.' }, { quoted: msg }); return;
  }

  if (isBotJid(targetJid, botJid)) {
    await sock.sendMessage(jid, {
      text: acao === 'promote'
        ? '🤖 O bot já cuida de si mesmo, obrigado!'
        : '🤖 Não é possível rebaixar o bot.',
    }, { quoted: msg }); return;
  }

  if (acao === 'demote' && senderBases.has(normalizeJidBase(targetJid))) {
    await sock.sendMessage(jid, { text: '🤡 Você não pode se rebaixar.' }, { quoted: msg }); return;
  }

  try {
    await sock.groupParticipantsUpdate(jid, [targetJid], acao);
    const targetBase = normalizeJidBase(targetJid);
    await sock.sendMessage(jid, {
      text: acao === 'promote'
        ? `⬆️ *@${targetBase}* foi promovido(a) a admin! 👑`
        : `⬇️ *@${targetBase}* perdeu o admin! 📉`,
      mentions: [targetJid],
    }, { quoted: msg });
  } catch (err) {
    console.error('[handlePromoverRebaixar] Erro:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui concluir a ação. O *Tico Bot precisa ser administrador do grupo* para promover ou rebaixar participantes.' }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !reportar ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleReportar(sock, msg, content, jid, contactNames, botJid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'reportar')) return;

  const reportedJidRaw = await resolveTargetJid(sock, msg, content, jid);

  if (!reportedJidRaw) {
    await sock.sendMessage(jid, {
      text: '⚠️ Responda a uma mensagem ou mencione um usuário com *!reportar @pessoa* para adverti-lo.',
    }, { quoted: msg }); return;
  }

  const { resolvedJid, userData } = await resolveUsuarioInfo(reportedJidRaw, sock);
  const reportedJid = userData?.idWhatsApp || resolvedJid || reportedJidRaw;
  const reportedBase = normalizeJidBase(reportedJid);

  const senderJid  = normalizarJid(msg.key.participant || msg.key.remoteJid);
  if (reportedBase === normalizeJidBase(senderJid)) {
    await sock.sendMessage(jid, { text: '🤡 Você não pode se reportar.' }, { quoted: msg }); return;
  }

  if (isBotJid(reportedJid, botJid)) {
    await sock.sendMessage(jid, { text: '🤖 Não é possível reportar o bot.' }, { quoted: msg }); return;
  }

  // ─── Incrementa advertência no MongoDB ───────────────────────
  const groupKey = jid.replace(/\./g, '_');

  const usuario = await Usuario.findOneAndUpdate(
    { idWhatsApp: reportedJid },
    { $inc: { [`warnings.${groupKey}`]: 1 } },
    { upsert: true, new: true },
  );

  const current = usuario?.warnings?.get?.(groupKey) ?? usuario?.warnings?.[groupKey] ?? 0;
  const nome    = contactNames?.[reportedJid] || `@${reportedBase}`;

  if (current >= 3) {
    try {
      await sock.groupParticipantsUpdate(jid, [reportedJid], 'remove');

      await Usuario.updateOne(
        { idWhatsApp: reportedJid },
        { $unset: { [`warnings.${groupKey}`]: '' } },
      );

      await sock.sendMessage(jid, {
        text: `🚫 *${nome}* foi removido(a)!\n\n_Motivo: 3 advertências acumuladas. Mereceu!_ 👋`,
        mentions: [reportedJid],
      });
    } catch (err) {
      console.error('[handleReportar] Erro ao remover:', err.message);
      await sock.sendMessage(jid, {
        text: `⚠️ *${nome}* chegou a 3 advertências, mas não consegui removê-lo(a).\n_O Tico Bot precisa ser administrador do grupo para remover participantes._`,
        mentions: [reportedJid],
      }, { quoted: msg });
    }
  } else {
    const remaining  = 3 - current;
    const nivelEmoji = current === 1 ? '🟡' : '🟠';
    const nivelLabel = current === 1 ? 'PRIMEIRA' : 'SEGUNDA';
    await sock.sendMessage(jid, {
      text:
        `⚠️ *ADVERTÊNCIA ${nivelLabel}* ⚠️\n\n` +
        `👤 Usuário: *@${reportedBase}*\n` +
        `${nivelEmoji} Advertências: *${current}/3*\n` +
        `⏳ Mais *${remaining}* para ser removido!\n\n` +
        `_Respeite as regras do grupo!_ 📜`,
      mentions: [reportedJid],
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !removerreporte ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleRemoverReporte(sock, msg, content, jid, contactNames, botJid) {
  if (!somenteGrupo(jid)) {
    return sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg });
  }

  if (!await checkAdmin(sock, msg, jid, 'removerreporte')) return;

  const senderJid  = normalizarJid(msg.key.participant || msg.key.remoteJid);
  const senderBase = normalizeJidBase(senderJid);

  const targetJidRaw = await resolveTargetJid(sock, msg, content, jid);

  if (!targetJidRaw) {
    return sock.sendMessage(jid, {
      text:
        '⚠️ Informe quem terá a advertência removida.\n' +
        '_Responda a uma mensagem ou mencione o usuário: *!removerreporte @pessoa*_',
    }, { quoted: msg });
  }

  const { resolvedJid, userData } = await resolveUsuarioInfo(targetJidRaw, sock);
  const targetJid  = userData?.idWhatsApp || resolvedJid || targetJidRaw;
  const targetBase = normalizeJidBase(targetJid);

  if (targetBase === senderBase) {
    return sock.sendMessage(jid, {
      text: '🤡 Você não pode remover sua própria advertência. Peça a outro admin.',
    }, { quoted: msg });
  }

  if (isBotJid(targetJid, botJid)) {
    return sock.sendMessage(jid, {
      text: '🤖 O bot não possui advertências.',
    }, { quoted: msg });
  }

  const groupKey = jid.replace(/\./g, '_');
  const nome     = contactNames?.[targetJid] || `@${targetBase}`;

  const atual = Number(userData?.warnings?.[groupKey] ?? 0);

  if (!userData || atual <= 0) {
    return sock.sendMessage(jid, {
      text: `✅ *${nome}* não possui advertências neste grupo.`,
      mentions: [targetJid],
    }, { quoted: msg });
  }

  const novoValor = atual - 1;

  if (novoValor === 0) {
    await Usuario.updateOne(
      { idWhatsApp: targetJid },
      { $unset: { [`warnings.${groupKey}`]: '' } },
    );
  } else {
    await Usuario.updateOne(
      { idWhatsApp: targetJid },
      { $set: { [`warnings.${groupKey}`]: novoValor } },
    );
  }

  const nivelEmoji  = novoValor === 0 ? '🟢' : novoValor === 1 ? '🟡' : '🟠';
  const textoStatus = novoValor === 0
    ? `🎉 *${nome}* está limpo(a)! Sem advertências neste grupo.`
    : `${nivelEmoji} *${nome}* agora tem *${novoValor}/3* advertência(s).`;

  await sock.sendMessage(jid, {
    text:
      `✅ *ADVERTÊNCIA REMOVIDA*\n\n` +
      `👤 Usuário: *@${targetBase}*\n` +
      `📉 Era: *${atual}/3* → Agora: *${novoValor}/3*\n\n` +
      textoStatus,
    mentions: [targetJid],
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !apagarmsg ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleApagarMsg(sock, msg, content, jid) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'apagarmsg')) return;

  const contextInfo = content?.extendedTextMessage?.contextInfo
                   || msg?.message?.extendedTextMessage?.contextInfo;

  const quotedKey  = contextInfo?.stanzaId;
  const quotedUser = contextInfo?.participant;

  if (!quotedKey) {
    await sock.sendMessage(jid, {
      text: '⚠️ Responda a uma mensagem com *!apagarmsg* para deletá-la.',
    }, { quoted: msg });
    return;
  }

  try {
    await sock.sendMessage(jid, {
      delete: {
        remoteJid:   jid,
        fromMe:      false,
        id:          quotedKey,
        participant: quotedUser,
      },
    });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
  } catch (err) {
    console.error('[handleApagarMsg] Erro ao apagar mensagem:', err.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui apagar a mensagem. O *Tico Bot precisa ser administrador do grupo* para apagar mensagens de outros participantes.',
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !limparwarns / !clearwarns (NOVA FUNÇÃO) ──────────────────
// ═══════════════════════════════════════════════════════════════

async function handleLimparWarns(sock, msg, content, jid, botJid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'limparwarns')) return;

  const groupKey = jid.replace(/\./g, '_');
  const textCmd  = (content?.conversation || content?.extendedTextMessage?.text || '').toLowerCase();

  if (/@all\b/i.test(textCmd)) {
    await Usuario.updateMany(
      { [`warnings.${groupKey}`]: { $exists: true } },
      { $unset: { [`warnings.${groupKey}`]: '' } }
    );
    await sock.sendMessage(jid, {
      text: '🧹✅ *Todas as advertências deste grupo foram zeradas!*',
    }, { quoted: msg });
    return;
  }

  const targetJidRaw = await resolveTargetJid(sock, msg, content, jid);
  if (!targetJidRaw) {
    await sock.sendMessage(jid, {
      text: '⚠️ Marque alguém ou use *@all*.\nExemplo: *!limparwarns @fulano* ou *!limparwarns @all*',
    }, { quoted: msg });
    return;
  }

  const { resolvedJid, userData } = await resolveUsuarioInfo(targetJidRaw, sock);
  const targetJid  = userData?.idWhatsApp || resolvedJid || targetJidRaw;
  const targetBase = normalizeJidBase(targetJid);

  await Usuario.updateOne(
    { idWhatsApp: targetJid },
    { $unset: { [`warnings.${groupKey}`]: '' } }
  );

  await sock.sendMessage(jid, {
    text: `🧹✅ Advertências de *@${targetBase}* foram totalmente zeradas!`,
    mentions: [targetJid],
  }, { quoted: msg });
}

module.exports = {
  handleBan,
  handleMute,
  handleDesmute,
  handlePromoverRebaixar,
  handleReportar,
  handleRemoverReporte,
  handleApagarMsg,
  handleLimparWarns,
};
