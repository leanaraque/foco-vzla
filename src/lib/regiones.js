// Agrupación geográfica para el STORYTELLING (capa de presentación, NO datos).
// Módulo PURO: agrupa necesidades/recursos en regiones legibles para la narrativa
// de la home. No accede a Firebase ni muta nada; solo lee item.geo.{lat,lng}.
//
// Frontera: esto es presentación, no el modelo de datos. Cuando el esquema canónico
// (§25) traiga `estado`/`municipio` poblados, `regionDe` los preferirá y las cajas
// geográficas quedan solo como respaldo. Por eso es forward-compatible.

// Cajas aproximadas de las zonas más golpeadas por el sismo del 24-jun-2026.
// [latMin, latMax, lngMin, lngMax]. El orden importa: primera coincidencia gana
// (la costa de La Guaira se evalúa antes que Caracas para no solaparse).
export const REGIONES = [
  { id: 'la_guaira',  nombre: 'La Guaira / costa',        bbox: [10.55, 10.72, -67.15, -66.30] },
  { id: 'caracas',    nombre: 'Caracas (Dtto. Capital)',  bbox: [10.42, 10.55, -67.10, -66.78] },
  { id: 'miranda',    nombre: 'Miranda (este)',           bbox: [10.30, 10.55, -66.78, -66.40] },
  { id: 'carabobo',   nombre: 'Carabobo (Valencia/Morón)',bbox: [10.05, 10.70, -68.35, -67.75] },
  { id: 'aragua',     nombre: 'Aragua (Maracay)',         bbox: [10.10, 10.45, -67.75, -67.35] },
  { id: 'anzoategui', nombre: 'Anzoátegui',               bbox: [ 9.90, 10.35, -65.20, -64.55] }
];

// Mapeo de un nombre de estado (esquema v2 futuro) a id de región.
const POR_ESTADO = {
  'la guaira': 'la_guaira', 'vargas': 'la_guaira',
  'distrito capital': 'caracas', 'dtto capital': 'caracas', 'caracas': 'caracas',
  'miranda': 'miranda', 'carabobo': 'carabobo', 'aragua': 'aragua', 'anzoategui': 'anzoategui'
};
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Devuelve el id de región de un item, o null si no encaja en ninguna conocida.
export function regionDe(item) {
  // Preferir el estado tipado si existe (forward-compatible con §25).
  if (item?.estado) { const r = POR_ESTADO[norm(item.estado)]; if (r) return r; }
  const lat = item?.geo?.lat, lng = item?.geo?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const r of REGIONES) {
    const [la, lb, lo, lp] = r.bbox;
    if (lat >= la && lat <= lb && lng >= lo && lng <= lp) return r.id;
  }
  return null;
}

// Agrupa en filas {id, nombre, nec, rec} ordenadas por necesidad desc. Solo
// incluye zonas con al menos un dato. "Otras zonas" agrupa lo que no encaja.
export function agruparPorZona(necesidades = [], recursos = []) {
  const m = new Map();
  for (const r of REGIONES) m.set(r.id, { id: r.id, nombre: r.nombre, nec: 0, rec: 0 });
  m.set('otra', { id: 'otra', nombre: 'Otras zonas', nec: 0, rec: 0 });

  for (const n of necesidades) m.get(regionDe(n) || 'otra').nec++;
  for (const x of recursos) m.get(regionDe(x) || 'otra').rec++;

  return [...m.values()]
    .filter((z) => z.nec || z.rec)
    .sort((a, b) => b.nec - a.nec || b.rec - a.rec);
}
