'use strict';

const { getAggregateVotesInPollMessage } = require('@whiskeysockets/baileys');

const {
  somenteGrupo,
  checkAdmin,
  getGroupMetadataCached,
  normalizeJidBase,
  isBotJid,
} = require('./helpers');

/** @type {Map<string, Array<{ texto: string, data: number }>>} */
const grupoAvisosMap = new Map();

// ═══════════════════════════════════════════════════════════════
// ─── !sorteio ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleSorteio(sock, msg, content, jid, botJid, contactNames) {
  const mentions = content.extendedTextMessage?.contextInfo?.mentionedJid || [];

  const seen = new Set();
  let participantes = mentions.filter(p => {
    const base = normalizeJidBase(p);
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });

  if (participantes.length === 0 && somenteGrupo(jid)) {
    try {
      const meta = await getGroupMetadataCached(sock, jid);
      if (meta?.participants) {
        participantes = meta.participants
          .map(p => p.id)
          .filter(id => !isBotJid(id, botJid));
      }
    } catch (err) {
      console.error('[handleSorteio] Erro ao buscar metadata:', err.message);
    }
  }

  if (participantes.length < 2) {
    await sock.sendMessage(jid, {
      text: '⚠️ Preciso de pelo menos *2 participantes*!\nMarque quem vai concorrer ou use em um grupo com mais gente.',
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, {
    text: `🎰 *SORTEANDO...*\n\nEntre *${participantes.length}* participante(s)...\n\n_Girando a roleta.._ 🌀`,
  }, { quoted: msg });
  await new Promise(r => setTimeout(r, 1500));

  const vencedor = participantes[Math.floor(Math.random() * participantes.length)];
  const nome     = contactNames[vencedor] || `@${normalizeJidBase(vencedor)}`;

  await sock.sendMessage(jid, {
    text:
      `🎉🏆 *RESULTADO DO SORTEIO* 🏆🎉\n\n` +
      `👑 Vencedor: *@${normalizeJidBase(vencedor)}*\n\n` +
      `🎊 Parabéns, *${nome}*! Você foi sorteado(a) entre *${participantes.length}* participante(s)!\n\n` +
      `_Boa sorte foi você que teve!_ 🍀`,
    mentions: [vencedor],
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !enquete ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const MAX_POLL_OPTIONS = 12;

// Map<messageKeyId, { message, question, options, jid, tallies, createdAt }>
const activePolls = new Map();

const POLL_TTL_MS = 24 * 60 * 60 * 1000; // enquetes "expiram" da memória após 24h

function limparPollsAntigos() {
  const agora = Date.now();
  for (const [id, poll] of activePolls.entries()) {
    if (agora - (poll.createdAt || 0) > POLL_TTL_MS) {
      activePolls.delete(id);
    }
  }
}

// Limpeza agendada automática a cada 30 minutos (evita vazamento de memória)
const pollCleanupTimer = setInterval(limparPollsAntigos, 30 * 60 * 1000);
// O temporizador não deve impedir o processo de encerrar em testes ou scripts.
pollCleanupTimer.unref?.();

async function handleEnquete(sock, msg, jid, caption) {
  limparPollsAntigos();

  const texto = String(caption || '').replace(/^[!.,\/#]enquete\s*/i, '').trim();
  if (!texto) {
    await sock.sendMessage(jid, {
      text: '⚠️ Digite a pergunta!\nExemplo: *!enquete Pizza ou hambúrguer?*',
    }, { quoted: msg });
    return;
  }

  const partes = texto.split('|').map(p => p.trim());
  const pergunta = partes.shift() || '';
  let opcoesBrutas = partes.filter(Boolean);

  if (pergunta.length > 255) {
    await sock.sendMessage(jid, { text: '⚠️ A pergunta da enquete deve ter no máximo 255 caracteres.' }, { quoted: msg });
    return;
  }
  if (opcoesBrutas.some(op => op.length > 100)) {
    await sock.sendMessage(jid, { text: '⚠️ Cada opção deve ter no máximo 100 caracteres.' }, { quoted: msg });
    return;
  }

  let isMulti = false;
  if (opcoesBrutas.length && /^multi(pla)?$/i.test(opcoesBrutas[opcoesBrutas.length - 1])) {
    isMulti = true;
    opcoesBrutas = opcoesBrutas.slice(0, -1);
  }

  const avisos = [];
  let opcoesFinais;

  if (opcoesBrutas.length === 0) {
    opcoesFinais = ['Sim', 'Não', 'Talvez'];
  } else {
    if (opcoesBrutas.length === 1) {
      await sock.sendMessage(jid, {
        text: '⚠️ Enquete precisa de pelo menos 2 opções (ou nenhuma, para Sim/Não/Talvez).',
      }, { quoted: msg });
      return;
    }

    const vistos = new Set();
    const semDuplicatas = [];
    const duplicatasRemovidas = [];
    for (const op of opcoesBrutas) {
      const chave = op.toLowerCase();
      if (vistos.has(chave)) {
        duplicatasRemovidas.push(op);
      } else {
        vistos.add(chave);
        semDuplicatas.push(op);
      }
    }
    if (duplicatasRemovidas.length) {
      avisos.push(`🔁 Opções duplicadas removidas: ${duplicatasRemovidas.join(', ')}`);
    }

    if (semDuplicatas.length > MAX_POLL_OPTIONS) {
      avisos.push(
        `✂️ WhatsApp permite no máximo ${MAX_POLL_OPTIONS} opções. ` +
        `Removidas: ${semDuplicatas.slice(MAX_POLL_OPTIONS).join(', ')}`
      );
    }
    opcoesFinais = semDuplicatas.slice(0, MAX_POLL_OPTIONS);

    if (opcoesFinais.length < 2) {
      await sock.sendMessage(jid, {
        text: '⚠️ Depois de remover duplicatas, sobrou menos de 2 opções válidas.',
      }, { quoted: msg });
      return;
    }
  }

  if (avisos.length) {
    await sock.sendMessage(jid, { text: avisos.join('\n') }, { quoted: msg });
  }

  const sent = await sock.sendMessage(jid, {
    poll: {
      name: pergunta,
      values: opcoesFinais,
      selectableCount: isMulti ? opcoesFinais.length : 1,
    },
  }, { quoted: msg });

  activePolls.set(sent.key.id, {
    message: sent,
    question: pergunta,
    options: opcoesFinais,
    jid,
    tallies: new Map(opcoesFinais.map(o => [o, 0])),
    createdAt: Date.now(),
  });
}

// ─── Vote tallying ────────────────────────────────────────────
function registerPollVoteHandler(sock) {
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!update.pollUpdates) continue;

      const poll = activePolls.get(key.id);
      if (!poll) continue;

      try {
        const aggregated = getAggregateVotesInPollMessage({
          message: poll.message,
          pollUpdates: update.pollUpdates,
        });

        for (const result of aggregated) {
          poll.tallies.set(result.name, result.voters.length);
        }
      } catch (err) {
        console.error('[registerPollVoteHandler] Erro ao computar voto de enquete:', err?.message || err);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ─── !todos ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleTodos(sock, msg, jid, caption) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'todos')) return;

  let meta;
  try {
    meta = await getGroupMetadataCached(sock, jid);
  } catch (err) {
    console.error('[handleTodos] Erro:', err.message);
    await sock.sendMessage(jid, { text: '❌ Não consegui buscar os membros.' }, { quoted: msg }); return;
  }

  if (!meta?.participants) {
    await sock.sendMessage(jid, { text: '❌ Não consegui buscar os membros.' }, { quoted: msg }); return;
  }

  const members = meta.participants.map(p => p.id);
  const texto   = caption.replace(/^[!.,\/#]todos\s*/i, '').trim() || '📢 *Atenção galera!*';
  const mencoes = members.map(m => `@${normalizeJidBase(m)}`).join(' ');

  await sock.sendMessage(jid, {
    text: `${texto}\n\n${mencoes}`,
    mentions: members,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !avisar ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleAvisar(sock, msg, jid, caption) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });
    return;
  }
  if (!await checkAdmin(sock, msg, jid, 'avisar')) return;

  const aviso = caption.replace(/^[!.,\/#]*avisar\s*/i, '').trim();
  if (!aviso) {
    await sock.sendMessage(jid, {
      text:
        `⚠️ *Digite o aviso!*\n\n` +
        `Exemplo: *!avisar Reunião hoje às 20h!*`,
    }, { quoted: msg });
    return;
  }

  if (!grupoAvisosMap.has(jid)) grupoAvisosMap.set(jid, []);
  const lista = grupoAvisosMap.get(jid);
  lista.push({ texto: aviso, data: Date.now() });
  if (lista.length > 10) lista.shift();

  let members = [];
  try {
    const meta = await getGroupMetadataCached(sock, jid);
    if (meta?.participants) {
      members = meta.participants.map(p => p.id);
    }
  } catch (err) {
    console.error('[handleAvisar] Erro ao buscar membros:', err.message);
  }

  const agora    = new Date();
  const dataStr  = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const numAviso = lista.length;

  const mencoes = members.map(m => `@${normalizeJidBase(m)}`).join(' ');

  await sock.sendMessage(jid, {
    text:
      `📢 ═══ *AVISO DO GRUPO* ═══ 📢\n\n` +
      `${aviso}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📅 ${dataStr} às ${horaStr}\n` +
      `📋 Aviso nº ${numAviso}\n\n` +
      `${mencoes}`,
    mentions: members,
  }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── !fixargrupo ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleFixarGrupo(sock, msg, content, jid, caption) {
  if (!somenteGrupo(jid)) {
    await sock.sendMessage(jid, { text: '⚠️ Apenas em grupos.' }, { quoted: msg }); return;
  }
  if (!await checkAdmin(sock, msg, jid, 'fixargrupo')) return;

  const args = caption.replace(/^[!.,\/#]fixargrupo\s*/i, '').trim();

  if (args === 'ver') {
    const lista = grupoAvisosMap.get(jid) || [];
    if (lista.length === 0) {
      await sock.sendMessage(jid, { text: 'ℹ️ Nenhum aviso salvo.' }, { quoted: msg }); return;
    }
    const ultimo = lista[lista.length - 1];
    const data   = new Date(ultimo.data).toLocaleString('pt-BR');
    await sock.sendMessage(jid, {
      text: `📌 *AVISO FIXADO*\n\n${ultimo.texto}\n\_Publicado em: ${data}_`,
    }, { quoted: msg });
    return;
  }

  const quotedMsg = content?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quotedMsg) {
    await sock.sendMessage(jid, {
      text:
        '⚠️ Responda uma mensagem com *!fixargrupo* para fixá-la.\n' +
        'Ou use *!fixargrupo ver* para ver o último aviso.',
    }, { quoted: msg }); return;
  }

  const texto =
    quotedMsg.conversation ||
    quotedMsg.extendedTextMessage?.text ||
    quotedMsg.imageMessage?.caption ||
    quotedMsg.videoMessage?.caption ||
    quotedMsg.documentMessage?.caption ||
    '<mídia>';

  if (!grupoAvisosMap.has(jid)) grupoAvisosMap.set(jid, []);
  const lista = grupoAvisosMap.get(jid);
  lista.push({ texto, data: Date.now() });
  if (lista.length > 10) lista.shift();

  await sock.sendMessage(jid, {
    text: `📌 *Aviso fixado com sucesso!*\n\nUse *!fixargrupo ver* para visualizar a qualquer momento.`,
  }, { quoted: msg });
}

module.exports = {
  handleSorteio,
  handleEnquete,
  registerPollVoteHandler,
  activePolls,
  handleTodos,
  handleAvisar,
  handleFixarGrupo,
};
