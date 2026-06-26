#!/usr/bin/env node
// Importador de CSV → necesidades (operador). Carga en bloque reportes desde un
// CSV (p.ej. edificios afectados) validando coherencia de coordenadas.
//
// AUTENTICACIÓN: usa el token de gcloud (Admin vía REST → bypassa App Check y
// rules, como corresponde a una carga del operador). Antes de correr:
//   gcloud auth login            (o ya estar autenticado)
//   gcloud config set project foco-vzla
//
// USO:
//   node scripts/import-csv.mjs <archivo.csv> [opciones]
// OPCIONES:
//   --dry-run            Solo valida y reporta; NO escribe nada.
//   --exacto             Coordenada EXACTA pública (sitios públicos de desastre).
//                        Por defecto se aproxima a nivel sector (~1km) y la exacta
//                        va al subdoc privado (modelo de privacidad §9-1).
//   --categoria=rescate  Categoría (rescate|medico|agua|alimento|refugio|otro).
//   --urgencia=critica   Urgencia por defecto si la fila no la trae (critica|alta|media).
//   --verificacion=no_verificada   Estado de verificación inicial.
//   --tag=IMPORT_X       Marca en `creador` para poder borrar/re-importar el lote.
//   --clear=IMPORT_X     Borra TODAS las necesidades con creador==IMPORT_X y termina.
//
// COLUMNAS reconocidas (flexible, insensible a may/acentos):
//   nombre, aliases, zona|zona(parroquia)|parroquia, municipio, referencia|direccion,
//   lat, lng|lon, urgencia, estado|verificacion, categoria, notas|notes|descripcion
// Requeridas para subir una fila: nombre (o sector) + lat + lng numéricos.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { geohashForLocation } = require('geofire-common');

const PROJECT = 'foco-vzla';
const VENEZUELA = [0.6, 12.2, -73.4, -59.8]; // [latMin, latMax, lngMin, lngMax]
const URG = { 'critica': 'critica', 'crítica': 'critica', 'alta': 'alta', 'media': 'media' };
const CAT = ['rescate', 'medico', 'médico', 'agua', 'alimento', 'refugio', 'otro'];

// ---- args ----
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const TAG = opt.tag || 'IMPORT_CSV';
const CATEGORIA = (opt.categoria || 'rescate').replace('médico', 'medico');
const URGENCIA_DEF = URG[(opt.urgencia || 'critica')] || 'critica';
const VERIF = opt.verificacion || 'no_verificada';

const token = () => execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const S = v => ({ stringValue: String(v) });
const N = v => ({ integerValue: v });
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

// ---- --clear ----
async function clear(tag) {
  let total = 0, page;
  do {
    const url = `${BASE}/necesidades?pageSize=300${page ? '&pageToken=' + page : ''}`;
    const j = await fetch(url, { headers: headers() }).then(r => r.json());
    page = j.nextPageToken;
    for (const d of j.documents || []) {
      if (d.fields?.creador?.stringValue === tag) {
        await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: headers() });
        total++;
      }
    }
  } while (page);
  console.log(`Borradas ${total} necesidades con creador=${tag}.`);
}

if (opt.clear) { await clear(opt.clear); process.exit(0); }
if (!file) { console.error('Falta el archivo CSV. Ver cabecera del script para uso.'); process.exit(1); }

// ---- parse + map columnas ----
const filas = parseCSV(readFileSync(file, 'utf8'));
const head = filas[0].map(c => norm(c));
const col = (...nombres) => { for (const n of nombres) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const C = {
  nombre: col('nombre'), aliases: col('aliases', 'alias'),
  zona: col('zona', 'zona(parroquia)', 'parroquia'), municipio: col('municipio'),
  ref: col('referencia', 'direccion', 'dirección'), lat: col('lat', 'latitud'),
  lng: col('lng', 'lon', 'longitud'), urg: col('urgencia'),
  estado: col('estado', 'verificacion', 'verificación'), cat: col('categoria', 'categoría'),
  notas: col('notas', 'notes', 'descripcion', 'descripción')
};
const get = (f, i) => (i >= 0 ? (f[i] || '').trim() : '');

const rows = filas.slice(1).filter(f => f.some(x => x && x.trim()));
const validas = [], omitidas = [];
const coordVistas = new Set();

for (const f of rows) {
  const nombre = get(f, C.nombre);
  const lat = parseFloat(get(f, C.lat)), lng = parseFloat(get(f, C.lng));
  if (!nombre) { omitidas.push([nombre || '(sin nombre)', 'sin nombre']); continue; }
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

// ---- subir ----
const aprox = (v) => Math.round(v * 100) / 100; // ~1km
let ok = 0, err = 0;
for (const { f, nombre, lat, lng } of validas) {
  const aliases = get(f, C.aliases), zona = get(f, C.zona), ref = get(f, C.ref), notas = get(f, C.notas);
  const cands = [nombre, ...aliases.split('/').map(x => x.trim())].filter(Boolean);
  const display = cands.sort((a, b) => b.length - a.length)[0];
  const sector = zona ? `${display} · ${zona}` : display;
  const urg = URG[norm(get(f, C.urg))] || URGENCIA_DEF;
  const categoria = (CAT.includes(norm(get(f, C.cat))) ? norm(get(f, C.cat)) : CATEGORIA).replace('médico', 'medico');
  const descripcion = cap([ref, notas].filter(Boolean).join('. ') + (opt.exacto ? '' : ''));

  // geo público: exacto si --exacto; si no, aproximado a sector.
  const pubLat = opt.exacto ? lat : aprox(lat);
  const pubLng = opt.exacto ? lng : aprox(lng);
  const gh = geohashForLocation([pubLat, pubLng]);

  const fields = {
    categoria: S(categoria), urgencia: S(urg), fuente: S('coordinador'),
    estado: S('sin_atender'), verificacion: S(VERIF), reclamada_por: { nullValue: null },
    creador: S(TAG), confirmaciones: N(0),
    sector: S(cap(sector, 140)), descripcion: S(descripcion || 'Reporte importado.'),
    geo: { mapValue: { fields: { lat: D(pubLat), lng: D(pubLng), geohash: S(gh) } } },
    sectorGeo: S(gh.slice(0, 5)),
    creada_en: TS(), actualizada_en: TS()
  };
  const res = await fetch(`${BASE}/necesidades`, { method: 'POST', headers: headers(), body: JSON.stringify({ fields }) });
  if (!res.ok) { err++; console.log('✗', sector, res.status, (await res.text()).slice(0, 100)); continue; }
  ok++;

  // Modelo privacidad: si NO es exacto, la coord exacta va al subdoc privado.
  if (!opt.exacto) {
    const id = (await res.json()).name.split('/').pop();
    await fetch(`${BASE}/necesidades/${id}/privado/datos`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ fields: { creador: S(TAG), contacto: S(''), geo_exacta: { mapValue: { fields: { lat: D(lat), lng: D(lng) } } } } })
    }).catch(() => {});
  }
}
console.log(`\n✅ Subidas: ${ok} | errores: ${err} | tag=${TAG} | ${opt.exacto ? 'coord EXACTA pública' : 'coord aproximada a sector (exacta en privado)'}`);
console.log(`Para revertir: node scripts/import-csv.mjs --clear=${TAG}`);
