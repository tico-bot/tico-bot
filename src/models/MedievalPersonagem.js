'use strict';

// Nome do arquivo: MedievalPersonagem.js
const mongoose = require('mongoose');

const medievalPersonagemSchema = new mongoose.Schema(
  {
    // ── Identificação ─────────────────────────────────────────────────────────
    idWhatsApp: {
      type:      String,
      required:  true,
      trim:      true,
      lowercase: true,
    },
    idGrupo: {
      type:      String,
      required:  true,
      trim:      true,
      lowercase: true,
    },

    // ── Identidade ────────────────────────────────────────────────────────────
    nome:     { type: String,  default: null },
    classe:   { type: String,  default: null },
    elemento: { type: String,  default: null },

    // ── Status base ───────────────────────────────────────────────────────────
    // min: 0 em todos os stats — evita valores negativos por $inc errado
    hp:      { type: Number, default: 100, min: 0 },
    hpMax:   { type: Number, default: 100, min: 1 },
    mana:    { type: Number, default: 80,  min: 0 },
    manaMax: { type: Number, default: 80,  min: 1 },
    ataque:  { type: Number, default: 10,  min: 0 },
    defesa:  { type: Number, default: 5,   min: 0 },

    // ── Progressão ────────────────────────────────────────────────────────────
    nivel:      { type: Number, default: 1, min: 1 },
    xpMedieval: { type: Number, default: 0, min: 0 },
    vitorias:   { type: Number, default: 0, min: 0 },
    derrotas:   { type: Number, default: 0, min: 0 },

    // ── Equipamentos ──────────────────────────────────────────────────────────
    armaEquipada:     { type: String, default: null },
    armaduraEquipada: { type: String, default: null },

    // ── Inventário de itens medievais ─────────────────────────────────────────
    // Map<nomeItem, quantidade>
    // IMPORTANTE: espaços no nome do item são substituídos por "_" em TODAS as operações
    // Exemplo: "Espada Rúnica" → chave "Espada_Rúnica"
    // Usar sempre: item.nome.replace(/ /g, '_') para escrever e .replace(/_/g, ' ') para ler
    inventarioMedieval: {
      type:    Map,
      of:      Number,
      default: () => ({}),   // factory function evita compartilhamento de referência
    },

    // ── Habilidades desbloqueadas (reservado para expansão futura) ────────────
    habilidades: {
      type:    [String],
      default: () => ([]),
    },

    // ── Histórico de batalhas (últimas 5) ─────────────────────────────────────
    historicoBatalhas: {
      type:    [
        {
          tipo:       { type: String }, // 'ataque' | 'magia' | 'defesa'
          oponente:   { type: String }, // nome do oponente
          dano:       { type: Number },
          resultado:  { type: String }, // 'vitoria' | 'derrota' | 'neutro'
          critico:    { type: Boolean, default: false },
          data:       { type: Date,    default: Date.now },
        },
      ],
      default: () => ([]),
    },

    // ── Cooldowns — undefined por padrão (sem default: null) ─────────────────
    // Usar undefined ao invés de null evita que queries como
    // { ultimoAtaque: { $lte: X } } retornem documentos novos inesperadamente
        ultimoAtaque:  { type: Date },
    ultimaMagia:   { type: Date },
    ultimaMissao:  { type: Date },
    ultimaRecarga: { type: Date },

    // ── Anti-farm persistente (sobrevive a restart e funciona multi-instância) ──
    ultimoAlvoAtaque:    { type: String, default: null },
    quandoAtacouAlvo:    { type: Date,   default: null },
    ultimoAlvoMagia:     { type: String, default: null },
    quandoUsouMagiaAlvo: { type: Date,   default: null },

    // ── Estado de derrota (sistema de saque) ──────────────────────────────────
    // Preenchido quando o hp chega a 0 em !atacar/!magia. Define quem pode
    // usar !saquear e até quando (janela de vulnerabilidade de 3 minutos).
    derrotadoEm:  { type: Date },
    derrotadoPor: { type: String, default: null },
  },
  {
    timestamps: true,  // createdAt + updatedAt automáticos
    versionKey: false, // remove o campo __v desnecessário
  }
);

// ── Índices ───────────────────────────────────────────────────────────────────
// Único por (usuário + grupo) — impede personagem duplicado
medievalPersonagemSchema.index({ idWhatsApp: 1, idGrupo: 1 }, { unique: true });
// Índice composto cobre a query de rank: sort({ vitorias: -1, nivel: -1 })
medievalPersonagemSchema.index({ idGrupo: 1, vitorias: -1, nivel: -1 });
// Ranking por nível dentro do grupo
medievalPersonagemSchema.index({ idGrupo: 1, nivel: -1 });

// ── Export com proteção contra re-compilação (hot reload / Render) ────────────
module.exports =
  mongoose.models.MedievalPersonagem ||
  mongoose.model('MedievalPersonagem', medievalPersonagemSchema);