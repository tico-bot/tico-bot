'use strict';

// ─── Centralização Total de Menus (Única Fonte de Verdade) ────────────────────

const { handleMenu }                         = require('./principal');
const { handleMenuUtil, handleMenuBaixar }   = require('./utilidades');
const { handleMenuJogos, handleBrincadeiras } = require('./jogos');
const { handleMenuGold, handleSistemaGold }  = require('./gold');
const { handleMenuPet, handleSistemaPet }    = require('./pet');
const { handleSistemaMedieval }             = require('./medieval');
const { handleMenuMarket }                  = require('./market');
const { handleMenuWork }                    = require('./trabalho');
const { handleMenuRelacionamento, handleMenuFilho } = require('./casal');
const { handleMenuAdm }                     = require('./admin');

module.exports = {
  handleMenu,
  handleMenuUtil,
  handleMenuBaixar,
  handleMenuJogos,
  handleBrincadeiras,
  handleMenuGold,
  handleSistemaGold,
  handleMenuPet,
  handleSistemaPet,
  handleSistemaMedieval,
  handleMenuMarket,
  handleMenuWork,
  handleMenuRelacionamento,
  handleMenuFilho,
  handleMenuAdm,
};
