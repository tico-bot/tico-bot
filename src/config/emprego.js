'use strict';

const HORARIO = {
  INICIO_MIN: 8 * 60,  // 08:00
  FIM_MIN:    23 * 60, // 23:00
  FUSO:       'America/Cuiaba',
};

const COOLDOWN_WORK_MS = 40 * 60 * 1000; // 40 minutos entre turnos
const JANELA_TOLERANCIA_MS = 30 * 60 * 1000; // 30 minutos de tolerância

module.exports = {
  HORARIO,
  COOLDOWN_WORK_MS,
  JANELA_TOLERANCIA_MS,
};
