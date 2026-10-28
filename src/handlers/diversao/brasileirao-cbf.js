'use strict';

const CBF_BASE = 'https://www.cbf.com.br/futebol-brasileiro/tabelas/campeonato-brasileiro';

// IDs das fases de 2026. Podem ser sobrescritos por variável de ambiente se a CBF mudar as rotas.
const ROTAS_CBF = {
  C: { env: 'BRASILEIRAO_CBF_SERIE_C_URL', url: `${CBF_BASE}/serie-c/2026/2098`, etapa: '2ª FASE' },
  D: { env: 'BRASILEIRAO_CBF_SERIE_D_URL', url: `${CBF_BASE}/serie-d/2026/2040`, etapa: '1ª FASE · GRUPOS' },
};

function decodeHtml(texto) {
  return String(texto || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function textoHtml(fragmento) {
  return decodeHtml(String(fragmento || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}

function parseTabelaCBF(html) {
  const tabelas = [];
  const regexTabela = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match;

  while ((match = regexTabela.exec(html))) {
    const conteudo = match[1];
    if (!/styles_teamName__/.test(conteudo)) continue;

    const cabecalhos = [...html.slice(0, match.index).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
    let grupo = '';
    for (let i = cabecalhos.length - 1; i >= 0; i--) {
      const candidato = textoHtml(cabecalhos[i][1]);
      if (/^GRUPO\s+/i.test(candidato)) { grupo = candidato; break; }
    }
    if (!grupo) continue;

    const entradas = [];
    const linhas = conteudo.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const linha of linhas) {
      const nomeMatch = linha.match(/<strong\b[^>]*class="[^"]*styles_teamName__[^"]*"[^>]*>([\s\S]*?)<\/strong>/i);
      if (!nomeMatch) continue;
      const posMatch = linha.match(/<strong\b[^>]*class="[^"]*styles_position__[^"]*"[^>]*>([\s\S]*?)<\/strong>/i);
      const celulas = [...linha.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x => textoHtml(x[1]));
      const nums = celulas.slice(1).map(x => {
        const n = Number(String(x).replace(',', '.').replace(/[^\d+.-]/g, ''));
        return Number.isFinite(n) ? n : 0;
      });
      if (!posMatch || nums.length < 8) continue;

      entradas.push({
        position: Number(textoHtml(posMatch[1])) || entradas.length + 1,
        team: { name: textoHtml(nomeMatch[1]) },
        points: nums[0] || 0,
        matches: nums[1] || 0,
        wins: nums[2] || 0,
        draws: nums[3] || 0,
        losses: nums[4] || 0,
        goalsFor: nums[5] || 0,
        goalsAgainst: nums[6] || 0,
        goalDifference: nums[7] || 0,
      });
    }

    if (entradas.length) tabelas.push({ name: grupo, entries: entradas });
  }

  return tabelas;
}

function parseTabelaCBFMarkdown(markdown) {
  const texto = String(markdown || '');
  const cabecalhos = [...texto.matchAll(/^##\s+(GRUPO\s+[A-Z0-9]+)\s*$/gim)];
  const tabelas = [];

  for (let i = 0; i < cabecalhos.length; i++) {
    const inicio = cabecalhos[i].index + cabecalhos[i][0].length;
    const fim = cabecalhos[i + 1]?.index ?? texto.length;
    const bloco = texto.slice(inicio, fim);
    const entradas = [];

    for (const linha of bloco.split(/\r?\n/)) {
      if (!/^\s*\|\s*\*\*\d+\*\*/.test(linha)) continue;
      const celulas = linha.split('|').slice(1, -1).map(c => c.trim());
      if (celulas.length < 9) continue;

      const posicao = Number(celulas[0].match(/^\*\*(\d+)\*\*/)?.[1]);
      const nome = celulas[0].match(/\*\*([^*]+)\*\*\]\(/)?.[1];
      const numeros = celulas.slice(1).map(c => {
        const n = Number(String(c).replace(',', '.').replace(/[^\d+.-]/g, ''));
        return Number.isFinite(n) ? n : null;
      });
      if (!posicao || !nome || numeros.slice(0, 8).some(n => n === null)) continue;

      entradas.push({
        position: posicao,
        team: { name: nome.trim() },
        points: numeros[0],
        matches: numeros[1],
        wins: numeros[2],
        draws: numeros[3],
        losses: numeros[4],
        goalsFor: numeros[5],
        goalsAgainst: numeros[6],
        goalDifference: numeros[7],
      });
    }

    if (entradas.length) tabelas.push({ name: cabecalhos[i][1].trim(), entries: entradas });
  }

  return tabelas;
}

async function buscarTabelaCBF(divisao, temporada = new Date().getFullYear(), fetchImpl = globalThis.fetch) {
  const rota = ROTAS_CBF[divisao];
  if (!rota) return null;
  const urlConfigurada = process.env[rota.env];
  const url = urlConfigurada || rota.url;
  const anoUrl = url.match(/\/(20\d{2})\//)?.[1];
  if (!urlConfigurada && Number(temporada) !== Number(anoUrl)) {
    throw new Error(`Fallback oficial da CBF ainda não configurado para a temporada ${temporada}`);
  }

  let tabelas = [];
  let erroDireto = null;

  try {
    const resposta = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; TicoBot/1.0; tabela de futebol)',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resposta.ok) throw new Error(`CBF respondeu HTTP ${resposta.status}`);
    tabelas = parseTabelaCBF(await resposta.text());
  } catch (err) {
    erroDireto = err;
  }

  if (!tabelas.length) {
    // A CBF pode apresentar uma cadeia TLS incompleta em alguns ambientes Node.
    // O fallback usa um leitor HTTP externo sem desativar a validação HTTPS do bot.
    const urlCBF = new URL(url);
    if (!(urlCBF.hostname === 'cbf.com.br' || urlCBF.hostname.endsWith('.cbf.com.br'))) {
      throw erroDireto || new Error('A fonte configurada não é um domínio oficial da CBF');
    }

    const urlLeitor = `https://r.jina.ai/http://${urlCBF.host}${urlCBF.pathname}${urlCBF.search}`;
    try {
      const respostaLeitor = await fetchImpl(urlLeitor, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'Mozilla/5.0 (compatible; TicoBot/1.0; tabela de futebol)',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!respostaLeitor.ok) throw new Error(`Leitor de página respondeu HTTP ${respostaLeitor.status}`);
      tabelas = parseTabelaCBFMarkdown(await respostaLeitor.text());
    } catch (errLeitor) {
      const motivo = erroDireto?.message || 'a CBF não retornou tabelas reconhecíveis';
      throw new Error(`Falha na CBF (${motivo}) e no fallback de leitura (${errLeitor.message})`);
    }
  }

  if (!tabelas.length) throw new Error('A página oficial da CBF não trouxe tabelas reconhecíveis');

  return {
    temporada: Number(anoUrl) || Number(temporada),
    etapa: rota.etapa,
    tabelas,
    url,
  };
}

module.exports = { buscarTabelaCBF, parseTabelaCBF, parseTabelaCBFMarkdown };
