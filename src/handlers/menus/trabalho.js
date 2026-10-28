'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuWork(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu = [
    '╔══════════════════════╗',
    '         💼 MENU EMPREGOS',
    '╚══════════════════════╝',
    '',
    '🔎 *CARREIRA & VAGAS*',
    '  ▸ ' + P + 'procuraremprego — listar vagas (alias: buscaemprego)',
    '  ▸ ' + P + 'procuraremprego <número> — escolher uma vaga (alias: escolheremprego)',
    '  ▸ ' + P + 'emprego — consultar cargo e progresso (alias: meuemprego)',
    '  ▸ ' + P + 'promocao — tentar promoção (alias: promcao)',
    '  ▸ ' + P + 'demitir — pedir demissão (alias: pedirdemissao)',
    '',
    '💰 *EXPEDIENTE*',
    '  ▸ ' + P + 'trabalhar — cumprir turno e receber salário',
    '  ▸ ' + P + 'work — alias de trabalhar',
    '',
    'Confira as mensagens do sistema para ver o horário, cooldown e requisitos do cargo.',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuWork };
