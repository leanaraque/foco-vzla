#!/usr/bin/env node
// Extractor: ayudavenezuela.app (API pública Supabase) → CSV para import-recursos.mjs
// ---------------------------------------------------------------------------
// Unifica TRES tablas de recursos disponibles tras el sismo del 24-jun-2026 en un
// solo CSV con el esquema que import-recursos.mjs entiende:
//   hospitals → categoria 'medico'   (hospitales operativos)
//   shelters  → categoria 'refugio'  (refugios oficiales, fuente Cecodap)
//   acopio    → categoria 'otro'     (centros de acopio; en notas qué necesita)
// Las filas sin lat/lng se GEOCODIFICAN (Nominatim/OSM, 1.1s/req, best-effort).
// API REST pública de solo lectura (apikey publishable). NO scrapea DOM.
//
// USO:
//   node scripts/extract-ayudavenezuela.mjs [salida.csv] [--no-geocode]
// Luego:
//   node scripts/import-recursos.mjs salida.csv --dry-run
//   node scripts/import-recursos.mjs salida.csv --exacto --tag=AV_REC
//   node scripts/import-recursos.mjs --clear=AV_REC        (revertir)

import { writeFileSync } from 'node:fs';

const SUPA = 'https://tthturshkovywsluoqtv.supabase.co/rest/v1';
const APIKEY = 'sb_publishable_amRzqevs9UFKz9ttOcyfrQ_m8dhYjGV'; // publishable, pública
const VENEZUELA = [0.6, 12.2, -73.4, -59.8];

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'ayudavenezuela-recursos.csv';
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '')).map(k => [k, true]));
const GEOCODE = !opt['no-geocode'];

const inVzla = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= VENEZUELA[0] && lat <= VENEZUELA[1] && lng >= VENEZUELA[2] && lng <= VENEZUELA[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const supa = async (q) => {
  const r = await fetch(`${SUPA}/${q}`, { headers: { apikey: APIKEY, 'accept-profile': 'public' } });
  if (!r.ok) { console.error('Supabase fallo:', q, r.status); return []; }
  return r.json();
};

const geoCache = new Map();
async function geocode(query) {
  if (!query) return null;
  if (geoCache.has(query)) return geoCache.get(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ve&q=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FOCO-VZLA/1.0 (coordinacion ayuda terremoto)' } });
    if (!r.ok) { geoCache.set(query, null); return null; }
    const j = await r.json(); const h = j[0];
    const res = h && inVzla(parseFloat(h.lat), parseFloat(h.lon)) ? { lat: parseFloat(h.lat), lng: parseFloat(h.lon) } : null;
    geoCache.set(query, res); return res;
  } catch { geoCache.set(query, null); return null; }
}

const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const arr = a => Array.isArray(a) ? a.filter(Boolean).join(', ') : (a || '');

// --- Descargar las 3 tablas -----------------------------------------------
console.log('Descargando hospitals, shelters y acopio …');
const [hospitals, shelters, acopio] = await Promise.all([
  supa('hospitals?select=*'),
  supa('shelters?select=*&moderation=eq.approved'),
  supa('acopio?select=*&moderation=eq.approved')
]);
console.log(`hospitals: ${hospitals.length} | shelters: ${shelters.length} | acopio: ${acopio.length}`);

// --- Normalizar a un modelo común { nombre, categoria, zona, municipio, ref, contacto, lat, lng, notas, geoQuery } ---
const items = [];
for (const h of hospitals) {
  const extra = [h.operational_status && `Estado: ${h.operational_status}`, h.trauma_designated && 'Trauma', arr(h.specialties) && `Especialidades: ${arr(h.specialties)}`, arr(h.needs) && `Necesita: ${arr(h.needs)}`, h.status_note].filter(Boolean).join('. ');
  items.push({ nombre: h.name, categoria: 'medico', zona: h.municipality, municipio: h.state, ref: h.address, contacto: h.phone, lat: h.lat, lng: h.lng,
    notas: `${extra}${extra ? '. ' : ''}Fuente: ayudavenezuela.app (Hospital)`, geoQuery: [h.address, h.municipality, h.state].filter(Boolean).join(', ') });
}
for (const s of shelters) {
  const extra = [s.capacity && `Capacidad: ${s.capacity}`, arr(s.needs) && `Necesita: ${arr(s.needs)}`, s.notes].filter(Boolean).join('. ');
  items.push({ nombre: s.name, categoria: 'refugio', zona: s.municipality, municipio: s.state, ref: s.address, contacto: s.contact_phone, lat: s.lat, lng: s.lng,
    notas: `${extra}${extra ? '. ' : ''}Fuente: ayudavenezuela.app (Refugio)`, geoQuery: [s.address, s.municipality, s.state].filter(Boolean).join(', ') });
}
for (const a of acopio) {
  const nombre = a.organizacion || 'Centro de acopio';
  const extra = [arr(a.necesita) && `Necesita: ${arr(a.necesita)}`, a.horario && `Horario: ${a.horario}`, a.tipo, a.notes].filter(Boolean).join('. ');
  items.push({ nombre, categoria: 'otro', zona: a.ciudad, municipio: a.estado, ref: a.direccion, contacto: a.contacto, lat: a.lat, lng: a.lng,
    notas: `Centro de acopio. ${extra}${extra ? '. ' : ''}Fuente: ayudavenezuela.app`, geoQuery: [a.direccion, a.ciudad, a.estado].filter(Boolean).join(', ') });
}

// --- Geocodificar los que no traen coords ---------------------------------
const pend = GEOCODE ? items.filter(x => !inVzla(x.lat, x.lng)).length : 0;
if (pend) console.log(`Geocodificando ~${pend} sin coords (~${Math.ceil(pend * 1.1)}s) …`);
let conCoords = 0, geocodificados = 0, sinUbic = 0, i = 0;
const cols = ['nombre', 'categoria', 'zona', 'municipio', 'referencia', 'contacto', 'lat', 'lng', 'notas'];
const filas = [cols.join(',')];

for (const it of items) {
  i++;
  let { lat, lng } = it, aprox = false;
  if (!inVzla(lat, lng)) {
    if (GEOCODE && it.geoQuery) {
      await sleep(1100);
      const hit = await geocode(it.geoQuery) || (it.zona ? (await sleep(1100), await geocode([it.zona, it.municipio].filter(Boolean).join(', '))) : null);
      if (hit) { lat = hit.lat; lng = hit.lng; aprox = true; geocodificados++; }
      else { sinUbic++; continue; }
    } else { sinUbic++; continue; }
  } else conCoords++;

  const notas = it.notas + (aprox ? ' · ubicación APROXIMADA (geocodificada)' : '');
  filas.push([it.nombre || '(sin nombre)', it.categoria, it.zona || '', it.municipio || '', it.ref || '', it.contacto || '', lat, lng, notas].map(csvCell).join(','));
  if (pend && i % 20 === 0) console.log(`  … ${i}/${items.length}`);
}

writeFileSync(out, filas.join('\r\n'), 'utf8');
console.log(`\n✅ CSV escrito: ${out}`);
console.log(`   Recursos: ${filas.length - 1} | con coords reales: ${conCoords} | geocodificados: ${geocodificados} | sin ubicación (omitidos): ${sinUbic}`);
console.log(`\nSiguiente: node scripts/import-recursos.mjs ${out} --dry-run`);
