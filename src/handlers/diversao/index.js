/**
 * Handler de Diversão — Tico Bot
 * Arquivo principal que coordena brincadeiras, economia, menus, pets, missões, marketplace e pesca
 */

// ─── Importar módulos específicos (mesma pasta) ───────────────────────────

// Emprego
const {
  handleProcurarEmprego,
  handleTrabalhar,
  handlePromocao,
  handleEmprego,
  handleDemitir,
  handleMenuWork,
} = require('./emprego');

// brincadeiras
const {
  handleMiniGame, handleGay, handleSexo, handleLesbica, handleAura,
  handleDado, handleMoeda, handle8ball, handleShip, handleRolar,
  handleXingar, handleElogio, handleCrush, handleCantada, handleSafadeza,
  handleTiro, handleMorte, handleRoletaRussa, handleRoletaRussa2, handleRoletaRussa3,
  handleFalta, handleBaterFalta, handleEuNunca, handleAnagrama, handlePpt,
  handleVerdadeOuDesafio, handleConfissao, handleJulgamento, handlePodre, handleFrango,
  handleMaldizer, handleFortuna, handleCompatibilidade,
  handleTrans, handleCorno, handlePeitudo, handlePauzudo,
  handleBundudo, handleGordo, handleCuzudo, handleGado, handleBucetudo, handleWorldCup,
} = require('./brincadeiras');

  // ── Filhos (6 itens) ────────────────────────────────────────────────────
const {
  handleTentarFilho,
  handleVerFilho,
  handleCuidarFilho,
  handleRemedioFilho,
  handleRenomearFilho,
  initFilhosScheduler,
} = require('./filhos');

// Economia
const {
  handleGold, handleLoja, handleLojaFood, handleLojaPet, handleLojaTec, handleLojaCasal,
  handleComprar, handleVender, handleInventario, handlePix, handlePixMulti, handlePixDoar,
  handleApostar, handleExtrato, handleGarimpar, handleSlots, handleCorrida,
  getSaldoAtual, changeGold, ITENS_LOJA, handleRankGold
} = require('./economia');

// Menus
const {
  handleBrincadeiras, handleMenuGold, handleMenuPet,
  handleSistemaGold, handleSistemaPet, handleMenuAuxiliar,
  handleSistemaMedieval, handleMenuMarket,
} = require('./menus');

// Marketplace (v3.1 — sem dependência de handlePescar no require direto)
const {
  handleAvenda, handleBuscarOferta, handleOfertar, handleBuy,
  handleCancelarOferta, handleMinhasOfertas, handleHistoricoMarket,
  handleOfertasRecebidas, handleAceitarOfferta,
  Oferta, MarketLog, CONFIG: CONFIG_MARKET, registerCatalog
} = require('./marketplace');

// Pesca
const {
  handlePescar, handleVaras, handleIscas, handleComprarPesca,
  handleInventarioPesca, handleVenderPesca, handleRankingPesca, handleStatsPesca,
  VARAS_PESCA, ISCAS, CATALOGO_PESCA, PEIXES_E_ITENS
} = require('./pesca');

registerCatalog({ ...VARAS_PESCA, ...ISCAS, ...PEIXES_E_ITENS });

// Quiz
// ✅ Correto
const {
  handleQuiz, handlePontos, handleRankJogos, quizState
} = require('./quiz');

// Economia - Banco do Quiz
const { handleBanco, handleResgatar, handleHistoricoBanco } = require('./banco');

// Missões
const {
  handleMissao, prepareDailyMissionState, findDailyMission, dailyMissionDefinitions
} = require('./missoes');

// Jogos extras
const {
  handleForca, handleLetra, handleChutar,
  handleAdivinha, handlePalpite,
  handleVelha, handleJogar,
  handleContas, handleResp,
  handleCharada, handleTermo, handleTentar,
  handleBatata, handlePassar, handleDuelo,
} = require('./jogosExtras');

const {
  handleCapturarPet, handleAlimentarPet, handleBrincarPet,
  handleStatusPet, handlePetRank, handlePets, handleAbrigo,
  handleAdoptarPet, handleRenomearPet, initPetScheduler, registerActiveGroup,
  handleCurarPet,handlePetToggle,
} = require('./pets');

// Roubo
const {
  handleMenuRoubo, handleMenuSec, handleComprarRoubo, handleComprarSec,
  handleEquiparRoubo, handleEquiparSec, handleInvRoubo, handleInvSec,
  handleMeioSec, handleRoubar, handleRoubarBanco, handlePolicia,
} = require('./roubo');
// ─── Utilitários ────────────────────────────────────────────────────────────

function getUserId(msg) {
  return msg.key.remoteJid.split('@')[0] === msg.key.participant?.split('@')[0]
    ? msg.key.participant
    : msg.key.remoteJid;
}

async function initializePersistedData() {
  console.log('✅ Diversão handler inicializado com sucesso');
}

// ─── EXPORTS COMPLETO ───────────────────────────────────────────────────────

module.exports = {
  handleMiniGame,
  // ── Brincadeiras (33 funções) ──────────────────────────────────────────────
  handleGay,
  handleSexo,
  handleLesbica,
  handleAura,
  handleDado,
  handleMoeda,
  handle8ball,
  handleShip,
  handleRolar,
  handleXingar,
  handleElogio,
  handleCrush,
  handleCantada,
  handleSafadeza,
  handleTiro,
  handleMorte,
  handleRoletaRussa,
  handleRoletaRussa2,
  handleRoletaRussa3,
  handleFalta,
  handleBaterFalta,
  handleEuNunca,
  handleAnagrama,
  handlePpt,
  handleVerdadeOuDesafio,
  handleConfissao,
  handleJulgamento,
  handlePodre,
  handleFrango,
  handleMaldizer,
  handleFortuna,
  handleCompatibilidade,
  handleTrans,
  handleCorno,
  handlePeitudo,
  handlePauzudo,
  handleBundudo,
  handleGordo,
  handleCuzudo,
  handleGado,
  handleBucetudo,
  handleWorldCup,
  // ── Economia (18 itens) ────────────────────────────────────────────────────
  handleGold,
  handleLoja,
  handleLojaFood,
  handleLojaPet,
  handleLojaTec,
  handleLojaCasal,
  handleComprar,
  handleVender,
  handleInventario,
  handlePix,
  handlePixMulti,
  handlePixDoar,
  handleApostar,
  handleExtrato,
  handleGarimpar,
  handleSlots,
  handleCorrida,
  getSaldoAtual,
  changeGold,
  ITENS_LOJA,
  handleRankGold,

  // ── Menus (6 funções) ──────────────────────────────────────────────────────
  handleBrincadeiras,
  handleMenuGold,
  handleMenuPet,
  handleSistemaGold,
  handleSistemaPet,
  handleMenuAuxiliar,
  handleSistemaMedieval,
  handleMenuMarket,

  // ── Marketplace v3.1 (11 itens) ────────────────────────────────────────────
  handleAvenda,
  handleBuscarOferta,
  handleOfertar,
  handleBuy,
  handleCancelarOferta,
  handleMinhasOfertas,
  handleHistoricoMarket,
  handleOfertasRecebidas,   // compatibilidade retroativa
  handleAceitarOfferta,     // compatibilidade retroativa
  Oferta,
  MarketLog,
  CONFIG_MARKET,
  registerCatalog,

// ── Pesca (12 itens) ────────────────────────────────────────────────────────
  handlePescar,
  handleVaras,
  handleIscas,
  handleComprarPesca,
  handleInventarioPesca,
  handleVenderPesca,
  handleRankingPesca,
  handleStatsPesca,
  VARAS_PESCA,
  ISCAS,
  CATALOGO_PESCA,
  PEIXES_E_ITENS,

  // ── Quiz (6 itens) ────────────────────────────────────────────────────────
  handleQuiz,
  handlePontos,
  handleRankJogos,
  handleForca,
  handleLetra,
  handleChutar,
  handleAdivinha,
  handlePalpite,
  handleVelha,
  handleJogar,
  handleContas,
  handleResp,
  handleCharada,
  handleTermo,
  handleTentar,
  handleBatata,
  handlePassar,
  handleDuelo,
  handleBanco,
  handleResgatar,
  quizState,
  handleHistoricoBanco,

  // ── Missões (4 itens) ─────────────────────────────────────────────────────
  handleMissao,
  prepareDailyMissionState,
  findDailyMission,
  dailyMissionDefinitions,

  // ── Filhos (6 itens) ─────────────────────────────────────────────────────
handleTentarFilho,
handleVerFilho,
handleCuidarFilho,
handleRemedioFilho,
handleRenomearFilho,
initFilhosScheduler,

  // ── Pets (14 itens) ───────────────────────────────────────────────────────
  handleCapturarPet,
  handleAdoptarPet,
  handleAlimentarPet,
  handleBrincarPet,
  handleStatusPet,
  handlePetRank,
  handlePets,
  handleAbrigo,
  initPetScheduler,
  registerActiveGroup,
  handleRenomearPet,
  handleCurarPet,
  handlePetToggle,

// ── Roubo (14 itens) ──────────────────────────────────────────────────────
  handleMenuRoubo,
  handleMenuSec,
  handleComprarRoubo,
  handleComprarSec,
  handleEquiparRoubo,
  handleEquiparSec,
  handleInvRoubo,
  handleInvSec,
  handleMeioSec,
  handleRoubar,
  handleRoubarBanco,
  handlePolicia,

// Emprego
  handleProcurarEmprego,
  handleTrabalhar,
  handlePromocao,
  handleEmprego,
  handleDemitir,
  handleMenuWork,

  // ── Utilitários (2 funções) ───────────────────────────────────────────────
  getUserId,
  initializePersistedData,
};