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
// Trigger al crear una confirmación. Incrementa el contador (no manipulable por
// el cliente) y, al alcanzar N (sensible a densidad), marca 'confirmada' (§22.5).
export const onConfirmacion = onDocumentCreated(
  { document: 'necesidades/{id}/confirmaciones/{uid}', region: 'us-central1' },
  async (event) => {
    const ref = db.collection('necesidades').doc(event.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const n = snap.data();
      const conf = (n.confirmaciones || 0) + 1;

      // N sensible a densidad (NO fijo): en sectores con más reportes alrededor se
      // exige algo más; en zonas vacías basta con poco. Acotado a [2,4].
      const umbral = await calcularUmbral(n);

      const patch = { confirmaciones: conf, actualizada_en: FieldValue.serverTimestamp() };
      if (conf >= umbral && n.verificacion !== 'confirmada' && n.verificacion !== 'verificada') {
        patch.verificacion = 'confirmada';
      }
      tx.update(ref, patch);
    });
  }
);

// Densidad por prefijo de geohash (sector aproximado). Más vecinos → umbral mayor.
async function calcularUmbral(n) {
  const gh = n.geo?.geohash;
  if (!gh || gh.length < 5) return 2;
  const pref = gh.slice(0, 5);
  // Rango [pref, pref + ''] = mismo sector ~5km.
  const q = db.collection('necesidades')
    .where('geo.geohash', '>=', pref)
    .where('geo.geohash', '<=', pref + '')
    .limit(20);
  const snap = await q.get();
  const densidad = snap.size;
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
    const limite = Date.now() - 6 * 60 * 60 * 1000; // 6 horas
    const corte = new Date(limite);
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
