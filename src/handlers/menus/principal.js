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
    '          🔥 TICO 🔥',
    '╚══════════════════════╝',
    '',
    greeting + (userMention ? ', ' + userMention : '') + '! São ' + timeStr + ' ⏰',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '🎨 *MÍDIA & FIGURINHAS*',
    '  ▸ ' + P + 'menufig — criar e buscar figurinhas',
    '  ▸ ' + P + 'menuefeitos — filtros para fotos e vídeos',
    '  ▸ ' + P + 'alteradores — áudio, voz e vídeo',
    '  ▸ ' + P + 'menubaixar — downloads de mídia',
    '',
    '🎮 *JOGOS & DIVERSÃO*',
    '  ▸ ' + P + 'menujogos — jogos, quizzes e brincadeiras',
    '  ▸ ' + P + 'brincadeiras — comandos sociais',
    '  ▸ ' + P + 'menuplata — economia, lojas e pesca',
    '  ▸ ' + P + 'menupet — personagens virtuais',
    '  ▸ ' + P + 'menumarket — marketplace entre jogadores',
    '  ▸ ' + P + 'menuroubar / ' + P + 'menusec — roubo e defesa',
    '  ▸ ' + P + 'menumediev — RPG medieval',
    '  ▸ ' + P + 'menuwork — empregos e salários',
    '',
    '💞 *RELACIONAMENTOS & FAMÍLIA*',
    '  ▸ ' + P + 'menucasal — comandos de casal',
    '  ▸ ' + P + 'menufilho — filhos e cuidados',
    '  ▸ ' + P + 'menuaniversario — datas de aniversário',
    '',
    '🛡️ *GRUPO & ADMINISTRAÇÃO*',
    '  ▸ ' + P + 'menuadm — moderação e configurações',
    '  ▸ ' + P + 'reportar — responder à mensagem para advertir',
    '',
    '🔧 *UTILIDADES & CONTA*',
    '  ▸ ' + P + 'menuutil — consultas, texto e perfil',
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
