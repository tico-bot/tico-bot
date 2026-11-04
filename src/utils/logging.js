'use strict';

function formatErrorDetails(error) {
  if (error?.stack && typeof error.stack === 'string') return error.stack;
  if (error?.message && typeof error.message === 'string') {
    return `${error.name || 'Error'}: ${error.message}`;
  }
  if (error === null || error === undefined) return String(error);
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : String(error);
  } catch {
    return String(error);
  }
}

function logError(scope, error, context = '') {
  const label = String(scope || 'Erro').trim().replace(/[\r\n\[\]]/g, '');
  const detail = formatErrorDetails(error);
  const prefix = context ? `${context}: ` : '';
  console.error(`[${label}] ${prefix}${detail}`);
}

module.exports = { formatErrorDetails, logError };
