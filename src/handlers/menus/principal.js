'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenu(sock, msg, jid, caption, getPrefix, author) {
  const P = obterPrefixo(jid, getPrefix);

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Cuiaba',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [hourText, minuteText] = agora.split(':');
  const hour = Number(hourText);
  const timeStr = `${String(hourText).padStart(2, '0')}:${minuteText}`;

  let greeting = 'Olá';
  if (hour >= 5  && hour < 12) greeting = '🌅 Bom dia';
  else if (hour >= 12 && hour < 18) greeting = '☀️ Boa tarde';
  else                               greeting = '🌙 Boa noite';

  const userMention = author ? `*${author}*` : '';

  const menu =
`╔══════════════════════╗
       🔥 Tico 🔥
╚══════════════════════╝

${greeting}, ${userMention}! São ${timeStr} ⏰

━━━━━━━━━━━━━━━━━━━━━━━━
🎨 *FIGURINHAS & EFEITOS*
  ▸ ${P}menufig
  ▸ ${P}menuefeitos

🛡️ *ADMINISTRAÇÃO*
  ▸ ${P}menuadm
  ▸ ${P}reportar _(marque a mensagem)_

🎮 *DIVERSÃO & JOGOS*
  ▸ ${P}menujogos
  ▸ ${P}brincadeiras
  ▸ ${P}alteradores
  ▸ ${P}menuroubar
  ▸ ${P}menusec
  ▸ ${P}menupet

💑 *RELACIONAMENTOS*
  ▸ ${P}menucasal
  ▸ ${P}menuaniversario
  ▸ ${P}menufilho

💼 *EMPREGOS*
  ▸ ${P}menuwork

🔧 *UTILIDADES*
  ▸ ${P}menuutil
━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenu };
