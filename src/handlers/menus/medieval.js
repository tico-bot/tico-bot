'use strict';

async function handleSistemaMedieval(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      🏰 MODO MEDIEVAL
╚══════════════════════╝

⚔️ *O QUE É?*
Um RPG completo onde você escolhe uma classe, ganha XP, batalha e conquista itens raros!

📜 *PERSONAGEM*
  ▸ ${P}ficha — ver sua ficha e atributos
  ▸ ${P}missaomed — missões por XP e saldo
  ▸ ${P}recargamana — meditar e recuperar energia
  ▸ ${P}usarpocao _(poção)_ — usar uma poção

🗡️ *BATALHA*
  ▸ ${P}atacar @alvo — batalhar contra outro jogador
  ▸ ${P}magia @alvo — lançar feitiço elemental
  ▸ ${P}saquear @alvo — levar pertences de inimigos derrotados

🛡️ *LOJA & EQUIPAMENTOS*
  ▸ ${P}lojamedieval — comprar equipamentos e poções
  ▸ ${P}comprar _(item)_ — comprar um item
  ▸ ${P}equipar _(item)_ — equipar
  ▸ ${P}desequipar _(item)_ — desequipar

🎒 *INVENTÁRIO*
  ▸ ${P}invmed — ver seu inventário
  ▸ ${P}sellmed _(item)_ — vender item
  ▸ ${P}givemed @alvo _(item)_ — entregar item a alguém

🏆 *RANKING & HISTÓRICO*
  ▸ ${P}rankmedieval — ranking do reino
  ▸ ${P}historico — suas batalhas

⚙️ *GRUPO*
  ▸ ${P}medieval _(on/off)_ — ligar ou desligar o modo

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleSistemaMedieval };
