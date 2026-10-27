'use strict';

const path = require('path');

async function safeReact(sock, jid, msgKey, emoji) {
  try {
    await sock.sendMessage(jid, { react: { text: emoji, key: msgKey } });
  } catch {}
}

async function handleCep(sock, msg, jid, caption) {
  const cep = caption.replace(/^[!.,\/#]cep\s*/i, '').trim().replace(/\D/g, '');
  if (!cep || cep.length !== 8) {
    await sock.sendMessage(jid, { text: '⚠️ Digite um CEP válido (8 dígitos).' }, { quoted: msg });
    return;
  }
  await safeReact(sock, jid, msg.key, '⏳');
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.erro) {
      await safeReact(sock, jid, msg.key, '❌');
      await sock.sendMessage(jid, { text: `❌ CEP *${cep}* não encontrado.` }, { quoted: msg });
      return;
    }
    const texto = [
      `📍 *CEP ${data.cep}*`,
      `🏡 *Logradouro:* ${data.logradouro || '—'}`,
      `🏘️ *Bairro:* ${data.bairro || '—'}`,
      `🏙️ *Cidade:* ${data.localidade} - ${data.uf}`,
      `📞 *DDD:* ${data.ddd || '—'}`,
    ].join('\n');
    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: '❌ Não consegui consultar este CEP.' }, { quoted: msg });
  }
}

async function handleClima(sock, msg, jid, caption) {
  const cidade = caption.replace(/^[!.,\/#]clima\s*/i, '').trim();
  if (!cidade) {
    await sock.sendMessage(jid, { text: '⚠️ Digite a cidade.\nExemplo: *!clima São Paulo*' }, { quoted: msg });
    return;
  }
  await safeReact(sock, jid, msg.key, '⏳');
  try {
    const url = `https://wttr.in/${encodeURIComponent(cidade)}?format=j1&lang=pt`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cur  = data.current_condition?.[0];
    if (!cur) throw new Error('Sem dados de clima');

    const desc  = cur.lang_pt?.[0]?.value || cur.weatherDesc?.[0]?.value || '—';
    const temp  = cur.temp_C          ?? '—';
    const sens  = cur.FeelsLikeC      ?? '—';
    const umid  = cur.humidity        ?? '—';
    const vento = cur.windspeedKmph   ?? '—';
    const uv    = cur.uvIndex         ?? '—';
    const vis   = cur.visibility      ?? '—';
    const press = cur.pressure        ?? '—';

    const area  = data.nearest_area?.[0];
    const local = area
      ? `${area.areaName?.[0]?.value || ''}, ${area.country?.[0]?.value || ''}`.replace(/^,\s*|,\s*$/g, '')
      : cidade;

    const t = Number(temp);
    const emoji =
      t >= 35 ? '🔥' :
      t >= 28 ? '🥵' :
      t >= 20 ? '☀️' :
      t >= 10 ? '🌤️' :
      t >= 0  ? '🧊' : '🥶';

    const texto = [
      `${emoji} *Clima em ${local}*`,
      '',
      `🌡️ *Temperatura:* ${temp}°C`,
      `🤔 *Sensação térmica:* ${sens}°C`,
      `📋 *Condição:* ${desc}`,
      `💧 *Umidade:* ${umid}%`,
      `💨 *Vento:* ${vento} km/h`,
      `☀️ *Índice UV:* ${uv}`,
      `👁️ *Visibilidade:* ${vis} km`,
      `🔵 *Pressão:* ${press} hPa`,
    ].join('\n');

    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch (err) {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: `❌ Não consegui obter o clima de *${cidade}*.` }, { quoted: msg });
  }
}

async function handleMoeda(sock, msg, jid, caption) {
  const input = caption.replace(/^[!.,\/#]moeda\s*/i, '').trim();
  const parts = input.split(/\s+/);
  if (parts.length < 3) {
    await sock.sendMessage(jid, { text: '⚠️ Uso: *!moeda [valor] [de] [para]*\nExemplo: *!moeda 100 USD BRL*' }, { quoted: msg });
    return;
  }
  const valor = parseFloat(parts[0].replace(',', '.'));
  const de    = parts[1].toUpperCase();
  const para  = parts[2].toUpperCase();

  if (isNaN(valor) || valor <= 0 || de.length !== 3 || para.length !== 3) {
    await sock.sendMessage(jid, { text: '⚠️ Valor ou código de moeda inválido. Ex: *!moeda 100 USD BRL*' }, { quoted: msg });
    return;
  }

  await safeReact(sock, jid, msg.key, '⏳');

  try {
    const url = `https://api.exchangerate-api.com/v4/latest/${de}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const taxa = data.rates?.[para];
    if (!taxa) throw new Error(`Par ${de}/${para} não encontrado`);

    const resultado   = (valor * taxa).toFixed(2);
    const taxaInversa = (1 / taxa).toFixed(4);
    const atualizado  = data.date ?? '—';

    const fmtValor     = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const fmtResultado = parseFloat(resultado).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const texto = [
      `💱 *Conversão de Moeda*`,
      '',
      `💵 *${fmtValor} ${de}* = *${fmtResultado} ${para}*`,
      '',
      `📊 *Taxa:* 1 ${de} = ${taxa.toFixed(4)} ${para}`,
      `🔁 *Inversa:* 1 ${para} = ${taxaInversa} ${de}`,
      `📅 *Atualizado em:* ${atualizado}`,
    ].join('\n');

    await sock.sendMessage(jid, { text: texto }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: `❌ Não consegui converter *${de}* para *${para}*.` }, { quoted: msg });
  }
}

async function handleCalcular(sock, msg, jid, caption) {
  const expr = caption.replace(/^[!.,\/#]calcular\s*/i, '').trim();
  if (!expr || !/^[\d\s+\-*/().%^,]+$/.test(expr)) {
    await sock.sendMessage(jid, { text: '⚠️ Digite uma expressão válida. Ex: *!calcular 15 * 3 + 2*' }, { quoted: msg });
    return;
  }
  try {
    const safeExpr = expr.replace(/,/g, '.').replace(/\^/g, '**');
    const resultado = Function(`'use strict'; return (${safeExpr})`)();
    if (typeof resultado !== 'number' || !isFinite(resultado)) throw new Error('Inválido');
    const fmtResultado = parseFloat(resultado.toPrecision(12)).toString();
    await sock.sendMessage(jid, { text: `🧮 *Resultado:* *${fmtResultado}*` }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, { text: '❌ Erro de cálculo. Verifique a expressão.' }, { quoted: msg });
  }
}

// Mapa de códigos ISO suportados. Fica fora da função pra ser reutilizado
// tanto na formatação da resposta quanto na validação de entrada.
const NOMES_IDIOMA = {
  en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano',
  ja: 'Japonês', zh: 'Chinês', ru: 'Russo', ar: 'Árabe', pt: 'Português',
  ko: 'Coreano', nl: 'Holandês', pl: 'Polonês', tr: 'Turco', hi: 'Hindi',
};

// Permite que o usuário digite o nome do idioma em português (sem acento),
// já que é mais natural pra quem fala PT-BR do que decorar código ISO.
const ALIASES_IDIOMA = {
  ingles: 'en', english: 'en',
  espanhol: 'es', spanish: 'es', castelhano: 'es',
  frances: 'fr', french: 'fr',
  alemao: 'de', german: 'de',
  italiano: 'it', italian: 'it',
  japones: 'ja', japanese: 'ja',
  chines: 'zh', chinese: 'zh', mandarim: 'zh',
  russo: 'ru', russian: 'ru',
  arabe: 'ar', arabic: 'ar',
  portugues: 'pt', portuguese: 'pt',
  coreano: 'ko', korean: 'ko',
  holandes: 'nl', dutch: 'nl',
  polones: 'pl', polish: 'pl',
  turco: 'tr', turkish: 'tr',
  hindi: 'hi',
};

function removerAcentos(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Resolve um token digitado (código ISO ou nome em português/inglês) pro
// código ISO correspondente. Retorna null se não reconhecer — isso é o que
// evita o bug antigo de tratar qualquer palavra de 2-3 letras como idioma.
function resolverIdioma(token) {
  if (!token) return null;
  const codigo = token.toLowerCase();
  if (NOMES_IDIOMA[codigo]) return codigo;
  const semAcento = removerAcentos(codigo);
  return ALIASES_IDIOMA[semAcento] ?? null;
}

async function handleTraduzir(sock, msg, jid, caption) {
  const raw = caption.replace(/^[!.,\/#]traduzir\s*/i, '').trim();
  const primeiraPalavra = raw.split(/\s+/)[0] || '';

  let origem = 'pt';
  let destino = 'en';
  let texto = raw;

  // Formato "origem-destino" (ex: en-es, ingles-espanhol) — controle explícito dos dois lados
  if (primeiraPalavra.includes('-')) {
    const [tokenOrigem, tokenDestino] = primeiraPalavra.split('-');
    const codOrigem = resolverIdioma(tokenOrigem);
    const codDestino = resolverIdioma(tokenDestino);
    if (codOrigem && codDestino) {
      origem = codOrigem;
      destino = codDestino;
      texto = raw.slice(primeiraPalavra.length).trim();
    }
  } else {
    // Formato de um único idioma (ex: en, espanhol) — esse token é sempre a
    // ORIGEM do texto, nunca o destino. Antes o código assumia que o texto
    // já estava em português e traduzia PARA o idioma informado — por isso
    // "!traduzir en dog" traduzia pt->en, e como "dog" não é português,
    // voltava em inglês mesmo (dando a impressão de que não traduzia).
    // Agora: se a origem for português, o destino vira inglês; caso
    // contrário, o destino vira português — o sentido natural de uso.
    const codOrigem = resolverIdioma(primeiraPalavra);
    if (codOrigem) {
      origem = codOrigem;
      destino = codOrigem === 'pt' ? 'en' : 'pt';
      texto = raw.slice(primeiraPalavra.length).trim();
    }
  }

  // Suporte a mensagem citada (reply) se nenhum texto direto foi fornecido
  if (!texto) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      texto =
        quotedMsg.conversation ||
        quotedMsg.extendedTextMessage?.text ||
        quotedMsg.imageMessage?.caption ||
        quotedMsg.videoMessage?.caption ||
        '';
    }
  }

  if (!texto) {
    await sock.sendMessage(jid, {
      text: '⚠️ Use: *!traduzir [idioma-do-texto] [texto]* ou responda a uma mensagem com *!traduzir [idioma-do-texto]*.\n' +
            'O idioma informado é o idioma ORIGINAL do texto — o destino é escolhido automaticamente (português ↔ outro idioma).\n' +
            'Exemplo: *!traduzir en dog* → traduz do inglês para o português\n' +
            'Sem idioma, assume que o texto está em português: *!traduzir Bom dia* → traduz para o inglês\n' +
            'Também aceita nomes em português: *!traduzir espanhol hola*\n' +
            'Para escolher os dois lados manualmente: *!traduzir en-es Good morning*',
    }, { quoted: msg });
    return;
  }

  if (origem === destino) {
    await sock.sendMessage(jid, { text: '⚠️ O idioma de origem e o de destino são o mesmo.' }, { quoted: msg });
    return;
  }

  // A API tem limite de ~500 caracteres por requisição anônima.
  const LIMITE_CARACTERES = 500;
  let truncado = false;
  if (texto.length > LIMITE_CARACTERES) {
    texto = texto.slice(0, LIMITE_CARACTERES);
    truncado = true;
  }

  await safeReact(sock, jid, msg.key, '⏳');
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=${origem}|${destino}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.responseStatus && Number(data.responseStatus) !== 200) {
      throw new Error(`API retornou status ${data.responseStatus}`);
    }

    const traduzido = data?.responseData?.translatedText?.trim();
    // A MyMemory às vezes devolve HTTP 200 com um aviso de cota estourada
    // no lugar da tradução — sem esse checar, isso ia direto pro usuário.
    if (!traduzido || /MYMEMORY WARNING/i.test(traduzido)) {
      throw new Error('Cota da API excedida ou sem tradução disponível');
    }

    const nomeOrigem = NOMES_IDIOMA[origem] ?? origem.toUpperCase();
    const nomeDestino = NOMES_IDIOMA[destino] ?? destino.toUpperCase();
    const aviso = truncado ? `\n\n_(texto cortado em ${LIMITE_CARACTERES} caracteres)_` : '';

    await sock.sendMessage(jid, {
      text: `🌐 *Tradução (${nomeOrigem} → ${nomeDestino}):*\n\n*${traduzido}*${aviso}`,
    }, { quoted: msg });
    await safeReact(sock, jid, msg.key, '✅');
  } catch {
    await safeReact(sock, jid, msg.key, '❌');
    await sock.sendMessage(jid, { text: '❌ Erro ao traduzir o texto. Tente novamente em instantes.' }, { quoted: msg });
  }
}

module.exports = {
  handleCep,
  handleClima,
  handleMoeda,
  handleCalcular,
  handleTraduzir,
};
