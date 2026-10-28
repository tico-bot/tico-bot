'use strict';

const menus = require('../menus');

async function handleBrincadeiras(sock, msg, jid, getPrefix) {
  return menus.handleBrincadeiras(sock, msg, jid, getPrefix);
}
async function handleMenuPlata(sock, msg, jid, getPrefix) {
  return menus.handleMenuGold(sock, msg, jid, getPrefix);
}
async function handleMenuPet(sock, msg, jid, getPrefix) {
  return menus.handleMenuPet(sock, msg, jid, getPrefix);
}
async function handleSistemaPlata(sock, msg, jid, getPrefix) {
  return menus.handleSistemaGold(sock, msg, jid, getPrefix);
}
async function handleSistemaPet(sock, msg, jid, getPrefix) {
  return menus.handleSistemaPet(sock, msg, jid, getPrefix);
}
async function handleSistemaMedieval(sock, msg, jid, getPrefix) {
  return menus.handleSistemaMedieval(sock, msg, jid, getPrefix);
}
async function handleMenuMarket(sock, msg, jid, getPrefix) {
  return menus.handleMenuMarket(sock, msg, jid, getPrefix);
}

module.exports = {
  handleBrincadeiras,
  // Compatibilidade com os nomes consumidos pelo roteador de comandos.
  handleMenuGold: handleMenuPlata,
  handleMenuPlata,
  handleMenuPet,
  handleSistemaGold: handleSistemaPlata,
  handleSistemaPlata,
  handleSistemaPet,
  handleSistemaMedieval,
  handleMenuMarket,
};
