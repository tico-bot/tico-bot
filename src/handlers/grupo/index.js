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
  return require('../menus/admin').handleMenuAdm(sock, msg, jid, getPrefix);
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
