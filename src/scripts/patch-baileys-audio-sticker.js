'use strict';

// Adds WhatsApp sound-sticker support to the pinned Baileys build.
// Idempotent: safe to run from npm postinstall after every dependency install.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const baileys = path.join(root, 'node_modules', '@whiskeysockets', 'baileys');
if (!fs.existsSync(baileys)) {
  console.warn('[sticker-audio-patch] Baileys not installed; skipping.');
  process.exit(0);
}
function read(rel) { return fs.readFileSync(path.join(baileys, rel), 'utf8'); }
function write(rel, content) { fs.writeFileSync(path.join(baileys, rel), content, 'utf8'); }
function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text;
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(label + ': expected one anchor, found ' + count);
  return text.replace(before, after);
}
function patchSection(text, startMarker, endMarker, patcher, label) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(label + ': section not found');
  return text.slice(0, start) + patcher(text.slice(start, end)) + text.slice(end);
}

// 1) Canonical proto schema.
{
  const rel = 'WAProto/WAProto.proto';
  let source = read(rel);
  source = patchSection(source, 'message StickerMessage {', 'message StickerPackMessage {', section =>
    replaceOnce(section,
      '        optional string accessibilityLabel = 22;\n    }',
      '        optional string accessibilityLabel = 22;\n        oneof audio {\n            AudioMessage audioMessage = 26;\n        }\n    }',
      'StickerMessage proto schema'
    ),
    'StickerMessage proto schema'
  );
  write(rel, source);
}

// 2) Generated protobuf runtime (encode/decode/verify/conversion).
{
  const rel = 'WAProto/index.js';
  let source = read(rel);
  source = patchSection(source, 'Message.StickerMessage = (function() {', 'Message.StickerPackMessage = (function() {', section => {
    section = replaceOnce(section,
      '            StickerMessage.prototype.accessibilityLabel = null;',
      '            StickerMessage.prototype.accessibilityLabel = null;\n\n            /** StickerMessage embedded audio. */\n            StickerMessage.prototype.audioMessage = null;',
      'StickerMessage runtime prototype'
    );

    section = replaceOnce(section,
      '                if (message.accessibilityLabel != null && Object.hasOwnProperty.call(message, "accessibilityLabel"))\n' +
      '                    writer.uint32(/* id 22, wireType 2 =*/178).string(message.accessibilityLabel);\n' +
      '                return writer;',
      '                if (message.accessibilityLabel != null && Object.hasOwnProperty.call(message, "accessibilityLabel"))\n' +
      '                    writer.uint32(/* id 22, wireType 2 =*/178).string(message.accessibilityLabel);\n' +
      '                if (message.audioMessage != null && Object.hasOwnProperty.call(message, "audioMessage"))\n' +
      '                    $root.proto.Message.AudioMessage.encode(message.audioMessage, writer.uint32(/* id 26, wireType 2 =*/210).fork()).ldelim();\n' +
      '                return writer;',
      'StickerMessage encoder'
    );

    section = replaceOnce(section,
      '                    case 22: {\n' +
      '                            message.accessibilityLabel = reader.string();\n' +
      '                            break;\n' +
      '                        }\n' +
      '                    default:',
      '                    case 22: {\n' +
      '                            message.accessibilityLabel = reader.string();\n' +
      '                            break;\n' +
      '                        }\n' +
      '                    case 26: {\n' +
      '                            message.audioMessage = $root.proto.Message.AudioMessage.decode(reader, reader.uint32());\n' +
      '                            break;\n' +
      '                        }\n' +
      '                    default:',
      'StickerMessage decoder'
    );

    section = replaceOnce(section,
      '                if (message.accessibilityLabel != null && message.hasOwnProperty("accessibilityLabel")) {\n' +
      '                    properties._accessibilityLabel = 1;\n' +
      '                    if (!$util.isString(message.accessibilityLabel))\n' +
      '                        return "accessibilityLabel: string expected";\n' +
      '                }\n' +
      '                return null;',
      '                if (message.accessibilityLabel != null && message.hasOwnProperty("accessibilityLabel")) {\n' +
      '                    properties._accessibilityLabel = 1;\n' +
      '                    if (!$util.isString(message.accessibilityLabel))\n' +
      '                        return "accessibilityLabel: string expected";\n' +
      '                }\n' +
      '                if (message.audioMessage != null && message.hasOwnProperty("audioMessage")) {\n' +
      '                    properties._audioMessage = 1;\n' +
      '                    {\n' +
      '                        let error = $root.proto.Message.AudioMessage.verify(message.audioMessage);\n' +
      '                        if (error)\n' +
      '                            return "audioMessage." + error;\n' +
      '                    }\n' +
      '                }\n' +
      '                return null;',
      'StickerMessage verifier'
    );

    section = replaceOnce(section,
      '                if (object.accessibilityLabel != null)\n' +
      '                    message.accessibilityLabel = String(object.accessibilityLabel);\n' +
      '                return message;',
      '                if (object.accessibilityLabel != null)\n' +
      '                    message.accessibilityLabel = String(object.accessibilityLabel);\n' +
      '                if (object.audioMessage != null) {\n' +
      '                    if (typeof object.audioMessage !== "object")\n' +
      '                        throw TypeError(".proto.Message.StickerMessage.audioMessage: object expected");\n' +
      '                    message.audioMessage = $root.proto.Message.AudioMessage.fromObject(object.audioMessage);\n' +
      '                }\n' +
      '                return message;',
      'StickerMessage fromObject'
    );

    section = replaceOnce(section,
      '                if (message.accessibilityLabel != null && message.hasOwnProperty("accessibilityLabel")) {\n' +
      '                    object.accessibilityLabel = message.accessibilityLabel;\n' +
      '                    if (options.oneofs)\n' +
      '                        object._accessibilityLabel = "accessibilityLabel";\n' +
      '                }\n' +
      '                return object;',
      '                if (message.accessibilityLabel != null && message.hasOwnProperty("accessibilityLabel")) {\n' +
      '                    object.accessibilityLabel = message.accessibilityLabel;\n' +
      '                    if (options.oneofs)\n' +
      '                        object._accessibilityLabel = "accessibilityLabel";\n' +
      '                }\n' +
      '                if (message.audioMessage != null && message.hasOwnProperty("audioMessage")) {\n' +
      '                    object.audioMessage = $root.proto.Message.AudioMessage.toObject(message.audioMessage, options);\n' +
      '                    if (options.oneofs)\n' +
      '                        object._audioMessage = "audioMessage";\n' +
      '                }\n' +
      '                return object;',
      'StickerMessage toObject'
    );
    return section;
  }, 'StickerMessage generated runtime');
  write(rel, source);
}

// 3) Generated declarations.
{
  const rel = 'WAProto/index.d.ts';
  let source = read(rel);
  source = patchSection(source, 'interface IStickerMessage {', 'class StickerMessage implements IStickerMessage {', section =>
    replaceOnce(section,
      '            accessibilityLabel?: (string|null);',
      '            accessibilityLabel?: (string|null);\n\n            /** Embedded sound-sticker audio. */\n            audioMessage?: (proto.Message.IAudioMessage|null);',
      'StickerMessage interface'
    ),
    'StickerMessage interface'
  );
  source = patchSection(source, 'class StickerMessage implements IStickerMessage {', 'class StickerPackMessage implements IStickerPackMessage {', section =>
    replaceOnce(section,
      '            public accessibilityLabel?: (string|null);',
      '            public accessibilityLabel?: (string|null);\n\n            /** Embedded sound-sticker audio. */\n            public audioMessage?: (proto.Message.IAudioMessage|null);',
      'StickerMessage class declaration'
    ),
    'StickerMessage class declaration'
  );
  write(rel, source);
}

// 4) Use Baileys' normal encrypted-media uploader for both image and audio.
{
  const rel = 'lib/Utils/messages.js';
  let source = read(rel);
  source = replaceOnce(source,
    "    else if ('requestPhoneNumber' in message) {\n" +
    '        m.requestPhoneNumberMessage = {};\n' +
    '    }\n' +
    '    else {',
    "    else if ('stickerAudio' in message && 'sticker' in message) {\n" +
    '        const preparedSticker = await prepareWAMessageMedia({ sticker: message.sticker }, options);\n' +
    '        const audioPayload = Buffer.isBuffer(message.stickerAudio)\n' +
    '            ? { audio: message.stickerAudio }\n' +
    '            : message.stickerAudio;\n' +
    '        if (!audioPayload || !audioPayload.audio) {\n' +
    "            throw new Boom('stickerAudio must contain an audio buffer', { statusCode: 400 });\n" +
    '        }\n' +
    '        const preparedAudio = await prepareWAMessageMedia({\n' +
    '            audio: audioPayload.audio,\n' +
    '            seconds: audioPayload.seconds,\n' +
    '            ptt: false,\n' +
    '            mimetype: audioPayload.mimetype || MIMETYPE_MAP.audio\n' +
    '        }, options);\n' +
    '        if (!preparedSticker.stickerMessage || !preparedAudio.audioMessage) {\n' +
    "            throw new Boom('Unable to prepare sound sticker media', { statusCode: 500 });\n" +
    '        }\n' +
    '        preparedSticker.stickerMessage.audioMessage = preparedAudio.audioMessage;\n' +
    '        m = preparedSticker;\n' +
    '    }\n' +
    "    else if ('requestPhoneNumber' in message) {\n" +
    '        m.requestPhoneNumberMessage = {};\n' +
    '    }\n' +
    '    else {',
    'Baileys stickerAudio message builder'
  );
  write(rel, source);
}

// Keep the public Baileys content types in sync with the custom send option.
{
  const rel = 'lib/Types/Message.d.ts';
  let source = read(rel);
  source = replaceOnce(
    source,
    '    sticker: WAMediaUpload;\n    isAnimated?: boolean;',
    '    sticker: WAMediaUpload;\n    stickerAudio?: WAMediaUpload | { audio: WAMediaUpload; seconds?: number; mimetype?: string };\n    isAnimated?: boolean;',
    'Baileys stickerAudio type declaration'
  );
  write(rel, source);
}

console.log('[sticker-audio-patch] StickerMessage.audioMessage + stickerAudio send pipeline installed.');