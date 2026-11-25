'use strict';

const WebP = require('node-webpmux');

const STICKER_PACK_ID = 'com.tico.whatsapp.stickers';
const STICKER_PACK_NAME = 'Tico';
const STICKER_PACK_PUBLISHER = '+55 61 98327-0461';
const INSTALL_FLAG = Symbol.for('tico.stickerMetadata.installed');

function createStickerExif() {
  const metadata = {
    'sticker-pack-id': STICKER_PACK_ID,
    'sticker-pack-name': STICKER_PACK_NAME,
    'sticker-pack-publisher': STICKER_PACK_PUBLISHER,
    emojis: [],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x41, 0x57,
    0x07, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x16, 0x00, 0x00, 0x00,
  ]);

  const exif = Buffer.concat([exifHeader, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);
  return exif;
}

/**
 * Insere os metadados de pacote do Tico em um WebP estático ou animado.
 * Outros tipos de entrada são devolvidos sem alteração para não interromper envios.
 */
async function addTicoStickerMetadata(sticker) {
  const isBytes = Buffer.isBuffer(sticker) || sticker instanceof Uint8Array;
  if (!isBytes) return sticker;

  const input = Buffer.isBuffer(sticker) ? sticker : Buffer.from(sticker);
  if (
    input.length < 12 ||
    input.toString('ascii', 0, 4) !== 'RIFF' ||
    input.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return sticker;
  }

  const image = new WebP.Image();
  await image.load(input);
  image.exif = createStickerExif();

  const output = await image.save(null);
  if (!Buffer.isBuffer(output) || output.length < 100) {
    throw new Error('node-webpmux não gerou um WebP válido com os metadados do Tico.');
  }
  return output;
}

/**
 * Aplica a identificação centralmente a todo sticker enviado pelo socket.
 * O fallback envia o WebP original caso a inclusão de EXIF falhe, evitando
 * que uma falha de metadados impeça o envio da própria figurinha.
 */
function installTicoStickerMetadata(sock) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('Socket inválido para instalar os metadados de figurinhas.');
  }
  if (sock[INSTALL_FLAG]) return false;

  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async function sendMessageWithTicoStickerMetadata(jid, content, options) {
    if (!content || !content.sticker) {
      return originalSendMessage(jid, content, options);
    }

    let preparedContent = content;
    try {
      const sticker = await addTicoStickerMetadata(content.sticker);
      if (sticker !== content.sticker) {
        preparedContent = { ...content, sticker };
      }
    } catch (error) {
      console.error('[StickerMetadata] Não foi possível inserir os metadados do Tico:', error.message);
    }

    return originalSendMessage(jid, preparedContent, options);
  };

  Object.defineProperty(sock, INSTALL_FLAG, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return true;
}

module.exports = {
  STICKER_PACK_ID,
  STICKER_PACK_NAME,
  STICKER_PACK_PUBLISHER,
  createStickerExif,
  addTicoStickerMetadata,
  installTicoStickerMetadata,
};
