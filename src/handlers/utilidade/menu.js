'use strict';

const menus = require('../menus');
const { obterPrefixo, enviarMenu } = require('../menus/helpers');

async function handleMenu(sock, msg, jid, caption, getPrefix, author) {
  return menus.handleMenu(sock, msg, jid, caption, getPrefix, author);
}
async function handleMenuUtil(sock, msg, jid, getPrefix) {
  return menus.handleMenuUtil(sock, msg, jid, getPrefix);
}
async function handleMenuJogos(sock, msg, jid, getPrefix) {
  return menus.handleMenuJogos(sock, msg, jid, getPrefix);
}
async function handleAlteradores(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '        🎛️ MENU ALTERADORES',
    '╚══════════════════════╝',
    '',
    'Responda à mídia com o comando ou envie mídia e comando juntos.',
    '',
    '🎬 *VÍDEO*',
    '  ▸ ' + P + 'videolento / ' + P + 'videorapido',
    '  ▸ ' + P + 'videocontrario / ' + P + 'reversevideo',
    '  ▸ ' + P + 'videosemaudio — remover áudio do vídeo',
    '',
    '🎵 *ÁUDIO*',
    '  ▸ ' + P + 'audiolento / ' + P + 'audiorapido / ' + P + 'audioreverse',
    '  ▸ ' + P + 'grave / ' + P + 'graveprofundo / ' + P + 'esquilo / ' + P + 'bass',
    '  ▸ ' + P + 'normalizaraudio / ' + P + 'limparaudio / ' + P + 'audiovolume',
    '  ▸ ' + P + 'reverb',
    '',
    '🎭 *VOZ*',
    '  ▸ ' + P + 'vozmenino / ' + P + 'vozgrossa / ' + P + 'vozmulher',
    '  ▸ ' + P + 'vozrobo / ' + P + 'vozalien / ' + P + 'vozvelho',
    '  ▸ ' + P + 'vozcrianca / ' + P + 'vozdemonio / ' + P + 'nightcore',
    '',
    '🔊 *AMBIENTE*',
    '  ▸ ' + P + 'eco / ' + P + 'caverna / ' + P + 'telefone',
    '  ▸ ' + P + 'radio / ' + P + 'megafone / ' + P + 'underwater',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}
async function handleMenuRelacionamento(sock, msg, jid, getPrefix) {
  return menus.handleMenuRelacionamento(sock, msg, jid, getPrefix);
}
async function handleMenuFilho(sock, msg, jid, getPrefix) {
  return menus.handleMenuFilho(sock, msg, jid, getPrefix);
}
async function handleMenuBaixar(sock, msg, jid, getPrefix) {
  return menus.handleMenuBaixar(sock, msg, jid, getPrefix);
}

module.exports = {
  handleMenu,
  handleMenuUtil,
  handleMenuJogos,
  handleMenuBaixar,
  handleMenuRelacionamento,
  handleAlteradores,
  handleMenuFilho,
};
