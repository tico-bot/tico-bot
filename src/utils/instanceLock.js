'use strict';

/**
 * Lock ÚNICO de instância do bot (Render x local).
 *
 * Antes existiam dois locks independentes (este e um dentro do
 * mongoAuthState.js). Agora só este existe: quem tem o lock é o único
 * processo autorizado a falar com o WhatsApp e a escrever as chaves Signal.
 *
 * Novidade: se o lock for perdido (outro processo assumiu porque nosso
 * heartbeat falhou por muito tempo), `onLost` é chamado para o bot parar
 * de escrever na sessão — é isso que evita as sessões Signal dessincronizadas.
 */

const mongoose = require('mongoose');
const os       = require('os');
const crypto   = require('crypto');

const LOCK_ID = 'bot-instance-lock';

const InstanceLockSchema = new mongoose.Schema({
  _id:         { type: String, default: LOCK_ID },
  ownerId:     String,
  hostname:    String,
  heartbeatAt: Date,
}, { collection: 'instance_locks' });

const InstanceLock = mongoose.models.InstanceLock || mongoose.model('InstanceLock', InstanceLockSchema);

const OWNER_ID       = crypto.randomUUID();
const HEARTBEAT_MS   = 15_000;
const STALE_AFTER_MS = 45_000; // 3 heartbeats perdidos = considera o dono anterior morto
// Se não conseguirmos renovar por este tempo, assumimos que outro processo
// pode ter tomado o lock e nos rebaixamos ANTES dele ficar "stale" para ele.
const SELF_DEMOTE_MS = 35_000;

let heartbeatTimer = null;
let owned          = false;
let lastOkAt       = 0;
let onLostCb       = null;

/**
 * Tenta assumir o lock. Retorna true se conseguiu (ou já era o dono),
 * false se outro processo com heartbeat recente já está de posse dele.
 */
async function acquireLock() {
  const now            = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_AFTER_MS);

  const assumido = await InstanceLock.findOneAndUpdate(
    {
      _id: LOCK_ID,
      $or: [
        { heartbeatAt: { $lt: staleThreshold } }, // dono anterior está morto
        { ownerId: OWNER_ID },                    // já somos nós
      ],
    },
    { $set: { ownerId: OWNER_ID, hostname: os.hostname(), heartbeatAt: now } },
    { new: true }
  );

  if (assumido) {
    owned = true;
    lastOkAt = Date.now();
    return true;
  }

  // Documento ainda não existe (primeira vez que o bot roda) — tenta criar.
  try {
    await InstanceLock.create({
      _id: LOCK_ID,
      ownerId: OWNER_ID,
      hostname: os.hostname(),
      heartbeatAt: now,
    });
    owned = true;
    lastOkAt = Date.now();
    return true;
  } catch {
    // E11000 duplicate key: já existe e está com heartbeat vivo — outro processo tem o lock.
    return false;
  }
}

function handleLost(motivo) {
  if (!owned) return;
  owned = false;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  console.error(`🚨 Lock de instância perdido (${motivo}).`);
  try { onLostCb?.(motivo); } catch (e) { console.error('⚠️ onLost falhou:', e?.message || e); }
}

/**
 * Inicia o heartbeat (idempotente). `onLost` é chamado se o lock for perdido.
 */
function startHeartbeat(onLost) {
  if (typeof onLost === 'function') onLostCb = onLost;
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    try {
      const res = await InstanceLock.updateOne(
        { _id: LOCK_ID, ownerId: OWNER_ID },
        { $set: { heartbeatAt: new Date() } }
      );
      if (res.matchedCount === 0) return handleLost('outro processo assumiu o lock');
      lastOkAt = Date.now();
    } catch (e) {
      console.error('⚠️ Erro ao renovar instance lock:', e.message);
      if (Date.now() - lastOkAt > SELF_DEMOTE_MS) handleLost('sem conseguir renovar o heartbeat');
    }
  }, HEARTBEAT_MS);
}

async function releaseLock() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  const eraDono = owned;
  owned = false;
  if (!eraDono) return;
  try {
    await InstanceLock.deleteOne({ _id: LOCK_ID, ownerId: OWNER_ID });
  } catch (e) {
    console.error('⚠️ Erro ao liberar instance lock:', e.message);
  }
}

function isOwner() { return owned; }

/** Dados do lock atual (para o comando de status). */
async function getLockInfo() {
  try {
    const doc = await InstanceLock.findById(LOCK_ID).lean();
    if (!doc) return null;
    return {
      ownerId:     doc.ownerId,
      hostname:    doc.hostname,
      heartbeatAt: doc.heartbeatAt,
      souDono:     doc.ownerId === OWNER_ID,
    };
  } catch {
    return null;
  }
}

module.exports = { acquireLock, startHeartbeat, releaseLock, isOwner, getLockInfo, OWNER_ID };
