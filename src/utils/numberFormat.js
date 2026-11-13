'use strict';

const formatadorNumeroBR = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
});

function formatarNumeroBR(valor) {
  const numero = Number(valor);
  return formatadorNumeroBR.format(Number.isFinite(numero) ? numero : 0);
}

module.exports = { formatarNumeroBR };
