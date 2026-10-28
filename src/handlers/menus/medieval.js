'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleSistemaMedieval(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '        🏰 MENU & GUIA MEDIEVAL',
    '╚══════════════════════╝',
    '',
    'Um RPG de personagens, equipamentos, missões e combates dentro do grupo.',
    '',
    '👤 *PERSONAGEM & PROGRESSO*',
    '  ▸ ' + P + 'ficha — consultar ou criar ficha',
    '  ▸ ' + P + 'missaomed — realizar missão',
    '  ▸ ' + P + 'recargamana — recuperar HP e mana',
    '  ▸ ' + P + 'rankmedieval — ranking de guerreiros',
    '  ▸ ' + P + 'historico — últimas batalhas',
    '',
    '⚔️ *COMBATE*',
    '  ▸ ' + P + 'atacar @pessoa — ataque físico',
    '  ▸ ' + P + 'magia @pessoa — ataque mágico',
    '  ▸ ' + P + 'saquear @pessoa — saquear alvo elegível',
    '',
    '🏪 *LOJA & INVENTÁRIO*',
    '  ▸ ' + P + 'lojamedieval — abrir loja (alias: lojamed)',
    '  ▸ ' + P + 'comprar <item> — comprar item',
    '  ▸ ' + P + 'equipar <item> / ' + P + 'desequipar <item>',
    '  ▸ ' + P + 'usarpocao <nome> — usar poção',
    '  ▸ ' + P + 'invmed — inventário medieval',
    '  ▸ ' + P + 'sellmed <item> — vender item',
    '  ▸ ' + P + 'givemed @pessoa <item> — entregar item',
    '',
    '⚙️ *GRUPO & AJUDA*',
    '  ▸ ' + P + 'medieval on/off — ligar/desligar modo',
    '  ▸ ' + P + 'menumediev — menu dos comandos',
    '  ▸ ' + P + 'comomediev — alias desta ajuda',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleSistemaMedieval };
