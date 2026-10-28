'use strict';

const CarteiraGrupo = require('../../models/CarteiraGrupo');

const MAX_LIMITE = 50;

function validarGrupo(idGrupo) {
  if (typeof idGrupo !== 'string' || !idGrupo.trim()) {
    throw new TypeError('carteira/ranking: "idGrupo" é obrigatório e deve ser uma string não vazia.');
  }
  return idGrupo.trim().toLowerCase();
}

function validarLimite(limite) {
  const numero = Number(limite);
  if (!Number.isFinite(numero)) return 10;
  return Math.max(1, Math.min(MAX_LIMITE, Math.floor(numero)));
}

async function rankingGold(idGrupo, limite = 10) {
  const grupo = validarGrupo(idGrupo);
  const max = validarLimite(limite);
  return CarteiraGrupo.find({ idGrupo: grupo, gold: { $gt: 0 } })
    .select('idWhatsApp gold level xp')
    .sort({ gold: -1, _id: 1 })
    .limit(max)
    .lean();
}

async function rankingXp(idGrupo, limite = 10) {
  const grupo = validarGrupo(idGrupo);
  const max = validarLimite(limite);
  return CarteiraGrupo.find({ idGrupo: grupo, xp: { $gt: 0 } })
    .sort({ xp: -1, _id: 1 })
    .limit(max)
    .select('idWhatsApp xp level gold')
    .lean();
}

module.exports = { rankingGold, rankingXp };
