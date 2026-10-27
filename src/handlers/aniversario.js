/**
 * Handler de Aniversários
 * Comandos: !reganiversario, !excluiraniversario, !meuaniversario,
 *           !listaniversarios, !sistemaniversario, !menuaniversario
 */

const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const Aniversario = require('../models/Aniversario');
const GrupoConfig = require('../models/GrupoConfig');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAnoAtual() {
  return new Date().getFullYear();
}

/**
  * Calcula a idade exata levando em conta o dia e mês de nascimento.
  */
function calcularIdade(dayNum, monthNum, yearNum) {
  const hoje = new Date();
  let idade = hoje.getFullYear() - yearNum;
  const mesAtual = hoje.getMonth() + 1;
  const diaAtual = hoje.getDate();

  if (mesAtual < monthNum || (mesAtual === monthNum && diaAtual < dayNum)) {
    idade--;
  }
  return Math.max(0, idade);
}

function validarData(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = dateStr.trim().match(dateRegex);
  if (!match) return null;

  const [, day, month, year] = match;
  const dayNum   = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum  = parseInt(year, 10);

  const testDate = new Date(yearNum, monthNum - 1, dayNum);
  if (testDate.getDate() !== dayNum || testDate.getMonth() !== monthNum - 1) return null;
  if (yearNum < 1900 || yearNum > getAnoAtual()) return null;

  return { day, month, year, dayNum, monthNum, yearNum };
}

function reply(sock, chatJid, msg, text, extra = {}) {
  return sock.sendMessage(chatJid, { text, ...extra }, { quoted: msg });
}

// ─── !reganiversario ──────────────────────────────────────────────────────────

async function handleRegAniversario(sock, msg, jid, caption, author, senderJid) {
  if (!senderJid) return;
  const senderJidNormalizado = jidNormalizedUser(senderJid);
  const chatJid              = jidNormalizedUser(jid);

  const dateStr = (caption || '').replace(/^[!.,/]reganiversario\s*/i, '').trim();

  if (!dateStr) {
    return reply(sock, chatJid, msg,
      '⚠️ Use: *!reganiversario DD/MM/AAAA*\nExemplo: *!reganiversario 20/01/1997*'
    );
  }

  const parsed = validarData(dateStr);
  if (!parsed) {
    return reply(sock, chatJid, msg,
      `⚠️ Data inválida! Use o formato *DD/MM/AAAA* com um ano entre 1900 e ${getAnoAtual()}.`
    );
  }

  const { day, month, dayNum, monthNum, yearNum } = parsed;

  try {
    await Aniversario.findOneAndUpdate(
      { idWhatsApp: senderJidNormalizado },
      { idWhatsApp: senderJidNormalizado, nome: author || null, date: dateStr },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (e) {
    console.error('⚠️ Erro ao salvar aniversário:', e.message);
    return reply(sock, chatJid, msg, '❌ Erro ao salvar aniversário. Tente novamente!');
  }

  const age       = calcularIdade(dayNum, monthNum, yearNum);
  const tagAuthor = `@${senderJidNormalizado.split('@')[0]}`;

  return reply(sock, chatJid, msg,
    `✅ *Aniversário registrado!*\n\n` +
    `🎂 ${tagAuthor} faz aniversário em *${day}/${month}*\n` +
    `📅 Idade atual: *${age} anos*`,
    { mentions: [senderJidNormalizado] }
  );
}

// ─── !excluiraniversario ──────────────────────────────────────────────────────

async function handleExcluirAniversario(sock, msg, jid, author, senderJid) {
  if (!senderJid) return;
  const senderJidNormalizado = jidNormalizedUser(senderJid);
  const chatJid              = jidNormalizedUser(jid);

  let deletado;
  try {
    deletado = await Aniversario.findOneAndDelete({ idWhatsApp: senderJidNormalizado });
  } catch (e) {
    console.error('⚠️ Erro ao excluir aniversário:', e.message);
    return reply(sock, chatJid, msg, '❌ Erro ao excluir aniversário. Tente novamente!');
  }

  if (!deletado) {
    return reply(sock, chatJid, msg, '⚠️ Você não tem nenhum aniversário registrado.');
  }

  const tagAuthor = `@${senderJidNormalizado.split('@')[0]}`;
  return reply(sock, chatJid, msg,
    `✅ O aniversário de ${tagAuthor} foi removido com sucesso!`,
    { mentions: [senderJidNormalizado] }
  );
}

// ─── !meuaniversario ──────────────────────────────────────────────────────────

async function handleMeuAniversario(sock, msg, jid, author, senderJid) {
  if (!senderJid) return;
  const senderJidNormalizado = jidNormalizedUser(senderJid);
  const chatJid              = jidNormalizedUser(jid);

  let entry;
  try {
    entry = await Aniversario.findOne({ idWhatsApp: senderJidNormalizado }).lean();
  } catch (e) {
    console.error('⚠️ Erro ao buscar aniversário:', e.message);
    return reply(sock, chatJid, msg, '❌ Erro ao buscar seu aniversário. Tente novamente!');
  }

  if (!entry || !entry.date) {
    return reply(sock, chatJid, msg,
      '⚠️ Você não tem aniversário registrado.\nUse: *!reganiversario DD/MM/AAAA*'
    );
  }

  const parsed = validarData(entry.date);
  if (!parsed) {
    return reply(sock, chatJid, msg, '⚠️ Seu aniversário registrado está num formato inválido.');
  }

  const { day, month, year, dayNum, monthNum, yearNum } = parsed;
  const age       = calcularIdade(dayNum, monthNum, yearNum);
  const tagAuthor = `@${senderJidNormalizado.split('@')[0]}`;

  return reply(sock, chatJid, msg,
    `🎂 ${tagAuthor}\n📅 Data: *${day}/${month}/${year}*\n📊 Idade atual: *${age} anos*`,
    { mentions: [senderJidNormalizado] }
  );
}

// ─── !listaniversarios ────────────────────────────────────────────────────────

async function handleListAniversarios(sock, msg, jid) {
  const chatJid = jidNormalizedUser(jid);

  let list;
  try {
    list = await Aniversario.find().lean();
  } catch (e) {
    console.error('⚠️ Erro ao listar aniversários:', e.message);
    return reply(sock, chatJid, msg, '❌ Erro ao carregar lista. Tente novamente!');
  }

  if (chatJid.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(chatJid);
      const membrosSet = new Set(
        meta.participants.flatMap(p => [p.id, p.lid]).filter(Boolean).map(id => id.toLowerCase())
      );
      list = list.filter(entry => entry.idWhatsApp && membrosSet.has(jidNormalizedUser(entry.idWhatsApp).toLowerCase()));
    } catch (e) {
      console.error('⚠️ Erro ao filtrar aniversários por grupo:', e.message);
    }
  }

  if (!list.length) {
    return reply(sock, chatJid, msg, '📋 Nenhum aniversário registrado ainda.');
  }

  // Ordena cronologicamente por Mês e Dia (mais próximo no calendário)
  list.sort((a, b) => {
    const pA = validarData(a.date);
    const pB = validarData(b.date);
    if (!pA) return 1;
    if (!pB) return -1;
    if (pA.monthNum !== pB.monthNum) return pA.monthNum - pB.monthNum;
    return pA.dayNum - pB.dayNum;
  });

  const mentions = [];
  let texto = `📅 *LISTA DE ANIVERSÁRIOS* 📅\n━━━━━━━━━━━━━━━━\n\n`;

  for (const entry of list) {
    const parsed = validarData(entry.date);
    if (!parsed) continue;
    const { day, month, year, dayNum, monthNum, yearNum } = parsed;
    const age      = calcularIdade(dayNum, monthNum, yearNum);
    const jidLimpo = jidNormalizedUser(entry.idWhatsApp);
    mentions.push(jidLimpo);
    texto += `🎂 @${jidLimpo.split('@')[0]} • *${day}/${month}/${year}* (${age} anos)\n`;
  }

  texto += `\n━━━━━━━━━━━━━━━━\n📊 Total: *${mentions.length}* aniversário(s) registrado(s)`;

  return reply(sock, chatJid, msg, texto, { mentions });
}

// ─── !sistemaniversario ───────────────────────────────────────────────────────

async function handleSistemaAniversario(sock, msg, jid, isGroupAdmin) {
  const chatJid = jidNormalizedUser(jid);

  if (!isGroupAdmin) {
    return reply(sock, chatJid, msg, '⚠️ Apenas admins podem usar esse comando.');
  }

  try {
    const config = await GrupoConfig.findOneAndUpdate(
      { idGrupo: chatJid },
      [{ $set: { sistemaAniversario: { $not: '$sistemaAniversario' } } }],
      { new: true, upsert: true }
    );

    const status = config.sistemaAniversario ? '✅ ativado' : '❌ desativado';
    return reply(sock, chatJid, msg, `🔧 Sistema de aniversários ${status} para esse grupo!`);
  } catch (e) {
    console.error('⚠️ Erro ao alterar sistema de aniversário:', e.message);
    return reply(sock, chatJid, msg, '❌ Erro ao alterar configuração. Tente novamente!');
  }
}

// ─── !menuaniversario ─────────────────────────────────────────────────────────

async function handleMenuAniversario(sock, msg, jid, getPrefix) {
  const chatJid = jidNormalizedUser(jid);
  const P       = typeof getPrefix === 'function' ? getPrefix(chatJid) : '!';

  const menu =
`╔══════════════════════╗
    🎂 MENU ANIVERSÁRIOS
╚══════════════════════╝

📝 *REGISTRO*
  ▸ ${P}reganiversario _(DD/MM/AAAA)_
     Exemplo: ${P}reganiversario 20/01/1997
  ▸ ${P}excluiraniversario — Remover

📊 *CONSULTAS*
  ▸ ${P}meuaniversario — Ver sua data
  ▸ ${P}listaniversarios — Listar todos

⚙️ *SISTEMA*
  ▸ ${P}sistemaniversario — Ativar/desativar _(apenas admin)_

🎉 *FUNCIONAMENTO*
  • Bot parabeniza automaticamente
  • Mostra idade e mensagem especial
  • Qualquer membro pode registrar
  • Data entre 1900 e ${getAnoAtual()}

━━━━━━━━━━━━━━━━━━━━━━━━`;

  return reply(sock, chatJid, msg, menu);
}

// ─── Exportar ─────────────────────────────────────────────────────────────────

module.exports = {
  handleRegAniversario,
  handleExcluirAniversario,
  handleMeuAniversario,
  handleListAniversarios,
  handleSistemaAniversario,
  handleMenuAniversario,
};