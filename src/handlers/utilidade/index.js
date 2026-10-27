'use strict';

const path = require('path');

const {
  handleMenu,
  handleMenuUtil,
  handleMenuJogos,
  handleMenuBaixar,
  handleMenuRelacionamento,
  handleAlteradores,
  handleMenuFilho,
} = require('./menu');

const { handleLevel, handleRankLevel } = require('./level');
const {
  handleSave, handleSaveRec, handleTiktok, handleAudioDownload,
  handleSom, handlePlayMp4, handlePlayDoc, getYtDlpPath, getYtDlpArgs,
  getFfmpegPath, getFfprobePath,
} = require('./downloads');

const { handleCep, handleClima, handleMoeda, handleCalcular, handleTraduzir } = require('./consultas');
const {
  handleQrcode, handleEncurtar, handlePiada, handleFato,
  handleCodigoMorse, handleDecodificarMorse, handleReverseText,
  handleSayFofoca, handleGerarNome,
} = require('./texto-fun');
const { handlePerfil, handleBio } = require('./perfil');

module.exports = {
  // Menus
  handleMenu,
  handleMenuUtil,
  handleMenuJogos,
  handleMenuBaixar,
  handleMenuRelacionamento,
  handleAlteradores,
  handleMenuFilho,

  // Level & XP
  handleLevel,
  handleRankLevel,

  // Downloads & Mídia
  handleSave,
  handleSaveRec,
  handleTiktok,
  handleAudioDownload,
  handleSom,
  handlePlayMp4,
  handlePlayDoc,
  getYtDlpPath,
  getYtDlpArgs,
  getFfmpegPath,
  getFfprobePath,

  // Consultas
  handleCep,
  handleClima,
  handleMoeda,
  handleCalcular,
  handleTraduzir,

  // Texto & Fun
  handleQrcode,
  handleEncurtar,
  handlePiada,
  handleFato,
  handleCodigoMorse,
  handleDecodificarMorse,
  handleReverseText,
  handleSayFofoca,
  handleGerarNome,

  // Perfil & Bio
  handlePerfil,
  handleBio,
};