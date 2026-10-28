'use strict';

const { obterPrefixo, enviarMenu } = require('./helpers');

async function handleMenuWork(sock, msg, jid, getPrefix) {
  const P = obterPrefixo(jid, getPrefix);
  const menu =
`╔══════════════════════╗
       💼 MENU EMPREGOS
╚══════════════════════╝

🔍 *CARREIRA & VAGAS*
  ▸ ${P}procuraremprego — Listar vagas disponíveis para o seu nível (7 opções)
  ▸ ${P}procuraremprego <1-7> — Escolher a vaga desejada
  ▸ ${P}emprego — Ver seu cargo, salário, progresso e status
  ▸ ${P}promocao — Qualificar para próxima categoria de cargos
  ▸ ${P}demitir — Pedir demissão voluntária (preserva histórico)

💰 *TRABALHO*
  ▸ ${P}trabalhar / ${P}work — Bater o ponto e receber seu salário
  💡 _Cada cargo possui funções específicas desempenhadas a cada turno!_

⏰ *REGRAS DO EXPEDIENTE*
  ▸ Horário comercial: *08:00 às 23:00 (Brasília)*
  ▸ Cooldown entre turnos: *40 minutos*
  ▸ Tolerância para bater ponto: *30 minutos* (congelada à noite)

━━━━━━━━━━━━━━━━━━━━━━━━`;

  await enviarMenu(sock, msg, jid, menu);
}

module.exports = { handleMenuWork };
