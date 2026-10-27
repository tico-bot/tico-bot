'use strict';

const mongoose = require('mongoose');
require('dotenv').config();

// Ajuste o caminho para o modelo de Grupos do seu MongoDB
const pkg = require('../models/Grupo.js'); 
const GrupoModel = pkg.Grupo ?? pkg;

/**
 * Sincroniza os nomes dos grupos no MongoDB utilizando a instância ativa do Baileys.
 * @param {Object} sock - Instância do cliente Baileys (sock)
 */
async function sincronizarNomesGrupos(sock) {
  if (!sock) {
    console.error('❌ Erro: A instância do sock do Baileys não foi fornecida.');
    return;
  }

  console.log('🔄 Iniciando varredura para atualizar nomes dos grupos...');

  try {
    // Busca grupos que estão sem nome, com nome vazio ou com padrão genérico
    const grupos = await GrupoModel.find({
      $or: [
        { nome: { $exists: false } },
        { nome: '' },
        { nome: /^Grupo / } // Filtra nomes genéricos que começam com "Grupo "
      ]
    });

    const total = grupos.length;
    
    if (total === 0) {
      console.log('✅ Todos os grupos já estão com os nomes atualizados.');
      return;
    }

    console.log('📦 ' + total + ' grupo(s) pendente(s) encontrado(s). Iniciando atualização...');

    let atualizados = 0;
    let falhas = 0;

    for (const grupo of grupos) {
      try {
        const jidGrupo = grupo.jid ?? grupo.idWhatsApp ?? '';

        // Validação simples para garantir que é um JID de grupo válido
        if (!jidGrupo || !jidGrupo.endsWith('@g.us')) {
          console.warn('⚠️ JID inválido ou não pertence a um grupo: ' + jidGrupo);
          falhas++;
          continue;
        }

        // Captura os metadados em tempo real direto do WhatsApp
        const metadata = await sock.groupMetadata(jidGrupo);
        const nomeReal = metadata.subject; // O campo 'subject' traz o nome real

        // Atualiza o documento correspondente no MongoDB
        await GrupoModel.updateOne(
          { _id: grupo._id },
          { 
            $set: { 
              nome: nomeReal,
              updatedAt: new Date()
            } 
          }
        );

        atualizados++;

        // Exibe o progresso de forma limpa a cada 5 atualizações ou no final
        if (atualizados % 5 === 0 || atualizados === total) {
          console.log('🔄 Atualizado ' + atualizados + '/' + total + ' grupos...');
        }

        // Pequeno delay de 1 segundo (anti-flood) para evitar bloqueios do WhatsApp
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        falhas++;
        // Captura erros comuns, como o bot ter sido removido do grupo (gera erro 401/404)
        console.error('❌ Ignorado: Bot sem acesso ou removido do grupo.');
      }
    }

    console.log('\n✅ Concluído! Sucesso: ' + atualizados + ' | Falhas: ' + falhas);

  } catch (err) {
    console.error('💥 Erro fatal na sincronização de grupos:', err.message);
  }
}

module.exports = { sincronizarNomesGrupos };