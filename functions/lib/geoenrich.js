// GEO-ENRICHER (Plan, crítico #1) — mejora la EXACTITUD de la ubicación de cada punto
// cruzando con información externa (OSM/Photon). Núcleo PURO y testeable:
//   - extraerDireccion(texto): saca las pistas de dirección del texto libre.
//   - triangular(): dadas coords candidatas (geocodificadas) + la coord actual, decide
//     la mejor coordenada y una CONFIANZA, y marca para revisión lo dudoso (no
//     auto-aplica lo incierto). La parte de red (geocodificar) vive en enriquecer().
// Privacidad: la PRECISIÓN de display (exacta/sector) NO la cambia el enricher — solo
// mejora la coordenada y su confianza. Edificios siguen exactos; personas, a sector.
import { distM } from './dedup.js';
import { inVzla, geocode as geocodeDefault } from './geocode.js';

// --- Extracción de pistas de dirección del texto libre (PURO) ---
// Captura clausulas con prefijo de vía/sector y el nombre que sigue.
const RE_DIR = /\b(calle|av\.?|avenida|carrera|cra\.?|sector|urb\.?|urbanizaci[oó]n|conjunto|paseo|callej[oó]n|manzana|mz\.?|edif\.?|edificio|residencias?|torre|km|kil[oó]metro)\s+[A-Za-zÁÉÍÓÚÑ0-9°ºNo.\-]+(?:\s+[A-Za-zÁÉÍÓÚÑ0-9°ºNo.\-]+){0,3}/gi;
export function extraerDireccion(texto) {
  const out = [];
  const t = String(texto || '');
  let m;
  while ((m = RE_DIR.exec(t)) !== null) {
    const frag = m[0].replace(/\s+/g, ' ').trim();
    if (frag.length >= 6 && !out.includes(frag)) out.push(frag);
    if (out.length >= 4) break;
  }
  return out;
}

// Arma las consultas de geocodificación de un registro, de más específica a menos.
export function consultasGeo(record = {}) {
  const nombre = (record.sector || '').split('·')[0].trim();
  const zona = (record.sector || '').split('·')[1]?.trim() || '';
  const muni = record.municipio || record.estado || '';
  const dirs = extraerDireccion(record.descripcion);
  const q = [];
  for (const d of dirs) q.push([d, zona || muni, 'Venezuela'].filter(Boolean).join(', '));
  if (nombre) q.push([nombre, zona, muni, 'Venezuela'].filter(Boolean).join(', '));
  if (zona) q.push([zona, muni, 'Venezuela'].filter(Boolean).join(', '));
  return [...new Set(q)].slice(0, 4);
}

const centroide = (pts) => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length });

// --- Triangulación (PURO): coords candidatas + coord actual → decisión ---
// candidatos: [{lat,lng,fuente}] (geocodificadas, ya filtradas inVzla).
// Devuelve { geo:{lat,lng}, confianza:'alta'|'media'|'baja', revisar:bool,
//   fuente_geo, movimiento_m }. NUNCA cambia la precisión de display.
export function triangular({ geoActual = null, precisionActual = 'sector', candidatos = [] } = {}) {
  const cands = (candidatos || []).filter((c) => c && inVzla(c.lat, c.lng));
  // Cluster de candidatos que concuerdan entre sí (<=200m del primero).
  let cluster = [];
  if (cands.length) {
    cluster = cands.filter((c) => distM(cands[0], c) <= 200);
  }
  // EVIDENCIA FUERTE = varios geocodificados concuerdan ENTRE SÍ (cluster ≥2). Un único
  // hit suele ser un centroide de ciudad ("Caracas", "Maiquetía") — NO es prueba de la
  // ubicación del edificio y NO debe mover coords ni marcar conflicto (inundaría la cola).
  const fuerte = cluster.length >= 2;
  const centro = cluster.length ? centroide(cluster) : (cands[0] || null);

  if (!centro) {
    // Sin info externa: conserva lo actual; revisar solo si tampoco hay coord actual.
    return { geo: geoActual, confianza: 'baja', revisar: !geoActual, fuente_geo: 'actual', movimiento_m: 0 };
  }
  if (geoActual && inVzla(geoActual.lat, geoActual.lng)) {
    const d = Math.round(distM(geoActual, centro));
    if (d <= 150) {
      // La fuente externa CONFIRMA la coord actual → alta confianza, no se mueve.
      return { geo: geoActual, confianza: 'alta', revisar: false, fuente_geo: 'confirmado_osm', movimiento_m: d };
    }
    if (precisionActual === 'sector') {
      // Mejora la coord aproximada solo con evidencia: cluster cercano (≤1km) o un único
      // hit MUY cercano (≤600m, refinamiento plausible de un centroide de zona).
      if ((fuerte && d <= 1000) || (!fuerte && d <= 600)) {
        return { geo: centro, confianza: 'media', revisar: false, fuente_geo: 'osm_mejora', movimiento_m: d };
      }
      // Varios externos concuerdan lejos = conflicto real → a revisión. Un solo hit lejano
      // (centroide de ciudad) = sin señal útil → conserva sin generar ruido.
      return fuerte
        ? { geo: geoActual, confianza: 'media', revisar: true, fuente_geo: 'conflicto', movimiento_m: d }
        : { geo: geoActual, confianza: 'media', revisar: false, fuente_geo: 'sin_mejora_externa', movimiento_m: d };
    }
    // Precisión EXACTA: la coord de fuente manda. Solo se marca conflicto si VARIOS
    // externos concuerdan en otro punto lejano (evidencia de que la exacta podría errar).
    return (fuerte && d > 150)
      ? { geo: geoActual, confianza: 'media', revisar: true, fuente_geo: 'conflicto', movimiento_m: d }
      : { geo: geoActual, confianza: 'alta', revisar: false, fuente_geo: 'sin_mejora_externa', movimiento_m: d };
  }
  // No había coord: usa el externo para rellenar. Alta si varios concuerdan; si es un
  // único hit (probable centroide de ciudad), colócalo a nivel zona sin marcar revisión.
  return { geo: centro, confianza: fuerte ? 'alta' : 'baja', revisar: false, fuente_geo: 'osm_nuevo', movimiento_m: 0 };
}

// --- Wrapper con red: geocodifica las consultas y triangula ---
export async function enriquecer(record, { geocodeImpl = geocodeDefault, max = 3 } = {}) {
  const geoActual = (record.geo && inVzla(record.geo.lat, record.geo.lng)) ? { lat: record.geo.lat, lng: record.geo.lng } : null;
  const consultas = consultasGeo(record).slice(0, max);
  const candidatos = [];
  for (const q of consultas) {
    const hit = await geocodeImpl(q);
    if (hit) candidatos.push({ ...hit, fuente: q });
  }
  return triangular({ geoActual, precisionActual: record.precision || 'sector', candidatos });
}
