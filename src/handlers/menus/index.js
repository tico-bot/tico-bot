'use strict';

// ─── Centralização Total de Menus (Única Fonte de Verdade) ────────────────────

const { handleMenu }                         = require('./principal');
const { handleMenuUtil, handleMenuBaixar }   = require('./utilidades');
const { handleMenuJogos, handleBrincadeiras } = require('./jogos');
const { handleMenuPrata, handleSistemaPrata } = require('./prata');
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
  handleMenuPrata,
  handleSistemaPrata,
  // Aliases internos mantidos para compatibilidade.
  handleMenuGold: handleMenuPrata,
  handleSistemaGold: handleSistemaPrata,
  handleMenuPet,
  handleSistemaPet,
  handleSistemaMedieval,
  handleMenuMarket,
  handleMenuWork,
  handleMenuRelacionamento,
  handleMenuFilho,
  handleMenuAdm,
};
