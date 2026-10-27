'use strict';

const mongoose = require('mongoose');
const CarteiraGrupo = require('../../models/CarteiraGrupo');

/**
 * Compra genérica: debita gold da CarteiraGrupo e credita `quantidade` de um
 * item num campo Map de inventário — com suporte a fallback caso o MongoDB
 * não esteja em modo Replica Set (modo standalone).
 *
 * @param {object} params
 * @param {string} params.idWhatsApp
 * @param {string} params.idGrupo
 * @param {number} params.preco
 * @param {string} params.descricaoGold      - label pro goldHistory (ex: "Compra: Pizza")
 * @param {import('mongoose').Model} params.modeloInventario - model onde o item é creditado
 * @param {object} params.filtroInventario   - filtro pra achar o doc (ex: { idWhatsApp })
 * @param {string} params.campoInventario    - caminho do campo Map (ex: 'inventory.pizza')
 * @param {number} [params.quantidade=1]
 * @returns {Promise<{ ok: true, carteira: object } | { ok: false, motivo: string }>}
 */
async function comprarComGold({
  idWhatsApp,
  idGrupo,
  preco,
  descricaoGold,
  modeloInventario,
  filtroInventario,
  campoInventario,
  quantidade = 1,
}) {
  if (!idWhatsApp || !idGrupo || typeof preco !== 'number' || isNaN(preco) || preco < 0) {
    return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  }

  const qtd = Math.floor(Number(quantidade));
  if (isNaN(qtd) || qtd <= 0) {
    return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  }


  // 1. Tenta realizar via transação Mongo (modo Replica Set)
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch {
    session = null;
  }

  if (session) {
    let carteiraAtualizada;
    let transactionSuccess = false;
    let isStandalone = false;

    try {
      await session.withTransaction(async () => {
        carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
          { idWhatsApp, idGrupo, gold: { $gte: preco } },
          {
            $inc: { gold: -preco },
            $push: {
              goldHistory: {
                $each: [{ type: 'gasto', item: descricaoGold, amount: preco }],
                $slice: -50,
              },
            },
          },
          { new: true, session }
        );

        if (!carteiraAtualizada) {
          throw new Error('GOLD_INSUFICIENTE');
        }

        await modeloInventario.findOneAndUpdate(
          filtroInventario,
          { $inc: { [campoInventario]: qtd } },
          { upsert: true, session }
        );
      });
      transactionSuccess = true;
    } catch (err) {
      if (err.message === 'GOLD_INSUFICIENTE') {
        await session.endSession();
        return { ok: false, motivo: 'GOLD_INSUFICIENTE' };
      }
      if (/replica set|standalone|Transaction numbers/i.test(err.message)) {
        isStandalone = true;
      } else {
        console.error('⚠️ Erro em comprarComGold (transação):', err.message);
      }
    } finally {
      await session.endSession();
    }

    if (transactionSuccess) {
      return { ok: true, carteira: carteiraAtualizada };
    }

    if (!isStandalone) {
      return { ok: false, motivo: 'ERRO' };
    }
  }

  // 2. Fallback atômico em 2 etapas para MongoDB standalone
  try {
    const carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp, idGrupo, gold: { $gte: preco } },
      {
        $inc: { gold: -preco },
        $push: {
          goldHistory: {
            $each: [{ type: 'gasto', item: descricaoGold, amount: preco }],
            $slice: -50,
          },
        },
      },
      { new: true }
    );

    if (!carteiraAtualizada) {
      return { ok: false, motivo: 'GOLD_INSUFICIENTE' };
    }

    try {
      await modeloInventario.findOneAndUpdate(
        filtroInventario,
        { $inc: { [campoInventario]: qtd } },
        { upsert: true }
      );
      return { ok: true, carteira: carteiraAtualizada };
    } catch (invErr) {
      // Estorno atômico de gold caso o inventário falhe
      await CarteiraGrupo.findOneAndUpdate(
        { idWhatsApp, idGrupo },
        {
          $inc: { gold: preco },
          $push: {
            goldHistory: {
              $each: [{ type: 'ganho', item: `Estorno: ${descricaoGold}`, amount: preco }],
              $slice: -50,
            },
          },
        }
      );
      console.error('❌ Estorno realizado em comprarComGold (standalone):', invErr.message);
      return { ok: false, motivo: 'ERRO' };
    }
  } catch (err) {
    console.error('⚠️ Erro em comprarComGold (fallback):', err.message);
    return { ok: false, motivo: 'ERRO' };
  }
}

/**
 * Venda genérica: remove `quantidade` de um item do inventário e credita `valorTotal`
 * de gold na CarteiraGrupo do usuário com suporte a estorno atômico.
 */
async function venderComGold({
  idWhatsApp,
  idGrupo,
  valorTotal,
  descricaoGold,
  modeloInventario,
  filtroInventario,
  campoInventario,
  quantidade = 1,
}) {
  if (!idWhatsApp || !idGrupo || typeof valorTotal !== 'number' || isNaN(valorTotal) || valorTotal <= 0) {
    return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  }

  const qtd = Math.floor(Number(quantidade));
  if (isNaN(qtd) || qtd <= 0) {
    return { ok: false, motivo: 'PARAMETROS_INVALIDOS' };
  }


  const invAtualizado = await modeloInventario.findOneAndUpdate(
    { ...filtroInventario, [campoInventario]: { $gte: qtd } },
    { $inc: { [campoInventario]: -qtd } },
    { new: true }
  );

  if (!invAtualizado) {
    return { ok: false, motivo: 'ITEM_INSUFICIENTE' };
  }

  try {
    const carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp, idGrupo },
      {
        $inc: { gold: valorTotal },
        $push: {
          goldHistory: {
            $each: [{ type: 'ganho', item: descricaoGold, amount: valorTotal }],
            $slice: -50,
          },
        },
      },
      { upsert: true, new: true }
    );
    return { ok: true, carteira: carteiraAtualizada };
  } catch (err) {
    await modeloInventario.findOneAndUpdate(
      filtroInventario,
      { $inc: { [campoInventario]: qtd } }
    );
    console.error('❌ Estorno de item em venderComGold:', err.message);
    return { ok: false, motivo: 'ERRO' };
  }
}

module.exports = { comprarComGold, venderComGold };