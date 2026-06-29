// Tiempo relativo/absoluto LOCALIZADO (ES/EN) — módulo PURO (sin Svelte ni Firebase),
// unit-testeable. Usa Intl.RelativeTimeFormat / Intl.DateTimeFormat (nativos, sin peso
// extra) para que el sello de frescura ("subido hace 2 h" / "uploaded 2 h ago") salga
// correcto en ambos idiomas sin mantener plantillas a mano.

// Normaliza a Date cualquier forma de timestamp que pueda llegar:
//  - Firestore Timestamp del SDK (tiene .toDate())
//  - objeto { seconds } (REST / caché)
//  - Date, número (ms) o string ISO
// Devuelve null si no hay fecha utilizable (p. ej. serverTimestamp aún pendiente offline).
export function aFecha(ts) {
  if (ts == null) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts === 'object' && Number.isFinite(ts.seconds)) return new Date(ts.seconds * 1000);
    if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
    if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts);
    if (typeof ts === 'string') { const d = new Date(ts); return Number.isNaN(d.getTime()) ? null : d; }
  } catch (_) { /* cae a null */ }
  return null;
}

const ahoraTxt = (locale) => (String(locale).startsWith('en') ? 'just now' : 'ahora mismo');

// Tiempo relativo compacto y localizado ("hace 2 h" / "2 h ago"). Para fechas futuras
// (relojes desfasados) acota a "ahora" para no mostrar "dentro de…". `ref` permite
// inyectar el "ahora" en tests.
export function relativo(ts, locale = 'es', ref = Date.now()) {
  const d = aFecha(ts);
  if (!d) return '';
  const seg = Math.round((ref - d.getTime()) / 1000);
  if (seg < 45) return ahoraTxt(locale);
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }); }
  catch (_) { rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' }); }
  const min = Math.round(seg / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const h = Math.round(min / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const dia = Math.round(h / 24);
  if (dia < 30) return rtf.format(-dia, 'day');
  const mes = Math.round(dia / 30);
  if (mes < 12) return rtf.format(-mes, 'month');
  return rtf.format(-Math.round(mes / 12), 'year');
}

// Fecha+hora absoluta localizada para el tooltip (title), p. ej. "24 jun 2026, 14:05".
export function absoluta(ts, locale = 'es') {
  const d = aFecha(ts);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch (_) {
    return d.toISOString();
  }
}

// ¿El registro es "viejo"? (umbral en horas) → para un matiz visual sutil de frescura.
export function esViejo(ts, horas = 24, ref = Date.now()) {
  const d = aFecha(ts);
  if (!d) return false;
  return ref - d.getTime() >= horas * 3600 * 1000;
}
