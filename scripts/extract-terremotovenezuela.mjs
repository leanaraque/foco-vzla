#!/usr/bin/env node
// Extractor: terremotovenezuela.com (API pública Supabase) → CSV para import-csv.mjs
// ---------------------------------------------------------------------------
// Fuente: registro ciudadano de edificios afectados por el doblete sísmico del
// 24-jun-2026. Es una API REST pública de solo lectura (apikey publishable, pública
// por diseño). NO scrapea DOM. Produce un CSV con las columnas que import-csv.mjs
// ya reconoce, de modo que la carga a Firestore use el camino ya testeado (modelo
// de privacidad §9-1, dedup, dry-run, --clear).
//
// MAPEO (decidido por el operador):
//   damage_level → urgencia:  total→critica · severo→alta · parcial→media
//   categoria = 'rescate' (edificio dañado = zona de búsqueda/rescate)
//   name→nombre · zone→zona · city→municipio · address→referencia
//   coords reales si la fila las trae; si no, se GEOCODIFICA la dirección
//   (Nominatim/OSM, rate-limit 1.1s, best-effort) y se marca como aproximada.
//
// USO:
//   node scripts/extract-terremotovenezuela.mjs [salida.csv] [--no-geocode] [--limit=N]
// Por defecto escribe ./terremotovenezuela.csv y geocodifica las filas sin coords.
// Luego:
//   node scripts/import-csv.mjs terremotovenezuela.csv --dry-run
//   node scripts/import-csv.mjs terremotovenezuela.csv --tag=TV_EDIF
//   node scripts/import-csv.mjs --clear=TV_EDIF        (revertir el lote)

import { writeFileSync } from 'node:fs';

const API = 'https://jckifxsdlnsvbztxydes.supabase.co/rest/v1/buildings';
const APIKEY = 'sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w'; // publishable, pública
const SELECT = 'id,name,address,city,zone,lat,lng,damage_level,status,has_missing_persons,last_updated_at';
const VENEZUELA = [0.6, 12.2, -73.4, -59.8]; // [latMin, latMax, lngMin, lngMax]
const URGENCIA = { total: 'critica', severo: 'alta', parcial: 'media' };

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'terremotovenezuela.csv';
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const GEOCODE = !opt['no-geocode'];
const LIMIT = opt.limit ? parseInt(opt.limit, 10) : Infinity;

const inVzla = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= VENEZUELA[0] && lat <= VENEZUELA[1] && lng >= VENEZUELA[2] && lng <= VENEZUELA[3];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Geocoding best-effort vía Nominatim (OSM). Política de uso: 1 req/s y User-Agent
// identificable. Devuelve {lat,lng} dentro de Venezuela o null.
const geoCache = new Map();
async function geocode(query) {
  if (!query) return null;
  if (geoCache.has(query)) return geoCache.get(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ve&q=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FOCO-VZLA/1.0 (coordinacion ayuda terremoto; contacto operador)' } });
    if (!r.ok) { geoCache.set(query, null); return null; }
    const j = await r.json();
    const hit = j[0];
    const res = hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
    const ok = res && inVzla(res.lat, res.lng) ? res : null;
    geoCache.set(query, ok);
    return ok;
  } catch { geoCache.set(query, null); return null; }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

// --- 1. Descargar ----------------------------------------------------------
console.log('Descargando edificios de terremotovenezuela.com …');
const resp = await fetch(`${API}?select=${SELECT}&order=last_updated_at.desc`, {
  headers: { apikey: APIKEY, 'accept-profile': 'public' }
});
if (!resp.ok) { console.error('Fallo la API:', resp.status, await resp.text()); process.exit(1); }
const rows = (await resp.json()).slice(0, LIMIT);
console.log(`Recibidos ${rows.length} edificios.`);

// --- 2. Mapear + geocodificar ---------------------------------------------
const cols = ['nombre', 'zona', 'municipio', 'referencia', 'lat', 'lng', 'urgencia', 'categoria', 'notas'];
const filas = [cols.join(',')];
let conCoords = 0, geocodificados = 0, sinUbicacion = 0, pendientesGeo = 0;

// Cuántas hay que geocodificar (para estimar tiempo)
pendientesGeo = GEOCODE ? rows.filter(b => !inVzla(b.lat, b.lng)).length : 0;
if (pendientesGeo) console.log(`Geocodificando ~${pendientesGeo} sin coords (~${Math.ceil(pendientesGeo * 1.1)}s) …`);

let i = 0;
for (const b of rows) {
  i++;
  let lat = b.lat, lng = b.lng, aproximada = false;

  if (!inVzla(lat, lng)) {
    if (GEOCODE) {
      // Consulta de más específica a menos: dirección+ciudad → zona+ciudad → ciudad
      const intentos = [
        [b.address, b.city].filter(Boolean).join(', '),
        [b.zone, b.city].filter(Boolean).join(', '),
        b.city
      ].filter(Boolean);
      let hit = null;
      for (const q of intentos) {
        await sleep(1100); // rate-limit Nominatim
        hit = await geocode(q);
        if (hit) break;
      }
      if (hit) { lat = hit.lat; lng = hit.lng; aproximada = true; geocodificados++; }
      else { sinUbicacion++; continue; } // sin ubicación fiable → no se importa
    } else { sinUbicacion++; continue; }
  } else {
    conCoords++;
  }

  const urgencia = URGENCIA[b.damage_level] || 'media';
  const notas = `Daño ${b.damage_level}. Fuente: terremotovenezuela.com`
    + (aproximada ? ' · ubicación APROXIMADA (geocodificada por dirección)' : '');

  filas.push([
    b.name || '(sin nombre)', b.zone || '', b.city || '', b.address || '',
    lat, lng, urgencia, 'rescate', notas
  ].map(csvCell).join(','));

  if (GEOCODE && pendientesGeo && i % 25 === 0) console.log(`  … ${i}/${rows.length}`);
}

writeFileSync(out, filas.join('\r\n'), 'utf8');
console.log(`\n✅ CSV escrito: ${out}`);
console.log(`   Filas: ${filas.length - 1} | con coords reales: ${conCoords} | geocodificados: ${geocodificados} | sin ubicación (omitidos): ${sinUbicacion}`);
console.log(`\nSiguiente paso (revisar antes de producción):`);
console.log(`   node scripts/import-csv.mjs ${out} --dry-run`);
