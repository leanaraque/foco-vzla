// Cloud Functions de FOCO (Fase 2a). Toda lógica que toca secretos o que debe ser
// no-manipulable por el cliente vive aquí (server-side, Admin SDK = bypassa rules).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

initializeApp();
const db = getFirestore();

// SECRETO (§22.7-4): la API key de Resend vive en Secret Manager, NUNCA en el
// cliente, .env del front ni el repo. Se setea con:
//   firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const DESTINO = 'hey@leanaraque.com';
const REMITENTE = 'FOCO <onboarding@resend.dev>'; // ajustar a dominio verificado en prod

const limpio = (v, max) => String(v ?? '').slice(0, max).replace(/[<>]/g, '');

// === Postulación de coordinadores → email vía Resend ======================
// Callable: el cliente solo invoca; nunca ve la key. App Check obligatorio.
export const solicitarCoordinador = onCall(
  { secrets: [RESEND_API_KEY], enforceAppCheck: true, region: 'us-central1', cors: true },
  async (req) => {
    const d = req.data || {};
    const nombre = limpio(d.nombre, 80);
    const zona = limpio(d.zona, 120);
    const contacto = limpio(d.contacto, 120);
    if (!nombre || !zona || !contacto) {
      throw new HttpsError('invalid-argument', 'Faltan nombre, zona o contacto.');
    }
    const organizacion = limpio(d.organizacion, 120);
    const motivo = limpio(d.motivo, 500);
    const uid = req.auth?.uid || 'anon';

    // Rate-limit server-side: 1 postulación por uid cada 60s (anti-spam).
    const marca = db.collection('_ratelimit_coordform').doc(uid);
    const prev = await marca.get();
    const ahora = Date.now();
    if (prev.exists && ahora - (prev.data().ts || 0) < 60000) {
      throw new HttpsError('resource-exhausted', 'Espera un momento antes de reenviar.');
    }
    await marca.set({ ts: ahora });

    const html = `
      <h2>Nueva postulación de coordinador — FOCO</h2>
      <ul>
        <li><b>Nombre:</b> ${nombre}</li>
        <li><b>Organización:</b> ${organizacion || '—'}</li>
        <li><b>Zona:</b> ${zona}</li>
        <li><b>Contacto:</b> ${contacto}</li>
        <li><b>Motivo:</b> ${motivo || '—'}</li>
        <li><b>uid:</b> ${uid}</li>
      </ul>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY.value()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: REMITENTE,
        to: [DESTINO],
        subject: `Postulación coordinador: ${nombre} (${zona})`,
        html
      })
    });
    if (!res.ok) {
      logger.error('Resend falló', res.status, await res.text());
      throw new HttpsError('internal', 'No se pudo enviar el correo.');
    }
    return { ok: true };
  }
);

// === Validación por multitud: contador + transición de estado =============
// Trigger al crear una confirmación. (§22.5)
export const onConfirmacion = onDocumentCreated(
  { document: 'necesidades/{id}/confirmaciones/{uid}', region: 'us-central1' },
  async (event) => {
    const ref = db.collection('necesidades').doc(event.params.id);
    const snap = await ref.get();
    if (!snap.exists) return;
    const n = snap.data();
    if (n.verificacion === 'confirmada' || n.verificacion === 'verificada') return;

    // F10 (defensa en profundidad): NO confiamos en el contador denormalizado (un
    // create malicioso podría pre-sembrarlo; además las rules ya lo fuerzan a 0).
    // El conteo AUTORITATIVO se deriva de la subcolección (1 confirmación por uid,
    // deduplicada por rules). COUNT es una agregación barata (no N lecturas).
    const conf = (await ref.collection('confirmaciones').count().get()).data().count;

    // N sensible a densidad (NO fijo), calculado FUERA de transacción y con
    // agregación COUNT por sector (F7: ~1 lectura, no ~20). Acotado a [2,4].
    const umbral = await calcularUmbral(n);

    const patch = { confirmaciones: conf, actualizada_en: FieldValue.serverTimestamp() };
    if (conf >= umbral) patch.verificacion = 'confirmada';
    await ref.update(patch);
  }
);

// Densidad por SECTOR (prefijo de geohash de 5 chars guardado en `sectorGeo`).
// F6: con geohashes reales (~10 chars) un rango sobre `geo.geohash` NO captura el
// sector (daba densidad ~0, umbral fijo en 2). Usamos IGUALDAD sobre `sectorGeo`
// (el prefijo estampado en el cliente y validado por las rules). COUNT, no fetch
// de documentos (F7). Más vecinos en el sector → umbral mayor.
async function calcularUmbral(n) {
  const pref = n.sectorGeo || (n.geo && n.geo.geohash ? n.geo.geohash.slice(0, 5) : null);
  if (!pref) return 2;
  const densidad = (
    await db.collection('necesidades').where('sectorGeo', '==', pref).count().get()
  ).data().count;
  if (densidad <= 3) return 2;
  if (densidad <= 10) return 3;
  return 4;
}

// === Salvaguarda del aislado (§22.5): cola del operador ====================
// Programada: las necesidades que llevan tiempo sin alcanzar N pasan a
// 'pendiente_revision' (NO se ocultan ni descartan; se PRIORIZAN). El front las
// pone primero y con badge. Corre cada hora.
export const marcarAislados = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-central1' },
  async () => {
    const corte = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 horas
    const q = db.collection('necesidades')
      .where('verificacion', '==', 'no_verificada')
      .where('creada_en', '<=', corte)
      .limit(200);
    const snap = await q.get();
    const batch = db.batch();
    let n = 0;
    snap.forEach((d) => {
      batch.update(d.ref, {
        verificacion: 'pendiente_revision',
        actualizada_en: FieldValue.serverTimestamp()
      });
      n++;
    });
    if (n) await batch.commit();
    logger.info(`marcarAislados: ${n} necesidades → pendiente_revision`);
  }
);
