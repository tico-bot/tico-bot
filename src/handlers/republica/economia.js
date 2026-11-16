'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const RepublicaEstado = require('../../models/RepublicaEstado');
const RepublicaRenda = require('../../models/RepublicaRenda');
const RepublicaLancamento = require('../../models/RepublicaLancamento');
const GrupoConfig = require('../../models/GrupoConfig');
const { alterarGold, getCarteira } = require('../../utils/carteira');

const locks = new Map();
// Receitas destinadas a fundos independentes: Bolsa, licença parental,
// eventos, desenvolvimento e reserva de emergência.
const ALOCACAO = Object.freeze({
  bolsaFamilia: 40,
  licencaParental: 20,
  eventos: 15,
  desenvolvimento: 10,
  reserva: 15,
});
const FAIXAS_IRPF = Object.freeze([
  { ate: 2000, aliquota: 0 },
  { ate: 8000, aliquota: 2 },
  { ate: 20000, aliquota: 5 },
  { ate: 50000, aliquota: 8 },
  { ate: null, aliquota: 12 },
]);

function diaCuiaba(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Cuiaba',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(data);
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}

async function modoAtivo(idGrupo) {
  const cfg = await GrupoConfig.findOne({ idGrupo }).select('republicaAtivo').lean();
  return cfg?.republicaAtivo === true;
}

async function getEstado(idGrupo) {
  return RepublicaEstado.findOneAndUpdate(
    { idGrupo },
    { $setOnInsert: { idGrupo } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function obterTaxasEfetivas(idGrupo) {
  const hoje = diaCuiaba();
  const estado = await getEstado(idGrupo);
  if (estado.impostos?.vigenciaDiaria?.dia !== hoje) {
    const impostos = estado.impostos || {};
    const snapshot = {
      dia: hoje,
      ajusteIrpfPp: Number(impostos.ajusteIrpfPp) || 0,
      cbs: Number(impostos.cbs) || 0,
      ibs: Number(impostos.ibs) || 0,
      iof: Number(impostos.iof) || 0,
      novos: (impostos.novos || []).map(item => ({
        id: item.id, nome: item.nome, aliquota: item.aliquota,
        base: item.base, aprovadoEm: item.aprovadoEm, ativo: item.ativo,
      })),
    };
    await RepublicaEstado.updateOne(
      { idGrupo, 'impostos.vigenciaDiaria.dia': { $ne: hoje } },
      { $set: { 'impostos.vigenciaDiaria': snapshot } }
    );
  }
  const atual = await RepublicaEstado.findOne({ idGrupo }).select('impostos.vigenciaDiaria').lean();
  return atual?.impostos?.vigenciaDiaria || {
    dia: hoje, ajusteIrpfPp: 0, cbs: 0.9, ibs: 0.1, iof: 1.5, novos: [],
  };
}

async function executarTransacao(fn) {
  const session = await mongoose.startSession();
  try {
    let resultado;
    await session.withTransaction(async () => {
      resultado = await fn(session);
    });
    return resultado;
  } finally {
    await session.endSession();
  }
}

function comLock(chave, fn) {
  const anterior = locks.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(fn);
  locks.set(chave, atual);
  return atual.finally(() => {
    if (locks.get(chave) === atual) locks.delete(chave);
  });
}

function calcularIrpfProgressivo(total, ajustePp = 0) {
  let restante = Math.max(0, Number(total) || 0);
  let limiteAnterior = 0;
  let imposto = 0;
  for (const faixa of FAIXAS_IRPF) {
    const limite = faixa.ate == null ? Infinity : faixa.ate;
    const base = Math.max(0, Math.min(restante, limite - limiteAnterior));
    const aliquota = Math.max(0, faixa.aliquota + (faixa.aliquota > 0 ? ajustePp : 0));
    imposto += base * aliquota / 100;
    restante -= base;
    limiteAnterior = limite;
    if (restante <= 0) break;
  }
  return Math.max(0, Math.round(imposto));
}

function calcularArrecadacao(valor) {
  const montante = Math.max(0, Math.floor(Number(valor) || 0));
  const fundos = Object.keys(ALOCACAO);
  const distribuicao = {};
  const restos = [];
  let distribuido = 0;
  for (const [ordem, fundo] of fundos.entries()) {
    const quota = montante * ALOCACAO[fundo] / 100;
    const inteiro = Math.floor(quota);
    distribuicao[fundo] = inteiro;
    distribuido += inteiro;
    restos.push({ fundo, resto: quota - inteiro, peso: ALOCACAO[fundo], ordem });
  }
  // Método dos maiores restos: conserva a proporção mesmo em impostos de 1 ou 2 Pratas.
  restos.sort((a, b) => b.resto - a.resto || b.peso - a.peso || a.ordem - b.ordem);
  let pendentes = montante - distribuido;
  for (let i = 0; i < pendentes; i++) distribuicao[restos[i].fundo] += 1;
  return distribuicao;
}

async function arrecadar(idGrupo, valor, categoria, origem, requestId = crypto.randomUUID(), extra = {}) {
  const montante = Math.floor(Number(valor) || 0);
  if (!idGrupo || montante <= 0) return { arrecadado: 0, duplicado: false };
  if (!extra.session) {
    return executarTransacao(session => arrecadar(
      idGrupo, montante, categoria, origem, requestId, { ...extra, session }
    ));
  }

  const session = extra.session;
  const existente = await RepublicaLancamento.findOne({ idGrupo, requestId }).session(session).lean();
  if (existente) return { arrecadado: 0, duplicado: true };

  const partilha = calcularArrecadacao(montante);
  const dados = {
    idGrupo, requestId, tipo: 'arrecadacao', fundo: 'misto',
    categoria: String(categoria || 'Tributo').slice(0, 80),
    valor: montante, origem: String(origem || '').slice(0, 120),
    usuarioId: extra.usuarioId || null,
    responsavelId: extra.responsavelId || null,
    observacao: extra.observacao || '',
  };
  const [lancamento] = await RepublicaLancamento.create([dados], { session });
  await RepublicaEstado.updateOne(
    { idGrupo },
    { $inc: {
      'tesouro.bolsaFamilia': partilha.bolsaFamilia,
      'tesouro.licencaParental': partilha.licencaParental,
      'tesouro.eventos': partilha.eventos,
      'tesouro.desenvolvimento': partilha.desenvolvimento,
      'tesouro.reserva': partilha.reserva,
      'tesouro.arrecadadoTotal': montante,
    } },
    { upsert: true, session }
  );
  return { arrecadado: montante, duplicado: false, partilha, lancamento };
}

async function despesa(idGrupo, fundo, valor, categoria, responsavelId, beneficiarioId, observacao, opcoes = {}) {
  const montante = Math.floor(Number(valor) || 0);
  if (!['eventos', 'desenvolvimento'].includes(fundo) || !Number.isSafeInteger(montante) || montante <= 0) {
    return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  }
  if (beneficiarioId) {
    const carteiraBeneficiario = await getCarteira(beneficiarioId, idGrupo);
    if (carteiraBeneficiario?.walletLinked || carteiraBeneficiario?.currencyInfo) {
      return { ok: false, motivo: 'CARTEIRA_EXTERNA' };
    }
  }

  const requestId = opcoes.requestId || crypto.randomUUID();
  if (!opcoes.session) {
    return executarTransacao(session => despesa(
      idGrupo, fundo, montante, categoria, responsavelId, beneficiarioId,
      observacao, { ...opcoes, requestId, session }
    ));
  }

  const session = opcoes.session;
  const existente = await RepublicaLancamento.findOne({ idGrupo, requestId }).session(session).lean();
  if (existente) return { ok: true, duplicado: true, lancamento: existente };

  const estado = await RepublicaEstado.findOne({ idGrupo }).session(session).lean();
  const saldo = Number(estado?.tesouro?.[fundo]) || 0;
  const limite = Math.floor(saldo * 0.10);
  if (!opcoes.aprovadaPopularmente && montante > limite) {
    return { ok: false, motivo: 'LIMITE_POR_DESPESA', limite };
  }
  if (montante > saldo) return { ok: false, motivo: 'SALDO_INSUFICIENTE' };
  const debitado = await RepublicaEstado.findOneAndUpdate(
    { idGrupo, ['tesouro.' + fundo]: { $gte: montante } },
    { $inc: { ['tesouro.' + fundo]: -montante, 'tesouro.gastoTotal': montante } },
    { new: true, session }
  );
  if (!debitado) return { ok: false, motivo: 'SALDO_INSUFICIENTE' };
  const [lancamento] = await RepublicaLancamento.create([{
    idGrupo, requestId, tipo: 'despesa', fundo,
    categoria: String(categoria || 'Despesa pública').slice(0, 80),
    valor: montante, origem: 'Orçamento público: ' + fundo,
    usuarioId: beneficiarioId || null,
    responsavelId: responsavelId || null,
    observacao: observacao || '',
  }], { session });
  if (beneficiarioId) {
    await alterarGold(
      beneficiarioId, idGrupo, montante,
      'Programa público: ' + String(categoria || 'despesa').slice(0, 60),
      { session }
    );
  }
  return { ok: true, lancamento };
}

function aliquotasConsumo(estado) {
  const novos = (estado.impostos?.novos || [])
    .filter(x => x.ativo && x.base === 'consumo')
    .reduce((s, x) => s + (Number(x.aliquota) || 0), 0);
  return Math.min(20, Math.max(0, Number(estado.impostos?.cbs || 0) + Number(estado.impostos?.ibs || 0) + novos));
}

async function calcularImpostoConsumo(idGrupo, base) {
  if (!(await modoAtivo(idGrupo))) return { imposto: 0, aliquota: 0 };
  const impostos = await obterTaxasEfetivas(idGrupo);
  const aliquota = aliquotasConsumo({ impostos });
  return { imposto: Math.max(0, Math.round(Math.max(0, base) * aliquota / 100)), aliquota };
}

async function calcularIOF(idGrupo, base) {
  if (!(await modoAtivo(idGrupo))) return { imposto: 0, aliquota: 0 };
  const impostos = await obterTaxasEfetivas(idGrupo);
  const novos = (impostos.novos || [])
    .filter(x => x.ativo && x.base === 'credito')
    .reduce((s, x) => s + (Number(x.aliquota) || 0), 0);
  const aliquota = Math.min(20, Math.max(0, Number(impostos.iof || 0) + novos));
  return { imposto: Math.max(0, Math.round(Math.max(0, base) * aliquota / 100)), aliquota };
}

async function registarImpostoConsumo(idGrupo, imposto, origem, usuarioId) {
  return arrecadar(idGrupo, imposto, 'CBS/IBS - Consumo', origem, crypto.randomUUID(), { usuarioId });
}

async function liquidarRenda(idWhatsApp, idGrupo, valorCredito, baseTributavel, origem) {
  const bruto = Math.max(0, Math.floor(Number(valorCredito) || 0));
  const base = Math.max(0, Math.floor(Number(baseTributavel) || 0));
  if (!bruto) return { carteira: await getCarteira(idWhatsApp, idGrupo), bruto: 0, imposto: 0, liquido: 0 };
  if (!(await modoAtivo(idGrupo)) || base <= 0) {
    const carteira = await alterarGold(idWhatsApp, idGrupo, bruto, origem || 'Rendimento');
    return { carteira, bruto, imposto: 0, liquido: bruto };
  }

  const carteiraAntes = await getCarteira(idWhatsApp, idGrupo);
  if (carteiraAntes?.walletLinked || carteiraAntes?.currencyInfo) {
    const carteira = await alterarGold(idWhatsApp, idGrupo, bruto, origem || 'Rendimento');
    return { carteira, bruto, imposto: 0, liquido: bruto, ignorado: 'carteira externa' };
  }

  const taxasEfetivas = await obterTaxasEfetivas(idGrupo);
  const chave = idGrupo + ':' + idWhatsApp + ':' + diaCuiaba();
  const requestIdImposto = 'irpf:' + crypto.randomUUID();
  return comLock(chave, async () => {
    await getEstado(idGrupo);
    return executarTransacao(async session => {
      const dia = diaCuiaba();
      const filtro = { idGrupo, usuarioId: idWhatsApp, dia };
      let renda = await RepublicaRenda.findOne(filtro).session(session).lean();
      if (!renda) {
        const [criada] = await RepublicaRenda.create([{
          ...filtro, totalBruto: 0, totalSalario: 0, totalIrpf: 0,
          ajusteIrpfPp: taxasEfetivas.ajusteIrpfPp || 0,
        }], { session });
        renda = criada.toObject();
      }

      const antes = Number(renda?.totalBruto) || 0;
      const ajuste = Number(renda?.ajusteIrpfPp ?? taxasEfetivas.ajusteIrpfPp) || 0;
      const irpfAntes = calcularIrpfProgressivo(antes, ajuste);
      const irpfDepois = calcularIrpfProgressivo(antes + base, ajuste);
      const irpf = Math.max(0, irpfDepois - irpfAntes);
      const novosRenda = Math.min(20, (taxasEfetivas.novos || [])
        .filter(x => x.ativo && x.base === 'renda')
        .reduce((s, x) => s + (Number(x.aliquota) || 0), 0));
      const adicional = Math.max(0, Math.round(base * novosRenda / 100));
      const imposto = Math.min(bruto, irpf + adicional);
      const liquido = bruto - imposto;

      const incrementoRenda = { totalBruto: base, totalIrpf: irpf };
      if (origem === 'Salário do emprego') incrementoRenda.totalSalario = base;
      await RepublicaRenda.updateOne(filtro, { $inc: incrementoRenda }, { session });

      const carteira = await alterarGold(
        idWhatsApp, idGrupo, liquido,
        origem || 'Rendimento líquido', { session }
      );
      if (imposto > 0) {
        await arrecadar(
          idGrupo, imposto, 'IRPF-Tico', origem || 'Rendimento tributável',
          requestIdImposto, { usuarioId: idWhatsApp, session }
        );
      }
      return { carteira, bruto, imposto, liquido, irpf, adicional };
    });
  });
}

async function aplicarMultiplicadorRecompensa(idGrupo, valor) {
  const original = Math.max(0, Math.floor(Number(valor) || 0));
  if (!(await modoAtivo(idGrupo))) return original;
  const estado = await getEstado(idGrupo);
  const bonus = estado.recompensaTemporaria;
  if (!bonus?.ate || new Date(bonus.ate).getTime() <= Date.now()) return original;
  const mult = Math.min(1.2, Math.max(0.8, Number(bonus.multiplicador) || 1));
  return Math.max(0, Math.round(original * mult));
}

module.exports = {
  ALOCACAO, FAIXAS_IRPF, diaCuiaba, modoAtivo, getEstado, obterTaxasEfetivas,
  arrecadar, despesa, calcularIrpfProgressivo, calcularArrecadacao,
  calcularImpostoConsumo, calcularIOF, registarImpostoConsumo,
  liquidarRenda, aplicarMultiplicadorRecompensa,
};
