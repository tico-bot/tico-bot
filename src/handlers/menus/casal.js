'use strict';

async function handleMenuRelacionamento(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      ❤️ MENU DO CASAL
╚══════════════════════╝

💍 *RELACIONAMENTO*
  ▸ ${P}casar @pessoa — Pedir em casamento
  ▸ ${P}euaceito — Aceitar pedido
  ▸ ${P}eurecuso — Recusar pedido
  ▸ ${P}cancelarpedido — Cancelar pedido enviado
  ▸ ${P}terminar — Terminar relacionamento _(bloqueia 10 min)_

💐 *DIÁRIOS (+5 XP cada, 1x/dia)*
  ▸ ${P}flores 🌹
  ▸ ${P}doces 🍬
  ▸ ${P}carta 💌
  ▸ ${P}mimo 🎁
  ▸ ${P}beijo 😘

💝 *ROMÂNTICOS*
  ▸ ${P}abraco — Dar um abraço
  ▸ ${P}presente — Dar um presente
  ▸ ${P}jantar — Jantar a dois
  ▸ ${P}cinematel — Sessão de cinema
  ▸ ${P}viajar — Viajar juntos
  ▸ ${P}serenata — Fazer uma serenata
  ▸ ${P}declarar — Declaração de amor
  ▸ ${P}ciumento — Demonstrar ciúme

🏆 *ESPECIAIS*
  ▸ ${P}statu — Status do casal
  ▸ ${P}meupar — Infos do seu par
  ▸ ${P}xpdobro — XP duplo por 1h
  ▸ ${P}aniversario_casal — Ver aniversário
  ▸ ${P}duelodecasais — Duelo entre casais
  ▸ ${P}rankcasais — Ranking de casais

🛒 *LOJA*
  ▸ ${P}lojacasal — Ver itens disponíveis

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

async function handleMenuFilho(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
      👶 MENU FILHOS
╚══════════════════════╝

👨‍👩‍👧 *FAMÍLIA*
  ▸ ${P}tentarfilho — Tentar ter um filho _(40% chance)_
  ▸ ${P}filho — Ver seus filhos e status
  ▸ ${P}cuidarfilho — Cuidar dos filhos _(cooldown 20h)_

💊 *SAÚDE*
  ▸ ${P}remediofil — Curar filho doente _(R$ 3,00)_

━━━━━━━━━━━━━━━━━━━━━━━━
📋 *REGRAS*
  • Limite de *3 filhos* por casal
  • A cada *7 dias* o filho completa *1 ano*
  • Atributos caem com o tempo — cuide diariamente!
  • Felicidade zerada → filho fica *doente*
  • Em caso de separação → *guarda compartilhada*
    _(o filho troca de responsável a cada dia)_

━━━━━━━━━━━━━━━━━━━━━━━━
📊 *ATRIBUTOS*
  😊 Felicidade • 🍽️ Fome
  😴 Sono • 🎈 Alegria

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuRelacionamento, handleMenuFilho };
