'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuPet(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '        🎭 MENU DE PERSONAGENS',
    '╚══════════════════════╝',
    '',
    '🎯 *CAPTURA & COLEÇÃO*',
    '  ▸ ' + P + 'capturar — capturar personagem que surgir',
    '  ▸ ' + P + 'pets — ver sua coleção',
    '  ▸ ' + P + 'abrigo — guardar personagem no abrigo (alias: shelter)',
    '  ▸ ' + P + 'renomearpet <nome> — renomear (alias: nomearpet)',
    '',
    '❤️ *CUIDADOS*',
    '  ▸ ' + P + 'alimentar — alimentar o personagem',
    '  ▸ ' + P + 'brincar — interagir',
    '  ▸ ' + P + 'curar — tratar o personagem',
    '',
    '📊 *STATUS & RANKING*',
    '  ▸ ' + P + 'statuspet — ver atributos',
    '  ▸ ' + P + 'petrank — ranking (alias: rankpet)',
    '',
    '🛒 *LOJA & AJUDA*',
    '  ▸ ' + P + 'lojapet — loja de itens',
    '  ▸ ' + P + 'sistempet — regras e funcionamento',
    '',
    '⚙️ *CONFIGURAÇÃO DO GRUPO*',
    '  ▸ ' + P + 'pet on/off/status — controlar os spawns',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

async function handleSistemaPet(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '          🐾 COMO FUNCIONAM OS PETS',
    '╚══════════════════════╝',
    '',
    'Capture os personagens que surgirem no grupo e cuide deles para manter os atributos.',
    '',
    '🎯 *CAPTURA & GUARDA*',
    '  ▸ ' + P + 'capturar — capturar um personagem disponível',
    '  ▸ ' + P + 'pets — consultar sua coleção',
    '  ▸ ' + P + 'abrigo — guardar seu personagem',
    '',
    '❤️ *CUIDADOS & PROGRESSO*',
    '  ▸ ' + P + 'alimentar / ' + P + 'brincar / ' + P + 'curar',
    '  ▸ ' + P + 'statuspet — consultar atributos',
    '  ▸ ' + P + 'lojapet — comprar itens',
    '',
    '⚙️ A disponibilidade de surgimentos depende das configurações do grupo.',
    'Use ' + P + 'menupet para ver a lista completa de comandos.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuPet, handleSistemaPet };
