// INGESTA (Plan §"Arquitectura") — Cloud Function AGENDADA que mantiene
// focovenezuela.org actualizada desde las fuentes externas, SIN duplicar.
// Cada ~3h: corre cada adapter AISLADO (un fallo de una fuente no tumba el resto),
// escribe al staging con upsert idempotente, y luego promueve staging → canónico.
//
// Agregar una fuente nueva = un import + una entrada en ADAPTERS (tras pasar la
// rúbrica de calificación, Plan Fase 1).
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { correrAdapter } from './lib/recolector.js';
import { promoverTodo } from './promotor.js';
import * as terremotovenezuela from './adapters/terremotovenezuela.js';
import * as terremotovenezuelaApp from './adapters/terremotovenezuela-app.js';
import * as ayudavenezuela from './adapters/ayudavenezuela.js';
import * as rescateVe from './adapters/rescate-ve.js';

// Registro de adapters activos (fuentes ya calificadas y probadas).
// Pendientes de captura de anon key por panel de red (ver adapters/PENDIENTES.md):
// ayudaparavenezuela.com y refugiosvenezuela.com (Supabase).
export const ADAPTERS = [terremotovenezuela, terremotovenezuelaApp, ayudavenezuela, rescateVe];

export const ingesta = onSchedule(
  { schedule: 'every 180 minutes', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore();
    const resumen = [];
    for (const adapter of ADAPTERS) {
      try {
        const r = await correrAdapter(db, adapter);
        resumen.push(r);
        logger.info(`ingesta[${adapter.sistema}]: ${r.escritos} a staging, ${r.rechazos} rechazos`);
      } catch (e) {
        // Aislamiento: el fallo de una fuente NO avanza su watermark ni detiene el resto.
        logger.error(`ingesta[${adapter.sistema}] FALLÓ (aislado): ${e?.message || e}`);
      }
    }
    const prom = await promoverTodo(db);
    logger.info(`ingesta: promoción ${JSON.stringify(prom)} | fuentes ${JSON.stringify(resumen)}`);
  }
);
