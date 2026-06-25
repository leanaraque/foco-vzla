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
  const ciudad = p.city || p.county || p.district || p.locality || '';
  const estado = p.state || '';
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
