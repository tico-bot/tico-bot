'use strict';

/**
 * Mantém a instância nova aguardando o lock até a instância antiga encerrar.
 * O Render pode manter a versão antiga ativa por cerca de 60s após a nova
 * ficar pronta; desistir após 30s deixa a nova versão sem conexão ao WhatsApp.
 */
async function acquireLockWithRetry({
  acquireLock,
  delayMs = 5000,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log,
  logError = console.error,
}) {
  if (typeof acquireLock !== 'function') {
    throw new TypeError('acquireLock precisa ser uma função.');
  }

  while (true) {
    try {
      if (await acquireLock()) return true;
    } catch (err) {
      logError('⚠️ Erro ao tentar adquirir o lock do WhatsApp:', err?.message || err);
    }

    log('⏳ Outra instância ainda controla o WhatsApp; nova tentativa em 5s.');
    await wait(delayMs);
  }
}

module.exports = { acquireLockWithRetry };
