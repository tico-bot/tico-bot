'use strict';

const RATE_LIMIT_PATTERN = /HTTP Error 429|too many requests|this content isn't available, try again later/i;

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createYoutubeRequestQueue({
  minIntervalMs = 8000,
  rateLimitCooldownMs = 60000,
  now = Date.now,
  sleep = defaultSleep,
  onWait = () => {},
} = {}) {
  let tail = Promise.resolve();
  let nextAllowedAt = 0;

  return function enqueue(task) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('A tarefa do YouTube precisa ser uma função.'));
    }

    const scheduled = tail.then(async () => {
      const waitMs = Math.max(0, nextAllowedAt - now());
      if (waitMs > 0) {
        onWait(waitMs);
        await sleep(waitMs);
      }

      let result;
      try {
        result = await task();
      } catch (error) {
        nextAllowedAt = Math.max(nextAllowedAt, now() + minIntervalMs);
        if (RATE_LIMIT_PATTERN.test(String(error?.message || ''))) {
          nextAllowedAt = Math.max(nextAllowedAt, now() + rateLimitCooldownMs);
        }
        throw error;
      }

      nextAllowedAt = Math.max(nextAllowedAt, now() + minIntervalMs);
      if (!result?.ok && RATE_LIMIT_PATTERN.test(String(result?.stderr || ''))) {
        nextAllowedAt = Math.max(nextAllowedAt, now() + rateLimitCooldownMs);
      }
      return result;
    });

    // Uma falha não pode quebrar a fila nem impedir as próximas solicitações.
    tail = scheduled.catch(() => {});
    return scheduled;
  };
}

module.exports = { createYoutubeRequestQueue };
