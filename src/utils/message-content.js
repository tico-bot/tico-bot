'use strict';

const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];

/**
 * Desembrulha mensagens temporárias/visualização única, inclusive quando um
 * envelope está aninhado dentro de outro (por exemplo, ephemeral + view-once).
 */
function unwrapMessageContent(message) {
  let current = message;

  for (let depth = 0; depth < 10 && current && typeof current === 'object'; depth += 1) {
    let nested = null;
    for (const field of MESSAGE_WRAPPERS) {
      if (current[field]?.message) {
        nested = current[field].message;
        break;
      }
    }
    if (!nested) break;
    current = nested;
  }

  return current;
}

module.exports = { unwrapMessageContent };
