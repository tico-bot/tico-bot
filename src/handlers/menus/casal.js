'use strict';

function obterPrefixo(jid, getPrefix) {
  try {
    const prefixo = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
    return typeof prefixo === 'string' && prefixo.trim() ? prefixo.trim() : '!';
  } catch {
    return '!';
  }
}

async function enviarMenu(sock, msg, jid, texto) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('[menu-casal] sock.sendMessage não está disponível.');
  }
  await sock.sendMessage(jid, { text: texto }, msg ? { quoted: msg } : {});
}

async function handleMenuRelacionamento(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu =
`╭━━━━━━━━━━━━━━━━━━━━━━╮
│      ❤️ MENU DO CASAL      │
╰━━━━━━━━━━━━━━━━━━━━━━╯

💍 *COMEÇAR OU GERENCIAR*
  ▸ ${P}namorar @pessoa — pedir em namoro
  ▸ ${P}casar @pessoa — pedir em casamento
  ▸ ${P}euaceito — aceitar um pedido recebido
  ▸ ${P}eurecuso — recusar um pedido recebido
  ▸ ${P}cancelarpedido — cancelar seu pedido pendente
  ▸ ${P}terminar — encerrar o relacionamento

💐 *CARINHOS DIÁRIOS*
  ▸ ${P}flores — enviar flores 🌹
  ▸ ${P}doces — dar doces 🍬
  ▸ ${P}carta — enviar uma carta 💌
  ▸ ${P}mimo — dar um mimo 🎁
  ▸ ${P}beijo — mandar um beijo 😘
  _Os usos diários podem render XP e alguns exigem itens._

💝 *MOMENTOS A DOIS*
  ▸ ${P}abraco @pessoa — dar um abraço
  ▸ ${P}presente — presentear seu par
  ▸ ${P}jantar — jantar romântico
  ▸ ${P}cinema — sessão de cinema (alias: cinematel)
  ▸ ${P}viajar — viajar juntos
  ▸ ${P}serenata — fazer uma serenata
  ▸ ${P}declarar — declarar seu amor
  ▸ ${P}ciumento — demonstrar ciúme
  ▸ ${P}surpresa — preparar uma surpresa

🏆 *STATUS E COMPETIÇÃO*
  ▸ ${P}statu — ver status e nível do casal
  ▸ ${P}meupar — ver quem é seu par
  ▸ ${P}aniversario_casal — conferir a data do relacionamento
  ▸ ${P}xpdobro — ativar XP dobrado por 1 hora
  ▸ ${P}rankcasais — ranking de casais
  ▸ ${P}duelodecasais @pessoa — desafiar outro casal

🛍️ *ITENS E ACESSÓRIOS*
  ▸ ${P}lojacasal — abrir a loja do casal

ℹ️ Use sempre o prefixo configurado neste grupo: *${P}*
━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

async function handleMenuFilho(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu =
`╭━━━━━━━━━━━━━━━━━━━━━━╮
│       👶 MENU FILHOS       │
╰━━━━━━━━━━━━━━━━━━━━━━╯

👨‍👩‍👧 *FAMÍLIA*
  ▸ ${P}tentarfilho — tentar ter um filho biológico
  ▸ ${P}adotarfilho [nome] — pedir adoção ao parceiro (nome opcional)
  ▸ ${P}adotarfilho aceitar <código> — confirmar adoção (responsável convidado)
  ▸ ${P}adotarfilho recusar <código> — recusar pedido (responsável convidado)
  ▸ ${P}adotarfilho cancelar <código> — cancelar o próprio pedido
  ▸ ${P}filho — ver filhos e situação atual
  ▸ ${P}cuidarfilho — cuidar dos filhos

💊 *SAÚDE E CUIDADOS*
  ▸ ${P}remediofil — tratar um filho doente
  ▸ ${P}renomearfilho <nome> — renomear um filho
  • Se tiver mais de um: ${P}renomearfilho <número> <nome>

📋 *COMO FUNCIONA*
  • Limite de até *3 filhos por casal*, incluindo adoções.
  • Um responsável solicita a adoção; o outro precisa aceitá-la em até 15 minutos.
  • Com o Modo República ativo, responsáveis com emprego elegível podem receber 48 horas de licença parental; a remuneração segue o salário apurado.
  • Cada *7 dias* no sistema equivalem a 1 ano de idade.
  • Os atributos diminuem a cada *6 horas*; se a felicidade chegar a zero, o filho pode adoecer.
  • Cada filho pode receber cuidados novamente a cada *20 horas*.
  • Se o casal estiver separado, a guarda alterna quando o sistema é consultado após *24 horas*. Se estiverem juntos, ambos podem cuidar.

📊 *ATRIBUTOS*
  😊 Felicidade  •  🍽️ Fome
  😴 Sono        •  🎈 Alegria

ℹ️ Use o prefixo configurado neste grupo: *${P}*
━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuRelacionamento, handleMenuFilho };