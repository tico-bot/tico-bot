'use strict';

const mongoose = require('mongoose');
const { initAuthCreds, proto, BufferJSON } = require('@whiskeysockets/baileys');

// ─── Schema: dados de autenticação (creds + chaves) ──────────────────────────

const authSchema = new mongoose.Schema({
  _id:  { type: String, required: true },
  data: { type: String, required: true }, // JSON string
}, { timestamps: true });

const AuthData = mongoose.models.AuthData || mongoose.model('AuthData', authSchema);

// ─── Lock de sessão ──────────────────────────────────────────────────────────
// O lock agora é UNICO e vive em utils/instanceLock.js (quem inicia o bot
// já o adquire em bot.js → main()). Antes havia um segundo lock aqui, com
// heartbeat próprio, que podia divergir do primeiro. `releaseLock` continua
// exportado por compatibilidade.
const { releaseLock } = require('./utils/instanceLock');

// ─── Cache em memória das chaves Signal ──────────────────────────────────────
// Só UM processo (o dono do lock) escreve estas chaves, então um cache
// write-through é seguro e evita uma ida ao Mongo para cada decrypt/encrypt.
// Guardamos o JSON (string) e fazemos parse na leitura, assim o Baileys/libsignal
// nunca recebe uma referência compartilhada que possa ser mutada por fora.
const CACHE_MAX = 20_000;
const keyCache  = new Map(); // id -> json string

function cacheSet(id, json) {
  if (keyCache.has(id)) keyCache.delete(id); // reinsere no fim (LRU simples)
  keyCache.set(id, json);
  if (keyCache.size > CACHE_MAX) {
    const remover = Math.ceil(CACHE_MAX * 0.1);
    let i = 0;
    for (const k of keyCache.keys()) {
      keyCache.delete(k);
      if (++i >= remover) break;
    }
  }
}

const stats = { sessoesCuradas: 0, cacheHits: 0, cacheMiss: 0 };

// ─── useMongoAuthState ────────────────────────────────────────────────────────

async function useMongoAuthState() {
  async function readJson(id) {
    const cached = keyCache.get(id);
    if (cached !== undefined) { stats.cacheHits++; return cached; }
    stats.cacheMiss++;
    const doc = await AuthData.findById(id).lean();
    if (!doc) return null;
    cacheSet(id, doc.data);
    return doc.data;
  }

  async function readData(id) {
    try {
      const json = await readJson(id);
      if (json == null) return null;
      return JSON.parse(json, BufferJSON.reviver);
    } catch {
      return null;
    }
  }

  async function writeData(id, data) {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await AuthData.findByIdAndUpdate(id, { data: json }, { upsert: true });
    return json;
  }

  let creds = await readData('creds');
  if (!creds) creds = initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result = {};
          await Promise.all(ids.map(async (id) => {
            let val = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && val) {
              val = proto.Message.AppStateSyncKeyData.fromObject(val);
            }
            result[id] = val;
          }));
          return result;
        },
        async set(data) {
          const ops     = [];
          const depois  = []; // atualizações de cache aplicadas só se o Mongo aceitar

          for (const [type, ids] of Object.entries(data)) {
            for (const [id, val] of Object.entries(ids)) {
              const docId = `${type}-${id}`;
              if (val != null) {
                const json = JSON.stringify(val, BufferJSON.replacer);
                ops.push({ updateOne: { filter: { _id: docId }, update: { $set: { data: json } }, upsert: true } });
                depois.push(() => cacheSet(docId, json));
              } else {
                ops.push({ deleteOne: { filter: { _id: docId } } });
                depois.push(() => keyCache.delete(docId));
              }
            }
          }

          if (!ops.length) return;
          await AuthData.bulkWrite(ops, { ordered: false });
          depois.forEach(fn => fn());
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}

async function clearMongoAuthState() {
  try {
    await AuthData.deleteMany({});
    keyCache.clear();
    console.log('🧹 Credenciais da sessão do WhatsApp limpas com sucesso no MongoDB.');
  } catch (err) {
    console.error('⚠️ Erro ao limpar credenciais da sessão no MongoDB:', err.message);
  }
}

/**
 * Apaga as sessões Signal (session-<user>.<device> / session-<user>_1.<device>)
 * de UM contato. Usado para auto-corrigir "Over 2000 messages into the future":
 * a sessão salva ficou defasada em relação ao remetente; sem ela o Baileys
 * pede retry e o remetente renegocia uma sessão nova automaticamente.
 * Também limpa o cache em memória, senão a sessão velha continuaria sendo usada.
 */
async function removeSessionsForUser(user) {
  const clean = String(user || '').split('@')[0].split(':')[0].replace(/[^0-9A-Za-z]/g, '');
  if (!clean) return 0;

  const prefixo = `session-${clean}`;
  for (const k of Array.from(keyCache.keys())) {
    if (k.startsWith(prefixo) && /^[._]/.test(k.slice(prefixo.length))) keyCache.delete(k);
  }

  try {
    const res = await AuthData.deleteMany({ _id: { $regex: new RegExp(`^session-${clean}[._]`) } });
    const n = res.deletedCount || 0;
    if (n > 0) stats.sessoesCuradas++;
    return n;
  } catch (err) {
    console.error('⚠️ Erro ao remover sessões do contato:', err.message);
    return 0;
  }
}

function getAuthStats() {
  return { ...stats, cacheSize: keyCache.size };
}

module.exports = {
  useMongoAuthState,
  clearMongoAuthState,
  releaseLock,
  removeSessionsForUser,
  getAuthStats,
};
