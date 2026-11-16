'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Filho = require('../../models/Filho');
const Relacionamento = require('../../models/Relacionamento');
const CarteiraGrupo = require('../../models/CarteiraGrupo');
const RepublicaBeneficio = require('../../models/RepublicaBeneficio');
const RepublicaLicenca = require('../../models/RepublicaLicenca');
const RepublicaLancamento = require('../../models/RepublicaLancamento');
const RepublicaRenda = require('../../models/RepublicaRenda');
const RepublicaEstado = require('../../models/RepublicaEstado');
const { alterarGold, getCarteira } = require('../../utils/carteira');
const { resolveJidComLid } = require('../../utils/identity');
const { diaCuiaba, modoAtivo } = require('./economia');

const DIA_MS = 24 * 60 * 60 * 1000;
const LICENCA_MS = 2 * DIA_MS;
const BOLSA_BASE_DIA = 200;
const BOLSA_CRIANCA_ATE_7 = 100;
const BOLSA_CRIANCA_ATE_17 = 50;
const BOLSA_TETO_DIA = 600;
const LIMITE_RENDA_PERCAPITA_DIA = 1000;
const LIMITE_PROTECAO_DIA = 1250;
const locks = new Map();

function idadeTico(nascidoEm, agora = Date.now()) {
  return Math.max(0, Math.floor((agora - new Date(nascidoEm || agora).getTime()) / (7 * DIA_MS)));
}

function chaveFamilia(adultos) {
  return adultos.slice().sort().join('|');
}

function calcularBolsa(dependentes = []) {
  const adicionais = dependentes.reduce((total, d) => {
    const idade = Number(d.idade) || 0;
    if (idade < 7) return total + BOLSA_CRIANCA_ATE_7;
    if (idade < 18) return total + BOLSA_CRIANCA_ATE_17;
    return total;
  }, 0);
  return Math.min(BOLSA_TETO_DIA, BOLSA_BASE_DIA + adicionais);
}

function lock(chave, fn) {
  const anterior = locks.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(fn);
  locks.set(chave, atual);
  return atual.finally(() => {
    if (locks.get(chave) === atual) locks.delete(chave);
  });
}

async function montarFamilia(idGrupo, usuarioId, candidatos = []) {
  const titular = await resolveJidComLid(usuarioId, idGrupo);
  const relacionamento = await Relacionamento.findOne({
    idGrupo,
    participantes: titular,
  }).lean();
  const adultos = [...new Set((relacionamento?.participantes || [titular]).map(x => String(x).toLowerCase()))];
  const condicoes = adultos.flatMap(id => [{ jidA: id }, { jidB: id }]);
  const filhos = condicoes.length
    ? await Filho.find({ idGrupo, $or: condicoes }).select('_id jidA jidB nome nascidoEm').lean()
    : [];
  const dependentesMap = new Map();
  for (const filho of filhos) {
    dependentesMap.set(String(filho._id), {
      filhoId: filho._id,
      nome: filho.nome || 'Dependente',
      idade: idadeTico(filho.nascidoEm),
    });
  }
  const dependentes = [...dependentesMap.values()];
  return {
    titular,
    adultos,
    dependentes,
    householdKey: chaveFamilia(adultos),
  };
}

async function solicitarBolsa(idGrupo, usuarioId) {
  if (!(await modoAtivo(idGrupo))) return { ok: false, motivo: 'MODO_DESLIGADO' };
  const familia = await montarFamilia(idGrupo, usuarioId);
  const carteiraTitular = await getCarteira(familia.titular, idGrupo);
  if (carteiraTitular?.walletLinked || carteiraTitular?.currencyInfo) {
    return { ok: false, motivo: 'CARTEIRA_EXTERNA' };
  }
  const conflito = await RepublicaBeneficio.findOne({
    idGrupo,
    ativo: true,
    adultos: { $in: familia.adultos },
    householdKey: { $ne: familia.householdKey },
  }).lean();
  if (conflito) return { ok: false, motivo: 'MEMBRO_JA_VINCULADO' };

  const beneficio = await RepublicaBeneficio.findOneAndUpdate(
    { idGrupo, householdKey: familia.householdKey },
    {
      $setOnInsert: {
        idGrupo,
        householdKey: familia.householdKey,
        titularId: familia.titular,
        solicitadoEm: new Date(),
      },
      $set: {
        adultos: familia.adultos,
        dependentes: familia.dependentes,
        ativo: true,
        motivoSuspensao: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, beneficio, familia };
}

async function rendaDiariaMedia(idGrupo, adultos, dias = 7) {
  const chaves = [];
  for (let i = 0; i < dias; i++) chaves.push(diaCuiaba(new Date(Date.now() - i * DIA_MS)));
  const rendas = await RepublicaRenda.find({
    idGrupo, usuarioId: { $in: adultos }, dia: { $in: chaves },
  }).select('totalBruto').lean();
  const bruto = rendas.reduce((s, r) => s + (Number(r.totalBruto) || 0), 0);
  return { total: bruto, mediaDia: bruto / dias };
}

async function salarioDiarioMedio(idGrupo, usuarioId, dias = 7) {
  const desde = new Date(Date.now() - dias * DIA_MS);
  const chaves = [];
  for (let i = 0; i < dias; i++) chaves.push(diaCuiaba(new Date(Date.now() - i * DIA_MS)));
  const rendas = await RepublicaRenda.find({
    idGrupo, usuarioId, dia: { $in: chaves },
  }).select('totalSalario').lean();
  const brutoTributavel = rendas.reduce((s, r) => s + (Number(r.totalSalario) || 0), 0);
  if (brutoTributavel > 0) return brutoTributavel / dias;

  // Migração suave: aproveita os salários do histórico local anteriores à activação do modo.
  const carteira = await CarteiraGrupo.findOne({ idGrupo, idWhatsApp: usuarioId }).select('goldHistory').lean();
  const historico = (carteira?.goldHistory || []).filter(item =>
    item.type === 'recebido' && item.item === 'Salário do emprego' &&
    new Date(item.date || 0).getTime() >= desde.getTime()
  );
  const liquidoAnterior = historico.reduce((s, item) => s + (Number(item.amount) || 0), 0);
  return liquidoAnterior / dias;
}

async function avaliarBolsa(beneficio) {
  const renda = await rendaDiariaMedia(beneficio.idGrupo, beneficio.adultos, 7);
  const pessoas = Math.max(1, beneficio.adultos.length + beneficio.dependentes.length);
  const perCapita = renda.mediaDia / pessoas;
  const hoje = diaCuiaba();
  let percentual = 100;
  let situacao = 'elegivel';

  if (perCapita > LIMITE_RENDA_PERCAPITA_DIA) {
    const protecaoAtiva = beneficio.protecaoAte && beneficio.protecaoAte >= hoje;
    if (perCapita <= LIMITE_PROTECAO_DIA && protecaoAtiva) {
      percentual = 50;
      situacao = 'regra_de_protecao';
    } else if (perCapita <= LIMITE_PROTECAO_DIA && !beneficio.protecaoAte) {
      const ate = diaCuiaba(new Date(Date.now() + 7 * DIA_MS));
      beneficio.protecaoAte = ate;
      await beneficio.save();
      percentual = 50;
      situacao = 'regra_de_protecao';
    } else {
      situacao = 'renda_acima_do_limite';
    }
  } else if (beneficio.protecaoAte && beneficio.protecaoAte < hoje) {
    beneficio.protecaoAte = null;
    await beneficio.save();
  }

  const valorIntegral = calcularBolsa(beneficio.dependentes);
  return {
    rendaPerCapita: Math.floor(perCapita),
    valor: situacao === 'renda_acima_do_limite' ? 0 : Math.floor(valorIntegral * percentual / 100),
    situacao,
    pessoas,
  };
}

async function pagarDoFundoSocial(idGrupo, fundo, valor, tipo, categoria, usuarioId, requestId) {
  const montante = Math.floor(Number(valor) || 0);
  const campos = {
    bolsaFamilia: { estado: 'bolsaFamilia', lancamento: 'bolsa_familia', nome: 'Fundo Bolsa Família' },
    licencaParental: { estado: 'licencaParental', lancamento: 'licenca_parental', nome: 'Fundo de Licença Parental' },
  };
  const destino = campos[fundo];
  if (!destino || montante <= 0 || !usuarioId) return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  const carteiraDestino = await getCarteira(usuarioId, idGrupo);
  if (carteiraDestino?.walletLinked || carteiraDestino?.currencyInfo) {
    return { ok: false, motivo: 'CARTEIRA_EXTERNA' };
  }

  const session = await mongoose.startSession();
  let resultado = null;
  try {
    await session.withTransaction(async () => {
      const existente = await RepublicaLancamento.findOne({ idGrupo, requestId }).session(session).lean();
      if (existente) {
        // A transferência e o débito do Tesouro são atómicos; lançamento existente significa pagamento concluído.
        resultado = { ok: true, valor: montante, duplicado: true };
        return;
      }

      const estadoAtual = await RepublicaEstado.findOne({ idGrupo }).session(session).lean();
      const saldo = Number(estadoAtual?.tesouro?.[destino.estado]) || 0;
      if (saldo < montante) {
        resultado = { ok: false, motivo: 'FUNDO_INSUFICIENTE' };
        return;
      }

      await RepublicaLancamento.create([{
        idGrupo, requestId, tipo, fundo: destino.lancamento, categoria,
        valor: montante, origem: destino.nome,
        usuarioId,
        observacao: 'Pagamento automático do Modo República.',
      }], { session });

      const estado = await RepublicaEstado.findOneAndUpdate(
        { idGrupo, ['tesouro.' + destino.estado]: { $gte: montante } },
        { $inc: { ['tesouro.' + destino.estado]: -montante, 'tesouro.gastoTotal': montante } },
        { new: true, session }
      );
      if (!estado) {
        const erro = new Error('FUNDO_INSUFICIENTE');
        erro.code = 'FUNDO_INSUFICIENTE';
        throw erro;
      }
      await alterarGold(usuarioId, idGrupo, montante, categoria, { session });
      resultado = { ok: true, valor: montante };
    });
    return resultado || { ok: false, motivo: 'PAGAMENTO_NAO_CONFIRMADO' };
  } catch (error) {
    if (error?.code === 'FUNDO_INSUFICIENTE' || error?.message === 'FUNDO_INSUFICIENTE') {
      return { ok: false, motivo: 'FUNDO_INSUFICIENTE' };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function processarBolsaGrupo(idGrupo) {
  const beneficios = await RepublicaBeneficio.find({ idGrupo, ativo: true }).lean();
  const hoje = diaCuiaba();
  const pagamentos = [];
  for (const beneficio of beneficios) {
    const chave = 'bolsa:' + beneficio._id + ':' + hoje;
    const resultado = await lock(chave, async () => {
      const atual = await RepublicaBeneficio.findById(beneficio._id);
      if (!atual || !atual.ativo || atual.ultimoPagamentoDia === hoje) return null;

      // Actualiza a composição familiar e a idade dos dependentes em cada apuramento.
      const familiaAtual = await montarFamilia(idGrupo, atual.titularId);
      if (familiaAtual.householdKey !== atual.householdKey) {
        atual.ativo = false;
        atual.motivoSuspensao = 'MUDANCA_FAMILIAR';
        await atual.save();
        return { id: atual.titularId, valor: 0, situacao: 'MUDANCA_FAMILIAR' };
      }
      atual.adultos = familiaAtual.adultos;
      atual.dependentes = familiaAtual.dependentes;
      await atual.save();
      const avaliacao = await avaliarBolsa(atual);
      if (!avaliacao.valor) {
        atual.ultimoPagamentoDia = hoje;
        atual.motivoSuspensao = avaliacao.situacao;
        await atual.save();
        return { id: atual.titularId, valor: 0, situacao: avaliacao.situacao };
      }
      const pago = await pagarDoFundoSocial(
        idGrupo, 'bolsaFamilia', avaliacao.valor, 'beneficio', 'Bolsa Família do Tico',
        atual.titularId, 'bolsa:' + idGrupo + ':' + atual.householdKey + ':' + hoje
      );
      if (!pago.ok) {
        atual.motivoSuspensao = pago.motivo || 'PAGAMENTO_PENDENTE';
        if (pago.motivo === 'CARTEIRA_EXTERNA') atual.ultimoPagamentoDia = hoje;
        await atual.save();
        return { id: atual.titularId, valor: 0, situacao: pago.motivo };
      }
      atual.ultimoPagamentoDia = hoje;
      atual.motivoSuspensao = null;
      await atual.save();
      return { id: atual.titularId, valor: pago.valor, situacao: avaliacao.situacao };
    });
    if (resultado) pagamentos.push(resultado);
  }
  return pagamentos;
}

async function registrarLicencasNascimento(idGrupo, idPessoaQueGestou, outroResponsavel, filho) {
  if (!(await modoAtivo(idGrupo)) || !filho?._id) return [];
  const primeiro = await resolveJidComLid(idPessoaQueGestou, idGrupo);
  const segundo = await resolveJidComLid(outroResponsavel, idGrupo);
  const pais = [
    { usuarioId: primeiro, tipo: 'maternidade' },
    { usuarioId: segundo, tipo: 'paternidade' },
  ].filter(p => p.usuarioId);
  const criadas = [];
  for (const pai of pais) {
    const carteira = await CarteiraGrupo.findOne({
      idGrupo, idWhatsApp: pai.usuarioId,
      empregoAtual: { $nin: [null, '', 'desempregado'] },
    }).lean();
    if (!carteira) continue;
    let salarioDiario = Math.max(0, Math.floor(await salarioDiarioMedio(idGrupo, pai.usuarioId, 7)));
    if (salarioDiario <= 0) {
      // Quem acabou de ser contratado também tem direito à licença remunerada.
      const catalogoEmpregos = require('../diversao/emprego');
      const cargoAtual = catalogoEmpregos.CARGO_MAP?.get(carteira.empregoAtual);
      const faixa = cargoAtual?.tierInfo;
      if (faixa) salarioDiario = Math.floor(((Number(faixa.salarioMin) || 0) + (Number(faixa.salarioMax) || 0)) / 2);
    }
    const inicio = new Date();
    const fim = new Date(inicio.getTime() + LICENCA_MS);
    const filtroLicenca = { idGrupo, usuarioId: pai.usuarioId, filhoId: filho._id };
    let licenca = await RepublicaLicenca.findOne(filtroLicenca);
    const licencaNova = !licenca;
    if (!licenca) {
      try {
        licenca = await RepublicaLicenca.create({
          ...filtroLicenca, tipo: pai.tipo, inicio, fim, salarioDiario,
          ativa: true, pagamentosRealizados: 0,
        });
      } catch (erroCriacao) {
        if (erroCriacao?.code !== 11000) throw erroCriacao;
        licenca = await RepublicaLicenca.findOne(filtroLicenca);
      }
    }
    criadas.push(licenca);

    // Suspende o relógio de faltas durante a licença. No fim das 48h,
    // o trabalhador regressa já fora do cooldown normal, mas ainda dentro
    // da janela de tolerância do emprego.
    if (licencaNova) {
      await CarteiraGrupo.updateOne(
        { _id: carteira._id },
        { $set: { ultimoTrabalho: new Date(fim.getTime() - 40 * 60 * 1000), avisosEmprego: [] } }
      );
    }

    // Os pagamentos são processados pelo ciclo central, que controla as duas parcelas de 24h.
  }
  return criadas;
}

async function obterLicencaAtiva(idGrupo, usuarioId) {
  const id = await resolveJidComLid(usuarioId, idGrupo);
  return RepublicaLicenca.findOne({
    idGrupo, usuarioId: id, ativa: true, fim: { $gt: new Date() },
  }).sort({ fim: -1 }).lean();
}

async function processarLicencasGrupo(idGrupo) {
  const agora = new Date();
  await RepublicaLicenca.updateMany(
    { idGrupo, ativa: true, fim: { $lte: agora } },
    { $set: { ativa: false } }
  );
  const licencas = await RepublicaLicenca.find({
    idGrupo, salarioDiario: { $gt: 0 }, pagamentosRealizados: { $lt: 2 }, inicio: { $lte: agora },
  }).lean();
  const hoje = diaCuiaba();
  const pagamentos = [];
  for (const licenca of licencas) {
    const parcelasPagas = licenca.pagamentosRealizados || 0;
    if (!licenca.salarioDiario || parcelasPagas >= 2 || agora.getTime() < new Date(licenca.inicio).getTime() + parcelasPagas * DIA_MS) continue;
    const resultado = await lock('licenca:' + licenca._id + ':parcela:' + (parcelasPagas + 1), async () => {
      const atual = await RepublicaLicenca.findById(licenca._id);
      const pagasAgora = atual?.pagamentosRealizados || 0;
      if (!atual || pagasAgora >= 2 || agora.getTime() < new Date(atual.inicio).getTime() + pagasAgora * DIA_MS) return null;
      const numeroPagamento = pagasAgora + 1;
      const pago = await pagarDoFundoSocial(
        idGrupo, 'licencaParental', atual.salarioDiario, 'licenca', 'Licença ' + atual.tipo,
        atual.usuarioId, 'licenca:' + idGrupo + ':' + atual._id + ':parcela:' + numeroPagamento
      );
      if (!pago.ok) return { id: atual.usuarioId, valor: 0, situacao: pago.motivo };
      atual.ultimoPagamentoDia = hoje;
      atual.pagamentosRealizados = numeroPagamento;
      // A licença continua activa até ao fim das 48 horas, mesmo após a segunda parcela.
      await atual.save();
      return { id: atual.usuarioId, valor: pago.valor, tipo: atual.tipo };
    });
    if (resultado) pagamentos.push(resultado);
  }
  return pagamentos;
}

async function solicitarLicencaAdocao(idGrupo, usuarioId, dias = 2) {
  if (!(await modoAtivo(idGrupo))) return { ok: false, motivo: 'MODO_DESLIGADO' };
  const id = await resolveJidComLid(usuarioId, idGrupo);
  const carteira = await CarteiraGrupo.findOne({
    idGrupo, idWhatsApp: id,
    empregoAtual: { $nin: [null, '', 'desempregado'] },
  }).lean();
  if (!carteira) return { ok: false, motivo: 'SEM_EMPREGO' };
  return { ok: false, motivo: 'ADOCAO_NAO_INTEGRADA', mensagem: 'O Tico ainda não tem um fluxo de adoção para validar o início desta licença.' };
}

module.exports = {
  LICENCA_MS,
  BOLSA_BASE_DIA,
  BOLSA_CRIANCA_ATE_7,
  BOLSA_CRIANCA_ATE_17,
  BOLSA_TETO_DIA,
  LIMITE_RENDA_PERCAPITA_DIA,
  calcularBolsa,
  idadeTico,
  montarFamilia,
  solicitarBolsa,
  avaliarBolsa,
  processarBolsaGrupo,
  registrarLicencasNascimento,
  obterLicencaAtiva,
  processarLicencasGrupo,
  solicitarLicencaAdocao,
};
