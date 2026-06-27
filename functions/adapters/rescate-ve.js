// Adapter: rescate-ve.vercel.app /api/external-points (API pública Next, sin auth) →
// recursos (centros de acopio) + necesidades (puntos de ayuda). IDs UUID estables +
// updated_at (ingesta incremental natural). Calificada ALTA en la rúbrica (Plan Fase 1).
//
// PRIVACIDAD: los `puntos` traen reporter_name (p.ej. "Publicado por X") y
// reporter_contact = PII. El nombre del reportante NUNCA va al público; el contacto
// va al subdoc privado (§9-1). La compuerta scrubPII del staging cubre el resto.
import { geoExacto } from '../lib/geo.js';
import { inVzla } from '../lib/geocode.js';

export const sistema = 'RESCATE_VE';
export const url = 'https://rescate-ve.vercel.app';
const API = 'https://rescate-ve.vercel.app/api/external-points';

// needs[] → categoría principal de FOCO (heurístico; default 'otro').
const CAT_NEED = [
  [/agua/i, 'agua'], [/aliment|comida|viver/i, 'alimento'],
  [/medic|salud|medicament|insulina|oxigeno|dialisis/i, 'medico'],
  [/refugio|alojam|albergue/i, 'refugio'], [/rescate|atrapad/i, 'rescate']
];
const categoriaDeNeeds = (needs) => {
  const txt = Array.isArray(needs) ? needs.join(' ') : String(needs || '');
  for (const [re, cat] of CAT_NEED) if (re.test(txt)) return cat;
  return 'otro';
};

export async function descargar({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(API, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`RESCATE_VE API ${r.status}`);
  const j = await r.json();
  return [
    ...(j.centros || []).map((c) => ({ _t: 'centro', ...c })),
    ...(j.puntos || []).map((p) => ({ _t: 'punto', ...p }))
  ];
}

export const watermarkDe = (x) => { const t = Date.parse(x.updated_at || x.created_at); return Number.isFinite(t) ? t : null; };

// PURO. centro → recurso 'otro' (acopio); punto → necesidad (categoría según needs[]).
export function mapear(x) {
  if (x.is_active === false) return null;
  if (!inVzla(x.latitude, x.longitude)) return null;
  const geo = geoExacto(x.latitude, x.longitude);
  const nombre = (x.name || x.organization || (x._t === 'centro' ? 'Centro de acopio' : 'Punto de ayuda')).slice(0, 140);
  const sector = (x.city ? `${nombre} · ${x.city}` : nombre).slice(0, 140);

  if (x._t === 'centro') {
    const recibe = Array.isArray(x.supply_types) && x.supply_types.length ? `Recibe: ${x.supply_types.join(', ')}. ` : '';
    const org = x.organization ? `${x.organization}. ` : '';
    const descripcion = `${org}${recibe}${x.schedule ? `Horario: ${x.schedule}. ` : ''}Fuente: rescate-ve.vercel.app`.slice(0, 500);
    return {
      destino: 'recurso', id_externo: String(x.id),
      publico: { categoria: 'otro', sector, descripcion, geo, precision: 'exacta', disponible: true },
      privado: x.phone ? { contacto: String(x.phone).slice(0, 140) } : null
    };
  }
  // punto → necesidad. reporter_name (PII) NO se publica; reporter_contact → privado.
  const pide = Array.isArray(x.needs) && x.needs.length ? `Necesita: ${x.needs.join(', ')}. ` : '';
  const notas = x.notes ? `${x.notes}. ` : '';
  const descripcion = `${pide}${notas}Fuente: rescate-ve.vercel.app`.slice(0, 500);
  return {
    destino: 'necesidad', id_externo: String(x.id),
    publico: { categoria: categoriaDeNeeds(x.needs), urgencia: x.status === 'urgent' ? 'alta' : 'media', sector, descripcion, geo, sectorGeo: geo.geohash.slice(0, 5), precision: 'exacta' },
    privado: x.reporter_contact ? { contacto: String(x.reporter_contact).slice(0, 140) } : null
  };
}
