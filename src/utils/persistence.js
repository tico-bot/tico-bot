'use strict';

const path = require('path');
const fs   = require('fs');
const { getGroupPrefix } = require('./prefixos');
const { incrementGroupCounter } = require('./group-activity');

// handlers/relacionamento expõe os Maps de estado (xpCasais, bloqueados,
// diariosUsados, xpBonus) que este módulo restaura/persiste no data.json.
// Isso preserva 1:1 o comportamento do bot.js original — nenhuma lógica
// nova, só extração.
const relacionamentoHandler = require('../handlers/relacionamento');

// ═══════════════════════════════════════════════════════════════
// ─── Arquivo de persistência local (cache — MongoDB é a fonte
// de verdade dos dados de jogo/economia; este arquivo guarda só
// contadores locais de atividade e estado efêmero de sessão) ────
// ═══════════════════════════════════════════════════════════════

const DATA_FILE = path.resolve(__dirname, '..', '..', 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.log('⚠️ Erro ao carregar data.json:', e.message); }
  return {
    msgCount:       {},
    stickerCount:   {},
    cmdCount:       {},
    pinnedMessages: {},
    groupConfig:    {},
    warnings:       {},
    relacionamentos:          {},
    relacionamentoXp:         {},
    relacionamentoBloqueados: {},
    relacionamentoDiarios:    {},
    relacionamentoXpBonus:    {},
  };
}

const _savedData   = loadData();
const msgCount     = new Map(Object.entries(_savedData.msgCount     || {}));
const stickerCount = new Map(Object.entries(_savedData.stickerCount || {}));
const cmdCount     = new Map(Object.entries(_savedData.cmdCount     || {}));
const groupMsgCount     = new Map(Object.entries(_savedData.groupMsgCount     || {}));
const groupStickerCount = new Map(Object.entries(_savedData.groupStickerCount || {}));
const groupCmdCount     = new Map(Object.entries(_savedData.groupCmdCount     || {}));

// Warnings: Map<groupJid, Map<userJid, count>>
const warnings = new Map();
for (const [gJid, usersObj] of Object.entries(_savedData.warnings || {})) {
  if (typeof usersObj === 'object') warnings.set(gJid, new Map(Object.entries(usersObj)));
}

// ── Restaura relacionamentos e estados associados ──
const relacionamentos = new Map(Object.entries(_savedData.relacionamentos || {}));

for (const [k, v] of Object.entries(_savedData.relacionamentoXp || {})) {
  relacionamentoHandler.xpCasais.set(k, v);
}
for (const [k, v] of Object.entries(_savedData.relacionamentoBloqueados || {})) {
  relacionamentoHandler.bloqueados.set(k, v);
}
for (const [k, v] of Object.entries(_savedData.relacionamentoDiarios || {})) {
  relacionamentoHandler.diariosUsados.set(k, v);
}
for (const [k, v] of Object.entries(_savedData.relacionamentoXpBonus || {})) {
  relacionamentoHandler.xpBonus.set(k, v);
}

console.log(`📂 Dados carregados: ${msgCount.size} usuário(s) no histórico, ${relacionamentos.size} relacionamento(s)`);

function saveData() {
  try {
    const existingData = fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {}
      : {};

    const warningsObj = {};
    for (const [gJid, usersMap] of warnings.entries()) {
      warningsObj[gJid] = Object.fromEntries([...usersMap.entries()]);
    }

    const data = {
      ...existingData,
      msgCount:       Object.fromEntries([...msgCount.entries()]),
      stickerCount:   Object.fromEntries([...stickerCount.entries()]),
      cmdCount:       Object.fromEntries([...cmdCount.entries()]),
      groupMsgCount:     Object.fromEntries([...groupMsgCount.entries()]),
      groupStickerCount: Object.fromEntries([...groupStickerCount.entries()]),
      groupCmdCount:     Object.fromEntries([...groupCmdCount.entries()]),
      warnings:       warningsObj,
      groupConfig: {
        autoSticker: [...autoStickerGroups],
        prefixos:    Object.fromEntries([...prefixMap.entries()]),
      },
      relacionamentos:          Object.fromEntries([...relacionamentos.entries()]),
      relacionamentoXp:         Object.fromEntries([...relacionamentoHandler.xpCasais.entries()]),
      relacionamentoBloqueados: Object.fromEntries([...relacionamentoHandler.bloqueados.entries()]),
      relacionamentoDiarios:    Object.fromEntries([...relacionamentoHandler.diariosUsados.entries()]),
      relacionamentoXpBonus:    Object.fromEntries([...relacionamentoHandler.xpBonus.entries()]),
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.log('⚠️ Erro ao salvar data.json:', e.message); }
}

setInterval(saveData, 60 * 1000);
process.on('SIGINT',  () => { saveData(); process.exit(); });
process.on('SIGTERM', () => { saveData(); process.exit(); });

// ── Configuração de grupo salva (auto-sticker, prefixos) ──────────────────
const _cfg = _savedData.groupConfig || {};
const autoStickerGroups = new Set(_cfg.autoSticker || []);
const prefixMap         = new Map();
if (_cfg.prefixos) {
  for (const [k, v] of Object.entries(_cfg.prefixos)) prefixMap.set(k, v);
}

function getPrefix(jid) {
  // Fonte única: cache de utils/prefixos (atualizado por setGroupPrefix e hidratado do Mongo).
  // Se ele ainda estiver no padrão, cai no valor legado do data.json.
  const p = getGroupPrefix(jid);
  return p !== '!' ? p : (prefixMap.get(jid) || '!');
}

const pinnedMessages = new Map(Object.entries(_savedData.pinnedMessages || {}));

// ─── Contadores (chamam saveData() com throttling — igual ao original) ──────
function contarSticker(jid, groupJid = null, map = stickerCount) {
  if (!jid || !map || typeof map.set !== 'function') return;
  map.set(jid, (map.get(jid) || 0) + 1);
  if (map === stickerCount && groupJid) incrementGroupCounter(groupStickerCount, groupJid, jid);
  if (map === stickerCount) saveData();
}
function contarCmd(jid, groupJid = null) {
  cmdCount.set(jid, (cmdCount.get(jid) || 0) + 1);
  if (groupJid) incrementGroupCounter(groupCmdCount, groupJid, jid);
  if (cmdCount.get(jid) % 5 === 0) saveData();
}
function contarMensagem(jid, nome, groupJid = null) {
  const cur = msgCount.get(jid) || { nome, count: 0 };
  cur.nome  = nome || cur.nome;
  cur.count++;
  msgCount.set(jid, cur);
  if (groupJid) incrementGroupCounter(groupMsgCount, groupJid, jid);
  if (cur.count % 10 === 0) saveData();
}

module.exports = {
  DATA_FILE,
  loadData,
  saveData,

  msgCount,
  stickerCount,
  cmdCount,
  groupMsgCount,
  groupStickerCount,
  groupCmdCount,
  warnings,
  relacionamentos,
  pinnedMessages,

  autoStickerGroups,
  prefixMap,
  getPrefix,

  contarSticker,
  contarCmd,
  contarMensagem,
};