'use strict';

async function handleMenuMarket(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      🛒 MARKETPLACE
╚══════════════════════╝

🔍 *EXPLORAR*
  ▸ ${P}avenda — ver ofertas no mercado
  ▸ ${P}buscaroferta _(item)_ — procurar ofertas de um item

💰 *VENDER*
  ▸ ${P}ofertar _(item) (preço) (qtd)_ — colocar item à venda
  ▸ ${P}minhasofertas — ver suas ofertas ativas
  ▸ ${P}cancelaroferta _(item)_ — remover sua oferta

🛍️ *COMPRAR*
  ▸ ${P}buyoferta _(vendedor) (item) (qtd)_ — comprar oferta

📜 *HISTÓRICO*
  ▸ ${P}historicomarket — compras e vendas

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuMarket };
