// PROMOTOR (Plan §"Arquitectura") — E/S de la conciliación STAGING → canónico.
// La lógica de DECISIÓN es pura y vive en functions/lib/promocion.js (testeable sin
// emulador). Aquí se lee el staging + los canónicos, se planea y se aplica.
//
// LÍNEA ROJA: nunca se sobrescribe el contenido de un reporte CIUDADANO (solo se le
// ADJUNTA la fuente). La gestión del operador (estado/verificacion/reclamada_por) NO
// se toca al re-ingerir. El dedup cross-source exhaustivo lo hace el curador agendado.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { mergeFuentes } from './lib/identidad.js';
import { COL_STAGING } from './lib/staging.js';
import { planearPromocion } from './lib/promocion.js';

async function leerStaging(db) {
  const snap = await db.collection(COL_STAGING).get();
  return snap.docs.map((d) => ({ _ref: d.ref, id: d.id, ...d.data() }));
}

async function leerCanonicos(db) {
  const [nec, rec] = await Promise.all([db.collection('necesidades').get(), db.collection('recursos').get()]);
  const map = (snap) => snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  return { necesidades: map(nec), recursos: map(rec) };
}

// Promueve el staging al canónico. Aplica la compuerta de PII (→ _revision_ingesta).
export async function promoverTodo(db = getFirestore(), ahora = Date.now()) {
  const staging = await leerStaging(db);
  const refStaging = new Map(staging.map((s) => [s.id, s._ref]));
  const hashDe = new Map(staging.map((s) => [s.id, s.hash || null]));
  const canonicos = await leerCanonicos(db);
  const ops = planearPromocion(staging, canonicos, ahora);

  let creados = 0, actualizados = 0, enRevision = 0, saltados = 0;
  const ts = FieldValue.serverTimestamp();
  // Escrituras BATCHEADAS (como el curador): cada op son ≤2 escrituras (canónico +
  // marca de staging). Sin batch, ~2400 round-trips secuenciales excedían el timeout
  // de 540s y Pub/Sub re-entregaba. Con batch (≤400 escrituras/commit) son pocas commits.
  let batch = db.batch(), escrituras = 0;
  const flush = async () => { if (escrituras) { await batch.commit(); batch = db.batch(); escrituras = 0; } };
  const limite = async () => { if (escrituras >= 400) await flush(); };

  for (const op of ops) {
    const sRef = refStaging.get(op.stagingId);
    if (op.tipo === 'saltar') { saltados++; continue; }
    if (op.tipo === 'revisar') {
      // set idempotente (re-escribir el mismo doc de revisión es inocuo) → sin get previo.
      batch.set(db.collection('_revision_ingesta').doc(op.stagingId), { staging_id: op.stagingId, destino: op.destino, motivo: op.motivo, motivos: op.motivos, creada_en: ts }); escrituras++;
      if (sRef) { batch.set(sRef, { estado_ingesta: 'revision' }, { merge: true }); escrituras++; }
      enRevision++; await limite(); continue;
    }
    const col = op.destino === 'recurso' ? 'recursos' : 'necesidades';
    if (op.tipo === 'crear') {
      const ref = db.collection(col).doc(); // id client-side, sin round-trip
      const doc = { ...op.campos, creador: op.sistema, fuentes: mergeFuentes([], op.fuente), creada_en: ts, actualizada_en: ts };
      if (op.destino === 'necesidad') {
        doc.estado = 'sin_atender'; doc.verificacion = 'no_verificada'; doc.reclamada_por = null;
        doc.fuente = 'coordinador'; doc.confirmaciones = 0;
        doc.vigencia = { ultima_confirmacion_en: ts, confirmaciones_vigencia: 0 };
      }
      batch.set(ref, doc); escrituras++;
      if (sRef) { batch.set(sRef, { promovido_a: ref.id, hash_promovido: hashDe.get(op.stagingId), estado_ingesta: 'promovido' }, { merge: true }); escrituras++; }
      creados++; await limite();
    } else if (op.tipo === 'actualizar') {
      // Solo refresca CONTENIDO si campos!=null (regla de propiedad). NUNCA toca la
      // gestión del operador (estado/verificacion/reclamada_por) ni los campos del curador.
      const patch = { fuentes: op.fuentes, actualizada_en: ts };
      if (op.campos) Object.assign(patch, op.campos);
      batch.set(db.collection(col).doc(op.canonId), patch, { merge: true }); escrituras++;
      if (sRef) { batch.set(sRef, { promovido_a: op.canonId, hash_promovido: hashDe.get(op.stagingId), estado_ingesta: 'promovido' }, { merge: true }); escrituras++; }
      actualizados++; await limite();
    }
  }
  await flush();
  logger.info(`promotor: staging ${staging.length} | creados ${creados} | actualizados ${actualizados} | en revisión ${enRevision} | saltados ${saltados}`);
  return { creados, actualizados, enRevision, saltados };
}
