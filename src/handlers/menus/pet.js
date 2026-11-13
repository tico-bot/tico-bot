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
    '  ▸ ' + P + 'personagens — ver o catálogo',
    '  ▸ ' + P + 'petselecionar <nome> — trocar o pet ativo',
    '  ▸ ' + P + 'abrigo — guardar personagem no abrigo (alias: shelter)',
    '  ▸ ' + P + 'renomearpet <nome> — renomear (alias: nomearpet)',
    '',
    '❤️ *CUIDADOS*',
    '  ▸ ' + P + 'alimentar — alimentar o personagem',
    '  ▸ ' + P + 'brincar — interagir',
    '  ▸ ' + P + 'curar — tratar a saúde',
    '  ▸ ' + P + 'banhar / ' + P + 'vacinar — higiene e prevenção',
    '  ▸ ' + P + 'brincar <brinquedo> — brincar usando um item',
    '  ▸ ' + P + 'equiparpet <item> — equipar acessório',
    '  ▸ ' + P + 'desequiparpet <item> — guardar acessório',
    '  ▸ ' + P + 'passear / ' + P + 'treinar — ganhar XP',
    '',
    '🤝 *SOCIAL & COMPETIÇÕES*',
    '  ▸ ' + P + 'visitarpet @pessoa — visitar um personagem',
    '  ▸ ' + P + 'duelopet @pessoa — duelo entre pets',
    '  ▸ ' + P + 'corridapet @pessoa — corrida entre pets',
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
    '  ▸ ' + P + 'pet on/off/status/spawn — controlar/invocar spawns',
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
    '  ▸ ' + P + 'personagens — consultar catálogo',
    '  ▸ ' + P + 'petselecionar <nome> — escolher personagem ativo',
    '  ▸ ' + P + 'abrigo — guardar seu personagem',
    '',
    '❤️ *CUIDADOS & PROGRESSO*',
    '  ▸ ' + P + 'alimentar / ' + P + 'brincar / ' + P + 'curar',
    '  ▸ ' + P + 'banhar / ' + P + 'vacinar / ' + P + 'treinar / ' + P + 'passear',
    '  ▸ ' + P + 'equiparpet / ' + P + 'desequiparpet',
    '  ▸ ' + P + 'visitarpet / ' + P + 'duelopet / ' + P + 'corridapet',
    '  ▸ ' + P + 'statuspet — consultar atributos',
    '  ▸ ' + P + 'lojapet — comprar itens',
    '',
    '⏳ Fome, energia, felicidade, higiene e saúde mudam com o tempo. Cuide do personagem.',
    '⚙️ A disponibilidade de surgimentos depende das configurações do grupo.',
    'Use ' + P + 'menupet para ver a lista completa de comandos.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuPet, handleSistemaPet };
