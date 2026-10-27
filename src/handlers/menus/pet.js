'use strict';

async function handleMenuPet(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
        🐾 MENU PETS
╚══════════════════════╝

🎯 *CAPTURA & COLEÇÃO*
  ▸ ${P}capturar — capturar pet selvagem
  ▸ ${P}pets — ver todos os seus pets
  ▸ ${P}abrigo — colocar pet no abrigo
  ▸ ${P}renomearpet _(nome)_ — renomear

❤️ *CUIDADOS*
  ▸ ${P}alimentar — alimentar o pet
  ▸ ${P}brincar — brincar com o pet
  ▸ ${P}curar — curar o pet

📊 *STATUS & RANKING*
  ▸ ${P}statuspet — ver status do seu pet
  ▸ ${P}petrank — ranking de pets

🛒 *LOJA & AJUDA*
  ▸ ${P}lojapet — loja de pets
  ▸ ${P}sistempet — como funciona

⚙️ *GRUPO*
  ▸ ${P}pet _(on/off/status)_ — ligar ou desligar os pets

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

async function handleSistemaPet(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
     🐾 COMO FUNCIONA
╚══════════════════════╝

🎯 *CAPTURA*
Pets aparecem aleatoriamente nos grupos. Use ${P}capturar quando um aparecer!

❤️ *CUIDADOS*
Mantenha seu pet com Fome, Felicidade e Saúde em alta usando itens da ${P}lojapet.

⭐ *EVOLUÇÃO*
Brincar e cuidar do seu pet aumenta a experiência dele!

📋 *ATALHOS*
  ▸ ${P}menupet — todos os comandos
  ▸ ${P}statuspet — ver como seu pet está

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuPet, handleSistemaPet };
