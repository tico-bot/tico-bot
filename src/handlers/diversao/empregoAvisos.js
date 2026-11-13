'use strict';

const CarteiraGrupo = require('../../models/CarteiraGrupo');
const GrupoConfig = require('../../models/GrupoConfig');
const { TEMPO, calcularTempoForaHorario, dentroDoHorario } = require('./emprego');

const MINUTO_MS = 60_000;
const AVISO_TURNO_MS = 10 * MINUTO_MS;
const AVISO_URGENTE_MS = 5 * MINUTO_MS;

function formatarMinutos(ms) {
  const minutos = Math.max(1, Math.ceil(ms / MINUTO_MS));
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}

/** Escolhe apenas o aviso mais relevante para o instante atual. */
function selecionarAviso(ultimoTrabalho, agora = Date.now(), avisosEnviados = []) {
  const ultimoTs = new Date(ultimoTrabalho).getTime();
  if (!Number.isFinite(ultimoTs) || ultimoTs <= 0 || agora < ultimoTs) return null;

  const decorridoEfetivo = (agora - ultimoTs) - calcularTempoForaHorario(ultimoTs, agora);
  const enviados = new Set(Array.isArray(avisosEnviados) ? avisosEnviados : []);

  if (decorridoEfetivo < TEMPO.COOLDOWN_MS) {
    const restante = TEMPO.COOLDOWN_MS - decorridoEfetivo;
    if (restante <= 0 || restante > AVISO_TURNO_MS) return null;
    return {
      codigo: restante <= AVISO_URGENTE_MS ? 'turno_5' : 'turno_10',
      restanteMs: restante,
      tipo: 'turno',
    };
  }

  if (decorridoEfetivo >= TEMPO.DEMISSAO_MS) return null;

  const restante = TEMPO.DEMISSAO_MS - decorridoEfetivo;
  if (restante <= AVISO_URGENTE_MS) {
    return { codigo: 'demissao_5', restanteMs: restante, tipo: 'demissao' };
  }
  if (restante <= AVISO_TURNO_MS) {
    return { codigo: 'demissao_10', restanteMs: restante, tipo: 'demissao' };
  }
  if (!enviados.has('tolerancia_inicio')) {
    return { codigo: 'tolerancia_inicio', restanteMs: restante, tipo: 'tolerancia' };
  }
  return null;
}

function montarMensagem(aviso, usuarioJid, cargoNome, prefixo = '!') {
  const mencao = `@${String(usuarioJid).split('@')[0].split(':')[0]}`;
  const falta = `*${formatarMinutos(aviso.restanteMs)}*`;

  if (aviso.tipo === 'turno') {
    return (
      `⏰ *LEMBRETE DE TRABALHO*\n\n` +
      `${mencao}, seu próximo turno como *${cargoNome}* estará disponível em ${falta}.\n\n` +
      `Prepare-se para usar *${prefixo}work* assim que o intervalo terminar.\n` +
      `_A contagem considera apenas o horário comercial (08h às 23h)._`
    );
  }

  if (aviso.tipo === 'tolerancia') {
    return (
      `🟢 *SEU PRÓXIMO TURNO ESTÁ LIBERADO!*\n\n` +
      `${mencao}, você já pode bater o ponto no cargo *${cargoNome}*.\n` +
      `A tolerância começou: restam ${falta} para o prazo terminar e você correr risco de demissão.\n\n` +
      `Use *${prefixo}work* para cumprir o próximo turno.\n` +
      `_A tolerância é contada apenas no horário comercial (08h às 23h)._`
    );
  }

  return (
    `🚨 *ATENÇÃO: RISCO DE DEMISSÃO*\n\n` +
    `${mencao}, faltam apenas ${falta} para terminar sua tolerância no cargo *${cargoNome}*.\n\n` +
    `Bata o ponto com *${prefixo}work* antes do fim do prazo. Se deixar passar, você será demitido por justa causa ao tentar voltar a trabalhar!\n` +
    `_A tolerância é contada apenas no horário comercial (08h às 23h)._`
  );
}

async function reivindicarAviso(carteira, codigo) {
  const resultado = await CarteiraGrupo.updateOne(
    {
      _id: carteira._id,
      ultimoTrabalho: carteira.ultimoTrabalho,
      empregoAtual: carteira.empregoAtual,
      avisosEmprego: { $ne: codigo },
    },
    { $addToSet: { avisosEmprego: codigo } }
  );
  return resultado.modifiedCount === 1;
}

async function processarAvisosTrabalho(sock, agora = Date.now()) {
  if (!sock?.user || typeof sock.sendMessage !== 'function') return 0;
  if (!dentroDoHorario(agora)) return 0;

  const carteiras = await CarteiraGrupo.find({
    empregoAtual: { $exists: true, $nin: [null, '', 'desempregado'] },
    ultimoTrabalho: { $type: 'date' },
  })
    .select('_id idWhatsApp idGrupo empregoAtual ultimoTrabalho avisosEmprego')
    .lean();

  if (!carteiras.length) return 0;

  const grupos = [...new Set(carteiras.map(c => c.idGrupo).filter(g => typeof g === 'string' && g.endsWith('@g.us')))];
  if (!grupos.length) return 0;

  // Grupos explicitamente desligados não recebem mensagens automáticas.
  const configs = await GrupoConfig.find({ idGrupo: { $in: grupos } })
    .select('idGrupo botAtivo prefixo')
    .lean();
  const configPorGrupo = new Map(configs.map(cfg => [cfg.idGrupo, cfg]));

  let enviados = 0;
  for (const carteira of carteiras) {
    const { idWhatsApp: usuarioJid, idGrupo: grupoJid } = carteira;
    if (!grupoJid?.endsWith('@g.us') || configPorGrupo.get(grupoJid)?.botAtivo === false) continue;
    if (typeof usuarioJid !== 'string' || !usuarioJid.includes('@')) continue;

    const aviso = selecionarAviso(carteira.ultimoTrabalho, agora, carteira.avisosEmprego);
    if (!aviso) continue;

    try {
      const reservado = await reivindicarAviso(carteira, aviso.codigo);
      if (!reservado) continue;

      try {
        await sock.sendMessage(grupoJid, {
          text: montarMensagem(aviso, usuarioJid, carteira.empregoAtual, configPorGrupo.get(grupoJid)?.prefixo || '!'),
          mentions: [usuarioJid],
        });
        enviados += 1;
      } catch (erroEnvio) {
        // Permite nova tentativa no próximo ciclo se o WhatsApp falhar.
        await CarteiraGrupo.updateOne(
          { _id: carteira._id, ultimoTrabalho: carteira.ultimoTrabalho },
          { $pull: { avisosEmprego: aviso.codigo } }
        ).catch(() => {});
        throw erroEnvio;
      }
    } catch (erro) {
      console.error(`[EmpregoAvisos] Falha ao avisar ${usuarioJid} em ${grupoJid}:`, erro?.message || erro);
    }
  }

  return enviados;
}

let timer = null;
let executando = false;
let socketAtual = null;

async function tick() {
  if (executando || !socketAtual?.user) return;
  executando = true;
  try {
    await processarAvisosTrabalho(socketAtual);
  } catch (erro) {
    console.error('[EmpregoAvisos] Erro no ciclo de avisos:', erro?.stack || erro?.message || erro);
  } finally {
    executando = false;
  }
}

function iniciarAgendadorAvisosEmprego(sock) {
  pararAgendadorAvisosEmprego();
  socketAtual = sock || null;
  if (!socketAtual?.user) return;

  tick();
  timer = setInterval(tick, MINUTO_MS);
  timer.unref?.();
  console.log('[EmpregoAvisos] Avisos de turno e tolerância iniciados (ciclo de 1 minuto).');
}

function pararAgendadorAvisosEmprego() {
  if (timer) clearInterval(timer);
  timer = null;
  socketAtual = null;
}

module.exports = {
  selecionarAviso,
  montarMensagem,
  processarAvisosTrabalho,
  iniciarAgendadorAvisosEmprego,
  pararAgendadorAvisosEmprego,
  formatarMinutos,
};
