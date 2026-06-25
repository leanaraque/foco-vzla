#!/usr/bin/env node
// PREP (build-time, costo runtime CERO): extrae lugares de OpenStreetMap vía
// Overpass API (gratis) para los municipios afectados y genera src/lib/lugares.json
// curado: { nombre, tipo, municipio, lat, lng, geohash, sectorGeo }.
//
// Uso: node scripts/extract-lugares.mjs
// (Solo lugares OSM/oficiales. NO incluye la lista privada de edificios del operador.)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { geohashForLocation } = require('geofire-common');

// Centros de parroquia/municipio para asignar el `municipio` por cercanía y para
// el fallback "centro de municipio" sin GPS. (lat, lng aproximados.)
const CENTROS = [
  // La Guaira (Vargas)
  { m: 'Catia La Mar, La Guaira', lat: 10.5990, lng: -67.0260 },
  { m: 'Maiquetía, La Guaira', lat: 10.5950, lng: -66.9800 },
  { m: 'La Guaira, La Guaira', lat: 10.6010, lng: -66.9320 },
  { m: 'Macuto, La Guaira', lat: 10.6080, lng: -66.8910 },
  { m: 'Caraballeda, La Guaira', lat: 10.6130, lng: -66.8490 },
  { m: 'Naiguatá, La Guaira', lat: 10.6190, lng: -66.7390 },
  { m: 'Carayaca, La Guaira', lat: 10.5530, lng: -67.1320 },
  // Carabobo (costa)
  { m: 'Puerto Cabello, Carabobo', lat: 10.4730, lng: -68.0130 },
  { m: 'Morón, Carabobo', lat: 10.4860, lng: -68.1930 }
];

function municipioCercano(lat, lng) {
  let best = CENTROS[0], bd = Infinity;
  for (const c of CENTROS) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best.m;
}

// Mapea etiquetas OSM a un tipo amigable en español.
function tipoAmigable(tags) {
  if (tags.place === 'town' || tags.place === 'village') return 'pueblo';
  if (tags.place === 'suburb' || tags.place === 'neighbourhood' || tags.place === 'quarter') return 'sector';
  if (tags.place === 'hamlet' || tags.place === 'locality') return 'caserío';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.amenity === 'clinic' || tags.healthcare) return 'centro de salud';
  if (tags.amenity === 'school' || tags.amenity === 'college' || tags.amenity === 'university') return 'escuela';
  if (tags.amenity === 'place_of_worship') return 'iglesia';
  if (tags.leisure === 'park' || tags.leisure === 'pitch') return 'plaza/parque';
  if (tags.amenity === 'marketplace') return 'mercado';
  return 'lugar';
}

// Prioridad para el CAP: los sectores poblados primero, luego POIs de referencia.
function prioridad(tipo) {
  const orden = ['sector', 'pueblo', 'caserío', 'hospital', 'centro de salud', 'plaza/parque', 'iglesia', 'escuela', 'mercado', 'lugar'];
  const i = orden.indexOf(tipo);
  return i === -1 ? 99 : i;
}

const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g');
const normaliza = (s) => s.normalize('NFD').replace(COMBINANTES, '').toLowerCase().trim();

// Dos bounding boxes: costa de Carabobo (Morón/Puerto Cabello) y La Guaira/Vargas.
const BBOX_CARABOBO = '10.40,-68.32,10.56,-67.95';
const BBOX_GUAIRA = '10.52,-67.20,10.70,-66.30';

function consulta(bbox) {
  return `
    [out:json][timeout:60];
    (
      node["place"~"^(town|village|suburb|neighbourhood|quarter|hamlet|locality)$"]["name"](${bbox});
      node["amenity"~"^(hospital|clinic|school|college|university|place_of_worship|marketplace)$"]["name"](${bbox});
      node["leisure"~"^(park|pitch)$"]["name"](${bbox});
      node["healthcare"]["name"](${bbox});
    );
    out body;`;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(bbox) {
  let ultimoErr;
  for (let intento = 0; intento < ENDPOINTS.length * 2; intento++) {
    const url = ENDPOINTS[intento % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'FOCO-ayuda-vzla/1.0 (https://github.com/leanaraque/foco-vzla; build-time place extraction)',
          'Accept': 'application/json'
        },
        body: 'data=' + encodeURIComponent(consulta(bbox))
      });
      if (res.ok) return (await res.json()).elements || [];
      ultimoErr = 'HTTP ' + res.status + ' en ' + url;
    } catch (e) {
      ultimoErr = e.message + ' en ' + url;
    }
    console.log('  reintento (' + ultimoErr + ')…');
    await sleep(3000);
  }
  throw new Error('Overpass agotado: ' + ultimoErr);
}

console.log('Consultando Overpass (Carabobo)…');
const a = await overpass(BBOX_CARABOBO);
console.log('  ', a.length, 'elementos');
console.log('Consultando Overpass (La Guaira)…');
const b = await overpass(BBOX_GUAIRA);
console.log('  ', b.length, 'elementos');

const vistos = new Set();
let lugares = [];
for (const el of [...a, ...b]) {
  const tags = el.tags || {};
  const nombre = (tags.name || '').trim();
  if (!nombre || el.lat == null || el.lon == null) continue;
  const tipo = tipoAmigable(tags);
  const municipio = municipioCercano(el.lat, el.lon);
  const clave = normaliza(nombre) + '|' + municipio;
  if (vistos.has(clave)) continue;
  vistos.add(clave);
  const geohash = geohashForLocation([el.lat, el.lon]);
  lugares.push({
    nombre,
    tipo,
    municipio,
    lat: Math.round(el.lat * 1e5) / 1e5,
    lng: Math.round(el.lon * 1e5) / 1e5,
    geohash,
    sectorGeo: geohash.slice(0, 5)
  });
}

// Orden por prioridad de tipo y nombre; CAP a 500.
lugares.sort((x, y) => prioridad(x.tipo) - prioridad(y.tipo) || x.nombre.localeCompare(y.nombre));
const CAP = 500;
if (lugares.length > CAP) lugares = lugares.slice(0, CAP);

// Asegura que los centros de municipio existan como entradas seleccionables.
for (const c of CENTROS) {
  const clave = normaliza(c.m.split(',')[0]) + '|' + c.m;
  if (![...vistos].some((k) => k === clave)) {
    const gh = geohashForLocation([c.lat, c.lng]);
    lugares.unshift({ nombre: c.m.split(',')[0], tipo: 'municipio', municipio: c.m, lat: c.lat, lng: c.lng, geohash: gh, sectorGeo: gh.slice(0, 5) });
  }
}

lugares = lugares.slice(0, 500); // CAP estricto ≤500 (centros van al frente)
writeFileSync(new URL('../src/lib/lugares.json', import.meta.url), JSON.stringify(lugares));
console.log(`\n✅ ${lugares.length} lugares → src/lib/lugares.json`);
console.log('   tamaño aprox:', (JSON.stringify(lugares).length / 1024).toFixed(1), 'KB (sin gzip)');
console.log('   muestra:', lugares.slice(0, 5).map((l) => `${l.nombre} (${l.tipo} · ${l.municipio})`).join(' | '));
