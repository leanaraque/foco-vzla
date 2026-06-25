// Lógica pura del autocompletado de ubicación (sin Svelte, unit-testeable).
// Vive aparte del componente para poder testear el ranking sin DOM ni fetch,
// y para hacer el código de Photon (fallback remoto) independiente.

import { geohashForLocation } from 'geofire-common';

// Bounding box de Venezuela continental (formato Photon: lng_min,lat_min,lng_max,lat_max).
// Limita los resultados remotos a Venezuela; si Photon devolviera algo fuera
// (puede pasar con nombres ambiguos como "San Cristóbal"), también filtramos
// localmente con `dentroDeVenezuela`.
export const BBOX_VENEZUELA = '-73.4,0.6,-59.8,12.2';

export function dentroDeVenezuela(lat, lng) {
  return lat >= 0.6 && lat <= 12.2 && lng >= -73.4 && lng <= -59.8;
}

const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g');
export const normaliza = (s) =>
  (s || '').normalize('NFD').replace(COMBINANTES, '').toLowerCase().trim();

// ¿Alguna palabra de `texto` empieza por `q`? Separadores: espacio, guion,
// paréntesis, ".,/". Reemplaza el uso de regex con escape (frágil) por un
// recorrido manual.
export function empiezaPorPalabra(texto, q) {
  const sep = /[\s\-()/.,]/;
  const L = texto.length;
  let i = 0;
  while (i < L) {
    while (i < L && sep.test(texto[i])) i++;
    if (i + q.length <= L && texto.slice(i, i + q.length) === q) return true;
    while (i < L && !sep.test(texto[i])) i++;
  }
  return false;
}

// Puntúa una sugerencia local frente a la query (ya normalizadas).
// Score MENOR = mejor. null = no matchea.
//   0 = nombre empieza por q (lo más obvio)
//   1 = palabra interna del nombre empieza por q
//   2 = nombre contiene q
//   3 = municipio empieza por q
//   4 = municipio contiene q
export function puntuar(l, q) {
  const n = normaliza(l.nombre);
  const m = normaliza(l.municipio);
  if (n.startsWith(q)) return { score: 0, len: n.length };
  if (empiezaPorPalabra(n, q)) return { score: 1, len: n.length };
  if (n.includes(q)) return { score: 2, len: n.length };
  if (m.startsWith(q)) return { score: 3, len: n.length };
  if (m.includes(q)) return { score: 4, len: n.length };
  return null;
}

// Filtro y ranking sobre el dataset local. Devuelve `max` sugerencias.
export function filtrarLocal(lugares, query, max = 6) {
  const q = normaliza(query);
  if (q.length < 2) return [];
  const matches = [];
  for (const l of lugares) {
    const p = puntuar(l, q);
    if (p) matches.push({ l, ...p });
  }
  matches.sort((a, b) => a.score - b.score || a.len - b.len || a.l.nombre.localeCompare(b.l.nombre));
  return matches.slice(0, max).map((x) => x.l);
}

// Photon devuelve nombres de estado y división administrativa en inglés (p.ej.
// "Sucre State", "Capital District", "Tachira State"). Normalizamos al español
// con tildes para que la etiqueta sea consistente con los lugares locales.
const ESTADOS_VE = {
  'amazonas state': 'Amazonas',
  'anzoategui state': 'Anzoátegui',
  'apure state': 'Apure',
  'aragua state': 'Aragua',
  'barinas state': 'Barinas',
  'bolivar state': 'Bolívar',
  'capital district': 'Distrito Capital',
  'carabobo state': 'Carabobo',
  'cojedes state': 'Cojedes',
  'delta amacuro state': 'Delta Amacuro',
  'falcon state': 'Falcón',
  'federal dependencies of venezuela': 'Dependencias Federales',
  'guarico state': 'Guárico',
  'la guaira state': 'La Guaira',
  'vargas state': 'La Guaira',          // antiguo nombre del estado
  'lara state': 'Lara',
  'merida state': 'Mérida',
  'miranda state': 'Miranda',
  'monagas state': 'Monagas',
  'nueva esparta state': 'Nueva Esparta',
  'portuguesa state': 'Portuguesa',
  'sucre state': 'Sucre',
  'tachira state': 'Táchira',
  'trujillo state': 'Trujillo',
  'yaracuy state': 'Yaracuy',
  'zulia state': 'Zulia'
};

export function normalizarEstadoPhoton(s) {
  if (!s) return s;
  const k = normaliza(s);
  return ESTADOS_VE[k] || s;
}

// "Parroquia Lechería" / "Municipio Liberta" → mantenemos como vienen (ya están
// en español). Pero hay casos en inglés ("Municipality of X") que normalizamos.
const PREFIJOS_INGLES = [
  ['municipality of ', 'Municipio '],
  ['parish of ', 'Parroquia ']
];

export function normalizarCiudadPhoton(s) {
  if (!s) return s;
  const low = s.toLowerCase();
  for (const [from, to] of PREFIJOS_INGLES) {
    if (low.startsWith(from)) return to + s.slice(from.length);
  }
  return s;
}

// Mapea un feature GeoJSON de Photon al shape interno {nombre, tipo, municipio,
// lat, lng, geohash, sectorGeo}. Devuelve `null` si el feature no cumple los
// mínimos (sin coords, sin nombre, fuera de Venezuela).
//
// Photon devuelve features con properties OSM-like (osm_key, osm_value, type,
// name, city, state, country, county, district, ...). Construimos un
// `municipio` legible combinando los campos disponibles.
export function photonAGusto(feature) {
  if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!dentroDeVenezuela(lat, lng)) return null;
  const p = feature.properties || {};
  if (p.country && normaliza(p.country) !== 'venezuela') return null;
  const nombre = (p.name || '').trim();
  if (!nombre) return null;
  // Construir "Ciudad, Estado" para el campo municipio (legible y consistente
  // con los lugares locales). Fallback a county/district si city falta.
  const ciudad = normalizarCiudadPhoton(p.city || p.county || p.district || p.locality || '');
  const estado = normalizarEstadoPhoton(p.state || '');
  const municipio = [ciudad, estado].filter(Boolean).join(', ').trim() || 'Venezuela';
  const tipo = photonATipo(p);
  const geohash = geohashForLocation([lat, lng]);
  return {
    nombre,
    tipo,
    municipio,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    geohash,
    sectorGeo: geohash.slice(0, 5),
    _origen: 'photon'    // marca para la UI (badge "más resultados")
  };
}

// Mapea el (osm_key,osm_value) de Photon al tipo amigable del proyecto.
export function photonATipo(p) {
  const key = p.osm_key || '';
  const val = p.osm_value || '';
  if (key === 'place') {
    if (val === 'city') return 'ciudad';
    if (val === 'town' || val === 'village') return 'pueblo';
    if (val === 'suburb' || val === 'neighbourhood' || val === 'quarter') return 'sector';
    if (val === 'hamlet' || val === 'locality') return 'caserío';
  }
  if (key === 'amenity') {
    if (val === 'hospital') return 'hospital';
    if (val === 'clinic') return 'centro de salud';
    if (val === 'school' || val === 'college' || val === 'university') return 'escuela';
    if (val === 'place_of_worship') return 'iglesia';
    if (val === 'marketplace') return 'mercado';
  }
  if (key === 'leisure' && (val === 'park' || val === 'pitch')) return 'plaza/parque';
  if (key === 'healthcare') return 'centro de salud';
  if (key === 'highway' || key === 'street') return 'calle';
  if (key === 'building') return 'edificio';
  return 'lugar';
}

// Divide `texto` en partes según las ocurrencias de `query` (ya normalizada).
// La comparación es insensible a acentos/mayúsculas: matchea sobre la versión
// normalizada del texto pero devuelve los CARACTERES ORIGINALES (con tildes y
// mayúsculas como vinieron). Útil para hacer highlight con <mark> en la UI.
//
// Devuelve: [{ t: 'sub', match: bool }, ...]
//   - "Plaza Bolívar" + query="bol" →
//       [{t:'Plaza ',match:false},{t:'Bol',match:true},{t:'ívar',match:false}]
//   - "Mérida" + query="merida" →
//       [{t:'Mérida',match:true}]  (match completo, normalización absorbe el í)
//
// Casos límite: query vacía o sin matches → devuelve [{t: texto, match: false}].
export function marcar(texto, query) {
  if (!texto) return [];
  if (!query || query.length === 0) return [{ t: texto, match: false }];
  const txt = String(texto);
  const tNorm = normaliza(txt);
  // Mapa de índices: normaliza puede acortar el texto (eliminar combinantes).
  // Iteramos sobre el original carácter a carácter para mantener la posición
  // de cada char y comparamos su versión normalizada acumulada.
  // Atajo: como normaliza usa NFD que SOLO descompone, cada char original
  // produce 1 char base + 0+ combinantes; entonces normalizando char a char
  // y descartando combinantes (que ya quita normaliza), la longitud de la
  // forma normalizada de cada char original es 1 (excepto si el char ya era
  // un combinante; tratamos eso como 0).
  const mapa = [];   // mapa[iOrig] = posición en tNorm
  let pos = 0;
  for (let i = 0; i < txt.length; i++) {
    mapa.push(pos);
    const segN = normaliza(txt[i]);
    pos += segN.length;
  }
  mapa.push(pos);  // sentinela final

  const out = [];
  let iOrig = 0;
  while (iOrig < txt.length) {
    const posN = mapa[iOrig];
    if (tNorm.startsWith(query, posN)) {
      // Encontrar dónde termina el match en el original (donde mapa[j] llega a posN+query.length).
      let jOrig = iOrig;
      while (jOrig < txt.length && mapa[jOrig + 1] - posN < query.length) jOrig++;
      // mapa[jOrig+1] - posN >= query.length → jOrig es el último char incluido
      out.push({ t: txt.slice(iOrig, jOrig + 1), match: true });
      iOrig = jOrig + 1;
    } else {
      // acumular chars no-match hasta encontrar el siguiente match o EOF
      let jOrig = iOrig + 1;
      while (jOrig < txt.length && !tNorm.startsWith(query, mapa[jOrig])) jOrig++;
      out.push({ t: txt.slice(iOrig, jOrig), match: false });
      iOrig = jOrig;
    }
  }
  return out;
}

// Quita duplicados entre la lista local y la remota usando (nombre+municipio
// normalizados) como clave. Conserva el primero (local > remoto por el orden
// con que se pase).
export function dedupe(items) {
  const visto = new Set();
  const out = [];
  for (const it of items) {
    const k = normaliza(it.nombre) + '|' + normaliza(it.municipio);
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(it);
  }
  return out;
}
