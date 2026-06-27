// Adapter: terremotovenezuela.app /api/reports (reportes ciudadanos con coords reales)
// → necesidades + recursos. Portado de scripts/extract-terremotovenezuela-app.mjs.
// `missing` (personas) se DESCARTA (fuera de alcance §3). Identidad estable = id del
// reporte; incremental por createdAt. `mapear` PURO.
import { geoExacto } from '../lib/geo.js';
import { inVzla } from '../lib/geocode.js';

export const sistema = 'TVAPP';
export const url = 'https://terremotovenezuela.app';

const API = 'https://terremotovenezuela.app/api/reports';
const MAP = {
  critical: { destino: 'necesidad', categoria: 'rescate', urgencia: 'critica' },
  building: { destino: 'necesidad', categoria: 'rescate', urgencia: 'alta' },
  supplies: { destino: 'necesidad', categoria: 'alimento', urgencia: 'alta' },
  nopower:  { destino: 'necesidad', categoria: 'otro', urgencia: 'media' },
  shelter:  { destino: 'recurso', categoria: 'refugio' }
  // missing: omitido a propósito (§3)
};

export async function descargar({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(API, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`TVAPP API ${r.status}`);
  return (await r.json()).reports || [];
}

export const watermarkDe = (r) => { const t = Date.parse(r.createdAt); return Number.isFinite(t) ? t : null; };

// PURO. Coords reales o se descarta (la app las trae). Coord EXACTA pública.
export function mapear(r) {
  const m = MAP[r.type];
  if (!m) return null;
  if (!inVzla(r.lat, r.lng)) return null;
  const geo = geoExacto(r.lat, r.lng);
  const nombre = (r.place || `Reporte ${r.type}`).slice(0, 140);
  const meta = [r.affected ? `Afectados: ${r.affected}` : '', r.confirmations ? `Confirmaciones: ${r.confirmations}` : ''].filter(Boolean).join('. ');
  const descripcion = [r.needs, meta, 'Fuente: terremotovenezuela.app'].filter(Boolean).join('. ').slice(0, 500);
  if (m.destino === 'necesidad') {
    return {
      destino: 'necesidad', id_externo: String(r.id), privado: null,
      publico: { categoria: m.categoria, urgencia: m.urgencia, sector: nombre, descripcion, geo, sectorGeo: geo.geohash.slice(0, 5), precision: 'exacta' }
    };
  }
  return {
    destino: 'recurso', id_externo: String(r.id), privado: null,
    publico: { categoria: m.categoria, sector: nombre, descripcion, geo, precision: 'exacta', disponible: true }
  };
}
