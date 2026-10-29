'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenu(sock, msg, jid, caption, getPrefix, author) {
  const P = obterPrefixo(jid, getPrefix);
  const timeStr = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const hour = Number(timeStr.slice(0, 2));
  const greeting = hour >= 5 && hour < 12 ? '🌅 Bom dia'
    : hour >= 12 && hour < 18 ? '☀️ Boa tarde' : '🌙 Boa noite';
  const userMention = author ? '*' + String(author).replace(/[*_]/g, '') + '*' : '';

  const menu = [
    '╔══════════════════════╗',
    '       🔥 Tico 🔥',
    '╚══════════════════════╝',
    '',
    greeting + (userMention ? ', ' + userMention : '') + '! São ' + timeStr + ' ⏰',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '🎨 *FIGURINHAS & EFEITOS*',
    '  ▸ ' + P + 'menufig — criar e buscar figurinhas',
    '  ▸ ' + P + 'menuefeitos — filtros para fotos e vídeos',
    '',
    '🛡️ *ADMINISTRAÇÃO*',
    '  ▸ ' + P + 'menuadm',
    '  ▸ ' + P + 'reportar _(marque a mensagem)_',
    '',
    '🎮 *DIVERSÃO & JOGOS*',
    '  ▸ ' + P + 'menujogos — jogos, quizzes e brincadeiras',
    '  ▸ ' + P + 'brincadeiras — comandos sociais',
    '  ▸ ' + P + 'alteradores — áudio, voz e vídeo',
    '  ▸ ' + P + 'menuprata — economia em Prata',
    '  ▸ ' + P + 'menumarket',
    '  ▸ ' + P + 'menumediev',
    '  ▸ ' + P + 'menuroubar',
    '  ▸ ' + P + 'menusec',
    '  ▸ ' + P + 'menupet',
    '',
    '💑 *RELACIONAMENTOS*',
    '  ▸ ' + P + 'menucasal',
    '  ▸ ' + P + 'menuaniversario',
    '  ▸ ' + P + 'menufilho',
    '',
    '💼 *EMPREGOS*',
    '  ▸ ' + P + 'menuwork — empregos e salários',
    '',
    '🔧 *UTILIDADES*',
    '  ▸ ' + P + 'menuutil — consultas, texto e perfil',
    '  ▸ ' + P + 'menubaixar — downloads de mídia',
    '  ▸ ' + P + 'perfil / ' + P + 'bio — seu perfil',
    '  ▸ ' + P + 'meupainel — painel e site do bot',
    '',
    '⚽ *FUTEBOL*',
    '  ▸ ' + P + 'menufutebol — tabelas, jogos e artilheiros',
    '━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenu };
