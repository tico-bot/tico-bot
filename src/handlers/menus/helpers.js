'use strict';

/** Resolve o prefixo do grupo sem deixar uma configuração inválida quebrar o menu. */
function obterPrefixo(jid, getPrefix) {
  try {
    const prefixo = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
    return typeof prefixo === 'string' && prefixo.trim() ? prefixo.trim() : '!';
  } catch (error) {
    return '!';
  }
}

/** Envia um menu de texto, citando a mensagem original quando disponível. */
async function enviarMenu(sock, msg, jid, texto) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('[menus] sock.sendMessage não está disponível.');
  }
  if (typeof jid !== 'string' || !jid.trim()) {
    throw new TypeError('[menus] JID de destino inválido.');
  }
  await sock.sendMessage(jid, { text: String(texto ?? '') }, msg ? { quoted: msg } : {});
}

module.exports = { obterPrefixo, enviarMenu };
