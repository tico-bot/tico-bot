'use strict';

// Integração do Tico com a Futebol API própria.
// Em desenvolvimento usa localhost; em produção configure FUTEBOL_API_URL.
const DEFAULT_API_URL = 'https://brasileirao-api-dczc.onrender.com';
const TIME_ZONE = 'America/Cuiaba';
const API_TIMEOUT_MS = 10000;

function getApiBaseUrl() {
  const configured = String(process.env.FUTEBOL_API_URL || process.env.BRASILEIRAO_API_URL || '')
    .trim().replace(/\/+$/, '');
  // Prevent an old localhost setting from breaking the bot on Render.
  if (!configured || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(configured)) {
    return DEFAULT_API_URL;
  }
  return configured;
}

function getApiHeaders() {
  const headers = { Accept: 'application/json' };
  const key = process.env.FUTEBOL_API_KEY || process.env.BRASILEIRAO_API_KEY;
  if (key) headers['X-API-Key'] = key;
  return headers;
}

function apiError(message, code) {
  const error = new Error(message);
  error.code = code || 'FOOTBALL_API_ERROR';
  return error;
}

function directFootballDataPath(endpoint) {
  const parsed = new URL(endpoint, 'https://api.local');
  if (!parsed.pathname.startsWith('/api/futebol/')) return null;
  const apiPath = parsed.pathname.slice('/api/futebol'.length);
  if (apiPath === '/competitions') return null; // The public API already serves this catalogue without a key.
  return '/v4' + apiPath + parsed.search;
}

async function requestFootballDataDirect(endpoint) {
  const token = process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_API_KEY;
  if (!token) {
    throw apiError(
      'O servidor da API está online, mas o provedor internacional não está configurado. Configure FOOTBALL_DATA_API_KEY no ambiente do Tico.',
      'PROVIDER_NOT_CONFIGURED'
    );
  }
  const path = directFootballDataPath(endpoint);
  if (!path) throw apiError('Esta consulta não tem fallback direto disponível.', 'DIRECT_FALLBACK_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, 'https://api.football-data.org'), {
      headers: { Accept: 'application/json', 'X-Auth-Token': token },
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = response.status === 403 || response.status === 401
        ? 'A chave FOOTBALL_DATA_API_KEY foi recusada ou não tem acesso a esta competição.'
        : (data?.message || ('football-data.org respondeu com HTTP ' + response.status + '.'));
      throw apiError(message, response.status === 403 || response.status === 401 ? 'PROVIDER_AUTH_ERROR' : 'PROVIDER_HTTP_ERROR');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw apiError('O provedor internacional demorou para responder.', 'FOOTBALL_API_TIMEOUT');
    if (error.code) throw error;
    throw apiError('Não consegui conectar ao provedor internacional de futebol.', 'PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

async function requestApi(endpoint) {
  const url = new URL(endpoint, getApiBaseUrl() + '/');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: getApiHeaders(), signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      // Brazilian tables/matches always come from our API. The public deployment's
      // international provider may lack its key, so international requests fall back
      // to the same football-data.org provider using the bot's existing environment key.
      if (payload?.error?.code === 'PROVIDER_NOT_CONFIGURED' && endpoint.startsWith('/api/futebol/')) {
        return requestFootballDataDirect(endpoint);
      }
      throw apiError(payload?.error?.message || ('A API respondeu com HTTP ' + response.status + '.'), payload?.error?.code || ('HTTP_' + response.status));
    }
    return payload.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw apiError('A API demorou para responder. Tente novamente em instantes.', 'FOOTBALL_API_TIMEOUT');
    }
    if (error.code) throw error;
    throw apiError('Não consegui conectar à nossa API. Confira se ela está online e se FUTEBOL_API_URL aponta para o endereço correto.', 'FOOTBALL_API_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function localDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Number(values.year), Number(values.month) - 1, Number(values.day) + offsetDays);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function displayDate(value) {
  if (!value) return 'data a definir';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function numberOr(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function formatInternationalStandings(data, code) {
  const competition = data?.competition || {};
  const standings = Array.isArray(data?.standings) ? data.standings : [];
  const season = data?.season?.startDate ? ' ' + data.season.startDate.slice(0, 4) : '';
  const lines = [
    '🌍 *' + (competition.name || code.toUpperCase()) + season + '* ⚽',
    '━━━━━━━━━━━━━━━━━━',
    '🏆 *CLASSIFICAÇÃO ATUAL*',
    '',
    '*POS. CLUBE — PTS | J | V | E | D | SG*'
  ];
  let total = 0;
  for (const group of standings) {
    const table = Array.isArray(group?.table) ? group.table : [];
    if (!table.length) continue;
    const groupCode = typeof group.group === 'string' && /^GROUP_[A-Z0-9]+$/.test(group.group)
      ? group.group.replace(/^GROUP_/, 'Grupo ') : null;
    if (standings.length > 1 || groupCode) lines.push('', '📋 *' + (groupCode || (group.type === 'TOTAL' ? 'Classificação geral' : group.type || 'Classificação')) + '*');
    for (const row of table) {
      if (total >= 48) {
        lines.push('', '… classificação abreviada para caber na mensagem.');
        lines.push('━━━━━━━━━━━━━━━━━━');
        return lines.join('\n');
      }
      const team = row.team || {};
      const name = String(team.shortName || team.name || 'Clube').slice(0, 24);
      const pos = numberOr(row.position) || '–';
      const gd = numberOr(row.goalDifference);
      lines.push(String(pos) + '. ' + name + ' — *' + numberOr(row.points) + ' pts* | ' +
        numberOr(row.playedGames) + 'J | ' + numberOr(row.won) + 'V | ' + numberOr(row.draw) +
        'E | ' + numberOr(row.lost) + 'D | SG ' + (gd > 0 ? '+' : '') + gd);
      if (Number(pos) === 4 && ['PL', 'PD', 'BL1', 'SA'].includes(String(code).toUpperCase())) {
        lines.push('━━━━━━━━━━━━━━━━━━', '🏆 *G4 — ZONA DE CLASSIFICAÇÃO*', '━━━━━━━━━━━━━━━━━━');
      }
      total++;
    }
  }
  if (!total) return null;
  lines.push(
    '',
    '📊 *LEGENDA:* Pts = pontos • J = jogos • V = vitórias • E = empates • D = derrotas • SG = saldo de gols',
    '━━━━━━━━━━━━━━━━━━',
    '🔄 _Consultado em ' + new Date().toLocaleString('pt-BR', { timeZone: TIME_ZONE }) + '_'
  );
  return lines.join('\n');
}

function formatMatches(data) {
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  if (!matches.length) return '📅 Não encontrei jogos nesse filtro e período. Tente outra data ou competição.';
  const competitionName = matches.find((match) => match.competition?.name)?.competition?.name;
  const lines = ['⚽ *JOGOS — ' + (competitionName || 'FUTEBOL').toUpperCase() + '*', '━━━━━━━━━━━━━━━━━━'];
  for (const match of matches.slice(0, 35)) {
    const home = match.homeTeam?.shortName || match.homeTeam?.name || 'A definir';
    const away = match.awayTeam?.shortName || match.awayTeam?.name || 'A definir';
    const status = String(match.status || '').toUpperCase();
    const ft = match.score?.fullTime || {};
    const current = match.score?.regularTime || {};
    const scoreHome = ft.home ?? current.home;
    const scoreAway = ft.away ?? current.away;
    const score = scoreHome !== null && scoreHome !== undefined && scoreAway !== null && scoreAway !== undefined
      ? '*' + scoreHome + ' × ' + scoreAway + '*'
      : 'vs';
    const label = status === 'FINISHED' ? '✅ Encerrado'
      : ['IN_PLAY', 'PAUSED', 'LIVE'].includes(status) ? '🔴 Ao vivo'
      : ['POSTPONED', 'SUSPENDED'].includes(status) ? '⚠️ Adiado/suspenso'
      : ['CANCELED', 'CANCELLED'].includes(status) ? '❌ Cancelado' : '🕒 Agendado';
    lines.push('', '📅 ' + displayDate(match.utcDate) + ' — ' + label, home + ' ' + score + ' ' + away);
  }
  if (matches.length > 35) lines.push('', '… e mais ' + (matches.length - 35) + ' partidas.');
  lines.push('━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

const FOOTBALL_LEAGUE_ALIASES = Object.freeze({
  champions: 'CL', ucl: 'CL', premier: 'PL', premierleague: 'PL',
  laliga: 'PD', espanhola: 'PD', bundesliga: 'BL1', alema: 'BL1',
  seriea: 'SA', italiana: 'SA', ligue1: 'FL1', francesa: 'FL1',
  portuguesa: 'PPL', ligaportuguesa: 'PPL', eredivisie: 'DED',
  mundial: 'WC', copadomundo: 'WC'
});

function normalizeAlias(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function resolveFootballAlias(rawCommand, prefixes = ['!', '.', '/', ',']) {
  const word = String(rawCommand || '').trim().toLowerCase();
  const prefix = prefixes.find((item) => item && word.startsWith(item));
  if (!prefix) return null;
  const alias = normalizeAlias(word.slice(prefix.length));
  const wantsMatches = alias.endsWith('jg');
  const base = wantsMatches ? alias.slice(0, -2) : alias;

  // The Brazilian table uses the same handler/data source as !brasileirao;
  // its fixtures use the same rounds endpoint as !rodada.
  if (base === 'brasileirao') {
    return {
      code: 'A',
      action: wantsMatches ? 'brazilian-matches' : 'brazilian-standings'
    };
  }

  const code = FOOTBALL_LEAGUE_ALIASES[base];
  return code ? { code, action: wantsMatches ? 'matches' : 'standings' } : null;
}

async function send(sock, msg, jid, text) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function helpText(prefix = '!') {
  return [
    '╔══════════════════════╗',
    '       ⚽ FUTEBOL · TICO',
    '╚══════════════════════╝',
    '',
    '🇧🇷 *BRASILEIRÃO*',
    '▸ ' + prefix + 'brasileirao / brasileirao A — tabela da Série A',
    '▸ ' + prefix + 'brasileiraojg — jogos da Série A',
    '▸ ' + prefix + 'brasileirao B — tabela da Série B',
    '▸ ' + prefix + 'brasileirao C — tabela da Série C',
    '▸ ' + prefix + 'brasileirao D — tabela da Série D',
    '▸ ' + prefix + 'rodada A — jogos da rodada atual',
    '▸ ' + prefix + 'rodada D A1 — calendário por grupo quando disponível',
    '',
    '🌍 *COMPETIÇÕES*',
    '▸ ' + prefix + 'campeonato — listar competições',
    '▸ ' + prefix + 'campeonato PL — detalhes da liga',
    '▸ ' + prefix + 'classificacao PL — tabela',
    '▸ ' + prefix + 'champions — tabela da Champions League',
    '▸ ' + prefix + 'premier — tabela da Premier League',
    '▸ ' + prefix + 'championsjg — jogos da Champions League',
    '▸ ' + prefix + 'premierjg — jogos da Premier League',
    '▸ ' + prefix + 'laliga / laligajg — tabela / jogos da La Liga',
    '▸ ' + prefix + 'bundesliga / bundesligajg — tabela / jogos da Bundesliga',
    '▸ ' + prefix + 'seriea / serieajg — tabela / jogos da Serie A italiana',
    '▸ ' + prefix + 'ligue1 / ligue1jg — tabela / jogos da Ligue 1',
    '▸ ' + prefix + 'portuguesa / portuguesajg — tabela / jogos da Liga Portuguesa',
    '▸ ' + prefix + 'clubes PL — clubes participantes',
    '▸ ' + prefix + 'artilheiros PL 10 — goleadores',
    '',
    '📅 *PARTIDAS*',
    '▸ ' + prefix + 'jogos — jogos de hoje',
    '▸ ' + prefix + 'jogos PL — Premier League hoje',
    '▸ ' + prefix + 'jogos PL 2026-10-28 2026-10-29 — intervalo',
    '',
    'Códigos: *BSA* Brasileirão A, *PL* Premier League, *PD* La Liga,',
    '*BL1* Bundesliga, *SA* Serie A italiana, *FL1* Ligue 1, *CL* Champions League, *PPL* Liga Portuguesa, *WC* Copa do Mundo.',
    'A classificação da Série D usa a CBF; o calendário da Série D por grupo pode não estar disponível na fonte.',
    '_Dados internacionais dependem da cobertura do provedor._'
  ].join('\n');
}

async function handleFutebol(sock, msg, jid, prefix = '!') {
  return send(sock, msg, jid, helpText(prefix || '!'));
}

async function handleCompetition(sock, msg, jid, args = []) {
  const code = String(args[0] || '').trim().toUpperCase();
  try {
    if (!code) {
      const data = await requestApi('/api/futebol/competitions');
      const items = Array.isArray(data) ? data : [];
      const list = items.map((item) => '• *' + item.code + '* — ' + item.name).join('\n');
      return send(sock, msg, jid, '🌍 *COMPETIÇÕES DISPONÍVEIS*\n━━━━━━━━━━━━━━━━━━\n' +
        (list || 'Nenhuma competição no catálogo.') + '\n\nUse *!campeonato PL* para ver detalhes.');
    }
    const data = await requestApi('/api/futebol/competitions/' + encodeURIComponent(code));
    const season = data.currentSeason || {};
    const lines = [
      '🌍 *' + (data.name || code) + '*',
      data.area?.name ? '📍 Região: ' + data.area.name : null,
      data.type ? '🏆 Tipo: ' + data.type : null,
      season.startDate ? '📅 Temporada: ' + season.startDate + ' a ' + (season.endDate || '?') : null,
      season.currentMatchday ? '🔢 Rodada atual: ' + season.currentMatchday : null,
      data.lastUpdated ? '🔄 Atualizado: ' + displayDate(data.lastUpdated) : null,
      '\nTabela: *!classificacao ' + code + '*\nJogos: *!jogos ' + code + '*'
    ].filter(Boolean);
    return send(sock, msg, jid, lines.join('\n'));
  } catch (error) {
    return send(sock, msg, jid, '❌ Não consegui consultar a competição. Confirme o código com *!campeonato* e verifique a cobertura da chave.\n_' + error.message + '_');
  }
}

function parseGameArgs(args = []) {
  const tokens = args.map((arg) => String(arg).trim()).filter(Boolean);
  let code;
  if (tokens[0] && /^[a-z0-9]{2,5}$/i.test(tokens[0]) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(tokens[0]) &&
      !['hoje', 'amanha', 'amanhã'].includes(tokens[0].toLowerCase())) {
    code = tokens.shift().toUpperCase();
  }
  function convert(value, fallback) {
    const token = String(value || '').toLowerCase();
    if (!token) return fallback;
    if (token === 'hoje') return localDate(0);
    if (token === 'amanha' || token === 'amanhã') return localDate(1);
    return value;
  }
  const dateFrom = convert(tokens[0], localDate(0));
  const dateTo = convert(tokens[1], dateFrom);
  return { code, dateFrom, dateTo };
}

async function handleMatches(sock, msg, jid, args = []) {
  const filters = parseGameArgs(args);
  if (!validDate(filters.dateFrom) || !validDate(filters.dateTo) || filters.dateFrom > filters.dateTo) {
    return send(sock, msg, jid, '⚠️ Data inválida. Use *!jogos PL 2026-10-28 2026-10-29* (formato AAAA-MM-DD).');
  }
  const params = new URLSearchParams({
    dateFrom: filters.dateFrom, dateTo: filters.dateTo, limit: '35'
  });
  if (filters.code) params.set('competitions', filters.code);
  try {
    const data = await requestApi('/api/futebol/matches?' + params.toString());
    return send(sock, msg, jid, formatMatches(data) + '\n📆 Período: ' + filters.dateFrom + ' a ' + filters.dateTo +
      (filters.code ? '\n🏆 Filtro: ' + filters.code : ''));
  } catch (error) {
    return send(sock, msg, jid, '❌ Não consegui buscar as partidas.\n_' + error.message + '_');
  }
}


function formatBrazilianRound(data, division) {
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  if (!rounds.length) return null;
  const lines = [
    '⚽ *BRASILEIRÃO SÉRIE ' + division + ' — RODADA ATUAL*',
    '━━━━━━━━━━━━━━━━━━'
  ];
  let total = 0;
  for (const round of rounds) {
    const matches = Array.isArray(round?.matches) ? round.matches : [];
    if (!matches.length) continue;
    lines.push('', '📍 *' + (round.groupName || round.label || ('Rodada ' + (round.number || '?'))) + '*');
    for (const match of matches) {
      if (total >= 24) {
        lines.push('', '… lista abreviada para caber na mensagem.');
        lines.push('━━━━━━━━━━━━━━━━━━');
        return lines.join('\n');
      }
      const home = match.homeTeam?.shortName || match.homeTeam?.name || 'A definir';
      const away = match.awayTeam?.shortName || match.awayTeam?.name || 'A definir';
      const scoreHome = match.score?.home;
      const scoreAway = match.score?.away;
      const hasScore = scoreHome !== null && scoreHome !== undefined &&
        scoreAway !== null && scoreAway !== undefined;
      const score = hasScore ? '*' + scoreHome + ' × ' + scoreAway + '*' : 'vs';
      const when = match.date
        ? (match.date.split('-').reverse().join('/') + (match.time ? ' às ' + match.time : ''))
        : (match.dateTime ? displayDate(match.dateTime) : 'Data a definir');
      const status = String(match.status || '').toLowerCase();
      const state = match.started || ['live', 'in_play', 'paused'].includes(status)
        ? '🔴' : (status === 'finished' ? '✅' : '🕒');
      lines.push('', state + ' ' + when, home + ' ' + score + ' ' + away);
      if (match.venue) lines.push('🏟️ ' + match.venue);
      total++;
    }
  }
  if (!total) return null;
  lines.push('', '━━━━━━━━━━━━━━━━━━', '🔄 _Consultado em ' +
    new Date().toLocaleString('pt-BR', { timeZone: TIME_ZONE }) + '_');
  return lines.join('\n');
}

async function handleBrazilianRound(sock, msg, jid, args = []) {
  const division = String(args[0] || 'A').replace(/^s[eé]rie\s*/i, '').toUpperCase();
  const group = String(args[1] || '').trim();
  if (!['A', 'B', 'C', 'D'].includes(division)) {
    return send(sock, msg, jid, '⚠️ Use *!rodada A*, *!rodada B*, *!rodada C* ou *!rodada D A1*.');
  }
  if (division === 'D' && !group) {
    return send(sock, msg, jid, '⚽ A Série D é dividida em grupos. Use *!rodada D A1* (ou outro grupo).');
  }
  if (division !== 'D' && group) {
    return send(sock, msg, jid, 'ℹ️ Para filtrar por grupo, use a Série D: *!rodada D A1*.');
  }
  try {
    const suffix = group ? '?group=' + encodeURIComponent(group) : '';
    const data = await requestApi('/api/brasileirao/' + division + '/rounds' + suffix);
    const text = formatBrazilianRound(data, division);
    if (!text) throw apiError('Não há jogos de rodada disponíveis nesta consulta.', 'ROUND_UNAVAILABLE');
    return send(sock, msg, jid, text);
  } catch (error) {
    if (division === 'D' && group && error.code === 'GROUP_NOT_FOUND') {
      return send(sock, msg, jid,
        'ℹ️ A fonte atual da API não disponibiliza o calendário de partidas da Série D por grupo. ' +
        'A classificação do grupo continua disponível em *!brasileirao D ' + group + '*.');
    }
    return send(sock, msg, jid, '❌ Não consegui carregar a rodada da Série ' + division +
      '. Confira se a API está online e se o grupo foi informado corretamente.\n_' + error.message + '_');
  }
}

async function handleClassification(sock, msg, jid, args = []) {
  const code = String(args[0] || '').trim().toUpperCase();
  if (!code) return send(sock, msg, jid, '⚠️ Informe a competição. Exemplo: *!classificacao PL*. Use *!campeonato* para ver os códigos.');
  try {
    const data = await requestApi('/api/futebol/competitions/' + encodeURIComponent(code) + '/standings');
    const text = formatInternationalStandings(data, code);
    if (!text) throw apiError('Não há classificação disponível para essa competição neste momento.', 'STANDINGS_UNAVAILABLE');
    return send(sock, msg, jid, text);
  } catch (error) {
    return send(sock, msg, jid, '❌ Não consegui carregar a classificação de *' + code + '*. O provedor pode não oferecer tabelas para essa competição.\n_' + error.message + '_');
  }
}

async function handleTeams(sock, msg, jid, args = []) {
  const code = String(args[0] || '').trim().toUpperCase();
  if (!code) return send(sock, msg, jid, '⚠️ Informe a competição. Exemplo: *!clubes PL*. Use *!campeonato* para ver os códigos.');
  try {
    const data = await requestApi('/api/futebol/competitions/' + encodeURIComponent(code) + '/teams');
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    if (!teams.length) return send(sock, msg, jid, 'Não encontrei clubes para essa competição.');
    const list = teams.slice(0, 40).map((team, index) =>
      (index + 1) + '. *' + (team.shortName || team.name || 'Clube') + '*' +
      (team.area?.name ? ' — ' + team.area.name : '')
    ).join('\n');
    return send(sock, msg, jid, '👥 *CLUBES — ' + (data.competition?.name || code) + '*\n━━━━━━━━━━━━━━━━━━\n' +
      list + (teams.length > 40 ? '\n… ' + (teams.length - 40) + ' clubes omitidos.' : ''));
  } catch (error) {
    return send(sock, msg, jid, '❌ Não consegui carregar os clubes dessa competição.\n_' + error.message + '_');
  }
}

async function handleScorers(sock, msg, jid, args = []) {
  const code = String(args[0] || '').trim().toUpperCase();
  const n = Number(args[1] || 10);
  const limit = Number.isInteger(n) && n >= 1 && n <= 20 ? n : 10;
  if (!code) return send(sock, msg, jid, '⚠️ Informe a competição. Exemplo: *!artilheiros PL 10*.');
  try {
    const data = await requestApi('/api/futebol/competitions/' + encodeURIComponent(code) + '/scorers?limit=' + limit);
    const scorers = Array.isArray(data?.scorers) ? data.scorers : [];
    if (!scorers.length) return send(sock, msg, jid, 'Não há dados de artilheiros disponíveis para essa competição.');
    const list = scorers.slice(0, limit).map((item, index) => {
      const player = item.player || {};
      const team = item.team?.shortName || item.team?.name || 'Time não informado';
      const assists = item.assists === null || item.assists === undefined ? '' : ' • ' + item.assists + ' assist.';
      return (index + 1) + '. *' + (player.name || 'Jogador') + '* — *' + (item.goals ?? 0) + ' gols*\n   ⚽ ' + team + assists;
    }).join('\n');
    return send(sock, msg, jid, '🥇 *ARTILHEIROS — ' + (data.competition?.name || code) +
      '*\n━━━━━━━━━━━━━━━━━━\n' + list);
  } catch (error) {
    return send(sock, msg, jid, '❌ Não consegui carregar os artilheiros. A consulta depende da cobertura do provedor.\n_' + error.message + '_');
  }
}

module.exports = {
  getApiBaseUrl, requestApi, directFootballDataPath, validDate, parseGameArgs,
  formatInternationalStandings, formatMatches, helpText, resolveFootballAlias,
  handleFutebol, handleCompetition, handleClassification, handleMatches,
  handleTeams, handleScorers, formatBrazilianRound, handleBrazilianRound
};
