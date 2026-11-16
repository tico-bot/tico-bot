'use strict';

const crypto = require('node:crypto');
const GrupoConfig = require('../../models/GrupoConfig');
const RepublicaEstado = require('../../models/RepublicaEstado');
const RepublicaEleicao = require('../../models/RepublicaEleicao');
const RepublicaVoto = require('../../models/RepublicaVoto');
const RepublicaConsulta = require('../../models/RepublicaConsulta');
const RepublicaVotoConsulta = require('../../models/RepublicaVotoConsulta');
const RepublicaLancamento = require('../../models/RepublicaLancamento');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const { modoAtivo, getEstado, obterTaxasEfetivas, despesa } = require('./economia');
const social = require('./social');
const eleicoes = require('./eleicoes');
const { resolveJidComLid } = require('../../utils/identity');
const { getCarteira } = require('../../utils/carteira');

const CONSULTA_IMPOSTO_MS = 12 * 60 * 60 * 1000;
const CONSULTA_EMENDA_MS = 24 * 60 * 60 * 1000;
const CONSULTA_DESPESA_MS = 6 * 60 * 60 * 1000;

function ehGrupo(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}
function formatar(valor) {
  return Math.floor(Number(valor) || 0).toLocaleString('pt-BR') + ' Pratas';
}
function textoAjuda(prefixo) {
  const p = prefixo || '/';
  return [
    '🇧🇷 *MODO REPÚBLICA — CENTRAL DO GOVERNO*',
    '',
    '*ELEIÇÕES*',
    p + 'republica candidatura @vice | <propostas> — formar chapa e apresentar plano',
    p + 'republica aceitar — o vice confirma',
    p + 'republica votar @presidente — voto secreto',
    p + 'republica eleicao — consultar eleição',
    '',
    '*GOVERNO E CONTAS*',
    p + 'republica status — presidente, vice e mandato',
    p + 'republica tesouro — saldos e repartição das receitas (40/20/15/10/15)',
    p + 'republica contas — últimas entradas e despesas',
    p + 'republica gasto <eventos|desenvolvimento> <valor> @membro <motivo> — despesa até 10% do fundo',
    p + 'republica proporgasto <eventos|desenvolvimento> <valor> @membro <motivo> — propor despesa à votação popular',
    p + 'republica decreto <título> | <texto> — publicar decreto',
    p + 'republica leis — consultar o Diário Oficial',
    '',
    '*TRIBUTAÇÃO*',
    p + 'republica impostos — consultar alíquotas',
    p + 'republica imposto <irpf|cbs|ibs|iof> <+/-pp> — ajustar imposto',
    p + 'republica novoimposto <nome> <alíquota> <renda|consumo|credito> — propor novo imposto',
    p + 'republica votarconsulta <id> <sim|nao> — votar em consulta popular',
    p + 'republica emenda limite-imposto <0-5> — referendo constitucional especial',
    p + 'republica consultas — consultas abertas',
    '',
    '*POLÍTICAS SOCIAIS*',
    p + 'republica bolsa solicitar — solicitar Bolsa Família do Tico',
    p + 'republica bolsa status — consultar benefício',
    p + 'republica licenca — consultar licença parental',
    '',
    '*RECOMPENSAS*',
    p + 'republica recompensa <+/-percentual> <horas> — alterar recompensa temporária',
    p + 'republica renunciar — sucessão constitucional pelo vice',
    '',
    p + 'republica on/off — ativar ou desativar o modo (administradores)',
    '',
    'O mandato dura 24 horas. A presidência não concede poderes de administrador do WhatsApp.',
  ].join('\n');
}

async function obterPapel(idGrupo, usuarioRaw) {
  const usuario = await resolveJidComLid(usuarioRaw, idGrupo);
  const estado = await getEstado(idGrupo);
  const presidente = estado.governo && estado.governo.presidenteId;
  const vice = estado.governo && estado.governo.viceId;
  return {
    usuario, estado,
    presidente: Boolean(usuario && presidente && usuario === presidente),
    vice: Boolean(usuario && vice && usuario === vice),
    autorizado: Boolean(usuario && (usuario === presidente || usuario === vice)),
    mandatoValido: Boolean(estado.governo?.mandatoAte && new Date(estado.governo.mandatoAte).getTime() > Date.now()),
  };
}

async function criarConsulta(idGrupo, tipo, titulo, proposta, autorId, duracaoMs, quorumMinimo, maioriaMinima) {
  const aberta = await RepublicaConsulta.findOne({ idGrupo, status: 'aberta', tipo }).lean();
  if (aberta) return { ok: false, motivo: 'CONSULTA_JA_ABERTA', consulta: aberta };
  try {
    const consulta = await RepublicaConsulta.create({
      idGrupo, tipo, titulo, proposta, autorId,
      status: 'aberta',
      encerraEm: new Date(Date.now() + duracaoMs),
      quorumMinimo, maioriaMinima,
    });
    return { ok: true, consulta };
  } catch (error) {
    if (error?.code === 11000) {
      const concorrente = await RepublicaConsulta.findOne({ idGrupo, status: 'aberta', tipo }).lean();
      return { ok: false, motivo: 'CONSULTA_JA_ABERTA', consulta: concorrente };
    }
    throw error;
  }
}

async function votarConsulta(idGrupo, eleitorRaw, idConsulta, voto) {
  if (!/^[a-f0-9]{24}$/i.test(String(idConsulta || ''))) return { ok: false, motivo: 'CONSULTA_NAO_ENCONTRADA' };
  const eleitorId = await resolveJidComLid(eleitorRaw, idGrupo);
  if (!eleitorId || !['sim', 'nao'].includes(voto)) return { ok: false, motivo: 'VOTO_INVALIDO' };
  const consulta = await RepublicaConsulta.findOne({ _id: idConsulta, idGrupo, status: 'aberta' });
  if (!consulta || new Date(consulta.encerraEm).getTime() <= Date.now()) return { ok: false, motivo: 'CONSULTA_NAO_ENCONTRADA' };
  const anterior = await RepublicaVotoConsulta.findOne({ idConsulta: consulta._id, eleitorId }).lean();
  await RepublicaVotoConsulta.findOneAndUpdate(
    { idConsulta: consulta._id, eleitorId },
    { $set: { idGrupo, voto }, $setOnInsert: { idConsulta: consulta._id, eleitorId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (anterior && anterior.voto !== voto) {
    await RepublicaConsulta.updateOne(
      { _id: consulta._id },
      { $inc: voto === 'sim' ? { totalSim: 1, totalNao: -1 } : { totalSim: -1, totalNao: 1 } }
    );
  } else if (!anterior) {
    await RepublicaConsulta.updateOne(
      { _id: consulta._id },
      { $inc: voto === 'sim' ? { totalSim: 1 } : { totalNao: 1 } }
    );
  }
  return { ok: true, consulta };
}

async function processarConsultas(sock, idGrupo) {
  const consultas = await RepublicaConsulta.find({ idGrupo, status: 'aberta', encerraEm: { $lte: new Date() } });
  for (const consulta of consultas) {
    const votosConsolidados = await RepublicaVotoConsulta.aggregate([
      { $match: { idConsulta: consulta._id, idGrupo } },
      { $group: { _id: '$voto', quantidade: { $sum: 1 } } },
    ]);
    consulta.totalSim = votosConsolidados.find(v => v._id === 'sim')?.quantidade || 0;
    consulta.totalNao = votosConsolidados.find(v => v._id === 'nao')?.quantidade || 0;
    const cadastrados = Math.max(1, await CarteiraGrupo.countDocuments({ idGrupo }));
    const total = consulta.totalSim + consulta.totalNao;
    const quorum = consulta.tipo === 'emenda_constitucional'
      ? Math.max(2, Math.ceil(cadastrados * 0.60))
      : Math.max(1, Math.ceil(cadastrados * consulta.quorumMinimo));
    const percentualSim = total ? consulta.totalSim / total : 0;
    let aprovada = total >= quorum && percentualSim >= consulta.maioriaMinima;
    let motivoExecucao = null;
    if (aprovada && consulta.tipo === 'novo_imposto') {
      const estado = await getEstado(idGrupo);
      const proposta = consulta.proposta || {};
      const existentes = (estado.impostos.novos || []).filter(x => x.ativo && x.base === proposta.base);
      const adicionalAtual = existentes.reduce((soma, x) => soma + (Number(x.aliquota) || 0), 0);
      const taxaBase = proposta.base === 'consumo'
        ? Number(estado.impostos.cbs || 0) + Number(estado.impostos.ibs || 0)
        : proposta.base === 'credito'
          ? Number(estado.impostos.iof || 0)
          : 0;
      if (!['renda', 'consumo', 'credito'].includes(proposta.base) ||
          !Number.isFinite(Number(proposta.aliquota)) || Number(proposta.aliquota) <= 0 ||
          adicionalAtual + taxaBase + Number(proposta.aliquota) > 20) {
        aprovada = false;
        motivoExecucao = 'A soma das alíquotas desta base ultrapassaria o limite de 20%. A proposta não foi aplicada.';
      } else {
        const impostoCriado = {
          id: 'imp-' + crypto.randomBytes(4).toString('hex'),
          nome: String(proposta.nome || 'Novo imposto').slice(0, 50),
          aliquota: Number(proposta.aliquota),
          base: proposta.base,
          aprovadoEm: new Date(), ativo: true,
        };
        estado.impostos.novos.push(impostoCriado);
        estado.leis.push({
          id: 'lei-' + crypto.randomBytes(4).toString('hex'),
          titulo: 'Criação de imposto: ' + impostoCriado.nome,
          texto: 'Imposto de ' + impostoCriado.aliquota + '% sobre ' + impostoCriado.base + ', aprovado em consulta popular. Entrada em vigor às 00:00 do próximo dia fiscal de Cuiabá.',
          autorId: consulta.autorId, aprovadaEm: new Date(), ativa: true,
        });
        if (estado.leis.length > 100) estado.leis.splice(0, estado.leis.length - 100);
        await estado.save();
      }
    }
    if (aprovada && consulta.tipo === 'emenda_constitucional') {
      const novoLimite = Number(consulta.proposta.limiteAjusteImpostoPp);
      if (Number.isFinite(novoLimite) && novoLimite >= 0 && novoLimite <= 5) {
        await RepublicaEstado.updateOne({ idGrupo }, {
          $set: { 'constituicao.limiteAjusteImpostoPp': novoLimite },
          $push: { leis: { $each: [{
            id: 'lei-' + crypto.randomBytes(4).toString('hex'),
            titulo: 'Emenda constitucional tributária',
            texto: 'Referendo popular aprovou limite presidencial de ±' + novoLimite + ' p.p. por imposto e mandato.',
            autorId: consulta.autorId, aprovadaEm: new Date(), ativa: true,
          }], $slice: -100 } },
        });
      } else {
        aprovada = false;
        motivoExecucao = 'A proposta de emenda tinha um limite inválido.';
      }
    }
    if (aprovada && consulta.tipo === 'despesa_publica') {
      const proposta = consulta.proposta || {};
      const resultadoDespesa = await despesa(
        idGrupo,
        proposta.fundo,
        proposta.valor,
        proposta.motivo || 'Despesa aprovada em consulta popular',
        consulta.autorId,
        proposta.beneficiarioId,
        proposta.motivo,
        { aprovadaPopularmente: true, requestId: 'consulta:' + String(consulta._id) }
      );
      if (!resultadoDespesa.ok) {
        aprovada = false;
        motivoExecucao = resultadoDespesa.motivo === 'SALDO_INSUFICIENTE'
          ? 'O fundo não tinha saldo suficiente no encerramento da consulta.'
          : resultadoDespesa.motivo === 'CARTEIRA_EXTERNA'
            ? 'O beneficiário utiliza carteira externa, que não pode receber recursos do Tesouro do Tico.'
            : 'A despesa não pôde ser executada por parâmetros inválidos.';
      }
    }
    consulta.status = aprovada ? 'aprovada' : 'rejeitada';
    await consulta.save();
    if (sock && sock.sendMessage) await sock.sendMessage(idGrupo, {
      text:
        '🗳️ *CONSULTA POPULAR ENCERRADA*\n\n' +
        '*' + consulta.titulo + '*\n' +
        '✅ Sim: *' + consulta.totalSim + '*\n' +
        '❌ Não: *' + consulta.totalNao + '*\n' +
        '📊 Quórum exigido: *' + quorum + '* de ' + cadastrados + ' membros registados\n\n' +
        (aprovada ? '✅ *PROPOSTA APROVADA E EXECUTADA*' : '❌ *PROPOSTA NÃO APROVADA*') +
        (consulta.tipo === 'novo_imposto' && aprovada ? '\n🕛 O novo imposto entra em vigor às 00:00 do próximo dia fiscal de Cuiabá.' : '') +
        (motivoExecucao ? '\n' + motivoExecucao : ''),
    }).catch(() => {});
  }
}

async function mostrarTesouro(sock, msg, idGrupo) {
  const estado = await getEstado(idGrupo);
  const t = estado.tesouro || {};
  return sock.sendMessage(idGrupo, {
    text:
      '🏦 *TESOURO NACIONAL — CONTAS DO GRUPO*\n\n' +
      '👨‍👩‍👧 Bolsa Família (40%): *' + formatar(t.bolsaFamilia) + '*\n' +
      '👶 Licença parental (20%): *' + formatar(t.licencaParental) + '*\n' +
      '🎉 Eventos (15%): *' + formatar(t.eventos) + '*\n' +
      '🏗️ Desenvolvimento (10%): *' + formatar(t.desenvolvimento) + '*\n' +
      '🛡️ Reserva de emergência (15%): *' + formatar(t.reserva) + '*\n' +
      '━━━━━━━━━━━━━━━━\n' +
      '📥 Total arrecadado: *' + formatar(t.arrecadadoTotal) + '*\n' +
      '📤 Total gasto: *' + formatar(t.gastoTotal) + '*\n\n' +
      '_Cada grupo tem seu próprio Tesouro. Os fundos sociais e a reserva não podem ser usados em despesas comuns._',
  }, { quoted: msg });
}

async function mostrarContas(sock, msg, idGrupo) {
  const estado = await getEstado(idGrupo);
  const lancamentos = await RepublicaLancamento.find({ idGrupo }).sort({ createdAt: -1 }).limit(8).lean();
  const linhas = lancamentos.map((l, i) => {
    const sinal = l.tipo === 'arrecadacao' ? '+' : '-';
    return (i + 1) + '. ' + sinal + formatar(l.valor) + ' — ' + l.categoria;
  });
  const total = ['bolsaFamilia', 'licencaParental', 'eventos', 'desenvolvimento', 'reserva']
    .reduce((soma, fundo) => soma + (Number(estado.tesouro?.[fundo]) || 0), 0);
  return sock.sendMessage(idGrupo, {
    text: '📚 *TRANSPARÊNCIA — CONTAS PÚBLICAS*\n\n' +
      (linhas.length ? linhas.join('\n') : '_Ainda não há movimentos registados._') +
      '\n\nTotal no Tesouro: *' + formatar(total) + '*',
  }, { quoted: msg });
}

async function mostrarImpostos(sock, msg, idGrupo) {
  const estado = await getEstado(idGrupo);
  const imp = estado.impostos || {};
  const vigentes = await obterTaxasEfetivas(idGrupo);
  const limite = estado.constituicao?.limiteAjusteImpostoPp ?? 2;
  const futuras = [];
  const comparar = (nome, atual, futuro, sufixo = '%') => {
    if (Number(atual) !== Number(futuro)) futuras.push(nome + ': ' + futuro + sufixo + ' (actualmente ' + atual + sufixo + ')');
  };
  comparar('IRPF-Tico — ajuste progressivo', vigentes.ajusteIrpfPp, imp.ajusteIrpfPp || 0, ' p.p.');
  comparar('CBS', vigentes.cbs, imp.cbs);
  comparar('IBS', vigentes.ibs, imp.ibs);
  comparar('IOF', vigentes.iof, imp.iof);
  const novosVigentes = new Set((vigentes.novos || []).filter(x => x.ativo).map(x => x.id));
  for (const imposto of (imp.novos || []).filter(x => x.ativo && !novosVigentes.has(x.id))) {
    futuras.push(imposto.nome + ': ' + imposto.aliquota + '% (' + imposto.base + ')');
  }
  const linhas = [
    '🧾 *SISTEMA TRIBUTÁRIO DO MODO REPÚBLICA*',
    '*Alíquotas em vigor hoje (' + vigentes.dia + ' — Cuiabá):*',
    '📈 IRPF-Tico (progressivo): ajuste de *' + (vigentes.ajusteIrpfPp >= 0 ? '+' : '') + (vigentes.ajusteIrpfPp || 0) + ' p.p.*',
    '🛒 CBS: *' + vigentes.cbs + '%*',
    '🏙️ IBS: *' + vigentes.ibs + '%*',
    '💳 IOF sobre crédito: *' + vigentes.iof + '%*',
    '⚖️ Limite presidencial por imposto/mandato: *±' + limite + ' p.p.*',
    '',
    'Os novos impostos dependem de consulta popular.',
  ];
  for (const n of (vigentes.novos || []).filter(x => x.ativo)) linhas.push('• ' + n.nome + ': ' + n.aliquota + '% (' + n.base + ')');
  if (futuras.length) {
    linhas.push('', '*Alterações já publicadas para o próximo dia fiscal:*');
    linhas.push(...futuras.map(x => '• ' + x));
  }
  linhas.push('', '_Alterações anunciadas durante o dia entram em vigor às 00:00 do próximo dia fiscal de Cuiabá. Nunca são retroactivas._');
  return sock.sendMessage(idGrupo, { text: linhas.join('\n') }, { quoted: msg });
}

async function ajustarImposto(sock, msg, idGrupo, usuarioRaw, nomeTaxa, deltaRaw) {
  // Cria a fotografia fiscal do dia antes de qualquer alteração presidencial.
  await obterTaxasEfetivas(idGrupo);
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode ajustar impostos.' }, { quoted: msg });
  const taxa = String(nomeTaxa || '').toLowerCase();
  const delta = Number(String(deltaRaw || '').replace(',', '.'));
  if (!['irpf', 'cbs', 'ibs', 'iof'].includes(taxa) || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 2) {
    return sock.sendMessage(idGrupo, { text: '⚠️ Use: /republica imposto <irpf|cbs|ibs|iof> <+/-2> em pontos percentuais.' }, { quoted: msg });
  }
  const estado = papel.estado;
  const limite = estado.constituicao?.limiteAjusteImpostoPp ?? 2;
  const campo = taxa === 'irpf' ? 'impostos.ajusteIrpfPp' : 'impostos.' + taxa;
  const atual = taxa === 'irpf' ? Number(estado.impostos.ajusteIrpfPp || 0) : Number(estado.impostos[taxa] || 0);
  const novo = taxa === 'irpf'
    ? Math.max(-2, Math.min(8, atual + delta))
    : Math.max(0, Math.min(20, atual + delta));
  const deltaAplicado = novo - atual;
  if (Math.abs(deltaAplicado) < 0.000001) {
    return sock.sendMessage(idGrupo, { text: '❌ Esse imposto já está no limite permitido para essa direcção.' }, { quoted: msg });
  }
  const atualAcumulado = Number(estado.impostos?.ajustesMandato?.[taxa]) || 0;
  const proximoAcumulado = atualAcumulado + Math.abs(deltaAplicado);
  if (proximoAcumulado > limite) return sock.sendMessage(idGrupo, {
    text: '⛔ Limite constitucional excedido. O governo já utilizou ' +
      atualAcumulado + ' p.p. deste imposto neste mandato; limite total de alterações: ' + limite + ' p.p.',
  }, { quoted: msg });
  const lei = {
    id: 'lei-' + crypto.randomBytes(4).toString('hex'),
    titulo: 'Alteração de imposto: ' + taxa.toUpperCase(),
    texto: 'Ajuste de ' + (deltaAplicado > 0 ? '+' : '') + deltaAplicado + ' p.p. Nova configuração: ' + novo + '. Entra em vigor às 00:00 do próximo dia fiscal de Cuiabá.',
    autorId: papel.usuario, aprovadaEm: new Date(), ativa: true,
  };
  const atualizado = await RepublicaEstado.findOneAndUpdate(
    {
      idGrupo,
      [campo]: atual,
      ['impostos.ajustesMandato.' + taxa]: { $lte: limite - Math.abs(deltaAplicado) },
    },
    {
      $set: { [campo]: novo },
      $inc: { ['impostos.ajustesMandato.' + taxa]: Math.abs(deltaAplicado) },
      $push: { leis: { $each: [lei], $slice: -100 } },
    },
    { new: true }
  );
  if (!atualizado) return sock.sendMessage(idGrupo, {
    text: '⚠️ A alíquota foi alterada por outra operação ou o limite do mandato acabou de ser atingido. Consulte /republica impostos e tente novamente.',
  }, { quoted: msg });
  return sock.sendMessage(idGrupo, {
    text: '📜 *DIÁRIO OFICIAL — NOVA ALÍQUOTA*\n\n' +
      '🏛️ Alteração publicada pelo presidente.\n' +
      '🧾 Imposto: *' + taxa.toUpperCase() + '*\n' +
      '📊 Ajuste aplicado: *' + (deltaAplicado > 0 ? '+' : '') + deltaAplicado + ' p.p.*\n' +
      '✅ Novo valor publicado: *' + novo + (taxa === 'irpf' ? ' p.p. de ajuste' : '%') + '*\n' +
      '🕛 Entrada em vigor: *00:00 do próximo dia fiscal de Cuiabá*.\n\n' +
      '_A alíquota em vigor hoje não muda. Transacções anteriores não são alteradas._',
  }, { quoted: msg });
}

async function proporNovoImposto(sock, msg, idGrupo, usuarioRaw, nome, aliquotaRaw, base) {
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode propor um novo imposto.' }, { quoted: msg });
  const aliquota = Number(String(aliquotaRaw || '').replace(',', '.'));
  if (!nome || !Number.isFinite(aliquota) || aliquota <= 0 || aliquota > 20 || !['renda', 'consumo', 'credito'].includes(base)) {
    return sock.sendMessage(idGrupo, { text: '⚠️ Use: /republica novoimposto <nome> <alíquota> <renda|consumo|credito>.' }, { quoted: msg });
  }
  const resultado = await criarConsulta(idGrupo, 'novo_imposto', 'Criar imposto: ' + nome,
    { nome: nome.slice(0, 50), aliquota, base }, papel.usuario, CONSULTA_IMPOSTO_MS, 0.25, 0.5);
  if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '⚠️ Já existe uma consulta aberta para novo imposto.' }, { quoted: msg });
  return sock.sendMessage(idGrupo, {
    text: '🗳️ *CONSULTA POPULAR ABERTA*\n\n' +
      'Proposta: *' + nome + '*\nAlíquota: *' + aliquota + '%*\nBase: *' + base + '*\n' +
      'ID: ' + resultado.consulta._id + '\nPrazo: *12 horas*\n' +
      '🕛 Se aprovada, a cobrança começa às 00:00 do próximo dia fiscal de Cuiabá.\n\n' +
      'Vote com /republica votarconsulta ' + resultado.consulta._id + ' sim ou nao.',
  }, { quoted: msg });
}

async function proporDespesaPublica(sock, msg, idGrupo, usuarioRaw, fundoRaw, valorRaw, beneficiarioRaw, motivoRaw) {
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.autorizado || !papel.mandatoValido) {
    return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente ou o vice em exercício podem propor despesas para votação.' }, { quoted: msg });
  }
  const fundo = String(fundoRaw || '').toLowerCase();
  const valor = Number(valorRaw);
  if (!['eventos', 'desenvolvimento'].includes(fundo) || !Number.isSafeInteger(valor) || valor <= 0 || !beneficiarioRaw) {
    return sock.sendMessage(idGrupo, { text: '⚠️ Use: /republica proporgasto <eventos|desenvolvimento> <valor> @membro <motivo>.' }, { quoted: msg });
  }
  const beneficiarioId = await resolveJidComLid(beneficiarioRaw, idGrupo);
  if (!beneficiarioId || beneficiarioId === papel.estado.governo.presidenteId || beneficiarioId === papel.estado.governo.viceId) {
    return sock.sendMessage(idGrupo, { text: '⛔ Presidente e vice não podem receber recursos do Tesouro.' }, { quoted: msg });
  }
  const carteiraBeneficiario = await getCarteira(beneficiarioId, idGrupo);
  if (carteiraBeneficiario?.walletLinked || carteiraBeneficiario?.currencyInfo) {
    return sock.sendMessage(idGrupo, { text: '⛔ O Tesouro só transfere Pratas para carteiras internas do Tico.' }, { quoted: msg });
  }
  const saldo = Number(papel.estado.tesouro?.[fundo]) || 0;
  if (valor > saldo) return sock.sendMessage(idGrupo, { text: '❌ O Fundo ' + fundo + ' tem apenas ' + formatar(saldo) + '.' }, { quoted: msg });
  const motivo = String(motivoRaw || 'Projecto público').trim().slice(0, 250);
  const resultado = await criarConsulta(
    idGrupo,
    'despesa_publica',
    'Despesa pública: ' + motivo.slice(0, 80),
    { fundo, valor, beneficiarioId, motivo },
    papel.usuario,
    CONSULTA_DESPESA_MS,
    0.25,
    0.5
  );
  if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '⚠️ Já existe uma proposta de despesa em votação.' }, { quoted: msg });
  return sock.sendMessage(idGrupo, {
    text: '🏛️ *PROPOSTA DE DESPESA — VOTAÇÃO POPULAR*\n\n' +
      '📂 Fundo: *' + fundo + '*\n' +
      '💰 Valor: *' + formatar(valor) + '*\n' +
      '👤 Beneficiário: @' + beneficiarioId.split('@')[0] + '\n' +
      '📝 Motivo: *' + motivo + '*\n' +
      '⏳ Prazo: *6 horas*\n' +
      '📊 Exige 25% de quórum e maioria simples.\n\n' +
      'ID: ' + resultado.consulta._id + '\n' +
      'Vote com /republica votarconsulta ' + resultado.consulta._id + ' sim ou nao.',
    mentions: [beneficiarioId],
  }, { quoted: msg });
}

async function proporEmenda(sock, msg, idGrupo, usuarioRaw, novoLimite) {
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode propor emenda constitucional.' }, { quoted: msg });
  const limite = Number(novoLimite);
  if (!Number.isFinite(limite) || limite < 0 || limite > 5) return sock.sendMessage(idGrupo, { text: '❌ O limite constitucional deve ficar entre 0 e 5 pontos percentuais.' }, { quoted: msg });
  const resultado = await criarConsulta(idGrupo, 'emenda_constitucional', 'Emenda ao limite de alteração tributária',
    { limiteAjusteImpostoPp: limite }, papel.usuario, CONSULTA_EMENDA_MS, 0.60, 2 / 3);
  if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '⚠️ Já existe consulta constitucional aberta.' }, { quoted: msg });
  return sock.sendMessage(idGrupo, {
    text: '⚖️ *REFERENDO CONSTITUCIONAL ESPECIAL*\n\n' +
      'Novo limite presidencial: *±' + limite + ' p.p. por imposto e mandato*.\n' +
      'ID: ' + resultado.consulta._id + '\nPrazo: *24 horas*\n' +
      'Exige 60% de quórum e 2/3 de votos favoráveis.\n\n' +
      'Vote com /republica votarconsulta ' + resultado.consulta._id + ' sim ou nao.',
  }, { quoted: msg });
}

async function alterarRecompensa(sock, msg, idGrupo, usuarioRaw, percentualRaw, horasRaw) {
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode ajustar recompensas.' }, { quoted: msg });
  const percentual = Number(String(percentualRaw || '').replace(',', '.'));
  const horas = Number(horasRaw);
  if (!Number.isFinite(percentual) || percentual === 0 || Math.abs(percentual) > 20 || !Number.isInteger(horas) || horas < 1 || horas > 6) {
    return sock.sendMessage(idGrupo, { text: '⚠️ Use: /republica recompensa +10 6 (máximo ±20%, até 6 horas).' }, { quoted: msg });
  }
  const recompensa = papel.estado.recompensaTemporaria || {};
  const agora = new Date();
  if (recompensa.ate && new Date(recompensa.ate).getTime() > agora.getTime()) return sock.sendMessage(idGrupo, { text: '⏳ Já existe uma alteração temporária activa. Não é permitido acumular bónus.' }, { quoted: msg });
  if ((recompensa.alteracoesNoMandato || 0) >= 2) return sock.sendMessage(idGrupo, { text: '⛔ O limite de duas alterações de recompensa neste mandato foi atingido.' }, { quoted: msg });
  const multiplicador = Math.max(0.8, Math.min(1.2, 1 + percentual / 100));
  const filtro = {
    idGrupo,
    'governo.presidenteId': papel.usuario,
    'governo.mandatoAte': { $gt: agora },
    'recompensaTemporaria.alteracoesNoMandato': { $lt: 2 },
    $or: [
      { 'recompensaTemporaria.ate': null },
      { 'recompensaTemporaria.ate': { $lte: agora } },
    ],
  };
  const alterada = await RepublicaEstado.updateOne(filtro, {
    $set: {
      'recompensaTemporaria.multiplicador': multiplicador,
      'recompensaTemporaria.ate': new Date(agora.getTime() + horas * 3600000),
      'recompensaTemporaria.mandatoId': String(papel.estado.governo.numeroMandato || 0),
    },
    $inc: { 'recompensaTemporaria.alteracoesNoMandato': 1 },
  });
  if (alterada.modifiedCount !== 1) return sock.sendMessage(idGrupo, {
    text: '⛔ O limite do mandato mudou ou já existe outra recompensa temporária activa. Consulte /republica status.',
  }, { quoted: msg });
  return sock.sendMessage(idGrupo, {
    text: '📢 *DECRETO DE RECOMPENSA*\n\nO presidente alterou as recompensas em *' +
      (percentual > 0 ? '+' : '') + percentual + '%* por *' + horas + ' hora(s)*.\n' +
      'A medida não altera recompensas já pagas e não pode ser acumulada.',
  }, { quoted: msg });
}

async function publicarDecreto(sock, msg, idGrupo, usuarioRaw, args) {
  const papel = await obterPapel(idGrupo, usuarioRaw);
  if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode publicar decretos.' }, { quoted: msg });
  const partes = String(args || '').split('|');
  const titulo = (partes.shift() || '').trim();
  const texto = partes.join('|').trim();
  if (!titulo || !texto || titulo.length > 100 || texto.length > 1000) return sock.sendMessage(idGrupo, { text: '⚠️ Use: /republica decreto <título> | <texto> (máximo 100/1000 caracteres).' }, { quoted: msg });
  const lei = {
    id: 'dec-' + crypto.randomBytes(4).toString('hex'),
    titulo, texto, autorId: papel.usuario, aprovadaEm: new Date(), ativa: true,
  };
  await RepublicaEstado.updateOne({ idGrupo }, { $push: { leis: { $each: [lei], $slice: -100 } } });
  return sock.sendMessage(idGrupo, {
    text: '📜 *DIÁRIO OFICIAL — DECRETO PUBLICADO*\n\n*' + titulo + '*\n' + texto +
      '\n\nO decreto não pode criar imposto nem alterar a Constituição por decisão unilateral.',
  }, { quoted: msg });
}

async function processarCiclo(sock) {
  const ativos = await GrupoConfig.find({ republicaAtivo: true }, { idGrupo: 1 }).lean();
  for (const grupo of ativos) {
    const idGrupo = grupo.idGrupo;
    try {
      const estado = await getEstado(idGrupo);
      await obterTaxasEfetivas(idGrupo);
      let aberta = await eleicoes.obterEleicaoAberta(idGrupo);
      const agora = new Date();
      if (aberta && new Date(aberta.encerraEm).getTime() <= agora.getTime()) {
        await eleicoes.processarEleicao(sock, idGrupo, agora);
        aberta = await eleicoes.obterEleicaoAberta(idGrupo);
      }
      if (!aberta) {
        const ultimaEleicaoSemResultado = await RepublicaEleicao.findOne({ idGrupo, status: { $in: ['sem_candidatos', 'sem_votos'] } }).sort({ createdAt: -1 }).lean();
        const mandatoAte = estado.governo?.mandatoAte ? new Date(estado.governo.mandatoAte).getTime() : 0;
        const eleitoEm = estado.governo?.eleitoEm ? new Date(estado.governo.eleitoEm).getTime() : 0;
        const falhaNesteMandato = Boolean(ultimaEleicaoSemResultado &&
          (!eleitoEm || new Date(ultimaEleicaoSemResultado.createdAt).getTime() > eleitoEm));
        const espera = Boolean(falhaNesteMandato &&
          agora.getTime() - new Date(ultimaEleicaoSemResultado.createdAt).getTime() >= eleicoes.NOVA_ELEICAO_SEM_CANDIDATOS_MS);
        const mandatoExpirado = mandatoAte > 0 && mandatoAte <= agora.getTime();
        const semMandatoInicial = !mandatoAte && !ultimaEleicaoSemResultado;
        const abrirAntesDoFim = mandatoAte > agora.getTime() &&
          mandatoAte <= agora.getTime() + eleicoes.DURACAO_ELEICAO_MS && !falhaNesteMandato;
        const tentarNovamenteSemGoverno = (!mandatoAte || mandatoExpirado) && espera;
        const mandatoExpirouSemFalha = mandatoExpirado && !falhaNesteMandato;
        if (semMandatoInicial || abrirAntesDoFim || tentarNovamenteSemGoverno || mandatoExpirouSemFalha) {
          const novaEleicao = await eleicoes.abrirEleicao(idGrupo, agora);
          if (sock && sock.sendMessage && novaEleicao) await sock.sendMessage(idGrupo, {
            text: '🗳️ *NOVA ELEIÇÃO — MODO REPÚBLICA*\n\nA votação para presidente e vice-presidente foi aberta.\nEncerra em: *' + new Date(novaEleicao.encerraEm).toLocaleString('pt-BR') + '*\n\nUse /republica candidatura @vice para formar uma chapa e /republica votar @presidente para votar.',
          }).catch(() => {});
        }
      }
      await processarConsultas(sock, idGrupo);
      const pagamentosBolsa = await social.processarBolsaGrupo(idGrupo);
      for (const pagamento of pagamentosBolsa) {
        if (pagamento.valor > 0) await sock.sendMessage(pagamento.id, {
          text: '👨‍👩‍👧 *BOLSA FAMÍLIA DO TICO — PAGAMENTO DIÁRIO*\n\nVocê recebeu *' + formatar(pagamento.valor) + '* do Fundo Bolsa Família.\n\nO pagamento foi registado nas contas públicas do seu grupo.',
        }).catch(() => {});
      }
      const pagamentosLicenca = await social.processarLicencasGrupo(idGrupo);
      for (const pagamento of pagamentosLicenca) {
        if (pagamento.valor > 0) await sock.sendMessage(pagamento.id, {
          text: '👶 *LICENÇA PARENTAL — PAGAMENTO*\n\nVocê recebeu *' + formatar(pagamento.valor) + '* do Fundo de Licença Parental.\n\nA licença dura 2 dias e mantém o seu emprego protegido.',
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[Republica] Falha no ciclo do grupo:', idGrupo, error?.stack || error?.message || error);
    }
  }
}

let cicloTimer = null;
let cicloEmAndamento = false;
function iniciarCiclo(sock) {
  if (cicloTimer) return;
  const executar = async () => {
    if (cicloEmAndamento) return;
    cicloEmAndamento = true;
    try {
      await processarCiclo(sock);
    } catch (error) {
      console.error('[Republica] Erro no ciclo:', error?.stack || error?.message || error);
    } finally {
      cicloEmAndamento = false;
    }
  };
  executar();
  cicloTimer = setInterval(executar, 60 * 1000);
  if (cicloTimer.unref) cicloTimer.unref();
}
function pararCiclo() {
  if (cicloTimer) clearInterval(cicloTimer);
  cicloTimer = null;
}

async function handleRepublica(sock, msg, idGrupo, caption, senderJid, senderAlternateJids, mentions, isAdmin, author, prefixo) {
  if (!ehGrupo(idGrupo)) return sock.sendMessage(idGrupo, { text: '🇧🇷 O Modo República funciona apenas em grupos.' }, { quoted: msg });
  const textoComando = String(caption || '').trim();
  const prefixoSeguro = String(prefixo || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexPrefixo = prefixoSeguro ? new RegExp('^' + prefixoSeguro + 'republica\\s*', 'i') : /^[!.,/#]republica\s*/i;
  const argsTexto = textoComando.replace(regexPrefixo, '').trim();
  const args = argsTexto.split(/\s+/).filter(Boolean);
  const acao = String(args[0] || 'ajuda').toLowerCase();
  const men = Array.isArray(mentions) ? mentions : [];

  if (acao === 'on' || acao === 'off') {
    if (!isAdmin) return sock.sendMessage(idGrupo, { text: '❌ Apenas administradores do WhatsApp podem ligar ou desligar modos.' }, { quoted: msg });
    const ativo = acao === 'on';
    const atual = await modoAtivo(idGrupo);
    if (atual === ativo) return sock.sendMessage(idGrupo, { text: ativo ? '🇧🇷 O Modo República já está activo.' : '🇧🇷 O Modo República já está desligado.' }, { quoted: msg });
    await GrupoConfig.findOneAndUpdate({ idGrupo }, { $set: { republicaAtivo: ativo } }, { upsert: true });
    if (ativo) {
      await getEstado(idGrupo);
      await obterTaxasEfetivas(idGrupo);
      const aberta = await eleicoes.obterEleicaoAberta(idGrupo);
      if (!aberta) await eleicoes.abrirEleicao(idGrupo);
      return sock.sendMessage(idGrupo, {
        text: '🇧🇷 *MODO REPÚBLICA ACTIVADO!*\n\nEleições, governo, tributação, Tesouro e políticas sociais estão disponíveis neste grupo.\n\n🗳️ A primeira eleição foi aberta. Use /republica para ver os comandos.\n\nOs fundos começam separados e vazios. A presidência não concede poderes de administrador do WhatsApp.',
      }, { quoted: msg });
    }
    return sock.sendMessage(idGrupo, {
      text: '🇧🇷 *MODO REPÚBLICA DESACTIVADO.*\n\nOs ciclos políticos e pagamentos automáticos foram pausados. Tesouro, leis, impostos e histórico foram preservados.',
    }, { quoted: msg });
  }
  if (!(await modoAtivo(idGrupo))) return sock.sendMessage(idGrupo, {
    text: '🇧🇷 O Modo República está desligado. Um administrador pode activá-lo com /republica on.',
  }, { quoted: msg });

  if (acao === 'ajuda' || acao === 'menu') return sock.sendMessage(idGrupo, { text: textoAjuda(prefixo) }, { quoted: msg });
  if (acao === 'status') {
    const estado = await getEstado(idGrupo);
    const g = estado.governo || {};
    const falta = g.mandatoAte ? Math.max(0, new Date(g.mandatoAte).getTime() - Date.now()) : 0;
    const eleicao = await eleicoes.consultarEleicao(idGrupo);
    return sock.sendMessage(idGrupo, {
      text:
        '🇧🇷 *GOVERNO DO GRUPO*\n\n' +
        '🏛️ Presidente: *' + (g.presidenteNome || 'Aguardando eleição') + '*\n' +
        '🤝 Vice: *' + (g.viceNome || 'A definir') + '*\n' +
        '⏳ Mandato: *' + (falta ? Math.ceil(falta / 3600000) + ' hora(s) restantes' : 'sem governo empossado') + '*\n' +
        '🔢 Mandato nº: *' + (g.numeroMandato || 0) + '*\n' +
        '🗳️ Eleição: *' + (eleicao ? 'aberta (' + eleicao.votos + ' votos)' : 'sem eleição aberta') + '*',
    }, { quoted: msg });
  }
  if (acao === 'eleicao') {
    const resultado = await eleicoes.consultarEleicao(idGrupo);
    if (!resultado) return sock.sendMessage(idGrupo, { text: '🗳️ Não há eleição aberta neste momento.' }, { quoted: msg });
    const chapas = resultado.eleicao.candidaturas.map((c, i) =>
      (i + 1) + '. ' + c.presidenteNome + ' / ' + c.viceNome + (c.viceAceitou ? ' ✅ confirmada' : ' ⏳ aguarda o vice') +
      (c.plano ? '\n   📋 Plano: ' + String(c.plano).slice(0, 350) : '\n   📋 Plano ainda não apresentado.')
    );
    return sock.sendMessage(idGrupo, {
      text: '🗳️ *ELEIÇÃO EM ANDAMENTO*\n\n' +
        (chapas.length ? chapas.join('\n') : '_Ainda não há chapas._') +
        '\n\nVotos registados: *' + resultado.votos + '*\nEncerra em: *' +
        new Date(resultado.eleicao.encerraEm).toLocaleString('pt-BR') + '*',
    }, { quoted: msg });
  }
  if (acao === 'candidatura') {
    if (!men[0]) return sock.sendMessage(idGrupo, { text: '⚠️ Marque quem será vice: /republica candidatura @vice.' }, { quoted: msg });
    const partesCandidatura = argsTexto.split('|');
    const plano = partesCandidatura.slice(1).join('|').trim();
    const resultado = await eleicoes.candidatar(
      idGrupo, senderJid, men[0], author || msg.pushName || 'Candidato', 'Vice indicado', plano
    );
    const mensagens = {
      SEM_ELEICAO: 'Não existe eleição aberta.',
      PRAZO_ENCERRADO: 'O prazo de candidatura terminou.',
      CANDIDATOS_INVALIDOS: 'A chapa tem integrantes inválidos ou iguais.',
      JA_CANDIDATADO: 'Você já registou candidatura nesta eleição.',
      VICE_JA_EM_CHAPA: 'Esse vice já está noutra chapa.',
    };
    if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '❌ ' + (mensagens[resultado.motivo] || 'Não foi possível criar a chapa.') }, { quoted: msg });
    return sock.sendMessage(idGrupo, {
      text: '📋 *CHAPA REGISTADA*\n\nPresidente: *' + (author || msg.pushName || 'Candidato') +
        '*\nVice indicado: @' + men[0].split('@')[0] +
        (plano ? '\n\n📋 *Plano de governo:*\n' + plano.slice(0, 500) : '\n\n📋 O plano de governo ainda não foi apresentado.') +
        '\n\nO vice precisa enviar /republica aceitar para confirmar.',
      mentions: [men[0]],
    }, { quoted: msg });
  }
  if (acao === 'aceitar') {
    const resultado = await eleicoes.aceitarVice(idGrupo, senderJid, author || msg.pushName || 'Vice-presidente');
    if (!resultado.ok) return sock.sendMessage(idGrupo, {
      text: resultado.motivo === 'PRAZO_ENCERRADO'
        ? '❌ O prazo para confirmar a chapa terminou.'
        : '❌ Não encontrei convite de vice pendente para você.',
    }, { quoted: msg });
    return sock.sendMessage(idGrupo, { text: '✅ Você aceitou ser vice-presidente. A chapa está confirmada e pode receber votos.' }, { quoted: msg });
  }
  if (acao === 'votar') {
    if (!men[0]) return sock.sendMessage(idGrupo, { text: '⚠️ Marque o candidato a presidente: /republica votar @presidente.' }, { quoted: msg });
    const resultado = await eleicoes.votar(idGrupo, senderJid, men[0]);
    if (!resultado.ok) return sock.sendMessage(idGrupo, {
      text: resultado.motivo === 'CHAPA_NAO_CONFIRMADA'
        ? '❌ Essa chapa ainda não foi confirmada pelo vice.'
        : '❌ Não foi possível registar o voto. Verifique a eleição.',
    }, { quoted: msg });
    return sock.sendMessage(idGrupo, { text: '🗳️ Seu voto secreto foi registado. Você pode alterá-lo enquanto a votação estiver aberta.' }, { quoted: msg });
  }
  if (acao === 'tesouro') return mostrarTesouro(sock, msg, idGrupo);
  if (acao === 'contas') return mostrarContas(sock, msg, idGrupo);
  if (acao === 'impostos') return mostrarImpostos(sock, msg, idGrupo);
  if (acao === 'imposto') return ajustarImposto(sock, msg, idGrupo, senderJid, args[1], args[2]);
  if (acao === 'novoimposto') {
    const base = args[args.length - 1];
    const aliquota = args[args.length - 2];
    const nome = args.slice(1, -2).join(' ');
    return proporNovoImposto(sock, msg, idGrupo, senderJid, nome, aliquota, base);
  }
  if (acao === 'emenda' && String(args[1] || '').toLowerCase() === 'limite-imposto') return proporEmenda(sock, msg, idGrupo, senderJid, args[2]);
  if (acao === 'votarconsulta') {
    const resultado = await votarConsulta(idGrupo, senderJid, args[1], String(args[2] || '').toLowerCase());
    if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '❌ Consulta não encontrada, encerrada ou voto inválido.' }, { quoted: msg });
    return sock.sendMessage(idGrupo, { text: '🗳️ Seu voto na consulta foi registado. É possível alterá-lo antes do encerramento.' }, { quoted: msg });
  }
  if (acao === 'consultas') {
    const consultas = await RepublicaConsulta.find({ idGrupo, status: 'aberta' }).sort({ encerraEm: 1 }).lean();
    const linhas = consultas.map(c => String(c._id) + ' — ' + c.titulo + ' — ' + c.totalSim + ' sim / ' + c.totalNao + ' não');
    return sock.sendMessage(idGrupo, { text: '🗳️ *CONSULTAS ABERTAS*\n\n' + (linhas.length ? linhas.join('\n') : '_Não há consultas abertas._') }, { quoted: msg });
  }
  if (acao === 'bolsa') {
    const sub = String(args[1] || '').toLowerCase();
    if (sub === 'solicitar') {
      const resultado = await social.solicitarBolsa(idGrupo, senderJid);
      const mensagens = {
        MODO_DESLIGADO: 'O Modo República está desligado.',
        MEMBRO_JA_VINCULADO: 'Um integrante desta família já está associado a outro benefício activo.',
        CARTEIRA_EXTERNA: 'O Bolsa Família do Tico só pode ser pago em Pratas da carteira interna do Tico; contas vinculadas ficam fora do programa.',
      };
      if (!resultado.ok) return sock.sendMessage(idGrupo, { text: '❌ ' + (mensagens[resultado.motivo] || 'Não foi possível solicitar o benefício.') }, { quoted: msg });
      return sock.sendMessage(idGrupo, {
        text: '👨‍👩‍👧 *SOLICITAÇÃO DO BOLSA FAMÍLIA DO TICO REGISTADA*\n\nO pedido será avaliado pela média de rendimentos dos últimos 7 dias. O pagamento, quando elegível, será diário e sairá exclusivamente do Fundo Social.',
      }, { quoted: msg });
    }
    if (sub === 'status') {
      const familia = await social.montarFamilia(idGrupo, senderJid);
      const beneficio = await require('../../models/RepublicaBeneficio').findOne({ idGrupo, householdKey: familia.householdKey }).lean();
      if (!beneficio) return sock.sendMessage(idGrupo, { text: 'Você ainda não tem pedido registado. Use /republica bolsa solicitar.' }, { quoted: msg });
      const valorDiarioPrevisto = social.calcularBolsa(beneficio.dependentes || []);
      const situacoes = {
        renda_acima_do_limite: 'suspenso por renda acima do limite',
        CARTEIRA_EXTERNA: 'não elegível: carteira externa',
        FUNDO_INSUFICIENTE: 'aguardando recursos do Fundo Bolsa Família',
        null: 'aguardando primeira avaliação',
      };
      const situacaoBeneficio = beneficio.motivoSuspensao
        ? (situacoes[beneficio.motivoSuspensao] || beneficio.motivoSuspensao)
        : (beneficio.ativo ? 'activo' : 'suspenso');
      return sock.sendMessage(idGrupo, {
        text: '👨‍👩‍👧 *BOLSA FAMÍLIA DO TICO*\n\nSituação: *' + situacaoBeneficio +
          '*\nValor diário previsto: *' + formatar(valorDiarioPrevisto) +
          '*\nÚltimo pagamento: *' + (beneficio.ultimoPagamentoDia || 'nenhum') +
          '*\nRegra de protecção até: *' + (beneficio.protecaoAte || 'não activa') + '*',
      }, { quoted: msg });
    }
  }
  if (acao === 'licenca') {
    const id = await resolveJidComLid(senderJid, idGrupo);
    const licenca = await social.obterLicencaAtiva(idGrupo, id);
    if (!licenca) return sock.sendMessage(idGrupo, { text: '👶 Você não tem licença parental activa.' }, { quoted: msg });
    return sock.sendMessage(idGrupo, {
      text: '👶 *LICENÇA PARENTAL*\n\nTipo: *' + licenca.tipo +
        '*\nInício: *' + new Date(licenca.inicio).toLocaleString('pt-BR') +
        '*\nFim: *' + new Date(licenca.fim).toLocaleString('pt-BR') +
        '*\nDuração: *2 dias*\nRemuneração diária: *' + formatar(licenca.salarioDiario) + '*',
    }, { quoted: msg });
  }
  if (acao === 'proporgasto') {
    return proporDespesaPublica(sock, msg, idGrupo, senderJid, args[1], args[2], men[0], args.slice(3).join(' ').replace(/@\d+/g, '').trim());
  }
  if (acao === 'gasto') {
    const papel = await obterPapel(idGrupo, senderJid);
    if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode autorizar despesas.' }, { quoted: msg });
    const fundo = String(args[1] || '').toLowerCase();
    const valor = Number(args[2]);
    const beneficiario = men[0] || null;
    const motivo = args.slice(3).join(' ').replace(/@\d+/g, '').trim() || 'Programa público';
    if (!['eventos', 'desenvolvimento'].includes(fundo) || !Number.isSafeInteger(valor) || valor <= 0 || !beneficiario) {
      return sock.sendMessage(idGrupo, { text: '⚠️ Use /republica gasto <eventos|desenvolvimento> <valor> @membro <motivo>.' }, { quoted: msg });
    }
    const alvo = await resolveJidComLid(beneficiario, idGrupo);
    if (alvo === papel.estado.governo.presidenteId || alvo === papel.estado.governo.viceId) return sock.sendMessage(idGrupo, { text: '⛔ Presidente e vice não podem receber transferências do Tesouro.' }, { quoted: msg });
    const resultado = await despesa(idGrupo, fundo, valor, motivo, papel.usuario, alvo, motivo);
    if (!resultado.ok) return sock.sendMessage(idGrupo, {
      text: resultado.motivo === 'LIMITE_POR_DESPESA'
        ? '⛔ Limite por despesa: ' + formatar(resultado.limite) + ' (10% do fundo ' + fundo + '). Despesas maiores precisam de aprovação popular especial.'
        : resultado.motivo === 'CARTEIRA_EXTERNA'
          ? '❌ O beneficiário usa carteira externa; o Tesouro só pode movimentar Pratas internas do Tico.'
          : resultado.motivo === 'SALDO_INSUFICIENTE'
            ? '❌ O fundo ' + fundo + ' não tem saldo suficiente.'
            : '❌ Fundo ' + fundo + ' sem saldo ou parâmetros inválidos.',
    }, { quoted: msg });
    return sock.sendMessage(idGrupo, {
      text: '📤 *DESPESA PÚBLICA REGISTADA*\n\nValor: *' + formatar(valor) +
        '*\nBeneficiário: @' + alvo.split('@')[0] + '\nMotivo: *' + motivo +
        '*\n\nO lançamento está disponível nas contas públicas.',
      mentions: [alvo],
    }, { quoted: msg });
  }
  if (acao === 'renunciar') {
    const papel = await obterPapel(idGrupo, senderJid);
    if (!papel.presidente || !papel.mandatoValido) return sock.sendMessage(idGrupo, { text: '❌ Apenas o presidente em exercício pode renunciar.' }, { quoted: msg });
    const governo = papel.estado.governo || {};
    if (governo.viceId) {
      await RepublicaEstado.updateOne(
        { idGrupo, 'governo.presidenteId': papel.usuario },
        { $set: {
          'governo.presidenteId': governo.viceId,
          'governo.presidenteNome': governo.viceNome || 'Presidente em exercício',
          'governo.viceId': null,
          'governo.viceNome': null,
        } }
      );
      return sock.sendMessage(idGrupo, {
        text: '🏛️ *SUCESSÃO PRESIDENCIAL*\n\nO presidente renunciou. O vice assumiu a Presidência até ao fim do mandato actual. As leis, impostos e contas públicas permanecem inalterados.',
      }, { quoted: msg });
    }
    await RepublicaEstado.updateOne(
      { idGrupo, 'governo.presidenteId': papel.usuario },
      { $set: { 'governo.mandatoAte': new Date() } }
    );
    return sock.sendMessage(idGrupo, {
      text: '🏛️ *RENÚNCIA PRESIDENCIAL REGISTADA*\n\nNão havia vice-presidente para assumir. Uma nova eleição será aberta automaticamente.',
    }, { quoted: msg });
  }
  if (acao === 'recompensa') return alterarRecompensa(sock, msg, idGrupo, senderJid, args[1], args[2]);
  if (acao === 'decreto') return publicarDecreto(sock, msg, idGrupo, senderJid, argsTexto.replace(/^decreto\s*/i, ''));
  if (acao === 'leis' || acao === 'decretos') {
    const estado = await getEstado(idGrupo);
    const leis = [...(estado.leis || [])].slice(-10).reverse();
    return sock.sendMessage(idGrupo, {
      text: '📜 *DIÁRIO OFICIAL*\n\n' +
        (leis.length ? leis.map(l => '*' + l.titulo + '*\n' + l.texto + '\nID: ' + l.id).join('\n\n') : '_Nenhuma lei/decreto publicado._'),
    }, { quoted: msg });
  }
  return sock.sendMessage(idGrupo, { text: '❓ Comando não reconhecido. Use /republica para ver a central.' }, { quoted: msg });
}

module.exports = {
  handleRepublica, iniciarCiclo, pararCiclo, processarCiclo,
  processarConsultas, obterPapel, votarConsulta, textoAjuda,
};
