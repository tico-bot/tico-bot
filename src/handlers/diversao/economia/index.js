'use strict';

const path = require('path');

const { ITENS_LOJA } = require(path.join(__dirname, '..', '..', '..', 'config', 'economia'));
const { getSaldoGrupo } = require('./_shared');

const {
  handleGold,
  handleLoja,
  handleLojaFood,
  handleLojaPet,
  handleLojaTec,
  handleLojaCasal,
  handleComprar,
  handleVender,
  handleInventario,
} = require('./loja');

const { handleGarimpar } = require('./garimpo');
const { handleSlots, handleCorrida, handleApostar } = require('./cassino');
const { handlePix, handlePixMulti, handlePixDoar, handleGive } = require('./transferencia');
const { handleExtrato } = require('./extrato');
const { handleRankGold } = require('./ranking');

const { alterarGold } = require('../../../utils/carteira');

module.exports = {
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
  handleGive,
  handleApostar,
  handleExtrato,
  handleGarimpar,
  handleSlots,
  handleCorrida,
  getSaldoGrupo,
  getSaldoAtual: getSaldoGrupo,
  changeGold: alterarGold,
  ITENS_LOJA,
  handleRankGold,
};
