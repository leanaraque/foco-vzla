// Adapter: terremotovenezuela.com (API pública Supabase, edificios afectados) →
// necesidades. Portado de scripts/extract-terremotovenezuela.mjs, pero con IDENTIDAD
// estable (id del edificio) para upsert idempotente e ingesta incremental por
// last_updated_at. `mapear` es PURO (testeable); la red vive en `descargar`.
import { geoPublico, geoExacto } from '../lib/geo.js';
import { inVzla } from '../lib/geocode.js';

export const sistema = 'TV_EDIF';
export const url = 'https://terremotovenezuela.com';

const API = 'https://jckifxsdlnsvbztxydes.supabase.co/rest/v1/buildings';
const APIKEY = 'sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w'; // publishable, pública
const SELECT = 'id,name,address,city,zone,lat,lng,damage_level,status,has_missing_persons,last_updated_at';
const URGENCIA = { total: 'critica', severo: 'alta', parcial: 'media' };
const SEVERIDAD = { total: 'total', severo: 'severo', parcial: 'parcial' };

// Descarga incremental: si `desde` (ms) viene, pide solo lo actualizado después.
export async function descargar({ desde, fetchImpl = fetch } = {}) {
  let q = `${API}?select=${SELECT}&order=last_updated_at.desc`;
  if (desde) q += `&last_updated_at=gt.${encodeURIComponent(new Date(desde).toISOString())}`;
  const r = await fetchImpl(q, { headers: { apikey: APIKEY, 'accept-profile': 'public' } });
  if (!r.ok) throw new Error(`TV_EDIF API ${r.status}`);
  return await r.json();
}

// Query de geocodificación (de más específica a menos) para filas sin coords.
export const geoQueryDe = (b) =>
  [b.address, b.city].filter(Boolean).join(', ') ||
  [b.zone, b.city].filter(Boolean).join(', ') || b.city || '';

export const watermarkDe = (b) => { const t = Date.parse(b.last_updated_at); return Number.isFinite(t) ? t : null; };

// PURO. `coords` opcional {lat,lng} (de geocodificación). Un edificio dañado es un
// SITIO PÚBLICO de desastre → coord EXACTA pública (precision 'exacta') si la fuente
// la trae; geocodificada → 'sector'. Sin coords ni geocode → null (lo descarta el
// harness como rechazo "sin-ubicacion").
export function mapear(b, coords) {
  let lat = b.lat, lng = b.lng, precision = 'exacta';
  if (!inVzla(lat, lng)) {
    if (coords && inVzla(coords.lat, coords.lng)) { lat = coords.lat; lng = coords.lng; precision = 'sector'; }
    else return null;
  }
  const dmg = b.damage_level;
  const geo = precision === 'exacta' ? geoExacto(lat, lng) : geoPublico(lat, lng);
  const nombre = b.name || '(edificio sin nombre)';
  const sector = (b.zone ? `${nombre} · ${b.zone}` : nombre).slice(0, 140);
  return {
    destino: 'necesidad',
    id_externo: String(b.id),
    privado: null,
    publico: {
      categoria: 'rescate',
      urgencia: URGENCIA[dmg] || 'alta',
      severidad: SEVERIDAD[dmg] || 'desconocida',
      sector,
      descripcion: `Daño ${dmg || 'desconocido'}. Fuente: terremotovenezuela.com`.slice(0, 500),
      geo, sectorGeo: geo.geohash.slice(0, 5), precision
    }
  };
}
