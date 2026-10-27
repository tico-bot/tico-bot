'use strict';

const LidMapping = require('../../models/LidMapping');

function normalizeJid(jid) {
  const [user, server] = String(jid || '').trim().toLowerCase().split('@');
  return user && server ? `${user.split(':')[0]}@${server}` : '';
}

function phoneVariants(jid) {
  const digits = String(jid || '').split('@')[0].replace(/\D/g, '');
  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 8) variants.add(`55${ddd}9${rest}`);
    else if (rest.length === 9 && rest.startsWith('9')) variants.add(`55${ddd}${rest.slice(1)}`);
  }
  return [...variants].filter(Boolean).map(number => `${number}@s.whatsapp.net`);
}

async function resolvePhoneJid(jid) {
  const normalized = normalizeJid(jid);
  if (normalized.endsWith('@lid')) {
    const mapping = await LidMapping.findOne({ lid: normalized }).select('pn').lean();
    return normalizeJid(mapping?.pn);
  }
  const variants = phoneVariants(normalized);
  if (!variants.length) return normalized;
  const mapping = await LidMapping.findOne({ pn: { $in: variants } }).select('pn').lean();
  return normalizeJid(mapping?.pn || normalized);
}

function formatWalletAmount(amount) {
  return `${Number(amount)} gold`;
}

function getWalletBalance() { return Promise.resolve({ linked: false }); }
function adjustWallet() { return Promise.resolve({ linked: false }); }
function adjustWalletLocal() { return Promise.resolve({ linked: false }); }
function transferWallet() { return Promise.resolve({ linked: false, recipientLinked: false }); }
function localMinorUnitsToBrlCents(amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) throw new TypeError('O valor deve ser um inteiro seguro.');
  return value;
}

module.exports = { getWalletBalance, adjustWallet, adjustWalletLocal, transferWallet, formatWalletAmount, localMinorUnitsToBrlCents, normalizeJid, resolvePhoneJid };
