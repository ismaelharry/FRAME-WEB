// Utilidades de fecha y hora en Europe/Madrid.
// Los instantes se guardan como milisegundos UTC; las fechas locales como 'YYYY-MM-DD'.
// Todas las conversiones pasan por Intl, de modo que los cambios de horario
// (último domingo de marzo y de octubre) se resuelven correctamente.

export const TZ = 'Europe/Madrid';
const MIN = 60_000;
const DAY = 86_400_000;

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function zonedParts(ms) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
    date, time: `${p.hour}:${p.minute}`,
    weekday: weekdayOf(date),
  };
}

// Diferencia (minutos) entre la hora local de Madrid y UTC en un instante dado.
export function offsetMinutes(ms) {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export const timeToMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const minutesToTime = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Convierte una hora local de Madrid a instante UTC.
// Devuelve null si la hora no existe (salto de primavera). En la hora repetida
// de otoño se elige la primera aparición.
export function localToUtc(date, time = '00:00') {
  if (!isDate(date) || !isTime(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([offsetMinutes(guess - 12 * 3_600_000), offsetMinutes(guess + 12 * 3_600_000)]);
  const candidates = [...offsets]
    .map((off) => guess - off * MIN)
    .filter((ms) => { const p = zonedParts(ms); return p.date === date && p.time === time; })
    .sort((a, b) => a - b);
  return candidates.length ? candidates[0] : null;
}

export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

export function todayLocal(now = Date.now()) {
  return zonedParts(now).date;
}

// Inicio y fin (UTC) de un día local. La medianoche siempre existe en Madrid
// porque los cambios de hora ocurren a las 02:00/03:00; un día puede durar 23 o 25 h.
export function dayBoundsUtc(date) {
  return [localToUtc(date, '00:00'), localToUtc(addDays(date, 1), '00:00')];
}

export function datesBetween(from, toExclusive) {
  const out = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

const LOCALES = { es: 'es-ES', en: 'en-GB' };

export function fmtDate(ms, lang = 'es', opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat(LOCALES[lang] || 'es-ES', { timeZone: TZ, ...opts }).format(new Date(ms));
}

export function fmtDateStr(date, lang = 'es', opts) {
  return fmtDate(localToUtc(date, '12:00'), lang, opts);
}

export function fmtTime(ms) {
  return zonedParts(ms).time;
}

export function fmtDateTime(ms, lang = 'es') {
  return `${fmtDate(ms, lang, { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtTime(ms)}`;
}

export function monthOf(date) { return date.slice(0, 7); }

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Horarios semanales: { mon: [["08:00","20:00"]], ..., sun: [] }
export function rangesFor(hours, date) {
  if (!hours) return [];
  const key = WEEKDAY_KEYS[weekdayOf(date)];
  return (hours[key] || []).filter((r) => Array.isArray(r) && isTime(r[0]) && (isTime(r[1]) || r[1] === '24:00'));
}

export const rangeMinutes = (r) => [timeToMinutes(r[0]), r[1] === '24:00' ? 1440 : timeToMinutes(r[1])];
