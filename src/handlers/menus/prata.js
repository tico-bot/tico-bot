'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuPrata(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '          💵 SISTEMA DE PRATA',
    '╚══════════════════════╝',
    '',
    '💰 *SALDO & LOJAS*',
    '  ▸ ' + P + 'prata — ver saldo (aliases: gold, real, reais)',
    '  ▸ ' + P + 'loja — loja geral',
    '  ▸ ' + P + 'lojafood / ' + P + 'lojapet / ' + P + 'lojatec / ' + P + 'lojacasal',
    '  ▸ ' + P + 'buy <item> — comprar item da loja',
    '  ▸ ' + P + 'vender <item> — vender item permitido',
    '  ▸ ' + P + 'inventario — ver inventário (alias: inv)',
    '  ▸ ' + P + 'give @pessoa <item> — entregar item do inventário',
    '',
    '💸 *TRANSFERÊNCIAS*',
    '  ▸ ' + P + 'pix @pessoa <valor> — transferir Prata',
    '  ▸ ' + P + 'pixmulti @1 @2 <valor> — transferência múltipla',
    '  ▸ ' + P + 'pixtodos — alias de pixmulti',
    '  ▸ ' + P + 'doarprata <valor> — doação de Prata',
    '',
    '📈 *GANHOS, APOSTAS & BANCO*',
    '  ▸ ' + P + 'missao — missão de economia',
    '  ▸ ' + P + 'garimpar — garimpar recursos (aliases: explorar, pesquisar)',
    '  ▸ ' + P + 'emprestimo <valor> / ' + P + 'divida — empréstimos e dívidas',
    '  ▸ ' + P + 'banco <valor> / ' + P + 'resgatar / ' + P + 'historicobanco',
    '  ▸ ' + P + 'apostar <valor> / ' + P + 'slots [valor] / ' + P + 'corrida [valor]',
    '  ▸ ' + P + 'extrato — histórico de transações',
    '  ▸ ' + P + 'rankprata — ranking de saldo (alias: rankgold)',
    '',
    '🐟 *PESCA*',
    '  ▸ ' + P + 'pescar — pescar',
    '  ▸ ' + P + 'varas / ' + P + 'iscas — lojas de pesca',
    '  ▸ ' + P + 'buypesca <item> — comprar vara/isca',
    '  ▸ ' + P + 'inventariopesca — ver itens e peixes',
    '  ▸ ' + P + 'sellpesca <item> — vender peixe/item',
    '  ▸ ' + P + 'givepesca @pessoa <item> — transferir peixe/item',
    '  ▸ ' + P + 'rankingpesca / ' + P + 'statspesca — ranking e estatísticas',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

async function handleSistemaPrata(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '📖 *COMO FUNCIONA A ECONOMIA*',
    '',
    'A economia usa Prata para compras, vendas, transferências, apostas e sistemas de jogo.',
    '',
    '📥 *FORMAS DE CONSEGUIR RECURSOS*',
    '  • ' + P + 'trabalhar — trabalhar no emprego',
    '  • ' + P + 'missao — cumprir missões',
    '  • ' + P + 'garimpar — obter recursos',
    '  • ' + P + 'pescar — pescar e vender itens',
    '  • ' + P + 'vender — vender itens aceitos pela loja',
    '',
    '📤 *USO DA PRATA*',
    '  • ' + P + 'loja / ' + P + 'buy — comprar itens',
    '  • ' + P + 'pix — transferir saldo',
    '  • ' + P + 'banco / ' + P + 'resgatar — administrar saldo no banco',
    '  • ' + P + 'apostar / ' + P + 'slots / ' + P + 'corrida — jogos de aposta',
    '',
    'Consulte ' + P + 'menuprata para ver todos os comandos e seus argumentos.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuPrata, handleSistemaPrata };
