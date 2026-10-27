'use strict';

const {
  handleBan,
  handleMute,
  handleDesmute,
  handlePromoverRebaixar,
  handleReportar,
  handleRemoverReporte,
  handleApagarMsg,
  handleLimparWarns,
} = require('./moderacao');

const {
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
} = require('./configuracao');

const {
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
} = require('./info');

const {
  handleSorteio,
  handleEnquete,
  registerPollVoteHandler,
  activePolls,
  handleTodos,
  handleAvisar,
  handleFixarGrupo,
} = require('./comunicacao');

const {
  isAdmin,
  getGroupOwner,
  isMuted,
  unmuteUser,
  setBemVindo,
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════
// ─── !menuadm ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

async function handleMenuAdm(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';

  const menu =
`╔══════════════════════╗
    🛡️ MENU ADMINISTRAÇÃO
╚══════════════════════╝

👤 *MEMBROS & ADMINS*
  ▸ ${P}ban @fulano — Banir membro
  ▸ ${P}ban @all — Banir todos não-admins
  ▸ ${P}mute @fulano — Mutar membro
  ▸ ${P}mute @all — Mutar todos
  ▸ ${P}desmute @fulano — Desmutar membro
  ▸ ${P}desmute @all — Desmutar todos
  ▸ ${P}promover @fulano — Tornar admin
  ▸ ${P}rebaixar @fulano — Remover admin
  ▸ ${P}listamembros — Listar membros
  ▸ ${P}listaadm — Listar admins
  ▸ ${P}adms [motivo] — Notificar todos os admins
  ▸ ${P}tempo [@fulano] — Tempo no grupo

📋 *GRUPO & REGRAS*
  ▸ ${P}grupinfo (ou ${P}grupoinfo) — Informações do grupo
  ▸ ${P}statsgrupo — Estatísticas completas
  ▸ ${P}regras — Ver regras do grupo
  ▸ ${P}setregras [texto] — Definir regras do grupo
  ▸ ${P}fechar — Fechar grupo (só admins falam)
  ▸ ${P}abrir — Abrir grupo (todos falam)
  ▸ ${P}linkgrupo — Gerar link de convite
  ▸ ${P}todos [msg] — Mencionar todos
  ▸ ${P}enquete [pergunta|op1|op2] — Criar enquete
  ▸ ${P}sorteio [@membros] — Sortear vencedor

⚙️ *CONFIGURAÇÕES*
  ▸ ${P}bot on/off — Ligar/desligar bot no grupo
  ▸ ${P}antilink on/off — Anti-link
  ▸ ${P}autosticker on/off — Auto-sticker
  ▸ ${P}slowmode [seg] — Slow mode (1–3600s)
  ▸ ${P}antiflood [msgs]/[seg] — Anti-flood
  ▸ ${P}bemvindo on/off/[msg] — Configurar boas-vindas
  ▸ ${P}pet on/off — Spawn de pets selvagens

🔔 *COMUNICAÇÃO & MODERAÇÃO*
  ▸ ${P}avisar [texto] — Avisar e mencionar @todos
  ▸ ${P}fixargrupo — Fixar mensagem (reply)
  ▸ ${P}fixargrupo ver — Ver último aviso fixado
  ▸ ${P}apagarmsg — Apagar mensagem (reply)
  ▸ ${P}reportar — Advertir usuário (reply)
  ▸ ${P}removerreporte — Remover 1 advertência (reply/@)
  ▸ ${P}limparwarns — Zerar todas advertências (@/@all)
  ▸ ${P}adv / ${P}advertencia — Ver suas advertências

📊 *JOGO / ECONOMIA*
  ▸ ${P}rankgold — Ranking de saldo deste grupo

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Moderação de membros
  handleBan,
  handleMute,
  handleDesmute,
  handleReportar,
  handlePromoverRebaixar,
  handleLimparWarns,

  // Informação, estatísticas e listas
  handleRanking,
  handleGrupInfo,
  handleListaAdm,
  handleListaMembros,
  handleTempo,
  handleRegras,
  handleSetRegras,
  handleAdms,
  handleStatsGrupo,

  // Interação com o grupo
  handleSorteio,
  handleEnquete,
  registerPollVoteHandler,
  activePolls,
  handleTodos,
  handleFecharAbrir,
  handleLinkGrupo,
  handleApagarMsg,

  // Configurações
  handleAntiLink,
  handleAutoSticker,
  handleSlowMode,
  handleAntiFlood,
  handleBemVindo,

  // Comunicação
  handleAvisar,
  handleFixarGrupo,
  handleMenuAdm,

  // Helpers para bot.js e router.js
  processarBemVindo,
  verificarSlowMode,
  verificarAntiFlood,
  isMuted,
  unmuteUser,
  isAdmin,
  getGroupOwner,
  handleRemoverReporte,
  handleAdvertencia,
  setBemVindo,
  handleBotToggle,
};
