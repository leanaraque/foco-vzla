// Helpers de DEDUP y clasificación, extraídos de curador.js para compartirlos con
// el promotor de ingesta. Comportamiento IDÉNTICO al original (no cambiar sin
// re-verificar el curador). El dedup es conservador y respeta la LÍNEA ROJA:
// ciudadano > confirmado-multitud > lote masivo; nunca se marca/sepulta un humano.

// Distancia en metros (haversine).
export function distM(a, b) { const R = 6371000, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

// Normalizador (acentos fuera, minúsculas, espacios colapsados).
export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Nombres genéricos que NO distinguen una entidad (no se usan para emparejar).
export const GEN = new Set(['casa', 'edificio', 'residencia', 'residencias', 'centro de acopio', 'refugio', 'hospital', 'terremotovenezuela.com', '']);

// Lotes cuya coordenada pública es EXACTA (sitios públicos de desastre).
export const TAGS_PRECISAS = new Set(['TV_EDIF', 'IMPORT_LAGUAIRA']);

// Severidad inferida de la descripción libre ("daño total/severo/parcial").
export const severidadDe = d => { const m = /da[ñn]o\s+(total|severo|parcial)/i.exec(d || ''); return m ? m[1].toLowerCase() : 'desconocida'; };

// Ciudadano = uid de Auth (mixto, largo); los lotes de ingesta son TAGS en mayúsculas.
export const esCiudadano = c => typeof c === 'string' && c.length >= 20 && /[a-z]/.test(c) && /[A-Z0-9]/.test(c);

// Lee ms epoch de un Timestamp de Firestore o de un número.
export const ms = ts => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : (typeof ts === 'number' ? ts : null);

// Mejor canónico de un cluster: ciudadano > verificado > exacta > más fuentes > más viejo.
export function rankCanon(a, b) {
  const s = n => (esCiudadano(n.creador) ? 8 : 0) + ((n.verificacion === 'verificada' || n.verificacion === 'confirmada') ? 4 : 0)
    + (n.precision === 'exacta' ? 2 : 0) + Math.min(1, (n.fuentes?.length || 0));
  const d = s(b) - s(a); if (d !== 0) return d;
  return (a._refMs || 0) - (b._refMs || 0); // más viejo primero
}

// Agrupa docs en clusters de posibles duplicados (union-find): proximidad <=25m con
// misma categoría, o mismo nombre distintivo <=150m. Requiere que cada doc traiga
// _geo {lat,lng} (o null) y _nom (nombre normalizado del primer segmento del sector).
export function clusters(docs) {
  const parent = docs.map((_, i) => i); const find = x => parent[x] === x ? x : (parent[x] = find(parent[x])); const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const cell = 0.0003, grid = new Map();
  docs.forEach((r, i) => { if (!r._geo) return; const k = `${Math.floor(r._geo.lat / cell)},${Math.floor(r._geo.lng / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  // proximidad <=25m misma categoría (alta confianza)
  docs.forEach((r, i) => { if (!r._geo) return; const ci = Math.floor(r._geo.lat / cell), cj = Math.floor(r._geo.lng / cell); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const j of grid.get(`${ci + di},${cj + dj}`) || []) if (j > i && docs[j]._geo && docs[j].categoria === r.categoria && distM(r._geo, docs[j]._geo) <= 25) uni(i, j); });
  // mismo nombre distintivo y <=150m (alta confianza)
  const byName = new Map();
  docs.forEach((r, i) => { if (r._nom && r._nom.length >= 5 && !GEN.has(r._nom)) (byName.get(r._nom) || byName.set(r._nom, []).get(r._nom)).push(i); });
  for (const idx of byName.values()) for (let a = 1; a < idx.length; a++) { const A = docs[idx[0]], B = docs[idx[a]]; if (A._geo && B._geo && distM(A._geo, B._geo) <= 150) uni(idx[0], idx[a]); }
  const g = new Map(); docs.forEach((_, i) => { const root = find(i); (g.get(root) || g.set(root, []).get(root)).push(i); }); return [...g.values()];
}
