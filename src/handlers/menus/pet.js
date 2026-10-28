'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuPet(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu =
`╔══════════════════════╗
        🎭 MENU DE PERSONAGENS
╚══════════════════════╝

🎯 *CAPTURA & COLEÇÃO*
  ▸ ${P}capturar — capturar personagem
  ▸ ${P}pets — ver seus personagens
  ▸ ${P}abrigo — colocar personagem no abrigo
  ▸ ${P}renomearpet _(nome)_ — renomear

❤️ *CUIDADOS*
  ▸ ${P}alimentar — alimentar o personagem
  ▸ ${P}brincar — interagir com o personagem
  ▸ ${P}curar — cuidar do personagem

📊 *STATUS & RANKING*
  ▸ ${P}statuspet — ver status do personagem
  ▸ ${P}petrank — ranking de personagens

🛒 *LOJA & AJUDA*
  ▸ ${P}lojapet — loja de itens para personagens
  ▸ ${P}sistempet — como funciona

⚙️ *GRUPO*
  ▸ ${P}pet _(on/off/status)_ — ligar ou desligar os spawns

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

async function handleSistemaPet(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu =
`╔══════════════════════╗
     🎭 COMO FUNCIONA
╚══════════════════════╝

🎯 *CAPTURA*
Personagens aparecem aleatoriamente nos grupos. Use ${P}capturar quando um aparecer!

❤️ *CUIDADOS*
Cuide do personagem e mantenha seus atributos em alta usando itens da ${P}lojapet.

⭐ *EVOLUÇÃO*
Interagir e cuidar do personagem aumenta a experiência dele!

📋 *ATALHOS*
  ▸ ${P}menupet — todos os comandos
  ▸ ${P}statuspet — ver os atributos do personagem

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuPet, handleSistemaPet };
