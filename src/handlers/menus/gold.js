'use strict';

async function handleMenuGold(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `💵 *SISTEMA DE REAIS* 💵\n\n` +
      `${P}reais / ${P}real — ver saldo (${P}gold continua como alias)\n` +
      `${P}loja — loja geral\n` +
      `${P}lojafood — loja de comida\n` +
      `${P}lojapet — loja de pets\n` +
      `${P}lojatec — loja de tecnologia\n` +
      `${P}lojacasal — loja de casal\n` +
      `${P}buy [item] — comprar item\n` +
      `${P}vender [item] — vender item\n` +
      `${P}inventario — ver inventário\n` +
      `${P}pix [@] [valor] — transferir Reais\n` +
      `${P}apostar [valor] — apostar Reais\n` +
      `${P}slots [valor] — jogar slots\n` +
      `${P}corrida [valor] — corrida de bichos\n` +
      `${P}garimpar — garimpar recursos\n` +
      `${P}extrato — histórico de transações\n` +
      `${P}banco [valor] — investir no banco\n` +
      `${P}resgatar — resgatar do banco\n` +
      `${P}rankgold — ranking de saldo\n` +
      `${P}give [@] [valor] — dar Reais`,
  }, { quoted: msg });
}

async function handleSistemaGold(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  await sock.sendMessage(jid, {
    text:
      `📖 *COMO FUNCIONA A MOEDA* 📖\n\n` +
      `💰 *Reais*\n` +
      `Os saldos e valores da economia do bot são exibidos em Reais ou na moeda local da conta vinculada. Use para comprar itens, apostar e muito mais!\n\n` +
      `📥 *Como ganhar:*\n` +
      `• Bônus diário ao mandar mensagem\n` +
      `• Trabalhar com ${P}trabalhar\n` +
      `• Garimpar com ${P}garimpar\n` +
      `• Vender itens com ${P}vender\n` +
      `• Ganhar no cassino/corrida\n` +
      `• Pescar e vender peixes\n\n` +
      `📤 *Como gastar:*\n` +
      `• Comprar itens na loja (${P}loja)\n` +
      `• Transferir para amigos (${P}pix)\n` +
      `• Apostar no cassino (${P}slots, ${P}apostar)\n` +
      `• Investir no banco (${P}banco; indisponível para contas vinculadas)`,
  }, { quoted: msg });
}

module.exports = { handleMenuGold, handleSistemaGold };
