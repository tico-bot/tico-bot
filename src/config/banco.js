'use strict';

// ─── Configurações do Banco ───────────────────────────────────────────────────

const BANCO_CONFIG = {
  PRAZO_MS:         20 * 60 * 1000, // 20 minutos
  JUROS_MIN:        5,
  JUROS_MAX:        15,
  DAILY_LIMIT:      100000,
  HISTORICO_LIMITE: 10,
};

module.exports = {
  BANCO_CONFIG,
};
