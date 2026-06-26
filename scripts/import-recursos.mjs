#!/usr/bin/env node
// Importador de CSV → recursos (operador). Análogo a import-csv.mjs (que carga
// necesidades) pero escribe en la colección `recursos`. Un RECURSO es un lugar que
// OFRECE ayuda (hospital, refugio, centro de acopio), no una necesidad.
//
// Esquema recursos (firestore.rules → validNuevoRecurso): categoria ∈
// agua|transporte|refugio|medico|alimento|otro · sector · descripcion · geo{lat,lng,
// geohash} · disponible:true · creador · creada_en. El contacto y la coord EXACTA van
// al subdoc privado /privado/datos (modelo §9-1), igual que en necesidades.
//
// AUTENTICACIÓN: token de gcloud (Admin REST → bypassa App Check y rules). Antes:
//   gcloud auth login ; gcloud config set project foco-vzla
//
// USO:
//   node scripts/import-recursos.mjs <archivo.csv> [opciones]
// OPCIONES:
//   --dry-run            Solo valida; NO escribe.
//   --exacto             Coord EXACTA pública (sitios públicos: hospitales, refugios).
//                        Por defecto aproxima a sector (~1km) y la exacta va al privado.
//   --categoria=medico   Categoría por defecto si la fila no la trae.
//   --tag=IMPORT_X       Marca en `creador` para revertir el lote.
//   --clear=IMPORT_X     Borra TODOS los recursos con creador==IMPORT_X y termina.
//
// COLUMNAS reconocidas: nombre, categoria, zona|sector, municipio, referencia|direccion,
//   contacto, lat, lng|lon, notas|notes|descripcion. Requeridas: nombre + lat + lng.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { geohashForLocation } = require('geofire-common');

const PROJECT = 'foco-vzla';
const VENEZUELA = [0.6, 12.2, -73.4, -59.8];
const CAT = ['agua', 'transporte', 'refugio', 'medico', 'médico', 'alimento', 'otro'];

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const TAG = opt.tag || 'IMPORT_REC';
const CATEGORIA_DEF = (opt.categoria || 'otro').replace('médico', 'medico');

const token = () => execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const S = v => ({ stringValue: String(v) });
const B = v => ({ booleanValue: v });
const D = v => ({ doubleValue: v });
const TS = () => ({ timestampValue: new Date().toISOString() });
const cap = (s, n = 500) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function parseCSV(txt) {
  const out = []; let campo = '', fila = [], q = false;
  for (let i = 0; i < txt.length; i++) { const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else { if (c === '"') q = true; else if (c === ',') { fila.push(campo); campo = ''; }
      else if (c === '\n') { fila.push(campo); out.push(fila); fila = []; campo = ''; }
      else if (c !== '\r') campo += c; } }
  if (campo.length || fila.length) { fila.push(campo); out.push(fila); }
  return out;
}

async function clear(tag) {
  let total = 0, page;
  do {
    const url = `${BASE}/recursos?pageSize=300${page ? '&pageToken=' + page : ''}`;
    const j = await fetch(url, { headers: headers() }).then(r => r.json());
    page = j.nextPageToken;
    for (const d of j.documents || []) {
      if (d.fields?.creador?.stringValue === tag) {
        await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: headers() });
        total++;
      }
    }
  } while (page);
  console.log(`Borrados ${total} recursos con creador=${tag}.`);
}

if (opt.clear) { await clear(opt.clear); process.exit(0); }
if (!file) { console.error('Falta el archivo CSV. Ver cabecera del script.'); process.exit(1); }

const filas = parseCSV(readFileSync(file, 'utf8'));
const head = filas[0].map(c => norm(c));
const col = (...nombres) => { for (const n of nombres) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const C = {
  nombre: col('nombre'), cat: col('categoria', 'categoría'),
  zona: col('zona', 'sector'), municipio: col('municipio'),
  ref: col('referencia', 'direccion', 'dirección'), contacto: col('contacto'),
  lat: col('lat', 'latitud'), lng: col('lng', 'lon', 'longitud'),
  notas: col('notas', 'notes', 'descripcion', 'descripción')
};
const get = (f, i) => (i >= 0 ? (f[i] || '').trim() : '');

const rows = filas.slice(1).filter(f => f.some(x => x && x.trim()));
const validas = [], omitidas = [];
const coordVistas = new Set();

for (const f of rows) {
  const nombre = get(f, C.nombre);
  const lat = parseFloat(get(f, C.lat)), lng = parseFloat(get(f, C.lng));
  if (!nombre) { omitidas.push(['(sin nombre)', 'sin nombre']); continue; }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { omitidas.push([nombre, 'sin lat/lng numéricos']); continue; }
  if (lat < VENEZUELA[0] || lat > VENEZUELA[1] || lng < VENEZUELA[2] || lng > VENEZUELA[3]) {
    omitidas.push([nombre, `coords fuera de Venezuela (${lat},${lng})`]); continue;
  }
  const k = lat.toFixed(5) + ',' + lng.toFixed(5);
  if (coordVistas.has(k)) { omitidas.push([nombre, 'coord duplicada']); continue; }
  coordVistas.add(k);
  validas.push({ f, nombre, lat, lng });
}

console.log(`Filas: ${rows.length} | válidas: ${validas.length} | omitidas: ${omitidas.length}`);
if (omitidas.length) { console.log('OMITIDAS:'); omitidas.forEach(([n, m]) => console.log(`  - ${n}: ${m}`)); }
if (opt['dry-run']) { console.log('\n(dry-run: no se escribió nada)'); process.exit(0); }

const aprox = (v) => Math.round(v * 100) / 100;
let ok = 0, err = 0;
for (const { f, nombre, lat, lng } of validas) {
  const zona = get(f, C.zona), ref = get(f, C.ref), notas = get(f, C.notas), contacto = get(f, C.contacto);
  const sector = zona ? `${nombre} · ${zona}` : nombre;
  const categoria = (CAT.includes(norm(get(f, C.cat))) ? norm(get(f, C.cat)) : CATEGORIA_DEF).replace('médico', 'medico');
  const descripcion = cap([ref, notas].filter(Boolean).join('. ')) || 'Recurso importado.';

  const pubLat = opt.exacto ? lat : aprox(lat);
  const pubLng = opt.exacto ? lng : aprox(lng);
  const gh = geohashForLocation([pubLat, pubLng]);

  const fields = {
    categoria: S(categoria), creador: S(TAG), disponible: B(true),
    sector: S(cap(sector, 140)), descripcion: S(descripcion),
    geo: { mapValue: { fields: { lat: D(pubLat), lng: D(pubLng), geohash: S(gh) } } },
    creada_en: TS()
  };
  const res = await fetch(`${BASE}/recursos`, { method: 'POST', headers: headers(), body: JSON.stringify({ fields }) });
  if (!res.ok) { err++; console.log('✗', sector, res.status, (await res.text()).slice(0, 120)); continue; }
  ok++;

  // Contacto y/o coord exacta → subdoc privado (igual que necesidades, §9-1).
  if (contacto || !opt.exacto) {
    const id = (await res.json()).name.split('/').pop();
    const priv = { creador: S(TAG), contacto: S(contacto || '') };
    if (!opt.exacto) priv.geo_exacta = { mapValue: { fields: { lat: D(lat), lng: D(lng) } } };
    await fetch(`${BASE}/recursos/${id}/privado/datos`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ fields: priv })
    }).catch(() => {});
  }
}
console.log(`\n✅ Subidos: ${ok} | errores: ${err} | tag=${TAG} | ${opt.exacto ? 'coord EXACTA' : 'coord aproximada (exacta en privado)'}`);
console.log(`Para revertir: node scripts/import-recursos.mjs --clear=${TAG}`);
