// PROCESADOR (Plan §"procesar") — Cloud Function AGENDADA que mantiene los datos
// ESTANDARIZADOS, RESUMIDOS y con GEO mejorada, de forma RECURRENTE e IDEMPOTENTE.
// Cada 2h: toma un lote de necesidades NUEVAS o CAMBIADAS (filtro por hash de contenido
// → no re-llama al LLM por lo ya procesado, controla el costo), y por cada una:
//   extracción tipada (§25) + geo-enricher (OSM) + resumen híbrido (reglas + Claude).
// Auto-aplica lo confiable; lo dudoso (geo en conflicto) va a `_procesar_revision`
// para el operador. La key de Anthropic vive en Secret Manager (nunca en el repo).
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { necesitaProceso, procesarUno } from './lib/procesar.js';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MAX_POR_RUN = 25; // cota de costo/tiempo por ejecución (geocode con throttle)

export const procesador = onSchedule(
  { schedule: 'every 120 minutes', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', secrets: [ANTHROPIC_API_KEY] },
  async () => {
    const db = getFirestore();
    const apiKey = ANTHROPIC_API_KEY.value();
    const snap = await db.collection('necesidades').get();
    const todos = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
      .filter((d) => !d.duplicado_de && necesitaProceso(d));
    const pendientes = todos.slice(0, MAX_POR_RUN);

    const ts = FieldValue.serverTimestamp();
    let procesados = 0, enRevision = 0, viaIa = 0;
    for (const d of pendientes) {
      try {
        const { patch, revision, _resumen } = await procesarUno(d, { apiKey, ahoraTs: ts });
        await d.ref.set(patch, { merge: true });
        if (_resumen?.via === 'ia') viaIa++;
        if (revision) {
          await db.collection('_procesar_revision').doc(d.id).set({ necesidad_id: d.id, sector: d.sector || '', ...revision, creada_en: ts }, { merge: true });
          enRevision++;
        }
        procesados++;
      } catch (e) {
        logger.error(`procesador[${d.id}] falló: ${e?.message || e}`);
      }
    }
    logger.info(`procesador: ${procesados} procesados (resumen IA ${viaIa}) | geo en revisión ${enRevision} | quedan ~${todos.length - procesados} por procesar`);
  }
);
