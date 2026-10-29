'use strict';

const SEPARATOR = '|';

function createGroupCounterKey(groupJid, userJid) {
  if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) return null;
  if (typeof userJid !== 'string' || !userJid.trim()) return null;
  return `${groupJid}${SEPARATOR}${userJid}`;
}

function incrementGroupCounter(map, groupJid, userJid) {
  const key = createGroupCounterKey(groupJid, userJid);
  if (!key || !map || typeof map.get !== 'function' || typeof map.set !== 'function') return 0;
  const current = Number(map.get(key));
  const next = (Number.isFinite(current) && current > 0 ? current : 0) + 1;
  map.set(key, next);
  return next;
}

function countGroupCounter(map, groupJid, identities, normalizeJid) {
  if (!map || typeof map.entries !== 'function' || typeof groupJid !== 'string') return 0;
  const targets = new Set();
  for (const id of identities || []) {
    if (typeof id !== 'string' || !id) continue;
    targets.add(id);
    const normalized = typeof normalizeJid === 'function' ? normalizeJid(id) : id;
    if (normalized) targets.add(normalized);
  }

  let total = 0;
  for (const [key, rawValue] of map.entries()) {
    if (typeof key !== 'string') continue;
    const separatorAt = key.indexOf(SEPARATOR);
    if (separatorAt < 0 || key.slice(0, separatorAt) !== groupJid) continue;
    const storedJid = key.slice(separatorAt + 1);
    const normalized = typeof normalizeJid === 'function' ? normalizeJid(storedJid) : storedJid;
    if (!targets.has(storedJid) && (!normalized || !targets.has(normalized))) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

function listGroupCounters(map, groupJid, normalizeJid) {
  const byUser = new Map();
  if (!map || typeof map.entries !== 'function' || typeof groupJid !== 'string') return [];
  for (const [key, rawValue] of map.entries()) {
    if (typeof key !== 'string') continue;
    const separatorAt = key.indexOf(SEPARATOR);
    if (separatorAt < 0 || key.slice(0, separatorAt) !== groupJid) continue;
    const storedJid = key.slice(separatorAt + 1);
    const userKey = typeof normalizeJid === 'function' ? (normalizeJid(storedJid) || storedJid) : storedJid;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    byUser.set(userKey, (byUser.get(userKey) || 0) + value);
  }
  return [...byUser.entries()];
}

module.exports = { createGroupCounterKey, incrementGroupCounter, countGroupCounter, listGroupCounters };
