// CURADOR (Spec §25.8) — Cloud Function AGENDADA que mantiene `necesidades` como
// fuente de verdad VIVA: corre cada hora, es IDEMPOTENTE y CONSERVADOR.
//
//   A) ENRIQUECE docs sin campos v2 (severidad/precision/rescate_activo/para_quien/
//      vigencia) — p.ej. lo que entre por ingesta masiva sin pasar por el form.
//   B) RECALCULA `prioridad` con DECAIMIENTO por frescura (lo viejo no reconfirmado
//      baja) — el motor compartido functions/lib/prioridad.js (mirror del cliente).
//   C) DEDUPLICA marcando `duplicado_de` SOLO en alta confianza; lo dudoso va a la
//      cola `_revision_merges` para el coordinador. LÍNEA ROJA: nunca marca como
//      duplicado un reporte CIUDADANO (uid), y un lote masivo nunca sepulta a un
//      humano: el ciudadano/verificado es siempre el canónico.
//
// No borra nada (los duplicados se ocultan en lectura por `duplicado_de`).
// El motor de prioridad y los helpers de dedup viven en functions/lib/ y se comparten
// con el promotor de ingesta (functions/promotor.js) para no duplicar la lógica.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { calcularPrioridad, esRescateActivo } from './lib/prioridad.js';
import { norm, severidadDe, TAGS_PRECISAS, esCiudadano, ms, distM, rankCanon, clusters, GEN } from './lib/dedup.js';

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
