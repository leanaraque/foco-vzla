// ORQUESTACIÓN del procesado (Plan §"procesar") — une extracción + geo + resumen por
// registro. Sin Firebase → testeable. La función agendada (functions/procesador.js)
// añade la E/S, el agendado, la idempotencia por hash y la compuerta de revisión.
//
// IDEMPOTENCIA / costo: `hashContenido` resume el contenido fuente; el procesador
// salta los docs cuyo hash ya está en `procesado.hash` → solo re-procesa lo nuevo o
// cambiado (controla el costo del LLM). `VERSION` permite forzar un reproceso global
// si cambia la lógica.
import { fnv1a } from './identidad.js';
import { extraer } from './extraer.js';
import { enriquecer } from './geoenrich.js';
import { resumenIA } from './resumen.js';
import { geoPublico, geoExacto } from './geo.js';
import { inVzla } from './geocode.js';

export const VERSION = 'p1';

export function hashContenido(rec = {}) {
  const g = rec.geo || {};
  return fnv1a([VERSION, rec.descripcion || '', rec.sector || '', g.lat ?? '', g.lng ?? ''].join('|'));
}

// ¿Este doc necesita procesarse? (contenido cambiado o nunca procesado)
export const necesitaProceso = (rec) => hashContenido(rec) !== rec?.procesado?.hash;

// Procesa UN registro. Devuelve { patch, revision }:
//   patch    → campos a escribir en el canónico (resumen + tipado + geo si confiable)
//   revision → entrada para la cola del operador si algo quedó dudoso (geo/PII), o null
// `ahoraTs` es el sentinel de timestamp del caller (serverTimestamp) o un número.
export async function procesarUno(rec, { apiKey, geocodeImpl, fetchImpl, ahoraTs = Date.now(), reGeoExacta = false } = {}) {
  const campos = extraer(rec);
  // Geo: si el registro YA trae coord EXACTA de su fuente (registro de edificios),
  // re-geocodificar el nombre normalmente la EMPEORA (los geocoders erran con edificios
  // puntuales) → se confía la coord de fuente. El enricher se enfoca en los APROXIMADOS
  // (precision 'sector') o sin coord, donde la info externa sí mejora la exactitud.
  const tieneExacta = rec.precision === 'exacta' && inVzla(rec.geo?.lat, rec.geo?.lng);
  const geoDec = (tieneExacta && !reGeoExacta)
    ? { geo: { lat: rec.geo.lat, lng: rec.geo.lng }, confianza: 'alta', revisar: false, fuente_geo: 'fuente_exacta', movimiento_m: 0 }
    : await enriquecer(rec, { geocodeImpl });
  const res = await resumenIA(rec, campos, { apiKey, fetchImpl });

  const patch = {
    resumen: res.resumen,
    severidad: campos.severidad,
    rescate_activo: campos.rescate_activo,
    actualizada_en: ahoraTs,
    procesado: { hash: hashContenido(rec), en: ahoraTs, resumen_via: res.via, geo_conf: geoDec.confianza, geo_fuente: geoDec.fuente_geo }
  };
  if (campos.rescate) patch.rescate = campos.rescate;
  if (Number.isFinite(campos.afectados)) patch.afectados = campos.afectados;
  if (Array.isArray(campos.necesidades) && campos.necesidades.length) patch.necesidades_pedidas = campos.necesidades;

  // GEO: solo se mueve la coordenada si la fuente externa la mejora con confianza y NO
  // está marcada para revisión, y el doc no fue editado a mano por el operador. La
  // PRECISIÓN de display no cambia (privacidad): edificio exacto, persona a sector.
  let revision = null;
  const mejoraGeo = geoDec.geo && inVzla(geoDec.geo.lat, geoDec.geo.lng) && !geoDec.revisar
    && (geoDec.fuente_geo === 'osm_mejora' || geoDec.fuente_geo === 'osm_nuevo');
  if (mejoraGeo && !rec.editado_por_operador) {
    const g = rec.precision === 'exacta' ? geoExacto(geoDec.geo.lat, geoDec.geo.lng) : geoPublico(geoDec.geo.lat, geoDec.geo.lng);
    patch.geo = g;
    patch.sectorGeo = g.geohash.slice(0, 5);
  } else if (geoDec.revisar) {
    revision = { tipo: 'geo', motivo: geoDec.fuente_geo, movimiento_m: geoDec.movimiento_m, sugerida: geoDec.geo || null };
  }

  return { patch, revision, _campos: campos, _geo: geoDec, _resumen: res };
}
