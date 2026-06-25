#!/usr/bin/env node
// PREP (build-time, costo runtime CERO): extrae lugares de OpenStreetMap vía
// Overpass API (gratis) para las zonas pobladas de Venezuela y genera
// src/lib/lugares.json curado: { nombre, tipo, municipio, lat, lng, geohash, sectorGeo }.
//
// Uso: node scripts/extract-lugares.mjs
// (Solo lugares OSM/oficiales. NO incluye la lista privada de edificios del operador.)
//
// AMPLIACIÓN §23 (cobertura nacional): de 2 zonas (La Guaira + costa Carabobo) a
// ~18 zonas principales del país. CAP elevado a 5000 para cubrir todo Venezuela
// sin perder peso del lazy-chunk (sigue por debajo del leaflet ~43 KB gzip).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { geohashForLocation } = require('geofire-common');

// Zonas: bbox + centros de municipio/parroquia para asignar `municipio` por
// cercanía y para el fallback "centro de municipio" cuando no hay GPS.
// bbox = lat_min,lng_min,lat_max,lng_max (formato Overpass).
const ZONAS = [
  {
    id: 'la-guaira',
    bbox: '10.52,-67.20,10.70,-66.30',
    centros: [
      { m: 'Catia La Mar, La Guaira', lat: 10.5990, lng: -67.0260 },
      { m: 'Maiquetía, La Guaira', lat: 10.5950, lng: -66.9800 },
      { m: 'La Guaira, La Guaira', lat: 10.6010, lng: -66.9320 },
      { m: 'Macuto, La Guaira', lat: 10.6080, lng: -66.8910 },
      { m: 'Caraballeda, La Guaira', lat: 10.6130, lng: -66.8490 },
      { m: 'Naiguatá, La Guaira', lat: 10.6190, lng: -66.7390 },
      { m: 'Carayaca, La Guaira', lat: 10.5530, lng: -67.1320 }
    ]
  },
  {
    id: 'carabobo-costa',
    bbox: '10.40,-68.32,10.56,-67.95',
    centros: [
      { m: 'Puerto Cabello, Carabobo', lat: 10.4730, lng: -68.0130 },
      { m: 'Morón, Carabobo', lat: 10.4860, lng: -68.1930 }
    ]
  },
  {
    id: 'caracas',
    bbox: '10.40,-67.05,10.55,-66.78',
    centros: [
      { m: 'Caracas (Libertador), Distrito Capital', lat: 10.5061, lng: -66.9146 },
      { m: 'Chacao, Miranda', lat: 10.4960, lng: -66.8520 },
      { m: 'Baruta, Miranda', lat: 10.4350, lng: -66.8740 },
      { m: 'El Hatillo, Miranda', lat: 10.4234, lng: -66.8281 },
      { m: 'Sucre (Petare), Miranda', lat: 10.4886, lng: -66.8086 }
    ]
  },
  {
    id: 'miranda-altos',
    bbox: '10.27,-67.20,10.50,-66.55',
    centros: [
      { m: 'Los Teques, Miranda', lat: 10.3450, lng: -67.0470 },
      { m: 'San Antonio de los Altos, Miranda', lat: 10.3870, lng: -66.9540 },
      { m: 'Carrizal, Miranda', lat: 10.3370, lng: -66.9970 },
      { m: 'Guarenas, Miranda', lat: 10.4700, lng: -66.6190 },
      { m: 'Guatire, Miranda', lat: 10.4730, lng: -66.5400 },
      { m: 'Charallave, Miranda', lat: 10.2440, lng: -66.8520 },
      { m: 'Cúa, Miranda', lat: 10.1640, lng: -66.8830 },
      { m: 'Ocumare del Tuy, Miranda', lat: 10.1170, lng: -66.7800 }
    ]
  },
  {
    id: 'aragua',
    bbox: '10.10,-67.85,10.45,-67.30',
    centros: [
      { m: 'Maracay, Aragua', lat: 10.2350, lng: -67.5910 },
      { m: 'Turmero, Aragua', lat: 10.2270, lng: -67.4720 },
      { m: 'Cagua, Aragua', lat: 10.1850, lng: -67.4600 },
      { m: 'La Victoria, Aragua', lat: 10.2280, lng: -67.3290 },
      { m: 'Villa de Cura, Aragua', lat: 10.0410, lng: -67.4880 }
    ]
  },
  {
    id: 'carabobo-valencia',
    bbox: '10.05,-68.20,10.40,-67.80',
    centros: [
      { m: 'Valencia, Carabobo', lat: 10.1620, lng: -68.0080 },
      { m: 'Naguanagua, Carabobo', lat: 10.2390, lng: -68.0140 },
      { m: 'San Diego, Carabobo', lat: 10.2370, lng: -67.9520 },
      { m: 'Guacara, Carabobo', lat: 10.2310, lng: -67.8800 },
      { m: 'Los Guayos, Carabobo', lat: 10.1740, lng: -67.9020 },
      { m: 'Mariara, Carabobo', lat: 10.2620, lng: -67.7050 }
    ]
  },
  {
    id: 'lara',
    bbox: '9.75,-69.85,10.20,-69.10',
    centros: [
      { m: 'Barquisimeto, Lara', lat: 10.0680, lng: -69.3470 },
      { m: 'Cabudare, Lara', lat: 10.0290, lng: -69.2630 },
      { m: 'El Tocuyo, Lara', lat: 9.7860, lng: -69.7960 }
    ]
  },
  {
    id: 'falcon',
    bbox: '11.30,-70.30,11.80,-69.60',
    centros: [
      { m: 'Coro, Falcón', lat: 11.4030, lng: -69.6730 },
      { m: 'Punto Fijo, Falcón', lat: 11.7050, lng: -70.2080 }
    ]
  },
  {
    id: 'zulia-maracaibo',
    bbox: '10.55,-71.85,10.85,-71.50',
    centros: [
      { m: 'Maracaibo, Zulia', lat: 10.6540, lng: -71.6450 },
      { m: 'San Francisco, Zulia', lat: 10.6160, lng: -71.6210 }
    ]
  },
  {
    id: 'merida',
    bbox: '8.50,-71.30,8.70,-71.05',
    centros: [
      { m: 'Mérida, Mérida', lat: 8.5970, lng: -71.1450 },
      { m: 'Ejido, Mérida', lat: 8.5470, lng: -71.2350 }
    ]
  },
  {
    id: 'tachira',
    bbox: '7.65,-72.50,7.95,-72.00',
    centros: [
      { m: 'San Cristóbal, Táchira', lat: 7.7670, lng: -72.2250 },
      { m: 'San Antonio del Táchira, Táchira', lat: 7.8090, lng: -72.4470 },
      { m: 'Rubio, Táchira', lat: 7.7060, lng: -72.3580 }
    ]
  },
  {
    id: 'anzoategui',
    bbox: '8.80,-64.85,10.30,-64.20',
    centros: [
      { m: 'Barcelona, Anzoátegui', lat: 10.1320, lng: -64.6850 },
      { m: 'Puerto La Cruz, Anzoátegui', lat: 10.2150, lng: -64.6320 },
      { m: 'Lechería, Anzoátegui', lat: 10.2010, lng: -64.6700 },
      { m: 'El Tigre, Anzoátegui', lat: 8.8870, lng: -64.2540 }
    ]
  },
  {
    id: 'sucre',
    bbox: '10.30,-64.30,10.80,-63.20',
    centros: [
      { m: 'Cumaná, Sucre', lat: 10.4550, lng: -64.1670 },
      { m: 'Carúpano, Sucre', lat: 10.6700, lng: -63.2580 }
    ]
  },
  {
    id: 'bolivar',
    bbox: '8.05,-62.85,8.40,-62.40',
    centros: [
      { m: 'Ciudad Bolívar, Bolívar', lat: 8.1290, lng: -63.5400 },
      { m: 'Ciudad Guayana (Puerto Ordaz), Bolívar', lat: 8.3530, lng: -62.6520 }
    ]
  },
  {
    id: 'monagas',
    bbox: '9.65,-63.30,9.85,-63.10',
    centros: [
      { m: 'Maturín, Monagas', lat: 9.7470, lng: -63.1730 }
    ]
  },
  {
    id: 'nueva-esparta',
    bbox: '10.85,-64.05,11.20,-63.70',
    centros: [
      { m: 'Porlamar, Nueva Esparta', lat: 10.9560, lng: -63.8580 },
      { m: 'Pampatar, Nueva Esparta', lat: 10.9970, lng: -63.7950 },
      { m: 'La Asunción, Nueva Esparta', lat: 11.0290, lng: -63.8620 }
    ]
  },
  {
    id: 'portuguesa-yaracuy',
    bbox: '8.95,-69.85,10.40,-68.65',
    centros: [
      { m: 'Acarigua, Portuguesa', lat: 9.5560, lng: -69.1980 },
      { m: 'Araure, Portuguesa', lat: 9.5790, lng: -69.2380 },
      { m: 'Guanare, Portuguesa', lat: 9.0440, lng: -69.7510 },
      { m: 'San Felipe, Yaracuy', lat: 10.3380, lng: -68.7400 }
    ]
  },
  {
    id: 'barinas-trujillo',
    bbox: '8.50,-70.40,9.45,-70.05',
    centros: [
      { m: 'Barinas, Barinas', lat: 8.6240, lng: -70.2070 },
      { m: 'Valera, Trujillo', lat: 9.3140, lng: -70.6130 },
      { m: 'Trujillo, Trujillo', lat: 9.3680, lng: -70.4360 }
    ]
  }
];

// Allana todos los centros en una sola lista para municipioCercano.
const CENTROS = ZONAS.flatMap((z) => z.centros);

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
  if (tags.place === 'city') return 'ciudad';
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

// Prioridad para el CAP: ciudades/sectores primero, luego POIs de referencia.
function prioridad(tipo) {
  const orden = ['ciudad', 'sector', 'pueblo', 'caserío', 'hospital', 'centro de salud', 'plaza/parque', 'iglesia', 'escuela', 'mercado', 'lugar'];
  const i = orden.indexOf(tipo);
  return i === -1 ? 99 : i;
}

const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g');
const normaliza = (s) => s.normalize('NFD').replace(COMBINANTES, '').toLowerCase().trim();

function consulta(bbox) {
  return `
    [out:json][timeout:90];
    (
      node["place"~"^(city|town|village|suburb|neighbourhood|quarter|hamlet|locality)$"]["name"](${bbox});
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

// Recorrer todas las zonas. Conservamos entre zonas mediante el Set `vistos`.
const vistos = new Set();
let lugares = [];

for (const z of ZONAS) {
  console.log(`Consultando Overpass (${z.id})…`);
  const els = await overpass(z.bbox);
  console.log(`  ${els.length} elementos crudos`);
  let nuevos = 0;
  for (const el of els) {
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
    nuevos++;
  }
  console.log(`  ${nuevos} nuevos lugares (acumulado ${lugares.length})`);
  // Pequeña pausa entre zonas para ser respetuoso con Overpass.
  await sleep(800);
}

// CAP por tipo (§23 Iter 1 fix): el orden simple por prioridad llenaba el CAP
// con sectores y descartaba TODOS los hospitales/escuelas/plazas. Ahora se
// asigna cuota por tipo: los POI críticos (hospitales, salud) entran siempre,
// y los sectores/pueblos comparten el resto.
const CUOTA = {
  ciudad: Infinity,           // las ciudades son pocas, siempre todas
  municipio: Infinity,        // los centros de municipio (se reinyectan abajo)
  hospital: 400,              // referencia médica crítica
  'centro de salud': 400,
  mercado: 300,
  'plaza/parque': 400,
  iglesia: 250,
  escuela: 400,
  caserío: 300,
  pueblo: 800,
  sector: 1800,
  lugar: 200
};
const CAP_TOTAL = 5000;

// Ordena dentro de cada tipo alfabéticamente para reproducibilidad.
lugares.sort((x, y) => x.nombre.localeCompare(y.nombre));

const porTipo = new Map();
for (const l of lugares) {
  if (!porTipo.has(l.tipo)) porTipo.set(l.tipo, []);
  porTipo.get(l.tipo).push(l);
}

let seleccion = [];
for (const [tipo, arr] of porTipo) {
  const tope = CUOTA[tipo] ?? 200;
  const tomados = arr.slice(0, tope);
  seleccion.push(...tomados);
  console.log(`  ${tipo}: ${arr.length} disponibles → ${tomados.length} elegidos (tope ${tope === Infinity ? '∞' : tope})`);
}

// Si nos pasamos del CAP_TOTAL, recortar manteniendo la diversidad: quitar de
// los tipos más grandes primero (sectores) hasta llegar al CAP.
if (seleccion.length > CAP_TOTAL) {
  console.log(`  total ${seleccion.length} > ${CAP_TOTAL}; recortando sectores/pueblos al final…`);
  // Reordenamos por prioridad de tipo para que los POI queden al frente.
  seleccion.sort((x, y) => prioridad(x.tipo) - prioridad(y.tipo) || x.nombre.localeCompare(y.nombre));
  seleccion = seleccion.slice(0, CAP_TOTAL);
}

lugares = seleccion;
// Orden final por prioridad de tipo, luego nombre (el ranking del filtro
// reordena por relevancia de la query, así que esto solo afecta a queries
// muy ambiguas).
lugares.sort((x, y) => prioridad(x.tipo) - prioridad(y.tipo) || x.nombre.localeCompare(y.nombre));

// Asegura que los centros de municipio existan como entradas seleccionables
// (van al frente para que aparezcan primero en búsquedas tipo "Maracay").
for (const c of CENTROS) {
  const nombreCentro = c.m.split(',')[0].trim();
  const clave = normaliza(nombreCentro) + '|' + c.m;
  if (!vistos.has(clave)) {
    const gh = geohashForLocation([c.lat, c.lng]);
    lugares.unshift({ nombre: nombreCentro, tipo: 'municipio', municipio: c.m, lat: c.lat, lng: c.lng, geohash: gh, sectorGeo: gh.slice(0, 5) });
    vistos.add(clave);
  }
}

// Re-cap por si los unshift sobrepasaron.
if (lugares.length > CAP_TOTAL) lugares = lugares.slice(0, CAP_TOTAL);

writeFileSync(new URL('../src/lib/lugares.json', import.meta.url), JSON.stringify(lugares));
console.log(`\n✅ ${lugares.length} lugares → src/lib/lugares.json`);
console.log('   tamaño aprox:', (JSON.stringify(lugares).length / 1024).toFixed(1), 'KB (sin gzip)');
console.log('   muestra:', lugares.slice(0, 5).map((l) => `${l.nombre} (${l.tipo} · ${l.municipio})`).join(' | '));
