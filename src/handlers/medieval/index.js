'use strict';

// ─── Módulo Medieval Centralizado ─────────────────────────────────────────────

const {
  handleMedievalToggle,
  handleFicha,
  handleAtacar,
  handleMagia,
  handleMissao,
  handleRecargaMana,
  handleHistorico,
  getModoAtivo,
  getOuCriarPersonagem,
  somenteGrupo,
  verificarRecuperacaoDerrota,
  JANELA_SAQUE_MS,
} = require('./combate');

const {
  handleLojaMedieval,
  handleComprarMedieval,
  handleEquipar,
  handleDesequipar,
  handleInvMed,
  handleUsarPocao,
  handleSellMed,
  handleGiveMed,
  handleRankMedieval,
  handleMenuMedieval,
} = require('./loja');

const {
  handleSaquear,
  handleRespostaSaque,
  saqueState,
} = require('./saque');

module.exports = {
  // Combate & Personagem
  handleMedievalToggle,
  handleFicha,
  handleAtacar,
  handleMagia,
  handleMissao,
  handleRecargaMana,
  handleHistorico,
  getModoAtivo,
  getOuCriarPersonagem,
  somenteGrupo,
  verificarRecuperacaoDerrota,
  JANELA_SAQUE_MS,

  // Loja & Inventário
  handleLojaMedieval,
  handleComprarMedieval,
  handleEquipar,
  handleDesequipar,
  handleInvMed,
  handleUsarPocao,
  handleSellMed,
  handleGiveMed,
  handleRankMedieval,
  handleMenuMedieval,

  // Saque
  handleSaquear,
  handleRespostaSaque,
  saqueState,
};
