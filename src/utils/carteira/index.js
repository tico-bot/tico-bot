'use strict';

const { getCarteira, alterarGold, alterarGoldSeguro } = require('./gold');
const { rankingGold, rankingXp }                       = require('./ranking');
const { transferirGold }                               = require('./transferencia');
const { comprarComGold, venderComGold }                = require('./compras');
const { resolveJidComLid }                             = require('../identity');

function formatarSaldo(centavos, carteira) {
  return `${Number(centavos)} gold`;
}

module.exports = {
  getCarteira,
  alterarGold,
  alterarGoldSeguro,
  rankingGold,
  rankingXp,
  transferirGold,
  comprarComGold,
  venderComGold,
  formatarSaldo,

  // Compat: quem ainda importar resolverJidCarteira daqui continua
  // funcionando. Migre pra require('../identity').resolveJidComLid
  // direto e remova este alias depois.
  resolverJidCarteira: resolveJidComLid,
};