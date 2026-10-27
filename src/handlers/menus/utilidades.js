'use strict';

async function handleMenuUtil(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
     🔧 MENU UTILIDADES
╚══════════════════════╝

📍 *CONSULTAS*
  ▸ ${P}cep _(número)_
  ▸ ${P}clima _(cidade)_
  ▸ ${P}calcular _(expressão)_

🌐 *TEXTO & IDIOMAS*
  ▸ ${P}traduzir _(idioma) (texto)_
  ▸ ${P}maiusculo _(texto)_
  ▸ ${P}invertido _(texto)_
  ▸ ${P}caixa _(texto)_

📡 *CÓDIGO MORSE*
  ▸ ${P}morse _(texto)_
  ▸ ${P}demorse _(código)_

🔗 *OUTROS*
  ▸ ${P}encurtar _(link)_
  ▸ ${P}qrcode _(texto)_
  ▸ ${P}dado _(lados)_
  ▸ ${P}moeda _(câmbio ou cara/coroa)_
  ▸ ${P}piada
  ▸ ${P}fato

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

async function handleMenuBaixar(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      📥 MENU DOWNLOADS
╚══════════════════════╝

🎵 *MÚSICA & ÁUDIO*
  ▸ ${P}som _(nome da música)_
  ▸ ${P}audio _(link)_

📱 *VÍDEO & REDES SOCIAIS*
  ▸ ${P}tiktok _(link)_
  ▸ ${P}save _(link)_
  ▸ ${P}saverec _(link)_

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuUtil, handleMenuBaixar };
