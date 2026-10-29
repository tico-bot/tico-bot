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

module.exports = { calcularTotalMensagens, calcularMensagensPerfil, somarContagensIdentidades };
