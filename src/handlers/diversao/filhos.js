'use strict';

const path   = require('path');
const Filho  = require(path.join(__dirname, '..', '..', 'models', 'Filho'));
const Usuario= require(path.join(__dirname, '..', '..', 'models', 'Usuario'));
const CarteiraGrupo = require(path.join(__dirname, '..', '..', 'models', 'CarteiraGrupo'));
const Relacionamento = require(path.join(__dirname, '..', '..', 'models', 'Relacionamento'));
const AdocaoSolicitacao = require(path.join(__dirname, '..', '..', 'models', 'AdocaoSolicitacao'));
const { resolverJidCarteira, formatarSaldo, alterarGold } = require(path.join(__dirname, '..', '..', 'utils', 'carteira'));
const { bloqueadoPorVinculo } = require(path.join(__dirname, '..', '..', 'utils', 'carteira', 'vinculo'));
const republicaEconomia = require('../republica/economia');
const republicaSocial = require('../republica/social');
const {
  getParticipantJids,
  getAlternateSenderJids,
  resolvePhoneAndJid,
} = require('../../utils/identity');
const { normalizarJidUsuario } = require('../../utils/jid');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CHANCE_FILHO       = 0.40;  // 40% de chance
const MAX_FILHOS         = 3;
const DIAS_POR_ANO       = 7;     // 7 dias reais = 1 ano
const COOLDOWN_CUIDAR    = 20 * 60 * 60 * 1000; // 20h
const COOLDOWN_TENTAR = 20 * 60 * 1000; // 20 minutos
const CUSTO_REMEDIO      = 300;   // gold
const RENOMEAR_MAX_LEN   = 20;    // tamanho máximo do nome do filho
const PRAZO_ADOCAO_MS = 15 * 60 * 1000;

const PERSONALIDADES = [
  'curioso 🔍', 'agitado ⚡', 'tímido 🌸', 'corajoso 🦁',
  'preguiçoso 😴', 'esperto 🧠', 'carinhoso 💕', 'teimoso 😤',
];

const NOMES_MENINO = [
  'Miguel', 'Arthur', 'Heitor', 'Davi', 'Gabriel',
  'Pedro', 'Lucas', 'Matheus', 'Rafael', 'Enzo',
  'Bernardo', 'Théo', 'Gael', 'Noah', 'Samuel',
  'Benício', 'Joaquim', 'Anthony', 'Ravi', 'Lorenzo',
  'Vicente', 'Henrique', 'Bryan', 'Daniel', 'Caio',
  'Nicolas', 'Felipe', 'Thiago', 'Eduardo', 'Vinícius',
];

const NOMES_MENINA = [
  'Alice', 'Sofia', 'Isabella', 'Valentina', 'Júlia',
  'Laura', 'Manuela', 'Luiza', 'Heloísa', 'Lívia',
  'Helena', 'Maria Alice', 'Maite', 'Cecília', 'Eloá',
  'Lorena', 'Beatriz', 'Maria Clara', 'Mariana', 'Antonella',
  'Liz', 'Isadora', 'Yasmin', 'Clara', 'Esther',
  'Giovanna', 'Melissa', 'Gabriela', 'Rafaela', 'Letícia',
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizarListaJids(valores) {
  const lista = Array.isArray(valores) ? valores : [valores];
  return [...new Set(lista
    .map(valor => normalizarJidUsuario(typeof valor === 'string' ? valor.trim() : null))
    .filter(Boolean))];
}

function identidadesSeSobrepoem(identidadesA, identidadesB) {
  const conjunto = new Set(normalizarListaJids(identidadesA));
  return normalizarListaJids(identidadesB).some(id => conjunto.has(id));
}

function avaliarParticipacaoPedidoAdocao(solicitanteIds, convidadoIds, usuarioIds, parceiroIds) {
  const solicitanteEhUsuario = identidadesSeSobrepoem(solicitanteIds, usuarioIds);
  const solicitanteEhParceiro = identidadesSeSobrepoem(solicitanteIds, parceiroIds);
  const convidadoEhUsuario = identidadesSeSobrepoem(convidadoIds, usuarioIds);
  const convidadoEhParceiro = identidadesSeSobrepoem(convidadoIds, parceiroIds);

  return {
    pertenceAoCasal:
      (solicitanteEhUsuario && convidadoEhParceiro) ||
      (solicitanteEhParceiro && convidadoEhUsuario),
    usuarioEhSolicitante: solicitanteEhUsuario && convidadoEhParceiro,
    usuarioEhConvidado: convidadoEhUsuario && solicitanteEhParceiro,
  };
}

function obterPrefixoComando(msg) {
  let atual = msg?.message;

  for (let profundidade = 0; profundidade < 8 && atual && typeof atual === 'object'; profundidade++) {
    const textos = [
      atual.conversation,
      atual.extendedTextMessage?.text,
      atual.imageMessage?.caption,
      atual.videoMessage?.caption,
      atual.documentMessage?.caption,
      atual.documentWithCaptionMessage?.message?.documentMessage?.caption,
    ];
    for (const texto of textos) {
      const prefixo = typeof texto === 'string' ? texto.trim().match(/^([!.,/#])/)?.[1] : null;
      if (prefixo) return prefixo;
    }

    const envelope = atual.ephemeralMessage ||
      atual.viewOnceMessage ||
      atual.viewOnceMessageV2 ||
      atual.viewOnceMessageV2Extension ||
      atual.documentWithCaptionMessage;
    atual = envelope?.message;
  }

  return '!';
}

function comandoDoGrupo(msg, nome, argumentos = '') {
  return obterPrefixoComando(msg) + nome + (argumentos ? ' ' + argumentos : '');
}

async function resolverIdentidadesJid(valores, sock) {
  const iniciais = normalizarListaJids(valores);
  const resultado = [...iniciais];
  const vistos = new Set(resultado);

  for (const jid of iniciais) {
    const info = await resolvePhoneAndJid(jid, sock).catch(() => null);
    for (const alias of [info?.resolvedJid, info?.pnJid, info?.lidJid]) {
      const normalizado = normalizarJidUsuario(alias);
      if (normalizado && !vistos.has(normalizado)) {
        vistos.add(normalizado);
        resultado.push(normalizado);
      }
    }
  }
  return resultado;
}

async function resolverIdentidadesRemetente(msg, sock) {
  const jidPrincipal = msg?.key?.participant || msg?.key?.remoteJid;
  return resolverIdentidadesJid(
    [jidPrincipal, ...getAlternateSenderJids(msg)],
    sock
  );
}

async function buscarUsuariosPorIdentidades(identidades) {
  // Todos os chamadores entregam aliases já resolvidos; não repetir consultas PN/LID.
  const ids = normalizarListaJids(identidades);
  const usuarios = [];
  const vistos = new Set();
  for (const id of ids) {
    const usuario = await Usuario.findOne({ idWhatsApp: id }).lean();
    if (!usuario) continue;
    const chave = String(usuario._id || usuario.idWhatsApp);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    usuarios.push(usuario);
  }
  return { usuarios, identidades: ids };
}

async function buscarCasalPorIdentidades(identidades, sock, idGrupo = null) {
  const identidadesEntrada = await resolverIdentidadesJid(identidades, sock);
  const { usuarios } = await buscarUsuariosPorIdentidades(identidadesEntrada);

  for (const usuario of usuarios) {
    if (!usuario?.casadoCom) continue;
    if (idGrupo && usuario.casadoGrupo && usuario.casadoGrupo !== idGrupo) continue;

    const usuarioIds = await resolverIdentidadesJid(
      [usuario.idWhatsApp, ...identidadesEntrada],
      sock
    );
    const identidadesParceiro = await resolverIdentidadesJid([usuario.casadoCom], sock);
    const { usuarios: parceiros } = await buscarUsuariosPorIdentidades(identidadesParceiro);

    for (const parceiro of parceiros) {
      if (!parceiro?.casadoCom) continue;
      if (idGrupo && parceiro.casadoGrupo && parceiro.casadoGrupo !== idGrupo) continue;

      const parceiroIds = await resolverIdentidadesJid(
        [parceiro.idWhatsApp, ...identidadesParceiro],
        sock
      );
      if (identidadesSeSobrepoem(usuarioIds, parceiroIds)) continue;

      const retornoParceiro = await resolverIdentidadesJid([parceiro.casadoCom], sock);
      if (!identidadesSeSobrepoem(usuarioIds, retornoParceiro)) continue;

      return { usuario, parceiro, usuarioIds, parceiroIds };
    }
  }

  return null;
}

function filtroFilhos(jid, usuarioIds, parceiroIds) {
  const idsA = normalizarListaJids(usuarioIds);
  const idsB = normalizarListaJids(parceiroIds);
  if (!idsA.length || !idsB.length) return { idGrupo: jid, _id: null };
  return {
    idGrupo: jid,
    $or: [
      { jidA: { $in: idsA }, jidB: { $in: idsB } },
      { jidA: { $in: idsB }, jidB: { $in: idsA } },
    ],
  };
}

function filtroFilhosPorPai(jid, usuarioIds) {
  const ids = normalizarListaJids(usuarioIds);
  if (!ids.length) return { idGrupo: jid, _id: null };
  return {
    idGrupo: jid,
    $or: [
      { jidA: { $in: ids } },
      { jidB: { $in: ids } },
    ],
  };
}

function calcularIdade(nascidoEm) {
  const diasVividos = (Date.now() - new Date(nascidoEm).getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(diasVividos / DIAS_POR_ANO);
}

function formatarIdade(nascidoEm) {
  const idade = calcularIdade(nascidoEm);
  if (idade <= 0) return 'menos de 1 ano';
  return idade === 1 ? '1 ano' : idade + ' anos';
}

function statusBar(valor, tamanho = 8) {
  const v = Math.max(0, Math.min(100, valor));
  const preenchido = Math.round((v / 100) * tamanho);
  const vazio = tamanho - preenchido;
  return `[${'█'.repeat(preenchido)}${'░'.repeat(vazio)}] ${v}%`;
}

function formatarTempo(ms) {
  const horas = Math.floor(ms / 3_600_000);
  const min   = Math.floor((ms % 3_600_000) / 60_000);
  const seg   = Math.floor((ms % 60_000) / 1000);
  if (horas > 0) return `${horas}h ${min}min`;
  if (min > 0)   return `${min}min ${seg}s`;
  return `${seg}s`;
}

async function buscarUsuarioComParceiro(userId, sock, msg, idGrupo) {
  const casal = await buscarCasalPorIdentidades(
    [userId, ...getAlternateSenderJids(msg)],
    sock,
    idGrupo
  );
  if (!casal) return null;
  return {
    usuario: casal.usuario,
    parceiro: casal.parceiro.idWhatsApp,
    usuarioIds: casal.usuarioIds,
    parceiroIds: casal.parceiroIds,
  };
}

// Os filtros aceitam PN/LID equivalentes para não perder filhos quando
// o WhatsApp alterna o identificador do mesmo participante.

// Retorna true se jidA e jidB do filho estão atualmente casados/namorando
// um com o outro — ou seja, o casal reconciliou. Nesse caso a guarda
// compartilhada é desativada e qualquer um dos pais pode cuidar.
async function estaoJuntos(filho, sock) {
  if (!filho.jidA || !filho.jidB) return false;

  const idsA = await resolverIdentidadesJid([filho.jidA], sock);
  const idsB = await resolverIdentidadesJid([filho.jidB], sock);
  const casalA = await buscarCasalPorIdentidades(idsA, sock, filho.idGrupo);
  if (casalA && identidadesSeSobrepoem(casalA.parceiroIds, idsB)) return true;

  const casalB = await buscarCasalPorIdentidades(idsB, sock, filho.idGrupo);
  return !!(casalB && identidadesSeSobrepoem(casalB.parceiroIds, idsA));
}

// Troca a guarda do filho 1x por dia, apenas enquanto o casal está separado.
// Se reconciliarem, a guarda fica "livre" (null) e ambos podem cuidar.
async function atualizarGuarda(filho, sock) {
  const juntos = await estaoJuntos(filho, sock);

  if (juntos) {
    // Casal reconciliou: guarda compartilhada desativada
    if (filho.guardaAtual !== null) {
      filho.guardaAtual = null;
      await filho.save();
    }
    return null; // null = guarda livre, qualquer um dos pais cuida
  }

  // Separados: garante que a guarda esteja definida e troca 1x/dia
  if (!filho.guardaAtual) {
    filho.guardaAtual = filho.jidA;
    filho.ultimaTroca = new Date();
    await filho.save();
    return filho.guardaAtual;
  }

  const diasDesdeUltimaTroca = (Date.now() - new Date(filho.ultimaTroca).getTime()) / (1000 * 60 * 60 * 24);
  if (diasDesdeUltimaTroca >= 1) {
    filho.guardaAtual = filho.guardaAtual === filho.jidA ? filho.jidB : filho.jidA;
    filho.ultimaTroca = new Date();
    await filho.save();
  }
  return filho.guardaAtual;
}

// ─── !tentarfilho ─────────────────────────────────────────────────────────────
// Só faz sentido com relacionamento ativo — continua exigindo casadoCom.

async function handleTentarFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const info = await buscarUsuarioComParceiro(userId, sock, msg, jid);
    if (!info) {
      return sock.sendMessage(jid, {
        text: '❌ Você precisa estar em um relacionamento ativo neste grupo para ter filhos biológicos!',
      }, { quoted: msg });
    }

    const { usuario, parceiro, usuarioIds, parceiroIds } = info;
    const usuarioId = normalizarJidUsuario(usuario.idWhatsApp) || userId;

    // ── Cooldown de 20 minutos ──
    if (usuario.ultimaTentativaFilho) {
      const restante = COOLDOWN_TENTAR - (Date.now() - new Date(usuario.ultimaTentativaFilho).getTime());
      if (restante > 0) {
        return sock.sendMessage(jid, {
          text: `⏳ Aguarde *${formatarTempo(restante)}* para tentar ter um filho novamente.`,
        }, { quoted: msg });
      }
    }

    // ── Verifica limite de filhos (apenas com o parceiro atual) ──
    const totalFilhos = await Filho.countDocuments(filtroFilhos(jid, usuarioIds, parceiroIds));
    if (totalFilhos >= MAX_FILHOS) {
      return sock.sendMessage(jid, {
        text: `❌ Vocês já atingiram o limite de *${MAX_FILHOS} filhos por casal*!`,
      }, { quoted: msg });
    }

    // Reserva o cooldown atomicamente para impedir duas tentativas simultâneas.
    const agoraTentativa = new Date();
    const inicioCooldown = new Date(agoraTentativa.getTime() - COOLDOWN_TENTAR);
    const tentativaReservada = await Usuario.findOneAndUpdate(
      {
        idWhatsApp: usuarioId,
        $or: [
          { ultimaTentativaFilho: null },
          { ultimaTentativaFilho: { $lte: inicioCooldown } },
        ],
      },
      { $set: { ultimaTentativaFilho: agoraTentativa } },
      { new: true }
    ).lean();

    if (!tentativaReservada) {
      const usuarioAtual = await Usuario.findOne({ idWhatsApp: usuarioId })
        .select('ultimaTentativaFilho')
        .lean();
      const ultimaTentativa = new Date(usuarioAtual?.ultimaTentativaFilho || 0).getTime();
      const restante = COOLDOWN_TENTAR - (Date.now() - ultimaTentativa);
      if (restante > 0) {
        return sock.sendMessage(jid, {
          text: `⏳ Aguarde *${formatarTempo(restante)}* para tentar ter um filho novamente.`,
        }, { quoted: msg });
      }
      throw new Error('Não foi possível reservar o cooldown da tentativa.');
    }

    // ── Sorteio ──
    if (Math.random() > CHANCE_FILHO) {
      const tentativas = [
        '😔 Dessa vez não rolou... Tentem novamente em 20 minutos!',
        '🍀 Quase! A sorte não sorriu dessa vez. Não desistam!',
        '💔 Não foi dessa vez. Continuem tentando em 20 minutos!',
      ];
      return sock.sendMessage(jid, {
        text: tentativas[Math.floor(Math.random() * tentativas.length)],
      }, { quoted: msg });
    }

    // ── Nasce o filho ──
    const sexo          = Math.random() < 0.5 ? 'menino' : 'menina';
    const nomes         = sexo === 'menino' ? NOMES_MENINO : NOMES_MENINA;
    const nome          = nomes[Math.floor(Math.random() * nomes.length)];
    const personalidade = PERSONALIDADES[Math.floor(Math.random() * PERSONALIDADES.length)];
    const emoji         = sexo === 'menino' ? '👦' : '👧';

    const filhoCriado = await Filho.create({
      jidA: usuarioId,
      jidB: parceiro,
      idGrupo: jid,
      nome,
      sexo,
      personalidade,
      felicidade: 100,
      fome:       100,
      sono:       100,
      alegria:    100,
      doente:     false,
      guardaAtual: null,
      ultimaTroca: new Date(),
      nascidoEm:   new Date(),
    });

    let avisoLicencas = '';
    if (await republicaEconomia.modoAtivo(jid)) {
      const licencas = await republicaSocial.registrarLicencasNascimento(jid, usuarioId, parceiro, filhoCriado);
      if (licencas.length) {
        avisoLicencas = `\n\n👶 *LICENÇAS PARENTAIS:* ${licencas.length} responsável(is) empregado(s) recebeu(ram) 2 dias de licença parental. Os pagamentos salariais são calculados pelo Fundo de Licença Parental.`;
        for (const licenca of licencas) {
          await sock.sendMessage(licenca.usuarioId, {
            text: '👶 *LICENÇA ' + String(licenca.tipo || 'PARENTAL').toUpperCase() + ' ATIVADA*\n\n' +
              'Você recebeu 2 dias de licença parental no emprego do Tico.\n' +
              'Remuneração diária prevista: *' + Math.floor(licenca.salarioDiario || 0).toLocaleString('pt-BR') + ' Pratas*.\n' +
              'O Fundo de Licença Parental realiza até dois pagamentos diários conforme o salário apurado. Seu emprego fica protegido durante as 48 horas.',
          }).catch(() => {});
        }
      }
    }

    return sock.sendMessage(jid, {
      text:
        `🎉 *PARABÉNS! NASCEU UM(A) FILHO(A)!* 🎉\n\n` +
        `${emoji} *${nome}*\n` +
        `🧬 Sexo: *${sexo}*\n` +
        `✨ Personalidade: *${personalidade}*\n` +
        `🎂 Idade: *recém-nascido(a)*\n\n` +
        `😊 Felicidade : ${statusBar(100)}\n` +
        `🍽️ Fome       : ${statusBar(100)}\n` +
        `😴 Sono       : ${statusBar(100)}\n` +
        `🎈 Alegria    : ${statusBar(100)}\n\n` +
        `💡 Use *${comandoDoGrupo(msg, 'cuidarfilho')}* para cuidar dele(a). Cada filho pode receber cuidados novamente a cada 20 horas.` +
        avisoLicencas,
      mentions: [usuarioId, parceiro],
    }, { quoted: msg });

  } catch (e) {
    console.error('[handleTentarFilho] Erro:', e.message);
    return sock.sendMessage(jid, {
      text: '⚠️ Erro ao tentar ter um filho. Tente novamente.',
    }, { quoted: msg }).catch(() => {});
  }
}


// ─── !adotarfilho ─────────────────────────────────────────────────────────────
async function obterCasalAdocao(sock, idGrupo, usuarioRaw, aliases = []) {
  // Nunca use o identificador da carteira para consultar Usuario/Relacionamento:
  // ele pode ser LID mesmo quando os modelos estão guardados pelo PN.
  const casal = await buscarCasalPorIdentidades(
    [usuarioRaw, ...aliases],
    sock,
    idGrupo
  );
  if (!casal?.usuario?.idWhatsApp || !casal?.parceiro?.idWhatsApp) return null;

  const usuarioId = normalizarJidUsuario(casal.usuario.idWhatsApp);
  const parceiroId = normalizarJidUsuario(casal.parceiro.idWhatsApp);
  const usuarioIds = casal.usuarioIds;
  const parceiroIds = casal.parceiroIds;
  if (!usuarioId || !parceiroId || identidadesSeSobrepoem(usuarioIds, parceiroIds)) return null;

  const filtrosRelacionamento = [];
  for (const idUsuario of usuarioIds) {
    for (const idParceiro of parceiroIds) {
      filtrosRelacionamento.push(
        { jidA: idUsuario, jidB: idParceiro },
        { jidA: idParceiro, jidB: idUsuario },
        { participantes: { $all: [idUsuario, idParceiro] } }
      );
    }
  }
  const relacionamento = await Relacionamento.findOne({
    idGrupo,
    $or: filtrosRelacionamento,
  }).lean();
  if (!relacionamento) return null;

  const metadados = await sock.groupMetadata(idGrupo);
  let usuarioNoGrupo = false;
  let parceiroNoGrupo = false;
  for (const participante of (metadados?.participants || [])) {
    // getParticipantJids já entrega PN/LID quando o WhatsApp os informa.
    // Os aliases do casal foram resolvidos antes; não consultar Mongo para cada membro.
    const idsParticipante = getParticipantJids(participante);
    if (!usuarioNoGrupo && identidadesSeSobrepoem(usuarioIds, idsParticipante)) {
      usuarioNoGrupo = true;
    }
    if (!parceiroNoGrupo && identidadesSeSobrepoem(parceiroIds, idsParticipante)) {
      parceiroNoGrupo = true;
    }
    if (usuarioNoGrupo && parceiroNoGrupo) break;
  }
  if (!usuarioNoGrupo || !parceiroNoGrupo) return null;

  return { usuarioId, parceiroId, usuarioIds, parceiroIds };
}

function gerarDadosAdocao(nome = '') {
  const sexo = Math.random() < 0.5 ? 'menino' : 'menina';
  const listaNomes = sexo === 'menino' ? NOMES_MENINO : NOMES_MENINA;
  const nomeLimpo = String(nome || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const nomeFinal = nomeLimpo || listaNomes[Math.floor(Math.random() * listaNomes.length)];
  if (nomeFinal.length > RENOMEAR_MAX_LEN) {
    throw new Error('O nome da criança pode ter no máximo ' + RENOMEAR_MAX_LEN + ' caracteres.');
  }
  return {
    nome: nomeFinal,
    sexo,
    personalidade: PERSONALIDADES[Math.floor(Math.random() * PERSONALIDADES.length)],
  };
}

async function criarFilhoAdotivo(idGrupo, pedido) {
  let filho = await Filho.findOne({ adocaoSolicitacaoId: pedido._id });
  if (filho) return filho;
  const agora = new Date();
  const dados = {
    jidA: pedido.solicitanteId,
    jidB: pedido.parceiroId,
    idGrupo,
    nome: pedido.nome,
    sexo: pedido.sexo,
    personalidade: pedido.personalidade,
    adotado: true,
    adotadoEm: agora,
    adocaoSolicitacaoId: pedido._id,
    felicidade: 100,
    fome: 100,
    sono: 100,
    alegria: 100,
    doente: false,
    guardaAtual: null,
    ultimaTroca: agora,
    nascidoEm: agora,
  };
  try {
    filho = await Filho.create(dados);
  } catch (erro) {
    if (erro?.code !== 11000) throw erro;
    filho = await Filho.findOne({ adocaoSolicitacaoId: pedido._id });
    if (!filho) throw erro;
  }
  return filho;
}

async function handleAdotarFilho(sock, msg, jid, caption) {
  if (!String(jid || '').endsWith('@g.us')) {
    return sock.sendMessage(jid, { text: '👨‍👩‍👧 O processo de adoção deve ser iniciado e confirmado no grupo do casal.' }, { quoted: msg });
  }

  const autorRaw = msg.key.participant || msg.key.remoteJid;
  const autorAliases = getAlternateSenderJids(msg);
  const partes = String(caption || '').trim().split(/\s+/).filter(Boolean);
  const primeiraOpcao = String(partes[1] || '').toLowerCase();
  const acao = ['aceitar', 'recusar', 'cancelar'].includes(primeiraOpcao) ? primeiraOpcao : '';
  const argumento = (acao ? partes.slice(2) : partes.slice(1)).join(' ').trim();

  try {
    const casal = await obterCasalAdocao(sock, jid, autorRaw, autorAliases);
    if (!casal) {
      return sock.sendMessage(jid, {
        text: '❌ Para adotar, os dois responsáveis precisam estar em um relacionamento ativo registrado neste grupo e fazer parte dele.',
      }, { quoted: msg });
    }
    const { usuarioId, parceiroId, usuarioIds, parceiroIds } = casal;

    if (acao === 'cancelar' || acao === 'recusar') {
      if (!argumento) return sock.sendMessage(jid, {
        text: '⚠️ Informe o código do pedido: *' + comandoDoGrupo(msg, 'adotarfilho', acao + ' <código>') + '*.',
      }, { quoted: msg });

      const pedido = await AdocaoSolicitacao.findOne({
        idGrupo: jid,
        codigo: argumento.toUpperCase(),
      });
      if (!pedido) return sock.sendMessage(jid, { text: '❌ Pedido de adoção não encontrado.' }, { quoted: msg });

      const pedidoSolicitanteIds = await resolverIdentidadesJid([pedido.solicitanteId], sock);
      const pedidoParceiroIds = await resolverIdentidadesJid([pedido.parceiroId], sock);
      const participacao = avaliarParticipacaoPedidoAdocao(
        pedidoSolicitanteIds,
        pedidoParceiroIds,
        usuarioIds,
        parceiroIds
      );
      if (!participacao.pertenceAoCasal) return sock.sendMessage(jid, {
        text: '❌ Este pedido não pertence ao relacionamento atual e não pode ser alterado por este casal.',
      }, { quoted: msg });

      const podeAgir = acao === 'cancelar'
        ? participacao.usuarioEhSolicitante
        : participacao.usuarioEhConvidado;
      if (!podeAgir) return sock.sendMessage(jid, {
        text: acao === 'cancelar'
          ? '❌ Apenas quem iniciou o pedido pode cancelá-lo.'
          : '❌ Apenas o parceiro convidado pode recusar a adoção.',
      }, { quoted: msg });

      if (pedido.status !== 'pendente') {
        return sock.sendMessage(jid, {
          text: pedido.status === 'expirada'
            ? '⌛ Este pedido já expirou.'
            : '⏳ Este pedido já foi processado ou está sendo confirmado.',
        }, { quoted: msg });
      }

      const agora = new Date();
      if (!pedido.expiresAt || new Date(pedido.expiresAt) <= agora) {
        await AdocaoSolicitacao.updateOne(
          { _id: pedido._id, status: 'pendente' },
          { $set: { status: 'expirada' } }
        );
        return sock.sendMessage(jid, { text: '⌛ Este pedido expirou.' }, { quoted: msg });
      }

      const novoStatus = acao === 'cancelar' ? 'cancelada' : 'recusada';
      const atualizado = await AdocaoSolicitacao.findOneAndUpdate(
        {
          _id: pedido._id,
          idGrupo: jid,
          status: 'pendente',
          expiresAt: { $gt: agora },
          solicitanteId: pedido.solicitanteId,
          parceiroId: pedido.parceiroId,
        },
        { $set: { status: novoStatus } },
        { new: true }
      );
      if (!atualizado) {
        return sock.sendMessage(jid, {
          text: '⏳ O pedido mudou de estado antes da operação. Consulte o código novamente.',
        }, { quoted: msg });
      }

      return sock.sendMessage(jid, {
        text: acao === 'cancelar'
          ? '🛑 Pedido de adoção cancelado.'
          : '📩 O parceiro recusou o pedido de adoção. Nenhuma criança foi registrada.',
      }, { quoted: msg });
    }

    if (acao === 'aceitar') {
      if (!argumento) return sock.sendMessage(jid, {
        text: '⚠️ Informe o código enviado no grupo: *' + comandoDoGrupo(msg, 'adotarfilho', 'aceitar <código>') + '*.',
      }, { quoted: msg });
      let pedido = await AdocaoSolicitacao.findOne({
        idGrupo: jid,
        codigo: argumento.toUpperCase(),
      });
      if (!pedido) return sock.sendMessage(jid, { text: '❌ Pedido de adoção não encontrado.' }, { quoted: msg });
      const pedidoSolicitanteIds = await resolverIdentidadesJid([pedido.solicitanteId], sock);
      const pedidoParceiroIds = await resolverIdentidadesJid([pedido.parceiroId], sock);
      const participacao = avaliarParticipacaoPedidoAdocao(
        pedidoSolicitanteIds,
        pedidoParceiroIds,
        usuarioIds,
        parceiroIds
      );
      if (!participacao.pertenceAoCasal) {
        return sock.sendMessage(jid, {
          text: '❌ Este pedido não pertence ao relacionamento atual e não pode ser confirmado por este casal.',
        }, { quoted: msg });
      }
      if (!participacao.usuarioEhConvidado) {
        return sock.sendMessage(jid, {
          text: '❌ Apenas o responsável convidado pode aceitar este pedido.',
        }, { quoted: msg });
      }
      if (pedido.status === 'aceita') {
        return sock.sendMessage(jid, { text: '✅ Esta adoção já foi confirmada e a criança já está registrada.' }, { quoted: msg });
      }
      if (pedido.status === 'pendente' && (!pedido.expiresAt || new Date(pedido.expiresAt) <= new Date())) {
        await AdocaoSolicitacao.updateOne(
          { _id: pedido._id, status: 'pendente' },
          { $set: { status: 'expirada' } }
        );
        return sock.sendMessage(jid, { text: '⌛ O pedido expirou. O parceiro precisa iniciar uma nova solicitação.' }, { quoted: msg });
      }
      if (!['pendente', 'processando'].includes(pedido.status)) {
        return sock.sendMessage(jid, { text: '❌ Este pedido já foi recusado, cancelado ou expirou.' }, { quoted: msg });
      }

      if (pedido.status === 'processando') {
        const timestampProcessamento = pedido.processamentoEm
          ? new Date(pedido.processamentoEm).getTime()
          : NaN;
        const processamentoParado = !Number.isFinite(timestampProcessamento) ||
          Date.now() - timestampProcessamento >= 2 * 60 * 1000;
        const pedidoExpirado = !pedido.expiresAt ||
          new Date(pedido.expiresAt).getTime() <= Date.now();

        if (processamentoParado && pedidoExpirado) {
          const filhoExistente = await Filho.findOne({ adocaoSolicitacaoId: pedido._id });
          if (!filhoExistente) {
            const expirado = await AdocaoSolicitacao.updateOne(
              {
                _id: pedido._id,
                status: 'processando',
                processamentoEm: pedido.processamentoEm || null,
              },
              { $set: { status: 'expirada' } }
            );
            if (expirado.modifiedCount) {
              return sock.sendMessage(jid, {
                text: '⌛ O pedido expirou durante uma tentativa interrompida. Inicie uma nova solicitação.',
              }, { quoted: msg });
            }
            return sock.sendMessage(jid, {
              text: '⏳ O estado do pedido mudou durante a confirmação. Consulte o código novamente.',
            }, { quoted: msg });
          }
        }
      }

      const reservado = await AdocaoSolicitacao.findOneAndUpdate(
        {
          _id: pedido._id,
          status: 'pendente',
          expiresAt: { $gt: new Date() },
        },
        { $set: { status: 'processando', processamentoEm: new Date() } },
        { new: true }
      );
      if (reservado) {
        pedido = reservado;
      } else if (pedido.status === 'pendente') {
        const estadoAtual = await AdocaoSolicitacao.findById(pedido._id).lean();
        if (estadoAtual?.status === 'pendente' && new Date(estadoAtual.expiresAt) <= new Date()) {
          await AdocaoSolicitacao.updateOne(
            { _id: pedido._id, status: 'pendente' },
            { $set: { status: 'expirada' } }
          );
          return sock.sendMessage(jid, { text: '⌛ O pedido expirou antes da confirmação. Inicie uma nova solicitação.' }, { quoted: msg });
        }
        return sock.sendMessage(jid, { text: '⏳ Este pedido já foi aceito, recusado ou está sendo processado.' }, { quoted: msg });
      } else if (pedido.status === 'processando' &&
        pedido.processamentoEm &&
        Date.now() - new Date(pedido.processamentoEm).getTime() < 2 * 60 * 1000) {
        return sock.sendMessage(jid, { text: '⏳ Esta adoção já está sendo processada. Aguarde a confirmação.' }, { quoted: msg });
      } else if (pedido.status === 'processando') {
        const agoraRetomada = new Date();
        const retomado = await AdocaoSolicitacao.findOneAndUpdate(
          {
            _id: pedido._id,
            status: 'processando',
            $or: [
              { processamentoEm: { $lte: new Date(agoraRetomada.getTime() - 2 * 60 * 1000) } },
              { processamentoEm: null },
            ],
          },
          { $set: { processamentoEm: agoraRetomada } },
          { new: true }
        );
        if (!retomado) return sock.sendMessage(jid, { text: '⏳ Esta adoção já está sendo processada. Aguarde a confirmação.' }, { quoted: msg });
        pedido = retomado;
      }

      const totalFilhos = await Filho.countDocuments(filtroFilhos(
        jid,
        await resolverIdentidadesJid([pedido.solicitanteId], sock),
        await resolverIdentidadesJid([pedido.parceiroId], sock)
      ));
      if (totalFilhos >= MAX_FILHOS) {
        await AdocaoSolicitacao.updateOne(
          { _id: pedido._id, status: 'processando' },
          { $set: { status: 'cancelada' } }
        );
        return sock.sendMessage(jid, {
          text: '❌ O casal já atingiu o limite de ' + MAX_FILHOS + ' filhos. O pedido foi cancelado.',
        }, { quoted: msg });
      }

      let filho;
      try {
        filho = await criarFilhoAdotivo(jid, pedido);
        await AdocaoSolicitacao.updateOne(
          { _id: pedido._id, status: 'processando' },
          { $set: { status: 'aceita', aceitaEm: new Date(), filhoId: filho._id } }
        );
      } catch (erro) {
        await AdocaoSolicitacao.updateOne(
          { _id: pedido._id, status: 'processando' },
          { $set: { status: 'pendente', processamentoEm: null } }
        ).catch(() => {});
        throw erro;
      }

      let licencas = [];
      let falhaLicenca = false;
      if (await republicaEconomia.modoAtivo(jid)) {
        try {
          licencas = await republicaSocial.registrarLicencasAdocao(
            jid, [pedido.solicitanteId, pedido.parceiroId], filho
          );
          for (const licenca of licencas) {
            await sock.sendMessage(licenca.usuarioId, {
              text: '👶 *LICENÇA PARENTAL POR ADOÇÃO ATIVADA*\n\n' +
                'A adoção foi confirmada e você recebeu 48 horas de licença parental.\n' +
                'Remuneração diária prevista: *' + Math.floor(licenca.salarioDiario || 0).toLocaleString('pt-BR') + ' Pratas*.\n' +
                'O Fundo de Licença Parental realiza até dois pagamentos diários conforme o valor salarial apurado. Seu emprego fica protegido durante as 48 horas.',
            }).catch(() => {});
          }
        } catch (erroLicenca) {
          falhaLicenca = true;
          console.error('[handleAdotarFilho] Adoção concluída, mas a licença parental falhou:', erroLicenca?.stack || erroLicenca?.message || erroLicenca);
        }
      }

      const emoji = filho.sexo === 'menino' ? '👦' : '👧';
      return sock.sendMessage(jid, {
        text: '🏡 *ADOÇÃO CONFIRMADA!*\n\n' +
          emoji + ' *' + filho.nome + '* passou a fazer parte da família.\n' +
          '✨ Personalidade: *' + filho.personalidade + '*\n' +
          '👨‍👩‍👧 Os dois responsáveis foram cadastrados e podem usar *' + comandoDoGrupo(msg, 'filho') + '* e *' + comandoDoGrupo(msg, 'cuidarfilho') + '* normalmente.\n' +
          (licencas.length
            ? '👶 *' + licencas.length + '* responsável(is) empregado(s) recebeu(ram) 48 horas de licença parental.'
            : falhaLicenca
              ? '⚠️ A adoção foi concluída, mas não consegui registrar a licença parental. A família foi atualizada; consulte um administrador.'
              : 'ℹ️ Nenhuma licença foi emitida: o Modo República está desligado ou os responsáveis não possuem emprego elegível.'),
        mentions: [pedido.solicitanteId, pedido.parceiroId],
      }, { quoted: msg });
    }

    const totalFilhos = await Filho.countDocuments(filtroFilhos(jid, usuarioIds, parceiroIds));
    if (totalFilhos >= MAX_FILHOS) {
      return sock.sendMessage(jid, {
        text: '❌ Vocês já atingiram o limite de ' + MAX_FILHOS + ' filhos por casal.',
      }, { quoted: msg });
    }

    const chaveCasal = [usuarioId, parceiroId].sort().join('|');
    const agora = new Date();
    await AdocaoSolicitacao.updateMany(
      { idGrupo: jid, chaveCasal, status: 'pendente', expiresAt: { $lte: agora } },
      { $set: { status: 'expirada' } }
    );

    const processosParados = await AdocaoSolicitacao.find({
      idGrupo: jid,
      chaveCasal,
      status: 'processando',
      $or: [
        { processamentoEm: { $lte: new Date(agora.getTime() - 2 * 60 * 1000) } },
        { processamentoEm: null },
      ],
    });
    for (const processo of processosParados) {
      const filhoExistente = await Filho.findOne({ adocaoSolicitacaoId: processo._id });
      if (filhoExistente) {
        await AdocaoSolicitacao.updateOne(
          { _id: processo._id, status: 'processando' },
          { $set: { status: 'aceita', aceitaEm: processo.aceitaEm || agora, filhoId: filhoExistente._id } }
        );
      } else if (!processo.expiresAt || new Date(processo.expiresAt) <= agora) {
        await AdocaoSolicitacao.updateOne(
          { _id: processo._id, status: 'processando' },
          { $set: { status: 'expirada' } }
        );
      } else {
        await AdocaoSolicitacao.updateOne(
          { _id: processo._id, status: 'processando' },
          { $set: { status: 'pendente', processamentoEm: null } }
        );
      }
    }

    const existente = await AdocaoSolicitacao.findOne({
      idGrupo: jid,
      status: { $in: ['pendente', 'processando'] },
      chaveCasal,
    });
    if (existente) return sock.sendMessage(jid, {
      text: '⏳ Já existe um pedido de adoção em andamento para este casal. Código: *' + existente.codigo + '*.',
    }, { quoted: msg });

    const dados = gerarDadosAdocao(argumento);
    let pedido;
    try {
      pedido = await AdocaoSolicitacao.create({
        idGrupo: jid,
        codigo: require('node:crypto').randomBytes(4).toString('hex').toUpperCase(),
        solicitanteId: usuarioId,
        parceiroId,
        chaveCasal: [usuarioId, parceiroId].sort().join('|'),
        ...dados,
        status: 'pendente',
        expiresAt: new Date(Date.now() + PRAZO_ADOCAO_MS),
      });
    } catch (erroCriacao) {
      if (erroCriacao?.code !== 11000) throw erroCriacao;
      const pedidoExistente = await AdocaoSolicitacao.findOne({
        idGrupo: jid,
        chaveCasal: [usuarioId, parceiroId].sort().join('|'),
        status: { $in: ['pendente', 'processando'] },
      });
      if (!pedidoExistente) throw erroCriacao;
      return sock.sendMessage(jid, {
        text: '⏳ Já existe um pedido de adoção em andamento para este casal. Código: *' + pedidoExistente.codigo + '*.',
      }, { quoted: msg });
    }
    return sock.sendMessage(jid, {
      text: '🏡 *PEDIDO DE ADOÇÃO ENVIADO*\n\n' +
        '👶 Criança: *' + pedido.nome + '* (' + pedido.sexo + ')\n' +
        '📋 Código: *' + pedido.codigo + '*\n' +
        '⌛ Prazo de confirmação: *15 minutos*.\n\n' +
        '@' + parceiroId.split('@')[0] + ', confirme com *' + comandoDoGrupo(msg, 'adotarfilho', 'aceitar ' + pedido.codigo) + '* ou recuse com *' + comandoDoGrupo(msg, 'adotarfilho', 'recusar ' + pedido.codigo) + '*.\n' +
        'Quem iniciou o pedido pode cancelá-lo com *' + comandoDoGrupo(msg, 'adotarfilho', 'cancelar ' + pedido.codigo) + '*.',
      mentions: [parceiroId, usuarioId],
    }, { quoted: msg });
  } catch (erro) {
    console.error('[handleAdotarFilho] Erro:', erro?.stack || erro?.message || erro);
    const mensagem = /no máximo\s+\d+\s+caracteres/i.test(String(erro?.message || ''))
      ? '⚠️ ' + erro.message
      : '⚠️ Ocorreu uma falha ao processar a adoção. Tente novamente; se o problema persistir, avise um administrador.';
    return sock.sendMessage(jid, { text: mensagem }, { quoted: msg }).catch(() => {});
  }
}

// ─── !filho ───────────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo — guarda compartilhada
// só vale enquanto o casal estiver separado.
async function handleVerFilho(sock, msg, jid) {
  try {
    const userIds = await resolverIdentidadesRemetente(msg, sock);
    // .sort() mantém a numeração igual à usada por /renomearfilho.
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userIds)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, {
        text: '👶 Você ainda não tem filhos! Use *' + comandoDoGrupo(msg, 'tentarfilho') + '* para tentar (é necessário ter um relacionamento ativo neste grupo).',
      }, { quoted: msg });
    }

    let texto = `👨‍👩‍👧‍👦 *SEUS FILHOS* (${filhos.length} no grupo)\n\n`;

    for (let i = 0; i < filhos.length; i++) {
      const filho   = filhos[i];
      const idade   = formatarIdade(filho.nascidoEm);
      const emoji   = filho.sexo === 'menino' ? '👦' : '👧';
      const guarda  = await atualizarGuarda(filho, sock);

      let guardaStr;
      if (guarda === null) {
        guardaStr = 'compartilhada (vocês estão juntos)';
      } else if (identidadesSeSobrepoem(userIds, [guarda])) {
        guardaStr = 'com você hoje';
      } else {
        guardaStr = 'com o outro responsável hoje';
      }

      const doente = filho.doente ? '\n⚠️ *DOENTE!* Use *' + comandoDoGrupo(msg, 'remediofil') + '* para tratar.' : '';

      texto +=
        `*${i + 1}.* ${emoji} *${filho.nome}* — ${idade}\n` +
        `✨ ${filho.personalidade}\n` +
        `😊 Felicidade : ${statusBar(filho.felicidade)}\n` +
        `🍽️ Fome       : ${statusBar(filho.fome)}\n` +
        `😴 Sono       : ${statusBar(filho.sono)}\n` +
        `🎈 Alegria    : ${statusBar(filho.alegria)}\n` +
        `🏠 Guarda     : *${guardaStr}*` +
        doente +
        `\n\n`;
    }

    texto += `_Use *${comandoDoGrupo(msg, 'renomearfilho')}* para dar um novo nome a um deles._`;

    return sock.sendMessage(jid, { text: texto.trim() }, { quoted: msg });
  } catch (e) {
    console.error('[handleVerFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao buscar seus filhos. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !cuidarfilho ─────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo. Se o casal está junto,
// guarda é livre (null) e qualquer um dos pais pode cuidar. Se separados,
// só quem está com a guarda no dia pode cuidar.
async function handleCuidarFilho(sock, msg, jid) {
  try {
    const userIds = await resolverIdentidadesRemetente(msg, sock);
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userIds)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, { text: '👶 Você não tem filhos ainda!' }, { quoted: msg });
    }

    const agora = Date.now();
    let texto = `💝 *CUIDANDO DOS FILHOS*\n\n`;
    let algumCuidado = false;
    let algumIndisponivel = false;

    for (const filho of filhos) {
      const guarda = await atualizarGuarda(filho, sock);

      // guarda === null → casal junto, guarda livre, qualquer um cuida.
      // guarda !== null → separados, só quem está com a guarda cuida.
      if (guarda !== null && !identidadesSeSobrepoem(userIds, [guarda])) {        texto += `👶 *${filho.nome}* está sob os cuidados do outro responsável hoje.\n\n`;
        algumIndisponivel = true;
        continue;
      }

      // Cooldown
      if (filho.ultimoCuidado && agora - new Date(filho.ultimoCuidado).getTime() < COOLDOWN_CUIDAR) {
        const restante = COOLDOWN_CUIDAR - (agora - new Date(filho.ultimoCuidado).getTime());
        texto += `👶 *${filho.nome}* já recebeu cuidados. Você poderá cuidar novamente em *${formatarTempo(restante)}*.\n\n`;
        algumIndisponivel = true;
        continue;
      }

      // Cuida
      filho.felicidade = Math.min(100, filho.felicidade + 20);
      filho.fome       = Math.min(100, filho.fome       + 25);
      filho.sono       = Math.min(100, filho.sono       + 20);
      filho.alegria    = Math.min(100, filho.alegria    + 20);
      filho.ultimoCuidado = new Date();
      await filho.save();

      algumCuidado = true;
      const emoji = filho.sexo === 'menino' ? '👦' : '👧';

      texto +=
        `${emoji} *${filho.nome}* foi cuidado(a)!\n` +
        `😊 Felicidade : ${statusBar(filho.felicidade)}\n` +
        `🍽️ Fome       : ${statusBar(filho.fome)}\n` +
        `😴 Sono       : ${statusBar(filho.sono)}\n` +
        `🎈 Alegria    : ${statusBar(filho.alegria)}\n\n`;
    }

    if (!algumCuidado && !algumIndisponivel) {
      texto += 'Nenhum filho disponível para cuidar agora.';
    }

    return sock.sendMessage(jid, { text: texto.trim() }, { quoted: msg });
  } catch (e) {
    console.error('[handleCuidarFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao cuidar dos filhos. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !remediofil ─────────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo.
async function handleRemedioFilho(sock, msg, jid) {
  const userId = msg.key.participant || msg.key.remoteJid;

  try {
    const userIds = await resolverIdentidadesRemetente(msg, sock);
    const filhoDoente = await Filho.findOne({
      ...filtroFilhosPorPai(jid, userIds),
      doente: true,
    });

    if (!filhoDoente) {
      return sock.sendMessage(jid, { text: '✅ Nenhum filho doente no momento!' }, { quoted: msg });
    }

    // Conta vinculada ao app: a Prata do grupo não vale mais (o saldo vive no app).
    const userIdCarteira = await resolverJidCarteira(userId, jid);
    // Débito atômico — evita corrida com outros comandos de gold
    const carteiraAtualizada = await CarteiraGrupo.findOneAndUpdate(
      { idWhatsApp: userIdCarteira, idGrupo: jid, gold: { $gte: CUSTO_REMEDIO } },
      { $inc: { gold: -CUSTO_REMEDIO } },
      { new: true }
    );

    if (!carteiraAtualizada) {
      const carteira = await CarteiraGrupo.findOne({ idWhatsApp: userIdCarteira, idGrupo: jid }).lean();
      return sock.sendMessage(jid, {
        text: `❌ Você precisa de *${formatarSaldo(CUSTO_REMEDIO, carteira)}* para comprar o remédio! Seu saldo é *${formatarSaldo(carteira?.gold ?? 0, carteira)}*.`,
      }, { quoted: msg });
    }

    filhoDoente.doente     = false;
    filhoDoente.felicidade = 60;
    filhoDoente.fome       = 60;
    filhoDoente.sono       = 60;
    filhoDoente.alegria    = 60;

    try {
      await filhoDoente.save();
    } catch (e) {
      // Reverte o débito se não conseguir salvar o filho
      await alterarGold(userIdCarteira, jid, CUSTO_REMEDIO, 'Estorno do remédio para filho');
      throw e;
    }

    const emoji = filhoDoente.sexo === 'menino' ? '👦' : '👧';

    return sock.sendMessage(jid, {
      text:
        `💊 *${filhoDoente.nome}* foi curado(a)!\n\n` +
        `${emoji} Já está se sentindo melhor.\n` +
        `💰 Gasto: *${formatarSaldo(CUSTO_REMEDIO, carteiraAtualizada)}*\n\n` +
        `😊 Felicidade : ${statusBar(60)}\n` +
        `🍽️ Fome       : ${statusBar(60)}\n` +
        `😴 Sono       : ${statusBar(60)}\n` +
        `🎈 Alegria    : ${statusBar(60)}`,
    }, { quoted: msg });
  } catch (e) {
    console.error('[handleRemedioFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao curar o filho. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── !renomearfilho ───────────────────────────────────────────────────────────
// Funciona independente de relacionamento ativo e independente de guarda —
// dar nome não depende do cooldown de cuidado, então qualquer um dos pais pode.

async function _aplicarRenome(sock, msg, jid, filho, novoNomeRaw) {
  const novoNome = novoNomeRaw.trim();

  if (!novoNome) {
    return sock.sendMessage(jid, { text: '⚠️ O novo nome não pode ser vazio.' }, { quoted: msg });
  }
  if (novoNome.length > RENOMEAR_MAX_LEN) {
    return sock.sendMessage(jid, {
      text: `⚠️ O nome deve ter no máximo *${RENOMEAR_MAX_LEN} caracteres*.`,
    }, { quoted: msg });
  }
  if (/[\n@]/.test(novoNome)) {
    return sock.sendMessage(jid, {
      text: '⚠️ O nome não pode conter quebra de linha nem "@".',
    }, { quoted: msg });
  }

  const nomeAntigo = filho.nome;
  filho.nome = novoNome;
  await filho.save();

  const emoji = filho.sexo === 'menino' ? '👦' : '👧';
  return sock.sendMessage(jid, {
    text: `✅ ${emoji} *${nomeAntigo}* agora se chama *${novoNome}*!`,
  }, { quoted: msg });
}

async function handleRenomearFilho(sock, msg, jid, args) {
  try {
    const userIds = await resolverIdentidadesRemetente(msg, sock);
    const filhos = await Filho.find(filtroFilhosPorPai(jid, userIds)).sort({ nascidoEm: 1 });

    if (filhos.length === 0) {
      return sock.sendMessage(jid, { text: '👶 Você não tem filhos ainda!' }, { quoted: msg });
    }

    const texto = (args || '').trim();

    // ── Um único filho: !renomearfilho <novo nome> ────────────────────────────
    if (filhos.length === 1) {
      if (!texto) {
        return sock.sendMessage(jid, {
          text: `✏️ Use: *${comandoDoGrupo(msg, 'renomearfilho', '<novo nome>')}*\nExemplo: *${comandoDoGrupo(msg, 'renomearfilho', 'Enzo')}*`,
        }, { quoted: msg });
      }
      return _aplicarRenome(sock, msg, jid, filhos[0], texto);
    }

    // ── Vários filhos: !renomearfilho <número> <novo nome> ────────────────────
    const match = texto.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      const lista = filhos.map((f, i) => `  *${i + 1}.* ${f.nome}`).join('\n');
      return sock.sendMessage(jid, {
        text:
          `✏️ Você tem mais de um filho! Use:\n*${comandoDoGrupo(msg, 'renomearfilho', '<número> <novo nome>')}*\n\n` +
          `Seus filhos:\n${lista}`,
      }, { quoted: msg });
    }

    const indice    = parseInt(match[1], 10) - 1;
    const filhoAlvo = filhos[indice];

    if (!filhoAlvo) {
      return sock.sendMessage(jid, {
        text: `❌ Número inválido! Use *${comandoDoGrupo(msg, 'filho')}* para ver a lista numerada novamente.`,
      }, { quoted: msg });
    }

    return _aplicarRenome(sock, msg, jid, filhoAlvo, match[2]);

  } catch (e) {
    console.error('[handleRenomearFilho] Erro:', e.message);
    return sock.sendMessage(jid, { text: '⚠️ Erro ao renomear o filho. Tente novamente.' }, { quoted: msg }).catch(() => {});
  }
}

// ─── DECAY DOS ATRIBUTOS (a cada 6 horas, via scheduler) ─────────────────────
async function decayFilhos() {
  try {
    const result = await Filho.updateMany({}, [
      {
        $set: {
          felicidade: { $max: [0, { $subtract: ['$felicidade', 10] }] },
          fome:       { $max: [0, { $subtract: ['$fome', 15] }] },
          sono:       { $max: [0, { $subtract: ['$sono', 10] }] },
          alegria:    { $max: [0, { $subtract: ['$alegria', 10] }] },
        },
      },
    ]);

    // Marca como doente quem ficou com felicidade 0
    await Filho.updateMany(
      { felicidade: 0, doente: false },
      { $set: { doente: true } }
    );

    console.log(`[Filhos] Decay aplicado em ${result.modifiedCount} filho(s).`);
  } catch (e) {
    console.error('[Filhos] Erro no decay:', e.message);
  }
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────
function initFilhosScheduler() {
  // Decay a cada 6 horas
  setInterval(decayFilhos, 6 * 60 * 60 * 1000);
  console.log('[FilhosScheduler] Iniciado.');
}

module.exports = {
  handleTentarFilho,
  handleAdotarFilho,
  handleVerFilho,
  handleCuidarFilho,
  handleRemedioFilho,
  handleRenomearFilho,
  initFilhosScheduler,
  _normalizarListaJids: normalizarListaJids,
  _identidadesSeSobrepoem: identidadesSeSobrepoem,
  _avaliarParticipacaoPedidoAdocao: avaliarParticipacaoPedidoAdocao,
  _obterPrefixoComando: obterPrefixoComando,
  _filtroFilhos: filtroFilhos,
  _filtroFilhosPorPai: filtroFilhosPorPai,
};