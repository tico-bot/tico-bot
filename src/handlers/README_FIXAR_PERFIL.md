Changes made:

1) handleFixar added to handlers/relacionamento.js — pins messages per chat in in-memory Map.
2) pinnedMessages Map added to bot.js and now persisted to data.json.
3) handlePerfil added to handlers/utilidade.js to properly handle `!perfil @fulano`.

This file documents the quick patch and is safe to remove.
