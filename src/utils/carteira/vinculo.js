'use strict';

// Carteiras deste bot são exclusivamente locais; não existe vínculo externo.
async function contaVinculada() { return false; }
async function bloqueadoPorVinculo() { return false; }
module.exports = { contaVinculada, bloqueadoPorVinculo };
