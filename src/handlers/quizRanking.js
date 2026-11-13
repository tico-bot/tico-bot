'use strict';

const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const ExtraState = require('../models/ExtraState');
const { resolveDisplayName } = require('../utils/identity');
const { TZ, agoraLocal } = require('../utils/tempo');

const PREMIOS_PRATA = [10000, 5000, 3500];
const PARTICIPATION_TARGET = 3;
const PARTICIPATION_REWARD = 500;
const HORA = 18;
const MINUTO = 30;

const MEDALS = ['🥇', '🥈', '🥉'];
let activeTimeouts = [];

async function resolverGruposAtivos(gruposAtivos, filtro = {}) {
  const informados = gruposAtivos instanceof Set
    ? [...gruposAtivos]
    : Array.isArray(gruposAtivos) ? gruposAtivos : [];
  if (informados.length > 0) return informados;
  return CarteiraGrupo.distinct('idGrupo', { idGrupo: { $regex: /@g\.us$/ }, ...filtro });
}

function formatarPremiosPrata() {
  return PREMIOS_PRATA.map((valor, i) =>
    `${MEDALS[i]} +${valor.toLocaleString('pt-BR')} Prata`
  ).join('\n');
}

function obterOffsetMinutos(instante) {
  const nome = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    timeZoneName: 'longOffset',
  }).formatToParts(instante).find(parte => parte.type === 'timeZoneName')?.value || 'GMT';
  const match = nome.match(/^GMT(?:(\+|-)0?(\d{1,2}):?(\d{2})?)?$/);
  if (!match || !match[1]) return 0;
  const sinal = match[1] === '-' ? -1 : 1;
  return sinal * (Number(match[2] || 0) * 60 + Number(match[3] || 0));
}

function converterHorarioLocalParaDate(dataLocal, hora, minuto) {
  const [ano, mes, dia] = dataLocal.split('-').map(Number);
  const horarioSemFuso = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
  let instante = horarioSemFuso;
  // Itera para aplicar o offset da zona de destino, sem depender do TZ do host.
  for (let i = 0; i < 3; i++) {
    instante = horarioSemFuso - obterOffsetMinutos(new Date(instante)) * 60_000;
  }
  return new Date(instante);
}

function adicionarDiaLocal(dataLocal) {
  const data = new Date(`${dataLocal}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
}

function calcularProximaPremiacao(agora = new Date()) {
  let data = agoraLocal(agora).iso;
  let instante = converterHorarioLocalParaDate(data, HORA, MINUTO);
  if (instante <= agora) {
    data = adicionarDiaLocal(data);
    instante = converterHorarioLocalParaDate(data, HORA, MINUTO);
  }
  return { data, instante, msRestantes: Math.max(0, instante.getTime() - agora.getTime()) };
}

function chaveEvento(groupJid, data) {
  return `quiz_premiacao_diaria:${data}:${encodeURIComponent(groupJid)}`;
}

async function obterEvento(groupJid, data) {
  const eventId = chaveEvento(groupJid, data);
  let documento = await ExtraState.findById(eventId).lean();
  if (documento?.value) return { eventId, evento: documento.value };

  const top3 = await CarteiraGrupo.find({ idGrupo: groupJid, quizPoints: { $gt: 0 } })
    .sort({ quizPoints: -1, createdAt: 1, idWhatsApp: 1 })
    .limit(3)
    .lean();
  const vencedores = top3
    .map((usuario, indice) => ({
      idWhatsApp: usuario?.idWhatsApp,
      pontos: Number(usuario?.quizPoints) || 0,
      colocacao: indice + 1,
      premio: PREMIOS_PRATA[indice],
    }))
    .filter(vencedor => vencedor.idWhatsApp);

  if (!vencedores.length) return { eventId, evento: null };

  const eventoInicial = { data, status: 'processing', vencedores };
  await ExtraState.updateOne(
    { _id: eventId },
    { $setOnInsert: { value: eventoInicial } },
    { upsert: true }
  );
  documento = await ExtraState.findById(eventId).lean();
  return { eventId, evento: documento?.value || eventoInicial };
}

async function executarPremiacao(sock, gruposAtivos, data = agoraLocal().iso) {
  console.log(`[QuizRanking] Executando premiação diária de ${data}...`);
  const chaveGlobal = `quiz_premiacao_diaria_global:${data}`;
  let estadoGlobal = await ExtraState.findById(chaveGlobal).lean();
  if (estadoGlobal?.value?.status === 'completed') {
    console.log(`[QuizRanking] A premiação de ${data} já foi concluída.`);
    return;
  }

  // Congela a lista de grupos no início da apuração. Em uma retomada após
  // reinício, grupos que começaram a pontuar depois das 18h30 não entram retroativamente.
  if (!estadoGlobal?.value) {
    const gruposDoDia = await resolverGruposAtivos(gruposAtivos, { quizPoints: { $gt: 0 } });
    const inicial = { data, status: 'processing', grupos: gruposDoDia };
    await ExtraState.updateOne(
      { _id: chaveGlobal },
      { $setOnInsert: { value: inicial } },
      { upsert: true }
    );
    estadoGlobal = await ExtraState.findById(chaveGlobal).lean();
    if (!estadoGlobal?.value) estadoGlobal = { value: inicial };
  }

  const grupos = Array.isArray(estadoGlobal.value.grupos) ? estadoGlobal.value.grupos : [];
  let falhas = 0;
  for (const groupJid of grupos) {
    if (!groupJid) continue;
    try {
      const { eventId, evento } = await obterEvento(groupJid, data);
      if (!evento || evento.status === 'completed') continue;

      if (evento.status === 'processing') {
        for (const vencedor of evento.vencedores) {
          const jid = jidNormalizedUser(vencedor.idWhatsApp);
          // A data no documento torna o crédito idempotente: reiniciar o processo
          // durante a apuração não paga o mesmo jogador duas vezes no mesmo dia.
          await CarteiraGrupo.updateOne(
            { idWhatsApp: vencedor.idWhatsApp, idGrupo: groupJid, quizPrizeDate: { $ne: data } },
            {
              $inc: { gold: vencedor.premio },
              $set: { quizPrizeDate: data, quizPoints: 0 },
              $push: {
                goldHistory: {
                  $each: [{
                    type: 'recebido',
                    item: `Premiação diária de quiz — ${vencedor.colocacao}º lugar`,
                    amount: vencedor.premio,
                    date: new Date(),
                  }],
                  $slice: -50,
                },
              },
            }
          );
          // Resolve o nome mais tarde, na mensagem, para manter o snapshot enxuto.
          vencedor.jidNormalizado = jid;
        }

        await CarteiraGrupo.updateMany(
          { idGrupo: groupJid, quizPoints: { $gt: 0 } },
          { $set: { quizPoints: 0 } }
        );

        evento.status = 'paid';
        await ExtraState.updateOne({ _id: eventId }, { $set: { value: evento } }, { upsert: true });
      }

      if (evento.status === 'paid') {
        let texto = `🏆 *PREMIAÇÃO DIÁRIA DE QUIZ!* 🏆\n\n`;
        texto += `Parabéns aos campeões de hoje!\n\n`;
        for (const vencedor of evento.vencedores) {
          const nome = await resolveDisplayName(
            vencedor.jidNormalizado || jidNormalizedUser(vencedor.idWhatsApp),
            sock,
            {},
            { fallback: 'Participante' }
          );
          texto += `${MEDALS[vencedor.colocacao - 1]} *${nome}* — ${vencedor.pontos} pts → *+${vencedor.premio.toLocaleString('pt-BR')} Prata!*\n`;
        }
        texto += `\n_O placar diário foi zerado. Amanhã haverá uma nova disputa às 18h30!_ 🍀\n`;
        texto += `_Use */quiz* para participar e conquistar o bônus diário de 500 Pratas ao acertar 3 perguntas!_`;

        await sock.sendMessage(groupJid, { text: texto });
        evento.status = 'completed';
        await ExtraState.updateOne({ _id: eventId }, { $set: { value: evento } }, { upsert: true });
        console.log(`[QuizRanking] Premiação diária enviada para ${groupJid}`);
      }
    } catch (erro) {
      falhas++;
      console.error(`[QuizRanking] Erro no grupo ${groupJid}:`, erro?.message || erro);
    }
  }

  if (falhas === 0) {
    const concluido = { ...estadoGlobal.value, data, status: 'completed' };
    await ExtraState.updateOne(
      { _id: chaveGlobal },
      { $set: { value: concluido } },
      { upsert: true }
    );
  } else {
    console.warn(`[QuizRanking] ${falhas} grupo(s) com falha; a apuração de ${data} poderá ser retomada.`);
  }
}

async function enviarAviso(sock, gruposAtivos, tipo) {
  const textos = {
    '60min': `⏰ *HOJE TEM PREMIAÇÃO DE QUIZ!*\n\nÀs *18h30*, os três primeiros do ranking diário recebem:\n${formatarPremiosPrata()}\n\n🎁 E qualquer jogador que acertar *3 perguntas* no dia ganha mais *+500 Pratas*!\n\n_Jogue */quiz* para participar!_`,
    '10min': `🔔 *FALTAM 10 MINUTOS!*\n\nÀs *18h30* sai a premiação diária do Quiz. O Top 3 ganha até *10.000 Pratas* e quem acertar 3 perguntas recebe *+500 Pratas* de bônus.\n\n_Use */quiz* e */rankjogos*!_`,
    '5min': `🚨 *ÚLTIMOS 5 MINUTOS!*\n\nA premiação diária começa às *18h30*! Ainda dá tempo de jogar */quiz*, subir no ranking e completar a meta de 3 acertos para ganhar *+500 Pratas*!`,
  };
  if (!textos[tipo]) return;

  // Os avisos também alcançam grupos com carteira mesmo que ainda ninguém tenha pontuado.
  const grupos = await resolverGruposAtivos(gruposAtivos);
  for (const groupJid of grupos) {
    if (!groupJid) continue;
    try {
      await sock.sendMessage(groupJid, { text: textos[tipo] });
    } catch (erro) {
      console.error(`[QuizRanking] Erro ao enviar aviso ${tipo} para ${groupJid}:`, erro?.message || erro);
    }
  }
}

function limparTimeouts() {
  for (const timeout of activeTimeouts) clearTimeout(timeout);
  activeTimeouts = [];
}

function agendarProximaPremiacao(sock, gruposAtivos) {
  limparTimeouts();
  const { data, instante, msRestantes } = calcularProximaPremiacao();
  const agoraMs = Date.now();

  for (const aviso of [
    { tipo: '60min', antes: 60 * 60 * 1000 },
    { tipo: '10min', antes: 10 * 60 * 1000 },
    { tipo: '5min', antes: 5 * 60 * 1000 },
  ]) {
    const atraso = instante.getTime() - aviso.antes - agoraMs;
    if (atraso <= 0) continue; // Não dispara lembretes cujo horário já passou após um reinício.
    activeTimeouts.push(setTimeout(() => {
      enviarAviso(sock, gruposAtivos, aviso.tipo).catch(erro =>
        console.error(`[QuizRanking] Erro no aviso ${aviso.tipo}:`, erro?.message || erro)
      );
    }, atraso));
  }

  activeTimeouts.push(setTimeout(async () => {
    try {
      await executarPremiacao(sock, gruposAtivos, data);
    } catch (erro) {
      console.error('[QuizRanking] Erro na premiação diária:', erro?.message || erro);
    } finally {
      agendarProximaPremiacao(sock, gruposAtivos);
    }
  }, msRestantes));

  const localHora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instante);
  console.log(`[QuizRanking] Próxima premiação diária: ${data} às ${localHora} (${TZ}).`);
}

function initQuizRankingScheduler(sock, gruposAtivos) {
  console.log('[QuizRanking] Agendador diário iniciado.');
  const agora = agoraLocal();
  if (agora.hora > HORA || (agora.hora === HORA && agora.minuto >= MINUTO)) {
    // Se o bot ficou offline após 18h30, tenta recuperar a apuração de hoje.
    executarPremiacao(sock, gruposAtivos, agora.iso).catch(erro =>
      console.error('[QuizRanking] Erro ao recuperar premiação diária:', erro?.message || erro)
    );
  }
  agendarProximaPremiacao(sock, gruposAtivos);
}

module.exports = {
  initQuizRankingScheduler,
  executarPremiacao,
  enviarAviso,
  PREMIOS_PRATA,
  PARTICIPATION_TARGET,
  PARTICIPATION_REWARD,
  calcularProximaPremiacao,
  converterHorarioLocalParaDate,
};
