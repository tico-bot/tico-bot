'use strict';

function contar(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function somarMensagens(registros) {
  return (Array.isArray(registros) ? registros : []).reduce(
    (total, registro) => total + contar(registro?.mensagens),
    0,
  );
}

/**
 * Consolidates counters split across identity aliases and counter stores.
 * User documents and group wallets are alternative sources for the same
 * activity, so each source is summed independently and the larger total wins.
 */
function calcularTotalMensagens({ usuarios = [], carteiras = [], fallback = 0 } = {}) {
  return Math.max(somarMensagens(usuarios), somarMensagens(carteiras), contar(fallback));
}

function calcularMensagensPerfil({ usuarios = [], fallback = 0, contadorLocal = 0 } = {}) {
  return Math.max(calcularTotalMensagens({ usuarios, fallback }), contar(contadorLocal));
}

function somarCampo(registros, campo) {
  return (Array.isArray(registros) ? registros : []).reduce(
    (total, registro) => total + contar(registro?.[campo]),
    0,
  );
}

function somarCampoCarteirasPorGrupo(carteiras, campo) {
  const maiorPorGrupo = new Map();
  let semGrupo = 0;
  for (const carteira of Array.isArray(carteiras) ? carteiras : []) {
    const valor = contar(carteira?.[campo]);
    const grupo = typeof carteira?.idGrupo === 'string' && carteira.idGrupo ? carteira.idGrupo : null;
    if (!grupo) {
      semGrupo += valor;
      continue;
    }
    maiorPorGrupo.set(grupo, Math.max(maiorPorGrupo.get(grupo) || 0, valor));
  }
  return semGrupo + [...maiorPorGrupo.values()].reduce((total, valor) => total + valor, 0);
}

/**
 * Reconstructs an accumulated statistic from alias-linked user docs and group wallets.
 * User documents and wallets overlap, so their totals are alternatives rather than additive.
 * Wallets are summed across groups, taking the largest value for duplicate PN/LID wallets
 * within one group (same policy as the wallet merge utility).
 */
function calcularTotalAcumulado({ usuarios = [], carteiras = [], campo, fallback = 0 } = {}) {
  if (typeof campo !== 'string' || !campo) return contar(fallback);
  return Math.max(
    somarCampo(usuarios, campo),
    somarCampoCarteirasPorGrupo(carteiras, campo),
    contar(fallback),
  );
}

/** Sum persisted in-memory counters for any PN/LID/device JID belonging to a user. */
function somarContagensIdentidades(mapa, identidades, normalizarJid, campo = null) {
  if (!mapa || typeof mapa.entries !== 'function') return 0;
  const alvo = new Set([...identidades].filter(Boolean));
  let total = 0;
  for (const [jid, valor] of mapa.entries()) {
    const normalizado = typeof normalizarJid === 'function' ? normalizarJid(jid) : jid;
    if (!alvo.has(jid) && (!normalizado || !alvo.has(normalizado))) continue;
    total += contar(campo ? valor?.[campo] : valor);
  }
  return total;
}

module.exports = { calcularTotalMensagens, calcularMensagensPerfil, calcularTotalAcumulado, somarContagensIdentidades };
