// CURADOR (Spec §25.8) — Cloud Function AGENDADA que mantiene `necesidades` como
// fuente de verdad VIVA: corre cada hora, es IDEMPOTENTE y CONSERVADOR.
//
//   A) ENRIQUECE docs sin campos v2 (severidad/precision/rescate_activo/para_quien/
//      vigencia) — p.ej. lo que entre por ingesta masiva sin pasar por el form.
//   B) RECALCULA `prioridad` con DECAIMIENTO por frescura (lo viejo no reconfirmado
//      baja) — el motor mirror de src/lib/prioridad.js.
//   C) DEDUPLICA marcando `duplicado_de` SOLO en alta confianza; lo dudoso va a la
//      cola `_revision_merges` para el coordinador. LÍNEA ROJA: nunca marca como
//      duplicado un reporte CIUDADANO (uid), y un lote masivo nunca sepulta a un
//      humano: el ciudadano/verificado es siempre el canónico.
//
// No borra nada (los duplicados se ocultan en lectura por `duplicado_de`).
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

// ---- Motor de prioridad (mirror de src/lib/prioridad.js; mantener en sync) ----
const PESOS = {
  atrapados: 45, con_vida: 15, rescate_reciente: 8, medicamento_critico: 35, herido: 20,
  severidad: { total: 18, severo: 12, parcial: 6, desconocida: 4 },
  vulnerable_unidad: 5, vulnerable_max: 15,
  personas: { '+20': 10, '6-20': 7, '2-5': 4, '1': 1 },
  categoria_base: { rescate: 10, medico: 9, agua: 7, alimento: 6, refugio: 6, servicios: 3, otro: 2 },
  urgencia_reportada: { critica: 3, alta: 1, media: 0 }, decaimiento: [[72, 25], [24, 12], [6, 4]]
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function calcularPrioridad(n, ahora) {
  let p = 0; const P = PESOS;
  if (n.rescate?.atrapados) { p += P.atrapados; if (n.rescate.con_vida) p += P.con_vida; if (n.rescate.desde === '<6h') p += P.rescate_reciente; }
  if (n.medico?.tipo === 'medicamento_critico') p += P.medicamento_critico; else if (n.medico?.tipo === 'herido') p += P.herido;
  p += P.severidad[n.severidad] ?? P.severidad.desconocida;
  p += Math.min(P.vulnerable_max, (n.vulnerables?.length || 0) * P.vulnerable_unidad);
  p += P.personas[n.personas_rango] || 0;
  if (p < 10) p += P.categoria_base[n.categoria] ?? 2;
  p += P.urgencia_reportada[n.urgencia] || 0;
  const ref = n._refMs; const horas = Number.isFinite(ref) ? Math.max(0, (ahora - ref) / 3.6e6) : 0;
  for (const [h, pts] of P.decaimiento) { if (horas > h) { p -= pts; break; } }
  return clamp(Math.round(p), 0, 100);
}
const esRescateActivo = (n) => !!(n.rescate?.atrapados) || n.medico?.tipo === 'medicamento_critico';

// ---- helpers geo/texto/clasificación ----
function distM(a, b) { const R = 6371000, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const GEN = new Set(['casa', 'edificio', 'residencia', 'residencias', 'centro de acopio', 'refugio', 'hospital', 'terremotovenezuela.com', '']);
const TAGS_PRECISAS = new Set(['TV_EDIF', 'IMPORT_LAGUAIRA']);
const severidadDe = d => { const m = /da[ñn]o\s+(total|severo|parcial)/i.exec(d || ''); return m ? m[1].toLowerCase() : 'desconocida'; };
// Ciudadano = uid de Auth (mixto, largo); los lotes de ingesta son TAGS en mayúsculas.
const esCiudadano = c => typeof c === 'string' && c.length >= 20 && /[a-z]/.test(c) && /[A-Z0-9]/.test(c);
const ms = ts => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : (typeof ts === 'number' ? ts : null);

// Mejor canónico de un cluster: ciudadano > verificado > exacta > más fuentes > más viejo.
function rankCanon(a, b) {
  const s = n => (esCiudadano(n.creador) ? 8 : 0) + ((n.verificacion === 'verificada' || n.verificacion === 'confirmada') ? 4 : 0)
    + (n.precision === 'exacta' ? 2 : 0) + Math.min(1, (n.fuentes?.length || 0));
  const d = s(b) - s(a); if (d !== 0) return d;
  return (a._refMs || 0) - (b._refMs || 0); // más viejo primero
}

function clusters(docs) {
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

export const curador = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = getFirestore();
    const ahora = Date.now();
    const snap = await db.collection('necesidades').get();
    const docs = snap.docs.map(d => {
      const n = { id: d.id, ref: d.ref, ...d.data() };
      const g = n.geo; n._geo = (g && Number.isFinite(g.lat)) ? { lat: g.lat, lng: g.lng } : null;
      n._nom = norm((n.sector || '').split('·')[0]);
      n._refMs = ms(n.vigencia?.ultima_confirmacion_en) ?? ms(n.creada_en) ?? ahora;
      return n;
    });

    // --- A) enriquecer + B) recomputar prioridad (frescura) ---
    let cambios = [];
    for (const n of docs) {
      const patch = {};
      if (n.severidad == null) patch.severidad = severidadDe(n.descripcion);
      if (n.para_quien == null) patch.para_quien = 'desconocido';
      if (n.precision == null) patch.precision = TAGS_PRECISAS.has(n.creador) ? 'exacta' : 'sector';
      const sev = patch.severidad ?? n.severidad;
      const activo = n.rescate_activo != null ? n.rescate_activo : esRescateActivo(n);
      if (n.rescate_activo == null) patch.rescate_activo = activo;
      if (n.vigencia == null) patch.vigencia = { ultima_confirmacion_en: n.creada_en ?? FieldValue.serverTimestamp(), confirmaciones_vigencia: 0 };
      // prioridad con decaimiento; si rescate_activo, sintetiza atrapados para el cálculo
      const prio = calcularPrioridad({ ...n, severidad: sev, rescate: n.rescate || (activo ? { atrapados: true } : undefined) }, ahora);
      if (prio !== n.prioridad) patch.prioridad = prio;
      if (Object.keys(patch).length) cambios.push({ ref: n.ref, patch });
    }

    // --- C) deduplicar conservador + cola de revisión ---
    let dupMarcados = 0, enRevision = 0;
    for (const cl of clusters(docs)) {
      if (cl.length < 2) continue;
      const miembros = cl.map(i => docs[i]);
      const canon = miembros.slice().sort(rankCanon)[0];
      for (const m of miembros) {
        if (m.id === canon.id) continue;
        if (m.duplicado_de === canon.id) continue;        // ya marcado → idempotente
        if (esCiudadano(m.creador)) continue;             // línea roja: no marcar humanos
        // alta confianza dentro del cluster (mismo nombre y <=150m, o <=25m misma cat)
        const cerca = m._geo && canon._geo && distM(m._geo, canon._geo);
        const altaConf = (m._nom && m._nom === canon._nom && !GEN.has(m._nom) && cerca <= 150) || (m.categoria === canon.categoria && cerca <= 25);
        if (altaConf) { cambios.push({ ref: m.ref, patch: { duplicado_de: canon.id } }); dupMarcados++; }
        else {
          // media confianza → cola del coordinador (idempotente por id de par)
          const rid = [m.id, canon.id].sort().join('__');
          const rref = db.collection('_revision_merges').doc(rid);
          if (!(await rref.get()).exists) {
            await rref.set({ a: m.id, b: canon.id, sector_a: m.sector || '', sector_b: canon.sector || '',
              dist_m: Math.round(cerca || -1), motivo: 'posible-duplicado', creada_en: FieldValue.serverTimestamp() });
            enRevision++;
          }
        }
      }
    }

    // --- aplicar en lotes (<=400 por batch) ---
    for (let i = 0; i < cambios.length; i += 400) {
      const batch = db.batch();
      for (const c of cambios.slice(i, i + 400)) batch.update(c.ref, c.patch);
      await batch.commit();
    }
    logger.info(`curador: ${docs.length} docs | actualizados ${cambios.length} (enrich/prioridad+dup) | dup marcados ${dupMarcados} | en revisión ${enRevision}`);
  }
);
