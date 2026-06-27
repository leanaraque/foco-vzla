// Adapter: ayudavenezuela.app (API pública Supabase, 3 tablas) → recursos.
// Portado de scripts/extract-ayudavenezuela.mjs: hospitals→medico, shelters→refugio,
// acopio→otro. Identidad estable = `<tabla>-<id>`. El CONTACTO va al privado (§9-1).
// `mapear` PURO; geocodifica las filas sin coords.
import { geoPublico, geoExacto } from '../lib/geo.js';
import { inVzla } from '../lib/geocode.js';

export const sistema = 'AV_REC';
export const url = 'https://ayudavenezuela.app';

const SUPA = 'https://tthturshkovywsluoqtv.supabase.co/rest/v1';
const APIKEY = 'sb_publishable_amRzqevs9UFKz9ttOcyfrQ_m8dhYjGV'; // publishable, pública
const arr = (a) => Array.isArray(a) ? a.filter(Boolean).join(', ') : (a || '');

export async function descargar({ fetchImpl = fetch } = {}) {
  const get = async (q) => {
    const r = await fetchImpl(`${SUPA}/${q}`, { headers: { apikey: APIKEY, 'accept-profile': 'public' } });
    return r.ok ? await r.json() : [];
  };
  const [hospitals, shelters, acopio] = await Promise.all([
    get('hospitals?select=*'),
    get('shelters?select=*&moderation=eq.approved'),
    get('acopio?select=*&moderation=eq.approved')
  ]);
  return [
    ...hospitals.map((h) => ({ _t: 'hospital', ...h })),
    ...shelters.map((s) => ({ _t: 'shelter', ...s })),
    ...acopio.map((a) => ({ _t: 'acopio', ...a }))
  ];
}

export const geoQueryDe = (x) => x._t === 'acopio'
  ? [x.direccion, x.ciudad, x.estado].filter(Boolean).join(', ')
  : [x.address, x.municipality, x.state].filter(Boolean).join(', ');

export const watermarkDe = () => null; // sin updated_at fiable → full pull (upsert idempotente igual)

// PURO. `coords` opcional (geocodificación). Sitio público → coord exacta; geocodificada → sector.
export function mapear(x, coords) {
  let lat = x.lat, lng = x.lng, precision = 'exacta';
  if (!inVzla(lat, lng)) {
    if (coords && inVzla(coords.lat, coords.lng)) { lat = coords.lat; lng = coords.lng; precision = 'sector'; }
    else return null;
  }
  const geo = precision === 'exacta' ? geoExacto(lat, lng) : geoPublico(lat, lng);
  let categoria, nombre, extra, contacto;
  if (x._t === 'hospital') {
    categoria = 'medico'; nombre = x.name; contacto = x.phone;
    extra = [x.operational_status && `Estado: ${x.operational_status}`, arr(x.specialties) && `Especialidades: ${arr(x.specialties)}`, arr(x.needs) && `Necesita: ${arr(x.needs)}`].filter(Boolean).join('. ');
  } else if (x._t === 'shelter') {
    categoria = 'refugio'; nombre = x.name; contacto = x.contact_phone;
    extra = [x.capacity && `Capacidad: ${x.capacity}`, arr(x.needs) && `Necesita: ${arr(x.needs)}`].filter(Boolean).join('. ');
  } else {
    categoria = 'otro'; nombre = x.organizacion || 'Centro de acopio'; contacto = x.contacto;
    extra = [arr(x.necesita) && `Necesita: ${arr(x.necesita)}`, x.horario && `Horario: ${x.horario}`].filter(Boolean).join('. ');
  }
  nombre = (nombre || '(sin nombre)').slice(0, 140);
  const descripcion = `${extra}${extra ? '. ' : ''}Fuente: ayudavenezuela.app`.slice(0, 500);
  return {
    destino: 'recurso', id_externo: `${x._t}-${x.id}`,
    publico: { categoria, sector: nombre, descripcion, geo, precision, disponible: true },
    privado: contacto ? { contacto: String(contacto).slice(0, 140) } : null
  };
}
