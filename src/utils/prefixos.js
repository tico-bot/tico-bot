'use strict';

const GrupoConfig = require('../models/GrupoConfig');

const DEFAULT_PREFIXES = ['!', '.', '/', ',', '#'];

// ─── Cache local de prefixos customizados por grupo ─────────────────────────
// Dono exclusivo deste módulo — não depende mais de utils/persistence.js.
// Bug corrigido: a versão anterior importava `setPrefix` de persistence.js,
// mas esse arquivo nunca exportou essa função — então `setGroupPrefix()`
// salvava o prefixo no MongoDB (GrupoConfig) só que NUNCA atualizava nada
// em memória, e `getGroupPrefix()` continuava servindo o prefixo antigo até
// o processo reiniciar. Ou seja: trocar o prefixo do grupo não tinha efeito
// nenhum na prática. Agora o cache é local a este módulo, atualizado na
// hora em `setGroupPrefix()`, e pode ser pré-carregado do Mongo no boot via
// `hydratePrefixCache()`.
const customPrefixCache = new Map();

/**
 * Retorna o prefixo ativo para o grupo/chat.
 * @param {string} jid
 * @returns {string}
 */
function getGroupPrefix(jid) {
  return customPrefixCache.get(jid) || '!';
}

/**
 * Define um novo prefixo para o grupo/chat: persiste no MongoDB e
 * atualiza o cache em memória na mesma chamada, para que o próximo
 * comando já reconheça o novo prefixo sem precisar reiniciar o bot.
 * @param {string} jid
 * @param {string} novoPrefixo
 */
async function setGroupPrefix(jid, novoPrefixo) {
  if (!DEFAULT_PREFIXES.includes(novoPrefixo)) {
    throw new Error(`Prefixo inválido. Escolha um dos permitidos: ${DEFAULT_PREFIXES.join(' ')}`);
  }
  await GrupoConfig.findOneAndUpdate(
    { idGrupo: jid },
    { $set: { prefixo: novoPrefixo } },
    { upsert: true }
  );
  customPrefixCache.set(jid, novoPrefixo);
}

/**
 * Carrega o cache de prefixos customizados a partir do MongoDB. Chamar
 * uma vez no boot do bot, depois de conectar ao Mongo — sem isso, um
 * grupo que já tinha prefixo customizado antes do último restart volta
 * a responder só ao prefixo padrão até alguém rodar o comando de trocar
 * o prefixo de novo.
 */
async function hydratePrefixCache() {
  try {
    const docs = await GrupoConfig.find(
      { prefixo: { $exists: true, $ne: '!' } },
      { idGrupo: 1, prefixo: 1 }
    ).lean();
    for (const doc of docs) {
      if (doc?.idGrupo && doc?.prefixo) customPrefixCache.set(doc.idGrupo, doc.prefixo);
    }
    console.log(`🔤 Prefixos customizados carregados: ${customPrefixCache.size} grupo(s).`);
  } catch (err) {
    console.error('⚠️ Erro ao carregar cache de prefixos:', err.message);
  }
}

/**
 * Verifica se o texto começa com qualquer prefixo válido ou o prefixo customizado do grupo.
 * @param {string} text
 * @param {string} [jid]
 * @returns {boolean}
 */
function isAnyCmd(text, jid) {
  if (!text || typeof text !== 'string') return false;
  const pGroup = jid ? getGroupPrefix(jid) : null;
  const allPrefixes = pGroup ? Array.from(new Set([...DEFAULT_PREFIXES, pGroup])) : DEFAULT_PREFIXES;
  return allPrefixes.some(p => text.startsWith(p));
}

/**
 * Verifica se o texto corresponde ao comando específico com qualquer prefixo válido.
 * Ex: matchCmd('!bot off', 'bot', jid) -> true
 * Ex: matchCmd('.bot off', 'bot', jid) -> true
 * @param {string} rawText
 * @param {string} cmdName
 * @param {string} [jid]
 * @returns {boolean}
 */
function matchCmd(rawText, cmdName, jid) {
  if (!rawText || typeof rawText !== 'string') return false;
  const cleanCmd = cmdName.toLowerCase().trim();
  const lowerText = rawText.toLowerCase().trim();
  const firstWord = lowerText.split(/\s+/)[0];

  const pGroup = jid ? getGroupPrefix(jid) : null;
  const allPrefixes = pGroup ? Array.from(new Set([...DEFAULT_PREFIXES, pGroup])) : DEFAULT_PREFIXES;

  return allPrefixes.some(p => firstWord === p + cleanCmd || lowerText.startsWith(p + cleanCmd + ' '));
}

/**
 * Extrai os argumentos limpos de um comando.
 * Ex: extractArgs('!bot off', 'bot', jid) -> 'off'
 * Ex: extractArgs('.bot on', 'bot', jid) -> 'on'
 * @param {string} rawText
 * @param {string} cmdName
 * @param {string} [jid]
 * @returns {string}
 */
function extractArgs(rawText, cmdName, jid) {
  if (!rawText || typeof rawText !== 'string') return '';
  const cleanCmd = cmdName.toLowerCase().trim();
  const pGroup = jid ? getGroupPrefix(jid) : null;
  const allPrefixes = pGroup ? Array.from(new Set([...DEFAULT_PREFIXES, pGroup])) : DEFAULT_PREFIXES;

  for (const p of allPrefixes) {
    const target = p + cleanCmd;
    if (rawText.toLowerCase().startsWith(target)) {
      return rawText.slice(target.length).trim();
    }
  }
  return rawText.trim();
}

module.exports = {
  DEFAULT_PREFIXES,
  getGroupPrefix,
  setGroupPrefix,
  hydratePrefixCache,
  isAnyCmd,
  matchCmd,
  extractArgs,
};
