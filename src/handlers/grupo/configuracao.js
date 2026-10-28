'use strict';

const fs   = require('fs');
const path = require('path');
const GrupoConfig = require('../../models/GrupoConfig');

const {
  somenteGrupo,
  checkAdmin,
  isAdmin,
  isBotJid,
  bemVindoGroups,
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════
// ─── !antilink ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAntiLink(sock, msg, content, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Esse comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'antilink')) return;

  const textoComando = (content.conversation || content.extendedTextMessage?.text || '');
  const arg = textoComando.replace(/^[!.,\/#]antilink\s*/i, '').trim().toLowerCase();
  const cfg     = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  const ativo   = cfg?.antiLink === true;

  if (['on', 'ativar', 'ativado'].includes(arg)) {
    if (ativo) {
      await sock.sendMessage(jid, { text: 'O anti-link já tá ativado aqui 😅' }, { quoted: msg });
      return;
    }
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { antiLink: true } },
      { upsert: true }
    );
    await sock.sendMessage(jid, {
      text: '🔗 Anti-link ativado! Quem mandar link leva ban.',
    }, { quoted: msg });

  } else if (['off', 'desativar', 'desativado'].includes(arg)) {
    if (!ativo) {
      await sock.sendMessage(jid, { text: 'O anti-link já tá desativado 😅' }, { quoted: msg });
      return;
    }
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { antiLink: false } },
      { upsert: true }
    );
    await sock.sendMessage(jid, { text: '🔗 Anti-link desativado.' }, { quoted: msg });

  } else {
    await sock.sendMessage(jid, {
      text: `🔗 Anti-link tá ${ativo ? '✅ ativado' : '❌ desativado'} aqui.\n\n_!antilink on para ativar_\n_!antilink off para desativar_`,
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !autosticker ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAutoSticker(sock, msg, content, jid, autoStickerGroups, saveData) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'autosticker')) return;

  const textoComando = content.conversation || content.extendedTextMessage?.text || '';
  const arg = textoComando.replace(/^[!.,\/#]autosticker\s*/i, '').trim().toLowerCase();

  if (['on', 'ativar', 'ativado'].includes(arg)) {
    autoStickerGroups.add(jid);
    try { saveData?.(); } catch {}
    await sock.sendMessage(jid, {
      text: '🖼️✅ *Auto-Sticker ATIVADO!*\n_Imagens/vídeos viram figurinhas automaticamente._',
    }, { quoted: msg });
  } else if (['off', 'desativar', 'desativado'].includes(arg)) {
    autoStickerGroups.delete(jid);
    try { saveData?.(); } catch {}
    await sock.sendMessage(jid, { text: '🖼️❌ *Auto-Sticker DESATIVADO!*' }, { quoted: msg });
  } else {
    const status = autoStickerGroups.has(jid) ? '✅ *Ativado*' : '❌ *Desativado*';
    await sock.sendMessage(jid, {
      text: `🖼️ *Auto-Sticker* — ${status}\n\n▸ *!autosticker on* → ativar\n▸ *!autosticker off* → desativar`,
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !slowmode ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

if (!global._slowModeLastMsg) global._slowModeLastMsg = new Map();
if (!global._slowModeCache)   global._slowModeCache   = new Map();

function limparSlowModeDoGrupo(jid) {
  const prefixo = `${jid}:`;
  for (const chave of global._slowModeLastMsg.keys()) {
    if (chave.startsWith(prefixo)) global._slowModeLastMsg.delete(chave);
  }
  global._slowModeCache.delete(jid);
}

async function handleSlowMode(sock, msg, jid, caption) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'slowmode')) return;

  const arg = caption.replace(/^[!.,\/#]slowmode\s*/i, '').trim().toLowerCase();

  if (arg === 'off' || arg === '0') {
    const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    if (!cfg?.slowModeAtivo) {
      await sock.sendMessage(jid, { text: '⏱️ O Slow Mode já está desativado.' }, { quoted: msg });
      return;
    }
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { slowModeAtivo: false } },
      { upsert: true }
    );
    limparSlowModeDoGrupo(jid);
    await sock.sendMessage(jid, { text: '⏱️❌ *Slow Mode desativado!*' }, { quoted: msg });
    return;
  }

  if (arg === 'status') {
    const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    if (!cfg?.slowModeAtivo) {
      await sock.sendMessage(jid, { text: 'ℹ️ Slow Mode está *desativado* neste grupo.' }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, {
        text: `ℹ️ Slow Mode está *ativo*!\n_Intervalo: 1 mensagem a cada *${cfg.slowModeSegundos}s* por usuário._`,
      }, { quoted: msg });
    }
    return;
  }

  const seg = parseInt(arg, 10);
  if (isNaN(seg) || seg < 1 || seg > 3600) {
    await sock.sendMessage(jid, {
      text:
        '⚠️ Informe o intervalo em segundos (1–3600).\n\n' +
        '📌 Exemplos:\n' +
        '• *!slowmode 30* → 1 mensagem a cada 30s\n' +
        '• *!slowmode status* → ver status atual\n' +
        '• *!slowmode off* → desativar',
    }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { slowModeAtivo: true, slowModeSegundos: seg } },
    { upsert: true }
  );
  limparSlowModeDoGrupo(jid);
  await sock.sendMessage(jid, {
    text: `⏱️✅ *Slow Mode ativado!*\n_Intervalo: 1 mensagem a cada *${seg}s* por usuário._`,
  }, { quoted: msg });
}

async function verificarSlowMode(jid, userJid) {
  const agora = Date.now();
  let cfgCache = global._slowModeCache.get(jid);

  if (!cfgCache || agora - cfgCache.fetchedAt > 60_000) {
    const doc = await GrupoConfig.findOne({ idGrupo: jid }, { slowModeAtivo: 1, slowModeSegundos: 1 }).lean();
    cfgCache = {
      ativo:     doc?.slowModeAtivo    ?? false,
      segundos:  doc?.slowModeSegundos ?? 30,
      fetchedAt: agora,
    };
    global._slowModeCache.set(jid, cfgCache);
  }

  if (!cfgCache.ativo) return true;

  if (!global._slowModeLastMsg) global._slowModeLastMsg = new Map();
  const chave  = `${jid}:${String(userJid || '').split('@')[0].split(':')[0]}`;
  const ultimo = global._slowModeLastMsg.get(chave) || 0;

  if (agora - ultimo < cfgCache.segundos * 1000) return false;
  global._slowModeLastMsg.set(chave, agora);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// ─── !antiflood ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

if (!global._antiFloodMsgs)        global._antiFloodMsgs        = new Map();
if (!global._antiFloodUltimaLimp)  global._antiFloodUltimaLimp  = new Map();
if (!global._antiFloodCache)       global._antiFloodCache        = new Map();

async function handleAntiFlood(sock, msg, jid, caption) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'antiflood')) return;

  const arg = caption.replace(/^[!.,\/#]antiflood\s*/i, '').trim().toLowerCase();

  if (arg === 'off') {
    const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    if (!cfg?.antiFloodAtivo) {
      await sock.sendMessage(jid, { text: '🛡️ O Anti-Flood já está desativado.' }, { quoted: msg });
      return;
    }
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { antiFloodAtivo: false } },
      { upsert: true }
    );
    global._antiFloodMsgs.delete(jid);
    global._antiFloodCache.delete(jid);
    await sock.sendMessage(jid, { text: '🛡️❌ *Anti-Flood desativado!*' }, { quoted: msg });
    return;
  }

  if (arg === 'status') {
    const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    if (!cfg?.antiFloodAtivo) {
      await sock.sendMessage(jid, { text: 'ℹ️ Anti-Flood está *desativado* neste grupo.' }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, {
        text:
          `ℹ️ Anti-Flood está *ativo*!\n` +
          `_Limite: *${cfg.antiFloodLimite} msgs* a cada *${cfg.antiFloodJanelaMs / 1000}s*._`,
      }, { quoted: msg });
    }
    return;
  }

  const match  = arg.match(/^(\d+)\/(\d+)$/);
  const limite = match ? parseInt(match[1], 10) : NaN;
  const janela = match ? parseInt(match[2], 10) * 1000 : NaN;

  if (!Number.isSafeInteger(limite) || !Number.isSafeInteger(janela) || limite < 2 || limite > 50 || janela < 2000 || janela > 24 * 60 * 60 * 1000) {
    await sock.sendMessage(jid, {
      text:
        '⚠️ Formato: *!antiflood [msgs]/[segundos]*\n\n' +
        '📌 Exemplos:\n' +
        '• *!antiflood 5/10* → max 5 msgs em 10s\n' +
        '• *!antiflood status* → ver status atual\n' +
        '• *!antiflood off* → desativar\n\n' +
        '_Limite: 2–50 msgs | Janela: 2s a 24h_',
    }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { antiFloodAtivo: true, antiFloodLimite: limite, antiFloodJanelaMs: janela } },
    { upsert: true }
  );
  global._antiFloodMsgs.delete(jid);
  global._antiFloodCache.delete(jid);
  await sock.sendMessage(jid, {
    text:
      `🛡️✅ *Anti-Flood ativado!*\n` +
      `_Limite: *${limite} msgs* a cada *${janela / 1000}s*._\n` +
      `_Quem ultrapassar será removido automaticamente!_`,
  }, { quoted: msg });
}

async function verificarAntiFlood(sock, jid, userJid, botJid) {
  if (isBotJid(userJid, botJid)) return false;
  if (await isAdmin(sock, jid, userJid).catch(() => false)) return false;

  const agora = Date.now();
  let cfgCache = global._antiFloodCache.get(jid);

  if (!cfgCache || agora - cfgCache.fetchedAt > 60_000) {
    const doc = await GrupoConfig.findOne(
      { idGrupo: jid },
      { antiFloodAtivo: 1, antiFloodLimite: 1, antiFloodJanelaMs: 1 }
    ).lean();
    cfgCache = {
      ativo:     doc?.antiFloodAtivo    ?? false,
      limite:    doc?.antiFloodLimite   ?? 5,
      janelaMs:  doc?.antiFloodJanelaMs ?? 10000,
      fetchedAt: agora,
    };
    global._antiFloodCache.set(jid, cfgCache);
  }

  if (!cfgCache.ativo) return false;

  const ultimaLimp = global._antiFloodUltimaLimp.get(jid) || 0;
  if (agora - ultimaLimp > 5 * 60 * 1000) {
    const msgsGrupo = global._antiFloodMsgs.get(jid);
    if (msgsGrupo) {
      for (const [uid, timestamps] of msgsGrupo.entries()) {
        const filtrado = timestamps.filter(t => agora - t < cfgCache.janelaMs);
        if (filtrado.length === 0) msgsGrupo.delete(uid);
        else msgsGrupo.set(uid, filtrado);
      }
    }
    global._antiFloodUltimaLimp.set(jid, agora);
  }

  if (!global._antiFloodMsgs.has(jid)) global._antiFloodMsgs.set(jid, new Map());
  const msgsGrupo = global._antiFloodMsgs.get(jid);
  // Usa a identidade base para que sufixos de dispositivo não permitam
  // contornar o limite com outra representação do mesmo JID.
  const userKey = String(userJid || '').split('@')[0].split(':')[0];
  const lista = (msgsGrupo.get(userKey) || []).filter(t => agora - t < cfgCache.janelaMs);
  lista.push(agora);
  msgsGrupo.set(userKey, lista);

  return lista.length > cfgCache.limite;
}

// ═══════════════════════════════════════════════════════════════
// ─── !bemvindo (PERSISTIDO NO MONGODB - GrupoConfig) ──────────
// ═══════════════════════════════════════════════════════════════

const BEMVINDO_MENSAGEM_PADRAO =
  `👋 Bem-vindo(a) ao grupo, {nome}!\n\n` +
  `📌 Para começar, que tal se *apresentar* para a galera?\n\n` +
  `Conta pra gente:\n` +
  `• 👤 *Nome:*\n` +
  `• 🎂 *Idade:*\n` +
  `• 📍 *De onde é:*\n` +
  `• 📷 *Foto do semblante:*\n` +
  `• 🎯 *O que te trouxe aqui:*\n\n` +
  `_Seja bem vindo!! 😄_`;

async function handleBemVindo(sock, msg, jid, caption) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Esse comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'bemvindo')) return;

  const args      = caption.replace(/^[!.,\/#]bemvindo\s*/i, '').trim();
  const argsLower = args.toLowerCase();

  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();

  if (argsLower === 'off' || argsLower === 'desativar') {
    if (!cfg?.bemVindoAtivo) {
      await sock.sendMessage(jid, { text: '😅 Boas-vindas já está desativado.' }, { quoted: msg });
      return;
    }
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { bemVindoAtivo: false } },
      { upsert: true }
    );
    await sock.sendMessage(jid, { text: '👋 Boas-vindas desativado com sucesso.' }, { quoted: msg });
    return;
  }

  if (argsLower === 'status') {
    if (!cfg?.bemVindoAtivo) {
      await sock.sendMessage(jid, {
        text: 'ℹ️ Boas-vindas está *desativado* neste grupo.\n\n_Use *!bemvindo on* para ativar com a mensagem padrão._',
      }, { quoted: msg });
    } else {
      const msgAtual = cfg.bemVindoMensagem || BEMVINDO_MENSAGEM_PADRAO;
      await sock.sendMessage(jid, {
        text: `✅ Boas-vindas está *ativo*!\n\n📝 Mensagem atual:\n\n${msgAtual}`,
      }, { quoted: msg });
    }
    return;
  }

  if (argsLower === 'on' || argsLower === 'ativar' || args === '') {
    const mensagem = cfg?.bemVindoMensagem || BEMVINDO_MENSAGEM_PADRAO;
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { bemVindoAtivo: true, bemVindoMensagem: mensagem } },
      { upsert: true }
    );
    await sock.sendMessage(jid, {
      text:
        `✅ Boas-vindas ativado com sucesso!\n\n${mensagem}\n\n` +
        `_Use *!bemvindo [sua mensagem]* para personalizar._\n` +
        `_Use *{nome}* para mencionar quem entrou._\n` +
        `_Use *!bemvindo off* para desativar._`,
    }, { quoted: msg });
    return;
  }

  // Mensagem personalizada enviada pelo admin
  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { bemVindoAtivo: true, bemVindoMensagem: args } },
    { upsert: true }
  );
  await sock.sendMessage(jid, {
    text:
      `✅ Mensagem de boas-vindas personalizada salva no banco de dados!\n\n${args}\n\n` +
      `_Use *{nome}* para mencionar quem entrou._\n` +
      `_Use *!bemvindo off* para desativar._`,
  }, { quoted: msg });
}

// ─── Chamado pelo bot.js ao detectar novo membro ──────────────
async function processarBemVindo(sock, jid, novoMembro, nomeDisplay) {
  try {
    const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
    if (cfg && cfg.bemVindoAtivo === false) return; // Se desativado explicitamente, ignora

    const mensagemBase = cfg?.bemVindoMensagem || BEMVINDO_MENSAGEM_PADRAO;
    const numero  = novoMembro.split('@')[0].split(':')[0];
    const mencao  = numero ? `@${numero}` : nomeDisplay;
    const mensagem = mensagemBase.replace(/\{nome\}/gi, mencao);

    const audioImageDir = path.join(__dirname, '..', '..', '..', 'Audio-Image');
    const joinImages = ['imagejoin.jpg', 'imagejoin2.jpg', 'imagejoin3.jpg'];
    const joinImageName = joinImages[Math.floor(Math.random() * joinImages.length)];
    const joinImagePath = path.join(audioImageDir, joinImageName);

    if (fs.existsSync(joinImagePath)) {
      try {
        const imageBuf = fs.readFileSync(joinImagePath);
        await sock.sendMessage(jid, {
          image:    imageBuf,
          caption:  mensagem,
          mentions: [novoMembro],
        });
        return;
      } catch (imgErr) {
        console.error('[processarBemVindo] Erro ao ler imagem:', imgErr.message);
      }
    }

    await sock.sendMessage(jid, {
      text:     mensagem,
      mentions: [novoMembro],
    });
  } catch (e) {
    console.error('[processarBemVindo] Erro ao enviar:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !fechar / !abrir ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleFecharAbrir(sock, msg, jid, fechar) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, fechar ? 'fechar' : 'abrir')) return;

  try {
    await sock.groupSettingUpdate(jid, fechar ? 'announcement' : 'not_announcement');
    await sock.sendMessage(jid, {
      text: fechar
        ? '🔒 *Grupo fechado!* Apenas admins podem enviar mensagens.'
        : '🔓 *Grupo aberto!* Todos podem enviar mensagens.',
    }, { quoted: msg });
  } catch (err) {
    console.error('[handleFecharAbrir] Erro:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui alterar. O bot é admin?' }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !bot on/off ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleBotToggle(sock, msg, jid, args, isAdminUser) {
  if (!somenteGrupo(jid)) {
    return sock.sendMessage(jid, { text: '⚠️ Esse comando só funciona em grupos.' }, { quoted: msg });
  }

  if (!isAdminUser) {
    return sock.sendMessage(jid, { text: '❌ Apenas admins podem usar esse comando.' }, { quoted: msg });
  }

  const acao = (args || '').trim().toLowerCase();
  if (!['on', 'off'].includes(acao)) {
    return sock.sendMessage(jid, {
      text:
        '🤖 *Bot on/off*\n\n' +
        '▸ *!bot on* — ligar o bot neste grupo\n' +
        '▸ *!bot off* — desligar o bot neste grupo\n\n' +
        '_Apenas admins podem usar este comando._',
    }, { quoted: msg });
  }

  const ativo    = acao === 'on';
  const cfgAtual = await GrupoConfig.findOne({ idGrupo: jid }).lean();

  const jaAtivo = cfgAtual ? cfgAtual.botAtivo !== false : true;

  if (ativo && jaAtivo) {
    return sock.sendMessage(jid, {
      text: '🤖 O bot já está *ligado* neste grupo!\n_Use *!bot off* para desligar._',
    }, { quoted: msg });
  }

  if (!ativo && !jaAtivo) {
    return sock.sendMessage(jid, {
      text: '🔕 O bot já está *desligado* neste grupo!\n_Use *!bot on* para ligar._',
    }, { quoted: msg });
  }

  try {
    const CarteiraGrupoModel = require('../../models/CarteiraGrupo');
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { idGrupo: jid, botAtivo: ativo } },
      { upsert: true }
    );
    await CarteiraGrupoModel.updateMany(
      { idGrupo: jid },
      { $set: { 'config.botAtivo': ativo, botAtivo: ativo } }
    );
  } catch (err) {
    console.error('[handleBotToggle] Erro ao atualizar GrupoConfig:', err.message);
    return sock.sendMessage(jid, {
      text: '❌ Erro ao salvar configuração. Tente novamente.',
    }, { quoted: msg });
  }

  if (ativo) {
    return sock.sendMessage(jid, {
      text: '✅ *Bot ligado neste grupo!* Estou de volta, pode mandar comandos. 🤖',
    }, { quoted: msg });
  } else {
    return sock.sendMessage(jid, {
      text:
        '🔕 *Bot desligado neste grupo!*\n\n' +
        'Não responderei mais comandos neste grupo.\n' +
        '_Use *!bot on* para reativar._',
    }, { quoted: msg });
  }
}

module.exports = {
  handleAntiLink,
  handleAutoSticker,
  handleSlowMode,
  verificarSlowMode,
  handleAntiFlood,
  verificarAntiFlood,
  handleBemVindo,
  processarBemVindo,
  handleBotToggle,
  handleFecharAbrir,
};
