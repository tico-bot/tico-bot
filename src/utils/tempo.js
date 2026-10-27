'use strict';

// Fuso do negócio (Cuiabá, UTC-4, sem horário de verão).
const TZ = 'America/Cuiaba';

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

/** Partes da data/hora atual no fuso de Cuiabá. */
function agoraLocal(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(data).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const diaSemana = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    .indexOf(String(partes.weekday).toLowerCase().slice(0, 3));

  return {
    ano: Number(partes.year), mes: Number(partes.month), dia: Number(partes.day),
    hora: Number(partes.hour), minuto: Number(partes.minute),
    diaSemana,                       // 0 = domingo
    iso: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

/** 'YYYY-MM-DD' de hoje (ou de `data`) em Cuiabá. */
function hojeStr(data = new Date()) { return agoraLocal(data).iso; }

/** Diferença em dias entre duas strings 'YYYY-MM-DD' (b - a). */
function diffDias(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/**
 * Converte "10m", "2h", "1d", "1h30m", "45s" em milissegundos.
 * Retorna null se inválido.
 */
function parseDuracao(txt) {
  const m = String(txt || '').toLowerCase().trim().match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const [, d = 0, h = 0, mi = 0, s = 0] = m;
  return (((Number(d) * 24 + Number(h)) * 60 + Number(mi)) * 60 + Number(s)) * 1000;
}

function formatarDuracao(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}min`, (!d && !h && !m) && `${s}s`].filter(Boolean).join(' ');
}

module.exports = { TZ, SEMANA, agoraLocal, hojeStr, diffDias, parseDuracao, formatarDuracao };
