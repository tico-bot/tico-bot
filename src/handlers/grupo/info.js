'use strict';

const Usuario      = require('../../models/Usuario');
const GrupoConfig  = require('../../models/GrupoConfig');
const { normalizarJid } = require('../../utils/jid');

const {
  somenteGrupo,
  checkAdmin,
  getGroupMetadataCached,
  getGroupOwner,
  normalizeJidBase,
  isMuted,
  mutedCount,
} = require('./helpers');

// Cooldown para o comando !adms (evita spam de notificações para admins)
if (!global._admsCooldownMap) global._admsCooldownMap = new Map();
const COOLDOWN_ADMS_MS = 3 * 60 * 1000; // 3 minutos

// ═══════════════════════════════════════════════════════════════
// ─── !grupinfo ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleGrupInfo(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch (err) {
    console.error('[handleGrupInfo] Erro:', err.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui buscar as informações do grupo.',
    }, { quoted: msg }); return;
  }

  if (!meta?.participants) {
    await sock.sendMessage(jid, { text: '❌ Não consegui obter metadados do grupo.' }, { quoted: msg });
    return;
  }

  const total   = meta.participants.length;
  const admins  = meta.participants.filter(p => p.admin).length;
  const membros = total - admins;
  const criado  = meta.creation
    ? new Date(meta.creation * 1000).toLocaleDateString('pt-BR')
    : '?';

  // WhatsApp aceita textos de até ~65.000 caracteres; 200 era um limite
  // arbitrário demais e cortava a descrição sem avisar. Agora só corta
  // se for realmente enorme, e avisa quando corta.
  const DESC_MAX  = 1024;
  const descBruta = meta.desc || '';
  const desc = descBruta
    ? (descBruta.length > DESC_MAX
        ? `${descBruta.slice(0, DESC_MAX)}…\n\n_(descrição truncada — está muito longa)_`
        : descBruta)
    : '_Sem descrição_';

  const fechado = meta.announce ? '🔒 Fechado' : '🔓 Aberto';

  const ownerJid = await getGroupOwner(sock, jid);
  const ownerStr = ownerJid ? `@${normalizeJidBase(ownerJid)}` : 'Desconhecido';

  const cfgGrupo = await GrupoConfig.findOne({ idGrupo: jid }).lean();

  const slowCfg  = cfgGrupo?.slowModeAtivo
    ? `✅ *${cfgGrupo.slowModeSegundos}s por msg*`
    : '❌ Inativo';
  const floodCfg = cfgGrupo?.antiFloodAtivo
    ? `✅ *${cfgGrupo.antiFloodLimite} msgs/${cfgGrupo.antiFloodJanelaMs / 1000}s*`
    : '❌ Inativo';
  const bvCfg    = cfgGrupo?.bemVindoAtivo
    ? '✅ Ativo'
    : '❌ Inativo';
  const antiLinkCfg = cfgGrupo?.antiLink ? '✅ Ativo' : '❌ Inativo';

  const muteCfg  = mutedCount(jid) > 0
    ? `✅ *${mutedCount(jid)} mutado(s)*`
    : '❌ Nenhum';

  const mentions = ownerJid ? [ownerJid] : [];

  await sock.sendMessage(jid, {
    text:
      `📋 *INFORMAÇÕES DO GRUPO*\n\n` +
      `📌 *Nome:* ${meta.subject}\n` +
      `👑 *Criador:* ${ownerStr}\n` +
      `📅 *Criado em:* ${criado}\n` +
      `🔑 *Status:* ${fechado}\n\n` +
      `👥 *Membros:* ${membros}\n` +
      `🛡️ *Admins:* ${admins}\n` +
      `📊 *Total:* ${total}\n\n` +
      `🔗 *Anti-Link:* ${antiLinkCfg}\n` +
      `⏱️ *Slow Mode:* ${slowCfg}\n` +
      `🛡️ *Anti-Flood:* ${floodCfg}\n` +
      `🔇 *Mutados:* ${muteCfg}\n` +
      `👋 *Boas-vindas:* ${bvCfg}\n\n` +
      `📝 *Descrição:*\n${desc}`,
    mentions,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !listaadm ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleListaAdm(sock, msg, jid, contactNames) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch (err) {
    console.error('[handleListaAdm] Erro ao buscar metadados:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui buscar os membros do grupo.' }, { quoted: msg });
    return;
  }

  const admins = meta?.participants?.filter(p => p.admin) || [];

  if (admins.length === 0) {
    await sock.sendMessage(jid, { text: 'ℹ️ Nenhum administrador encontrado neste grupo.' }, { quoted: msg });
    return;
  }

  const mentions = admins.map(p => p.id);

  const linhas = admins.map((p, i) => {
    const numero = normalizeJidBase(p.id);
    const nome   = contactNames?.[p.id] || `@${numero}`;
    const tipo   = p.admin === 'superadmin' ? '👑 Dono' : '🛡️ Admin';
    return `${i + 1}. ${nome} — ${tipo}`;
  }).join('\n');

  await sock.sendMessage(jid, {
    text: `👑 *ADMINISTRADORES DO GRUPO*\n\n${linhas}\n\n_Total: ${admins.length} admin(s)_`,
    mentions,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !listamembros ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleListaMembros(sock, msg, jid, contactNames) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }

  if (!await checkAdmin(sock, msg, jid, 'listamembros')) return;

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch (err) {
    console.error('[handleListaMembros] Erro ao buscar metadados:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui buscar os membros do grupo.' }, { quoted: msg });
    return;
  }

  const todos   = meta?.participants || [];
  const membros = todos.filter(p => !p.admin);
  const total   = todos.length;

  if (membros.length === 0) {
    await sock.sendMessage(jid, {
      text: 'ℹ️ Nenhum membro não-admin encontrado neste grupo.',
    }, { quoted: msg });
    return;
  }

  const MAX = 30;
  const chunks = [];
  for (let i = 0; i < membros.length; i += MAX) {
    chunks.push(membros.slice(i, i + MAX));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk    = chunks[ci];
    const mentions = chunk.map(p => p.id);

    const linhas = chunk.map((p, i) => {
      const numero = normalizeJidBase(p.id);
      const nome   = contactNames?.[p.id] || `@${numero}`;
      const mutado = isMuted(jid, p.id) ? ' 🔇' : '';
      const inicio = ci * MAX + i + 1;
      return `${inicio}. ${nome} (+${numero})${mutado}`;
    }).join('\n');

    const de  = ci * MAX + 1;
    const ate = Math.min((ci + 1) * MAX, membros.length);

    await sock.sendMessage(jid, {
      text: `👥 *MEMBROS DO GRUPO* (${de}–${ate} de ${total})\n\n${linhas}`,
      mentions,
    }, { quoted: msg });

    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !tempo ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleTempo(sock, msg, content, jid, author, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }

  const mentionedJid = content?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const senderJid    = msg.key.participant || msg.key.remoteJid;
  const alvoJid      = mentionedJid[0] || senderJid;
  const alvoBase     = normalizeJidBase(alvoJid);

  let entradaTexto = '❓ desconhecido';
  let isFallback   = false;

  try {
    const meta = await getGroupMetadataCached(sock, jid);
    const part = meta?.participants?.find(p => {
      if (!p) return false;
      return normalizeJidBase(p.id) === alvoBase || (p.lid && normalizeJidBase(p.lid) === alvoBase);
    });

    const entradaMs = part?.joinedAt
      ? part.joinedAt * 1000
      : (() => { isFallback = true; return (meta?.creation || 0) * 1000; })();

    const diffMs = Date.now() - entradaMs;
    const dias   = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const meses  = Math.floor(dias / 30);
    const anos   = Math.floor(dias / 365);

    if (anos > 0)       entradaTexto = `há *${anos} ano${anos > 1 ? 's' : ''}*`;
    else if (meses > 0) entradaTexto = `há *${meses} ${meses > 1 ? 'meses' : 'mês'}*`;
    else if (dias > 0)  entradaTexto = `há *${dias} dia${dias > 1 ? 's' : ''}*`;
    else                entradaTexto = `há *menos de 1 dia*`;

    if (isFallback) entradaTexto += ' _(estimativa — desde a criação do grupo)_';
  } catch (err) {
    console.error('[handleTempo] Erro:', err.message);
  }

  const frases = [
    `⏳ *@${alvoBase}* está nesse grupo ${entradaTexto}. Veterano(a) resistente! 🏅`,
    `📅 *@${alvoBase}* aguentou esse grupo ${entradaTexto}. Tem moral! 💪`,
    `🕰️ *@${alvoBase}* sobrevive aqui ${entradaTexto}. Corajoso(a)! 😂`,
    `📌 *@${alvoBase}* faz parte desse grupo ${entradaTexto}. Fidelidade máxima! 🤝`,
  ];

  await sock.sendMessage(jid, {
    text: frases[Math.floor(Math.random() * frases.length)],
    mentions: [alvoJid],
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !adv / !advertencia ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAdvertencia(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    return sock.sendMessage(
      jid,
      { text: '⚠️ Esse comando só funciona em grupos.' },
      { quoted: msg }
    );
  }

  const senderJidRaw = msg.key.participant || msg.key.remoteJid;
  const senderJid    = senderJidRaw ? normalizarJid(senderJidRaw) : null;
  if (!senderJid) return;

  const groupKey = jid.replace(/\./g, '_');

  let usuario;
  try {
    usuario = await Usuario.findOne(
      { idWhatsApp: senderJid },
      { warnings: 1 }
    ).lean();
  } catch (err) {
    console.error('[handleAdvertencia] Erro ao buscar usuário:', err.message);
    return sock.sendMessage(
      jid,
      { text: '❌ Erro ao consultar suas advertências. Tente novamente.' },
      { quoted: msg }
    );
  }

  const atual = Math.max(0, Number(usuario?.warnings?.[groupKey] ?? 0));

  if (atual === 0) {
    return sock.sendMessage(
      jid,
      { text: '✅ Você está limpo(a)! Sem advertências neste grupo.' },
      { quoted: msg }
    );
  }

  const nivelEmoji = atual >= 3 ? '🔴' : atual === 2 ? '🟠' : '🟡';
  const restantes  = Math.max(0, 3 - atual);
  const statusMsg  = restantes === 0
    ? '🚨 *Você está no limite!* Qualquer nova advertência pode resultar em remoção.'
    : `⏳ Mais *${restantes}* e você será removido(a)!`;

  return sock.sendMessage(
    jid,
    {
      text:
        `${nivelEmoji} *SUAS ADVERTÊNCIAS NESTE GRUPO*\n\n` +
        `⚠️ Você tem *${atual}/3* advertência(s).\n` +
        `${statusMsg}\n\n` +
        `_Respeite as regras do grupo!_ 📜`,
    },
    { quoted: msg }
  );
}

// ═══════════════════════════════════════════════════════════════
// ─── !ranking (mensagens) ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function barraProgresso(valor, maximo, tamanho = 10) {
  if (!maximo || maximo <= 0) return '░'.repeat(tamanho);
  const filled = Math.min(Math.round((valor / maximo) * tamanho), tamanho);
  return '█'.repeat(filled) + '░'.repeat(tamanho - filled);
}

async function handleRanking(sock, msg, jid, msgCount = new Map(), contactNames = {}) {
  if (!jid?.endsWith('@g.us')) {
    await sock.sendMessage(jid, {
      text: '⚠️ Este comando só pode ser usado em grupos.',
    }, { quoted: msg });
    return;
  }

  try {
    const entradas = [...msgCount.entries()]
      .filter(([id]) => id.endsWith('@s.whatsapp.net') || id.endsWith('@c.us') || id.endsWith('@lid'))
      .map(([id, data]) => ({
        idWhatsApp: id,
        count: typeof data === 'object' ? (data.count ?? 0) : (data ?? 0),
      }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    if (!entradas.length) {
      await sock.sendMessage(jid, {
        text:
          `📊 *RANKING GERAL DE MENSAGENS*\n\n` +
          `📭 Nenhuma mensagem registrada ainda!\n\n` +
          `_Comece a conversar para aparecer no ranking!_`,
      }, { quoted: msg });
      return;
    }

    const totalMsgs = entradas.reduce((s, e) => s + e.count, 0);
    const maxCount  = entradas[0].count || 1;

    const linhas = entradas.map((e, i) => {
      const numero = normalizeJidBase(e.idWhatsApp);
      const nome   = contactNames?.[e.idWhatsApp] || `@${numero}`;
      const pct    = ((e.count / totalMsgs) * 100).toFixed(1);
      const bar    = barraProgresso(e.count, maxCount);
      return `${MEDALS[i]} *${nome}*\n   ${bar} ${e.count} msgs (${pct}%)`;
    });

    const mentions = entradas.map(e => e.idWhatsApp);

    await sock.sendMessage(jid, {
      text:
        `📊 *RANKING GERAL DE MENSAGENS* 📊\n\n` +
        `${linhas.join('\n\n')}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💬 Total: *${totalMsgs}* mensagens\n` +
        `👥 Participantes no ranking: *${entradas.length}*\n` +
        `_Continue conversando para subir no ranking!_`,
      mentions,
    }, { quoted: msg });

  } catch (e) {
    console.error('[Grupo] handleRanking:', e.message);
    await sock.sendMessage(jid, {
      text: '⚠️ Erro ao carregar o ranking. Tente novamente!',
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !linkgrupo ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleLinkGrupo(sock, msg, jid) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'linkgrupo')) return;

  try {
    const code = await sock.groupInviteCode(jid);
    await sock.sendMessage(jid, {
      text:
        `🔗 *Link de convite do grupo:*\n\n` +
        `https://chat.whatsapp.com/${code}\n\n` +
        `⚠️ _Compartilhe com cuidado! Qualquer pessoa com este link pode entrar no grupo._`,
    }, { quoted: msg });
  } catch (err) {
    console.error('[handleLinkGrupo] Erro ao obter link:', err.message);
    await sock.sendMessage(jid, {
      text: '❌ Não consegui obter o link do grupo. Verifique se o bot é administrador.',
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── !regras / !setregras (NOVAS FUNÇÕES) ───────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleRegras(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }

  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();
  let regrasTexto = cfg?.regras;

  if (!regrasTexto) {
    try {
      const meta = await getGroupMetadataCached(sock, jid);
      regrasTexto = meta?.desc || 'ℹ️ Nenhuma regra personalizada definida para este grupo.';
    } catch {
      regrasTexto = 'ℹ️ Nenhuma regra definida.';
    }
  }

  await sock.sendMessage(jid, {
    text:
      `📜 ═══ *REGRAS DO GRUPO* ═══ 📜\n\n` +
      `${regrasTexto}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💡 _Admins podem alterar as regras usando *!setregras [texto]*_`,
  }, { quoted: msg });
}

async function handleSetRegras(sock, msg, jid, caption) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'setregras')) return;

  const novoTexto = caption.replace(/^[!.,\/#]setregras\s*/i, '').trim();

  if (!novoTexto) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *Digite as regras do grupo!*\n\n` +
        `📌 Exemplos:\n` +
        `• *!setregras 1. Proibido travar\n2. Respeite todos os membros*\n` +
        `• *!setregras reset* → voltar para a descrição do grupo`,
    }, { quoted: msg });
    return;
  }

  if (novoTexto.toLowerCase() === 'reset' || novoTexto.toLowerCase() === 'off') {
    await GrupoConfig.findOneAndUpdate(
      { idGrupo: jid },
      { $set: { regras: null } },
      { upsert: true }
    );
    await sock.sendMessage(jid, {
      text: '📜✅ *Regras redefinidas!* O grupo voltará a exibir a descrição original do WhatsApp.',
    }, { quoted: msg });
    return;
  }

  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { regras: novoTexto } },
    { upsert: true }
  );

  await sock.sendMessage(jid, {
    text: `📜✅ *Regras atualizadas com sucesso!*\n\nUse *!regras* para visualizar.`,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !adms / !marcaradms (NOVA FUNÇÃO) ─────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAdms(sock, msg, jid, caption, contactNames) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }

  const agora = Date.now();
  const ultimoUso = global._admsCooldownMap.get(jid) || 0;
  const restante = COOLDOWN_ADMS_MS - (agora - ultimoUso);

  if (restante > 0) {
    const segs = Math.ceil(restante / 1000);
    await sock.sendMessage(jid, {
      text: `⏱️ Aguarde *${segs}s* para chamar os administradores novamente.`,
    }, { quoted: msg });
    return;
  }

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch (err) {
    console.error('[handleAdms] Erro:', err.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao buscar administradores.' }, { quoted: msg });
    return;
  }

  const admins = meta?.participants?.filter(p => p.admin) || [];
  if (!admins.length) {
    await sock.sendMessage(jid, { text: 'ℹ️ Nenhum admin encontrado neste grupo.' }, { quoted: msg });
    return;
  }

  global._admsCooldownMap.set(jid, agora);

  const motivo = caption.replace(/^[!.,\/#](adms|marcaradms|chamaradms)\s*/i, '').trim() || 'Chamada urgente dos membros!';
  const mentions = admins.map(p => p.id);
  const tags = admins.map(p => `@${normalizeJidBase(p.id)}`).join(' ');

  await sock.sendMessage(jid, {
    text:
      `🚨 ═══ *CHAMANDO ADMINISTRADORES* ═══ 🚨\n\n` +
      `📢 *Motivo:* ${motivo}\n\n` +
      `🛡️ ${tags}`,
    mentions,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !statsgrupo / !estatisticas (NOVA FUNÇÃO) ─────────────────
// ═══════════════════════════════════════════════════════════════

async function handleStatsGrupo(sock, msg, jid) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch {
    await sock.sendMessage(jid, { text: '❌ Erro ao obter estatísticas do grupo.' }, { quoted: msg });
    return;
  }

  const total = meta?.participants?.length || 0;
  const admins = meta?.participants?.filter(p => p.admin)?.length || 0;
  const membros = total - admins;
  const mutados = mutedCount(jid);

  const cfg = await GrupoConfig.findOne({ idGrupo: jid }).lean();

  const statusStr = (val) => val ? '✅ Ativo' : '❌ Inativo';

  await sock.sendMessage(jid, {
    text:
      `📊 ═══ *PAINEL DE ESTATÍSTICAS* ═══ 📊\n\n` +
      `📌 *Grupo:* ${meta?.subject || '—'}\n` +
      `👥 *Membros Normais:* ${membros}\n` +
      `🛡️ *Administradores:* ${admins}\n` +
      `🔇 *Membros Mutados:* ${mutados}\n` +
      `📈 *Total Integrantes:* ${total}\n\n` +
      `⚙️ *STATUS DAS CONFIGURAÇÕES:*\n` +
      `• 🤖 Bot no Grupo: ${cfg?.botAtivo !== false ? '✅ Ligado' : '🔕 Desligado'}\n` +
      `• 🔗 Anti-Link: ${statusStr(cfg?.antiLink)}\n` +
      `• 🛡️ Anti-Flood: ${statusStr(cfg?.antiFloodAtivo)}\n` +
      `• ⏱️ Slow Mode: ${statusStr(cfg?.slowModeAtivo)}\n` +
      `• 👋 Boas-Vindas: ${statusStr(cfg?.bemVindoAtivo !== false && cfg?.bemVindoAtivo)}\n` +
      `• 🖼️ Auto-Sticker: ${statusStr(cfg?.autoSticker)}\n` +
      `• 🐾 Spawn de Pets: ${statusStr(cfg?.sistemaPet)}\n` +
      `• 📜 Regras Customizadas: ${cfg?.regras ? '✅ Definidas' : 'ℹ️ Padrão'}`,
  }, { quoted: msg });
}

module.exports = {
  handleGrupInfo,
  handleListaAdm,
  handleListaMembros,
  handleTempo,
  handleAdvertencia,
  handleRanking,
  handleLinkGrupo,
  handleRegras,
  handleSetRegras,
  handleAdms,
  handleStatsGrupo,
};
