// Geocodificación best-effort (Nominatim/OSM) para registros de fuente SIN coords.
// Factorizado de scripts/extract-*.mjs: cache en memoria + throttle 1.1s + reintento
// + bounds de Venezuela + User-Agent identificable (política de uso de Nominatim).
// `inVzla` es PURO y testeable; `geocode` acepta fetchImpl inyectable para tests.
const VENEZUELA = [0.6, 12.2, -73.4, -59.8]; // [latMin, latMax, lngMin, lngMax]

export const inVzla = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= VENEZUELA[0] && lat <= VENEZUELA[1] && lng >= VENEZUELA[2] && lng <= VENEZUELA[3];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

export async function geocode(query, { fetchImpl = fetch, throttleMs = 1100 } = {}) {
  if (!query) return null;
  if (cache.has(query)) return cache.get(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ve&q=${encodeURIComponent(query)}`;
  for (let intento = 0; intento < 2; intento++) {
    try {
      await sleep(throttleMs);
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'FOCO-VZLA/1.0 (coordinacion ayuda terremoto; hey@leanaraque.com)' } });
      if (!r.ok) continue;
      const j = await r.json();
      const h = j[0];
      const res = h && inVzla(parseFloat(h.lat), parseFloat(h.lon)) ? { lat: parseFloat(h.lat), lng: parseFloat(h.lon) } : null;
      cache.set(query, res);
      return res;
    } catch { /* reintento */ }
  }
  cache.set(query, null);
  return null;
}
