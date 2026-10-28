'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuMarket(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '          🛒 MARKETPLACE',
    '╚══════════════════════╝',
    '',
    '🔎 *EXPLORAR OFERTAS*',
    '  ▸ ' + P + 'avenda [página] — navegar pelas ofertas',
    '  ▸ ' + P + 'buscaroferta <item> — procurar item (alias: buscaoferta)',
    '',
    '📤 *VENDER*',
    '  ▸ ' + P + 'ofertar <item> <preço> <quantidade> — anunciar item',
    '  ▸ ' + P + 'minhasofertas — consultar ofertas (alias: mesofertas)',
    '  ▸ ' + P + 'cancelaroferta <item> — cancelar anúncio (alias: canceloferta)',
    '',
    '📥 *COMPRAR*',
    '  ▸ ' + P + 'buyoferta <vendedor> <item> <quantidade> — comprar oferta',
    '',
    '📜 *HISTÓRICO*',
    '  ▸ ' + P + 'historicomarket — histórico de transações (alias: mercadohistorico)',
    '',
    'A compra de ofertas é feita por ' + P + 'buyoferta.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuMarket };
