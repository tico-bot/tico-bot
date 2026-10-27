'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const fs            = require('fs');
const mongoose      = require('mongoose');
const path          = require('path');
const Usuario       = require(path.join(__dirname, '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', 'models', 'CarteiraGrupo'));
const Filho         = require(path.join(__dirname, '..', 'models', 'Filho'));
const LidMapping    = require(path.join(__dirname, '..', 'models', 'LidMapping'));

// ─── Cores ───────────────────────────────────────────────────────────────────
const RESET    = '\x1b[0m';
const VERDE    = '\x1b[32m';
const AMARELO  = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const CYAN     = '\x1b[36m';
const BRANCO   = '\x1b[37m';

// ─── Caminhos de saída ───────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, '..', '..');
const DADOS_FILE   = path.join(ROOT, 'dados.json');
const NUMEROS_FILE = path.join(ROOT, 'numeros.json');

// ─── Helpers de log ──────────────────────────────────────────────────────────
function sep()     { console.log(`${BRANCO}${'─'.repeat(70)}${RESET}`); }
function titulo(t) { sep(); console.log(`  ${AMARELO}${t}${RESET}`); sep(); }
function ok(t)     { console.log(`  ${VERDE}✅ ${t}${RESET}`); }
function info(t)   { console.log(`  ${CYAN}ℹ️  ${t}${RESET}`); }
function warn(t)   { console.log(`  ${AMARELO}⚠️  ${t}${RESET}`); }
function erro(t)   { console.log(`  ${VERMELHO}❌ ${t}${RESET}`); }

// ─── Helpers de JID / número ─────────────────────────────────────────────────

/** Remove sufixo @xxx e :device, retorna só os dígitos. */
function limparNumero(valor = '') {
  return String(valor)
    .replace(/@\S+/g, '')   // remove @s.whatsapp.net, @g.us, @lid, etc.
    .replace(/:\d+$/, '')   // remove :83 (sufixo de dispositivo)
    .replace(/\D/g, '')     // remove qualquer não-dígito (espaços, +, -)
    .trim();
}

/** Retorna true se o JID é de grupo ou broadcast (não é usuário). */
function isGrupoOuBroadcast(jid = '') {
  return jid.endsWith('@g.us') || jid.endsWith('@broadcast');
}

/** Retorna true se o JID usa privacidade @lid (não tem número real). */
function isLid(jid = '') {
  return jid.endsWith('@lid');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  titulo('💾  EXPORTAÇÃO + EXTRAÇÃO DE NÚMEROS');

  if (!process.env.MONGO_URI) {
    erro('MONGO_URI não definida no .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  ok('MongoDB conectado\n');

  info('Buscando coleções...');

  const [usuarios, carteiras, filhos, lidMappings] = await Promise.all([
    Usuario.find({}).lean(),
    CarteiraGrupo.find({}).lean(),
    Filho.find({}).lean(),
    LidMapping.find({}).lean(),
  ]);

  // ── Mapa lid → número limpo ───────────────────────────────────────────────
  const lidParaNumero = {};
  for (const m of lidMappings) {
    if (!m.lid || !m.pn) continue;
    if (isGrupoOuBroadcast(m.pn)) continue; // ignora pn que é grupo
    const num = limparNumero(m.pn);
    // número de grupo tem 15+ dígitos começando com 120363 — descarta
    if (!num || num.startsWith('120363') || num.length > 14) continue;
    lidParaNumero[m.lid] = num;
  }

  // ── Enriquece usuários com telefone real ──────────────────────────────────
  const usuariosEnriquecidos = usuarios.map(u => {
    let telefone = u.telefone ?? null;

    if (!telefone) {
      if (isLid(u.idWhatsApp)) {
        telefone = lidParaNumero[u.idWhatsApp] ?? null;
      } else if (!isGrupoOuBroadcast(u.idWhatsApp)) {
        telefone = limparNumero(u.idWhatsApp) || null;
      }
    }

    return { ...u, telefone };
  });

  // ── Salva dados.json ──────────────────────────────────────────────────────
  const dados = {
    exportadoEm: new Date().toISOString(),
    totais: {
      usuarios:    usuarios.length,
      carteiras:   carteiras.length,
      filhos:      filhos.length,
      lidMappings: lidMappings.length,
    },
    usuarios: usuariosEnriquecidos,
    carteiras,
    filhos,
    lidMappings,
  };

  fs.writeFileSync(DADOS_FILE, JSON.stringify(dados, null, 2), 'utf8');

  // ── Sincroniza telefone resolvido de volta no MongoDB ─────────────────────
  info('Sincronizando telefones no MongoDB...');
  const ops = [];
  for (const u of usuariosEnriquecidos) {
    if (!u.telefone) continue;
    if (u.telefone === u._id?.toString()) continue; // segurança
    if (isGrupoOuBroadcast(u.idWhatsApp)) continue;
    if (u.telefone.length >= 15) continue;
    // Só atualiza quem ainda não tem telefone salvo no banco
    if (u.telefone && !usuarios.find(o => o.idWhatsApp === u.idWhatsApp)?.telefone) {
      ops.push({
        updateOne: {
          filter: { idWhatsApp: u.idWhatsApp },
          update: { $set: { telefone: u.telefone } },
        },
      });
    }
  }

  if (ops.length > 0) {
    await Usuario.bulkWrite(ops, { ordered: false });
    ok(`Telefones sincronizados: ${ops.length} usuário(s) atualizados no MongoDB`);
  } else {
    info('Nenhum telefone novo para sincronizar.');
  }

  // ── Mapas auxiliares ──────────────────────────────────────────────────────
  const nomeMap     = {};
  const telefoneMap = {};
  for (const u of usuariosEnriquecidos) {
    if (u.idWhatsApp && u.nome)     nomeMap[u.idWhatsApp]     = u.nome;
    if (u.idWhatsApp && u.telefone) telefoneMap[u.idWhatsApp] = u.telefone;
  }

  // ── Agrupa por número único ───────────────────────────────────────────────
  const mapaUsuarios = new Map();

  function getOuCriar(numero, jid, nome, gold, xp, nivel) {
    if (!mapaUsuarios.has(numero)) {
      mapaUsuarios.set(numero, {
        numero,
        idWhatsApp: jid,
        nome:       nome ?? null,
        telefone:   numero,
        gold:       gold  ?? 0,
        xp:         xp    ?? 0,
        nivel:      nivel ?? 0,
        grupos:     [],
      });
    }
    return mapaUsuarios.get(numero);
  }

  // 1. Usuários com telefone resolvido
  for (const u of usuariosEnriquecidos) {
    if (isGrupoOuBroadcast(u.idWhatsApp)) continue;
    if (!u.telefone) continue;
    // Descarta se o número tem 15+ dígitos (padrão de JID de grupo)
    if (u.telefone.length >= 15) continue;
    getOuCriar(u.telefone, u.idWhatsApp, u.nome, u.gold, u.xp, u.level ?? u.nivel ?? 0);
  }

  // 2. Carteiras — resolve número e agrupa grupos
  for (const c of carteiras) {
    if (isGrupoOuBroadcast(c.idWhatsApp)) continue;
    // Carteiras cujo idWhatsApp é o mesmo que o idGrupo são registros de grupo, não usuário
    if (c.idWhatsApp.replace(/@\S+/, '') === c.idGrupo.replace(/@\S+/, '')) continue;

    let numero = telefoneMap[c.idWhatsApp] ?? null;
    if (!numero) {
      numero = isLid(c.idWhatsApp)
        ? (lidParaNumero[c.idWhatsApp] ?? null)
        : (limparNumero(c.idWhatsApp) || null);
    }
    if (!numero) continue;
    if (numero.length >= 15) continue; // descarta JIDs de grupo disfarçados

    const entrada = getOuCriar(
      numero,
      c.idWhatsApp,
      nomeMap[c.idWhatsApp] ?? c.nome ?? null,
      0, 0, 0
    );

    if (!entrada.nome && c.nome) entrada.nome = c.nome;

    const jaExiste = entrada.grupos.some(g => g.idGrupo === c.idGrupo);
    if (!jaExiste) {
      entrada.grupos.push({
        idGrupo: c.idGrupo,
        gold:    c.gold  ?? 0,
        banco:   c.banco ?? {},
        xp:      c.xp    ?? 0,
        nivel:   c.nivel ?? c.level ?? 1,
      });
    }
  }

  // ── Ordena por número ─────────────────────────────────────────────────────
  const lista = [...mapaUsuarios.values()].sort((a, b) => a.numero.localeCompare(b.numero));

  // ── Estatísticas ──────────────────────────────────────────────────────────
  const comTelefone = usuariosEnriquecidos.filter(u => u.telefone && !isGrupoOuBroadcast(u.idWhatsApp)).length;
  const semNome     = lista.filter(u => !u.nome).length;
  const semGrupo    = lista.filter(u => u.grupos.length === 0).length;
  const comGrupo    = lista.filter(u => u.grupos.length  > 0).length;

  const numeros = {
    geradoEm:      new Date().toISOString(),
    baseExportada: dados.exportadoEm,
    total:         lista.length,
    usuarios:      lista,
  };

  fs.writeFileSync(NUMEROS_FILE, JSON.stringify(numeros, null, 2), 'utf8');

  // ── Resumo ────────────────────────────────────────────────────────────────
  const kbDados   = (fs.statSync(DADOS_FILE).size   / 1024).toFixed(1);
  const kbNumeros = (fs.statSync(NUMEROS_FILE).size / 1024).toFixed(1);

  titulo('📊  RESUMO DA EXPORTAÇÃO');
  ok(`Usuários     : ${usuarios.length} (${comTelefone} com telefone)`);
  ok(`Carteiras    : ${carteiras.length}`);
  ok(`Filhos       : ${filhos.length}`);
  ok(`LidMappings  : ${lidMappings.length}`);
  sep();
  ok(`Números únicos : ${lista.length}`);
  ok(`Com grupo(s)   : ${comGrupo}`);
  if (semGrupo) warn(`Sem grupo      : ${semGrupo}`);
  if (semNome)  warn(`Sem nome       : ${semNome}`);
  sep();
  info(`dados.json   : ${DADOS_FILE} (${kbDados} KB)`);
  info(`numeros.json : ${NUMEROS_FILE} (${kbNumeros} KB)`);

  console.log(`\n  ${VERDE}✅ Exportação concluída com sucesso!${RESET}\n`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  erro(`Erro fatal: ${err.message}`);
  process.exit(1);
});