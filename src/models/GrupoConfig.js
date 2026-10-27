'use strict';
const mongoose = require('mongoose');

const grupoConfigSchema = new mongoose.Schema(
  {
    idGrupo: { type: String, required: true, unique: true, trim: true },
    nomeGrupo: { type: String, default: null, trim: true },
    nomeCustom: { type: String, default: null, trim: true },

    // ── Prefixo ──────────────────────────────────────────────────
    prefixo: {
      type:      String,
      default:   '!',
      enum:      ['!', '.', '/', ',', '#'],
      trim:      true,
    },

    // ── Moderação ────────────────────────────────────────────────
    antiLink:          { type: Boolean, default: false },
    autoSticker:       { type: Boolean, default: false },
    slowModeAtivo:     { type: Boolean, default: false },
    slowModeSegundos:  { type: Number,  default: 30,  min: 1  },
    antiFloodAtivo:    { type: Boolean, default: false },
    antiFloodLimite:   { type: Number,  default: 5,   min: 2  },
    antiFloodJanelaMs: { type: Number,  default: 10000, min: 2000 },

    // ── Sistemas ─────────────────────────────────────────────────
    sistemaAniversario: { type: Boolean, default: false },
    sistemaPet:         { type: Boolean, default: false },
    sistemaGold:        { type: Boolean, default: false },
    medievalAtivo:      { type: Boolean, default: false },
    botAtivo:           { type: Boolean, default: true  },
    xpAtivo:            { type: Boolean, default: true  },
    rankingSemanal:     { type: Boolean, default: false },

    // ── Bem-vindo ────────────────────────────────────────────────
    bemVindoAtivo:    { type: Boolean, default: false },
    bemVindoMensagem: { type: String,  default: null,  trim: true },
    boasVindas:       { type: Boolean, default: true  },

    // ── Regras do Grupo ──────────────────────────────────────────
    regras:           { type: String,  default: null,  trim: true },
  },
  {
    timestamps: true,
    collection: 'grupoconfigs',
  }
);

module.exports =
  mongoose.models.GrupoConfig ||
  mongoose.model('GrupoConfig', grupoConfigSchema);