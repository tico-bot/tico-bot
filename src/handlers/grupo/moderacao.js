'use strict';

const fs   = require('fs');
const path = require('path');
const Usuario = require('../../models/Usuario');
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
} = require('./helpers');

const BAN_IMAGE_PATH = path.join(__dirname, '..', '..', '..', 'Audio-Image', 'imageban.jpg');
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
  const senderBase = normalizeJidBase(senderJid);
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
        return base !== senderBase && baseLid !== senderBase;
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
        `${fail > 0 ? `\n❌ Falhas: *${fail}*` : ''}\n` +
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

  if (normalizeJidBase(targetJid) === senderBase) {
    await sock.sendMessage(jid, { text: '🤡 Você não pode banir a si mesmo.' }, { quoted: msg });
    return;
  }

  if (isBotJid(targetJid, botJid)) {
    await sock.sendMessage(jid, { text: '🤖 Não é possível banir o bot!' }, { quoted: msg });
    return;
  }

  // Tenta enviar mídias sem deixar falhas de mídia abortarem o banimento
  try {
    if (fs.existsSync(BAN_IMAGE_PATH)) {
      await sock.sendMessage(jid, {
        image:    fs.readFileSync(BAN_IMAGE_PATH),
        caption:  `🔨 @${normalizeJidBase(targetJid)} foi banido(a) do grupo! Tchau! 👋`,
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
      text: '❌ Não consegui remover. O bot é admin?',
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
  const senderBase = normalizeJidBase(senderJid);
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
        return base !== senderBase && baseLid !== senderBase;
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
      text: `🔇 *${targets.length} membro(s) mutados (admins preservados)!*\n_Se falarem serão removidos em 20s._`,
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
    text: `🔇 *${tag}* foi mutado(a)!\n_Se falar será removido(a) em 20s._`,
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
  if (!await checkAdmin(sock, msg, jid, acao === 'promote' ? 'promover' : 'rebaixar')) return;

  const textMsg   = content.conversation || content.extendedTextMessage?.text || '';
  const isAll     = /@all\b/i.test(textMsg);
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderBase = normalizeJidBase(senderJid);

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
            normalizeJidBase(p.id) !== senderBase
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
        `✔️ *${ok}*${fail > 0 ? `\n❌ Falhas: *${fail}*` : ''}`,
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

  if (acao === 'demote' && normalizeJidBase(targetJid) === senderBase) {
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
    await sock.sendMessage(jid, { text: '❌ Não consegui alterar. O bot é admin?' }, { quoted: msg });
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
        text: `⚠️ *${nome}* chegou a 3 advertências mas não consegui remover.\n_O bot é admin?_`,
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
      text: '❌ Não consegui apagar a mensagem. Verifique se o bot é administrador.',
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
