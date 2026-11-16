'use strict';

const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const CarteiraGrupo = require('../models/CarteiraGrupo');
const ExtraState = require('../models/ExtraState');
const { resolveDisplayName } = require('../utils/identity');
const { TZ, agoraLocal } = require('../utils/tempo');

const PREMIOS_PRATA = [10000, 5000, 3500];
const PARTICIPATION_TARGET = 3;
const PARTICIPATION_REWARD = 500;
const HORA_INICIAL = 18;
const MINUTO_INICIAL = 30;
const INTERVALO_GRUPOS_MINUTOS = 40;
const MINUTOS_DIA = 24 * 60;
const CHAVE_HORARIOS_GRUPOS = 'quiz_premiacao_horarios_grupos';

const MEDALS = ['🥇', '🥈', '🥉'];
const timersPorGrupo = new Map();
let intervaloSincronizacao = null;
let sincronizacaoEmAndamento = false;

async function resolverGruposAtivos(gruposAtivos, filtro = {}) {
  const informados = gruposAtivos instanceof Set
    ? [...gruposAtivos]
    : Array.isArray(gruposAtivos) ? gruposAtivos : [];
  if (informados.length > 0) return informados;
  return CarteiraGrupo.distinct('idGrupo', { idGrupo: { $regex: /@g\.us$/ }, ...filtro });
}

/** Reserva horários permanentes no MongoDB para não os trocar após reinícios. */
async function resolverHorariosGrupos(gruposAtivos) {
  const grupos = [...new Set((await resolverGruposAtivos(gruposAtivos)).filter(Boolean))];
  const documento = await ExtraState.findById(CHAVE_HORARIOS_GRUPOS).lean();
  const estado = documento && documento.value && typeof documento.value === 'object'
    ? documento.value
    : {};
  const atribuicoes = new Map(
    (Array.isArray(estado.atribuicoes) ? estado.atribuicoes : [])
      .filter(item => item && item.grupo && Number.isInteger(item.indice) && item.indice >= 0)
      .map(item => [item.grupo, item.indice])
  );
  const indices = [...atribuicoes.values()];
  const maiorIndice = indices.length ? Math.max(...indices) : -1;
  let proximoIndice = Math.max(
    Number.isInteger(estado.proximoIndice) ? estado.proximoIndice : 0,
    maiorIndice + 1
  );
  let alterado = false;

  for (const grupo of grupos.filter(grupo => !atribuicoes.has(grupo)).sort()) {
    atribuicoes.set(grupo, proximoIndice++);
    alterado = true;
  }

  if (alterado) {
    await ExtraState.updateOne(
      { _id: CHAVE_HORARIOS_GRUPOS },
      { $set: { value: {
        versao: 1,
        proximoIndice,
        atribuicoes: [...atribuicoes.entries()].map(([grupo, indice]) => ({ grupo, indice })),
      } } },
      { upsert: true }
    );
  }

  return {
    grupos: grupos.sort((a, b) => atribuicoes.get(a) - atribuicoes.get(b)),
    atribuicoes,
  };
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

function formatarHorario(hora, minuto) {
  return String(hora).padStart(2, '0') + 'h' + String(minuto).padStart(2, '0');
}

function obterHorarioGrupo(indiceGrupo = 0) {
  const indice = Number.isFinite(Number(indiceGrupo))
    ? Math.max(0, Math.floor(Number(indiceGrupo)))
    : 0;
  const minutosDoDia = (HORA_INICIAL * 60 + MINUTO_INICIAL + indice * INTERVALO_GRUPOS_MINUTOS) % MINUTOS_DIA;
  const hora = Math.floor(minutosDoDia / 60);
  const minuto = minutosDoDia % 60;
  return { indice, hora, minuto, texto: formatarHorario(hora, minuto) };
}

function calcularProximaPremiacao(agora = new Date(), indiceGrupo = 0) {
  const horario = obterHorarioGrupo(indiceGrupo);
  let data = agoraLocal(agora).iso;
  let instante = converterHorarioLocalParaDate(data, horario.hora, horario.minuto);
  if (instante <= agora) {
    data = adicionarDiaLocal(data);
    instante = converterHorarioLocalParaDate(data, horario.hora, horario.minuto);
  }
  return {
    data,
    instante,
    horario,
    msRestantes: Math.max(0, instante.getTime() - agora.getTime()),
  };
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

  // Mesmo sem participantes, fecha o ciclo desse grupo no horário definido.
  const eventoInicial = {
    data,
    status: vencedores.length ? 'processing' : 'completed',
    vencedores,
  };
  await ExtraState.updateOne(
    { _id: eventId },
    { $setOnInsert: { value: eventoInicial } },
    { upsert: true }
  );
  documento = await ExtraState.findById(eventId).lean();
  return { eventId, evento: documento?.value || eventoInicial };
}

async function executarPremiacao(sock, gruposAtivos, data = agoraLocal().iso, horario = obterHorarioGrupo(0)) {
  console.log('[QuizRanking] Executando premiação diária de ' + data + '...');
  // A apuração é individual: concluir um grupo não bloqueia os outros.
  const grupos = await resolverGruposAtivos(gruposAtivos);
  let falhas = 0;
  for (const groupJid of grupos) {
    if (!groupJid) continue;
    try {
      const { eventId, evento } = await obterEvento(groupJid, data);
      if (!evento || evento.status === 'completed') continue;

      if (evento.status === 'processing') {
        for (const vencedor of evento.vencedores) {
          const jid = jidNormalizedUser(vencedor.idWhatsApp);
          await CarteiraGrupo.updateOne(
            { idWhatsApp: vencedor.idWhatsApp, idGrupo: groupJid, quizPrizeDate: { $ne: data } },
            {
              $inc: { gold: vencedor.premio },
              $set: { quizPrizeDate: data, quizPoints: 0 },
              $push: {
                goldHistory: {
                  $each: [{
                    type: 'recebido',
                    item: 'Premiação diária de quiz — ' + vencedor.colocacao + 'º lugar',
                    amount: vencedor.premio,
                    date: new Date(),
                  }],
                  $slice: -50,
                },
              },
            }
          );
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
        let texto = '🏆 *PREMIAÇÃO DIÁRIA DE QUIZ!* 🏆\n\n';
        texto += 'Parabéns aos campeões de hoje!\n\n';
        for (const vencedor of evento.vencedores) {
          const nome = await resolveDisplayName(
            vencedor.jidNormalizado || jidNormalizedUser(vencedor.idWhatsApp),
            sock,
            {},
            { fallback: 'Participante' }
          );
          texto += MEDALS[vencedor.colocacao - 1] + ' *' + nome + '* — ' + vencedor.pontos + ' pts → *+' + vencedor.premio.toLocaleString('pt-BR') + ' Prata!*\n';
        }
        texto += '\n_O placar diário foi zerado. Amanhã haverá uma nova disputa às ' + formatarHorario(horario.hora, horario.minuto) + '!_ 🍀\n';
        texto += '_Use */quiz* para participar e conquistar o bônus diário de 500 Pratas ao acertar 3 perguntas!_';

        await sock.sendMessage(groupJid, { text: texto });
        evento.status = 'completed';
        await ExtraState.updateOne({ _id: eventId }, { $set: { value: evento } }, { upsert: true });
        console.log('[QuizRanking] Premiação diária enviada para ' + groupJid);
      }
    } catch (erro) {
      falhas++;
      console.error('[QuizRanking] Erro no grupo ' + groupJid + ':', erro && erro.message || erro);
    }
  }

  if (falhas > 0) {
    console.warn('[QuizRanking] ' + falhas + ' grupo(s) com falha durante a apuração de ' + data + '.');
  }
}

function criarTextoAviso(tipo, horario) {
  const hora = formatarHorario(horario.hora, horario.minuto);
  const textos = {
    '60min': '⏰ *HOJE TEM PREMIAÇÃO DE QUIZ!*\n\nÀs *' + hora + '*, os três primeiros do ranking diário recebem:\n' + formatarPremiosPrata() + '\n\n🎁 E qualquer jogador que acertar *3 perguntas* no dia ganha mais *+500 Pratas*!\n\n_Jogue */quiz* para participar!_',
    '10min': '🔔 *FALTAM 10 MINUTOS!*\n\nÀs *' + hora + '* sai a premiação diária do Quiz. O Top 3 ganha até *10.000 Pratas* e quem acertar 3 perguntas recebe *+500 Pratas* de bônus.\n\n_Use */quiz* e */rankjogos*!_',
    '5min': '🚨 *ÚLTIMOS 5 MINUTOS!*\n\nA premiação diária começa às *' + hora + '*! Ainda dá tempo de jogar */quiz*, subir no ranking e completar a meta de 3 acertos para ganhar *+500 Pratas*!',
  };
  return textos[tipo] || null;
}

async function enviarAviso(sock, gruposAtivos, tipo, horariosPorGrupo = null) {
  if (!['60min', '10min', '5min'].includes(tipo)) return;
  const grupos = await resolverGruposAtivos(gruposAtivos);
  for (const groupJid of grupos) {
    if (!groupJid) continue;
    try {
      const horario = horariosPorGrupo instanceof Map
        ? (horariosPorGrupo.get(groupJid) || obterHorarioGrupo(0))
        : (horariosPorGrupo || obterHorarioGrupo(0));
      const texto = criarTextoAviso(tipo, horario);
      if (texto) await sock.sendMessage(groupJid, { text: texto });
    } catch (erro) {
      console.error('[QuizRanking] Erro ao enviar aviso ' + tipo + ' para ' + groupJid + ':', erro && erro.message || erro);
    }
  }
}

function limparAgendamentoGrupo(groupJid) {
  const timers = timersPorGrupo.get(groupJid) || [];
  for (const timer of timers) clearTimeout(timer);
  timersPorGrupo.delete(groupJid);
}

function agendarPremiacaoGrupo(sock, groupJid, indiceGrupo) {
  limparAgendamentoGrupo(groupJid);
  const proxima = calcularProximaPremiacao(new Date(), indiceGrupo);
  const data = proxima.data;
  const instante = proxima.instante;
  const msRestantes = proxima.msRestantes;
  const horario = proxima.horario;
  const agoraMs = Date.now();
  const timers = [];
  const horariosPorGrupo = new Map([[groupJid, horario]]);

  for (const aviso of [
    { tipo: '60min', antes: 60 * 60 * 1000 },
    { tipo: '10min', antes: 10 * 60 * 1000 },
    { tipo: '5min', antes: 5 * 60 * 1000 },
  ]) {
    const atraso = instante.getTime() - aviso.antes - agoraMs;
    if (atraso <= 0) continue;
    timers.push(setTimeout(() => {
      enviarAviso(sock, new Set([groupJid]), aviso.tipo, horariosPorGrupo).catch(erro =>
        console.error('[QuizRanking] Erro no aviso ' + aviso.tipo + ' de ' + groupJid + ':', erro && erro.message || erro)
      );
    }, atraso));
  }

  timers.push(setTimeout(async () => {
    try {
      await executarPremiacao(sock, new Set([groupJid]), data, horario);
    } catch (erro) {
      console.error('[QuizRanking] Erro na premiação do grupo ' + groupJid + ':', erro && erro.message || erro);
    } finally {
      timersPorGrupo.delete(groupJid);
      agendarPremiacaoGrupo(sock, groupJid, indiceGrupo);
    }
  }, msRestantes));

  timersPorGrupo.set(groupJid, timers);
  console.log('[QuizRanking] Próxima premiação de ' + groupJid + ': ' + data + ' às ' + horario.texto + ' (' + TZ + ').');
}

async function agendarProximasPremiacoes(sock, gruposAtivos) {
  if (sincronizacaoEmAndamento) return;
  sincronizacaoEmAndamento = true;
  try {
    const resultado = await resolverHorariosGrupos(gruposAtivos);
    const grupos = resultado.grupos;
    const atribuicoes = resultado.atribuicoes;
    const agora = new Date();
    const local = agoraLocal(agora);

    if (grupos.length > MINUTOS_DIA / INTERVALO_GRUPOS_MINUTOS) {
      console.warn('[QuizRanking] Há 36 horários diários distintos com intervalos de 40 minutos; grupos adicionais reutilizarão horários.');
    }

    for (const groupJid of grupos) {
      if (timersPorGrupo.has(groupJid)) continue;
      const indiceGrupo = atribuicoes.get(groupJid) || 0;
      const horario = obterHorarioGrupo(indiceGrupo);
      const instanteDeHoje = converterHorarioLocalParaDate(local.iso, horario.hora, horario.minuto);

      // Recupera apenas o grupo cujo horário já passou durante uma interrupção.
      if (instanteDeHoje <= agora) {
        try {
          await executarPremiacao(sock, new Set([groupJid]), local.iso, horario);
        } catch (erro) {
          console.error('[QuizRanking] Erro ao recuperar premiação de ' + groupJid + ':', erro && erro.message || erro);
        }
      }

      if (!timersPorGrupo.has(groupJid)) agendarPremiacaoGrupo(sock, groupJid, indiceGrupo);
    }
  } finally {
    sincronizacaoEmAndamento = false;
  }
}

function initQuizRankingScheduler(sock, gruposAtivos) {
  console.log('[QuizRanking] Agendador diário por grupo iniciado.');
  agendarProximasPremiacoes(sock, gruposAtivos).catch(erro =>
    console.error('[QuizRanking] Erro ao iniciar os horários de premiação:', erro && erro.message || erro)
  );

  if (!intervaloSincronizacao) {
    // Descobre grupos novos sem alterar os horários já reservados.
    intervaloSincronizacao = setInterval(() => {
      agendarProximasPremiacoes(sock, gruposAtivos).catch(erro =>
        console.error('[QuizRanking] Erro ao actualizar horários dos grupos:', erro && erro.message || erro)
      );
    }, 15 * 60 * 1000);
    if (typeof intervaloSincronizacao.unref === 'function') intervaloSincronizacao.unref();
  }
}

module.exports = {
  initQuizRankingScheduler,
  executarPremiacao,
  enviarAviso,
  PREMIOS_PRATA,
  PARTICIPATION_TARGET,
  PARTICIPATION_REWARD,
  calcularProximaPremiacao,
  obterHorarioGrupo,
  resolverHorariosGrupos,
  converterHorarioLocalParaDate,
};
