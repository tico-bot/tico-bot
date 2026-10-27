'use strict';

const mongoose = require('mongoose');

// ─── Sub-schema: histórico de gold ───────────────────────────────────────────
const goldHistorySchema = new mongoose.Schema({
  type:   { type: String, enum: ['recebido', 'gasto'], required: true },
  item:   { type: String, required: true, trim: true },
  amount: { type: Number, required: true },
  date:   { type: Date,   default: Date.now },
}, { _id: false });

// ─── Sub-schema: pet ─────────────────────────────────────────────────────────
const petSchema = new mongoose.Schema({
  type:            { type: String,  default: null },
  name:            { type: String,  default: null, trim: true },
  rarity:          { type: String,  default: null },
  level:           { type: Number,  default: 1,    min: 1 },
  xp:              { type: Number,  default: 0,    min: 0 },
  happiness:       { type: Number,  default: 60,   min: 0, max: 100 },
  energy:          { type: Number,  default: 80,   min: 0, max: 100 },
  fullness:        { type: Number,  default: 80,   min: 0, max: 100 },
  capturedAt:      { type: Date,    default: null },
  lastInteraction: { type: Date,    default: null },
}, { _id: false });

// ─── Sub-schema: abrigo de pet ───────────────────────────────────────────────
const petShelterSchema = new mongoose.Schema({
  isSheltered:  { type: Boolean, default: false },
  shelteredPet: { type: Object,  default: null },
  leftAt:       { type: Date,    default: null },
}, { _id: false });

// ─── Sub-schema: progresso de missões ────────────────────────────────────────
const missaoNumSchema = new mongoose.Schema({
  xp100:   { type: Number, default: 0, min: 0 },
  msg50:   { type: Number, default: 0, min: 0 },
  quiz5:   { type: Number, default: 0, min: 0 },
  gold500: { type: Number, default: 0, min: 0 },
  pet10:   { type: Number, default: 0, min: 0 },
  roubo3:  { type: Number, default: 0, min: 0 },
}, { _id: false });

const missaoBoolSchema = new mongoose.Schema({
  xp100:   { type: Boolean, default: false },
  msg50:   { type: Boolean, default: false },
  quiz5:   { type: Boolean, default: false },
  gold500: { type: Boolean, default: false },
  pet10:   { type: Boolean, default: false },
  roubo3:  { type: Boolean, default: false },
}, { _id: false });

const dailyMissionsSchema = new mongoose.Schema({
  date:      { type: String,           default: null },
  progress:  { type: missaoNumSchema,  default: () => ({}) },
  completed: { type: missaoBoolSchema, default: () => ({}) },
  claimed:   { type: missaoBoolSchema, default: () => ({}) },
}, { _id: false });

// ─── Sub-schema: item da loja do casal ───────────────────────────────────────
const casalItemSchema = new mongoose.Schema({
  itemKey:     { type: String, required: true, trim: true, lowercase: true },
  compradoPor: { type: String, required: true },
  compradoEm:  { type: Date,   default: Date.now },
}, { _id: false });

// ─── Schema principal ─────────────────────────────────────────────────────────
const usuarioSchema = new mongoose.Schema({
  // ── Identificação ────────────────────────────────────────────
  idWhatsApp: { type: String, required: true, unique: true, trim: true, lowercase: true },
  nome:         { type: String, default: null,  trim: true },
  telefone:     { type: String, default: null,  trim: true },
  uid:          { type: String, unique: true,   sparse: true, default: () => new mongoose.Types.ObjectId().toHexString() },
  bio:          { type: String, default: null,  trim: true, maxlength: 150 },

  // ── Conta do painel (login com usuário e senha) ──────────────
  // Sem `default: null` aqui de propósito: com sparse:true no índice, o Mongo
  // só ignora o campo quando ele está AUSENTE do documento — um null explícito
  // ainda conta como "existe" e quebra o unique index assim que o segundo
  // usuário sem username/email é criado. Sem default, o Mongoose não grava
  // o campo quando ele não é informado, e o sparse index volta a funcionar.
  username:     { type: String, trim: true, lowercase: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, default: null },
  email:        { type: String, trim: true, lowercase: true },

  // ── Banimento global ─────────────────────────────────────────
  // Necessário para PATCH /api/admin/usuario/:id/ban funcionar.
  // Sem este campo o Mongoose ignora o $set silenciosamente (strict mode).
  // GET /api/admin/usuarios também depende deste campo para retornar
  // o status correto — sem ele sempre chegava como undefined no frontend.
  banido: { type: Boolean, default: false },

  // ── Progressão global ────────────────────────────────────────
  xp:         { type: Number, default: 0,   min: 0 },
  level:      { type: Number, default: 1,   min: 1 },
  gold:       { type: Number, default: 0, min: 0 },
  walletMigration: {
    type: new mongoose.Schema({
      id: { type: String, default: null },
      goldCents: { type: Number, default: 0 },
    }, { _id: false }),
    default: undefined,
    select: false,
  },
  quizPoints: { type: Number, default: 0,   min: 0 },
  mensagens:  { type: Number, default: 0,   min: 0 },

  // ── Histórico diário de XP (chave: "YYYY-MM-DD", valor: XP ganho no dia) ──
  xpHistory:        { type: Map, of: Number, default: {} },

  // ── Atividade semanal (array de 7 posições, dom→sáb) ─────────────────────
  atividadeSemanal: { type: [Number], default: [0, 0, 0, 0, 0, 0, 0] },

  // ── Relacionamento ───────────────────────────────────────────
  xpCasal:     { type: Number, default: 0,    min: 0 },
  casadoCom:   { type: String, default: null },
  casadoTipo:  { type: String, enum: ['casamento', 'namoro', null], default: null },
  casadoDesde: { type: Date,   default: null },
  casadoGrupo: { type: String, default: null },
  casalItens:  { type: [casalItemSchema], default: [] },

  // ── Inventário ───────────────────────────────────────────────
  // Mixed aceita Map<string,number>, objeto plano ou array — o frontend normaliza.
  inventory:   { type: mongoose.Schema.Types.Mixed, default: {} },

  // ── Histórico de gold ────────────────────────────────────────
  goldHistory: { type: [goldHistorySchema], default: [] },

  // ── Pet ──────────────────────────────────────────────────────
  pet:        { type: petSchema,        default: () => ({}) },
  petShelter: { type: petShelterSchema, default: () => ({}) },

  // ── Missões diárias ──────────────────────────────────────────
  dailyMissions: { type: dailyMissionsSchema, default: () => ({}) },



  // ── Acessórios de casal equipados (itemKey → boolean) ────────
  acessoriosCasal: { type: Map, of: Boolean, default: {} },

  // ── Advertências (jid do grupo → contagem) ───────────────────
  warnings: { type: Map, of: Number, default: {} },

}, {
  timestamps: true,
});

// O saldo global também é local: todas as alterações são persistidas diretamente no MongoDB.

// ─── Índices ──────────────────────────────────────────────────────────────────
usuarioSchema.index({ gold: -1 });
usuarioSchema.index({ xp: -1 });
usuarioSchema.index({ quizPoints: -1 });
usuarioSchema.index({ email: 1 },    { unique: true, sparse: true });
usuarioSchema.index({ username: 1 }, { unique: true, sparse: true });
usuarioSchema.index({ casadoCom: 1 }, { sparse: true }); // GET /admin/relacionamentos
usuarioSchema.index({ banido: 1 },    { sparse: true }); // GET /admin/usuarios

// ─── Exportar ─────────────────────────────────────────────────────────────────
module.exports = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);