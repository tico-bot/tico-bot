'use strict';

const menus = require('../menus');

async function handleBrincadeiras(sock, msg, jid, getPrefix) {
  return menus.handleBrincadeiras(sock, msg, jid, getPrefix);
}
async function handleMenuPrata(sock, msg, jid, getPrefix) {
  return menus.handleMenuPrata(sock, msg, jid, getPrefix);
}
async function handleMenuPet(sock, msg, jid, getPrefix) {
  return menus.handleMenuPet(sock, msg, jid, getPrefix);
}
async function handleSistemaPrata(sock, msg, jid, getPrefix) {
  return menus.handleSistemaPrata(sock, msg, jid, getPrefix);
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
  handleMenuGold: handleMenuPrata,
  handleMenuPrata,
  handleMenuPet,
  handleSistemaGold: handleSistemaPrata,
  handleSistemaPrata,
  handleSistemaPet,
  handleSistemaMedieval,
  handleMenuMarket,
};
