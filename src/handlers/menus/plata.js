'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuGold(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  await sock.sendMessage(jid, {
    text:
      `💵 *SISTEMA DE PLATA* 💵\n\n` +
      `${P}plata / ${P}plata — ver saldo (${P}plata é o comando principal)\n` +
      `${P}loja — loja geral\n` +
      `${P}lojafood — loja de comida\n` +
      `${P}lojapet — loja de pets\n` +
      `${P}lojatec — loja de tecnologia\n` +
      `${P}lojacasal — loja de casal\n` +
      `${P}buy [item] — comprar item\n` +
      `${P}vender [item] — vender item\n` +
      `${P}inventario — ver inventário\n` +
      `${P}pix [@] [valor] — transferir Plata\n` +
      `${P}apostar [valor] — apostar Plata\n` +
      `${P}slots [valor] — jogar slots\n` +
      `${P}corrida [valor] — corrida de bichos\n` +
      `${P}garimpar — garimpar recursos\n` +
      `${P}extrato — histórico de transações\n` +
      `${P}banco [valor] — investir no banco\n` +
      `${P}resgatar — resgatar do banco\n` +
      `${P}rankplata — ranking de saldo\n` +
      `${P}give [@] [valor] — dar Plata`,
  }, { quoted: msg });
}

async function handleSistemaGold(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  await sock.sendMessage(jid, {
    text:
      `📖 *COMO FUNCIONA A MOEDA* 📖\n\n` +
      `💰 *Plata*\n` +
      `Os saldos e valores da economia do bot são exibidos em Plata ou na moeda local da conta vinculada. Use para comprar itens, apostar e muito mais!\n\n` +
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
