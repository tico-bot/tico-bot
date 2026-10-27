'use strict';

async function handleMenuAdm(sock, msg, jid, getPrefix) {
  const P = typeof getPrefix === 'function' ? getPrefix(jid) : '!';
  const menu =
`╔══════════════════════╗
    🛡️ MENU ADMINISTRAÇÃO
╚══════════════════════╝

⚙️ *CONFIGURAÇÃO DE GRUPO*
  ▸ ${P}bot on/off — Ativar/desativar bot no grupo
  ▸ ${P}antilink on/off — Ativar/desativar antilink
  ▸ ${P}autosticker on/off — Ativar/desativar auto-sticker
  ▸ ${P}slowmode [seg] — Configurar slow mode (1-3600s)
  ▸ ${P}antiflood [msgs]/[seg] — Configurar anti-flood
  ▸ ${P}bemvindo on/off/[msg] — Configurar boas-vindas
  ▸ ${P}medieval on/off — Ativar/desativar modo medieval

📋 *REGRAS & INFORMAÇÕES*
  ▸ ${P}regras — Visualizar regras do grupo
  ▸ ${P}setregras [texto] — Definir regras do grupo
  ▸ ${P}grupinfo — Informações detalhadas do grupo
  ▸ ${P}statsgrupo — Estatísticas do grupo
  ▸ ${P}listamembros — Lista de membros do grupo
  ▸ ${P}listaadm — Lista de administradores

🔨 *MODERAÇÃO & CARGOS*
  ▸ ${P}ban @pessoa — Banir membro
  ▸ ${P}ban @all — Banir todos não-admins
  ▸ ${P}mute @pessoa — Mutar membro
  ▸ ${P}mute @all — Mutar todos os não-admins
  ▸ ${P}desmute @pessoa — Desmutar membro
  ▸ ${P}promover @pessoa — Tornar membro administrador
  ▸ ${P}rebaixar @pessoa — Remover cargo de administrador
  ▸ ${P}adv / ${P}reportar — Dar advertência (reply/@)
  ▸ ${P}removerreporte — Limpar advertência (reply/@)
  ▸ ${P}fechar — Fechar o grupo para mensagens
  ▸ ${P}abrir — Abrir o grupo para mensagens

📢 *COMUNICAÇÃO & FERRAMENTAS*
  ▸ ${P}todos [mensagem] — Marcar todos os membros
  ▸ ${P}adms [motivo] — Notificar todos os administradores
  ▸ ${P}avisar [mensagem] — Enviar aviso de admin com @todos
  ▸ ${P}fixargrupo — Fixar mensagem citada
  ▸ ${P}fixargrupo ver — Ver último aviso fixado
  ▸ ${P}enquete [pergunta|op1|op2] — Criar enquete
  ▸ ${P}sorteio — Sortear um membro do grupo
  ▸ ${P}linkgrupo — Obter link de convite do grupo

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

module.exports = { handleMenuAdm };
