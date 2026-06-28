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

// === Solicitud de la comunidad (Resuelto / Corrección) → cola del Panel =======
// Callable: un usuario propone que un punto ya recibió ayuda (tipo 'resuelto') o
// aporta una corrección/más detalles (tipo 'correccion'). NO cambia la necesidad ni
// su estado (eso solo lo hace un coordinador desde el Panel). FUENTE DE VERDAD: se
// PERSISTE una solicitud en `solicitudes` (Admin SDK → bypassa rules; el cliente no
// puede escribirla directo) para que el coordinador la GESTIONE desde el Panel.
// Además avisa por correo (best-effort: si Resend falla, la solicitud ya quedó
// guardada y NO se pierde). App Check obligatorio + rate-limit (anti-spam).
export const solicitarResolucion = onCall(
  { secrets: [RESEND_API_KEY], enforceAppCheck: true, region: 'us-central1', cors: true },
  async (req) => {
    const d = req.data || {};
    const id = limpio(d.id, 60);
    if (!id) throw new HttpsError('invalid-argument', 'Falta el id del punto.');
    const sector = limpio(d.sector, 160);
    const categoria = limpio(d.categoria, 40);
    const urgencia = limpio(d.urgencia, 20);
    const descripcion = limpio(d.descripcion, 500);
    const motivo = limpio(d.motivo, 200);     // ¿por qué cree que fue atendido?
    const fuente = limpio(d.fuente, 120);      // ¿cómo lo sabe?
    const contacto = limpio(d.contacto, 120);  // opcional, para seguimiento
    const url = limpio(d.url, 200);
    const tipo = d.tipo === 'correccion' ? 'correccion' : 'resuelto';
    const detalle = limpio(d.detalle, 500);
    const uid = req.auth?.uid || 'anon';

    // Rate-limit server-side: 1 solicitud por uid cada 60s (anti-spam, defensa real).
    const marca = db.collection('_ratelimit_resolucion').doc(uid);
    const prev = await marca.get();
    const ahora = Date.now();
    if (prev.exists && ahora - (prev.data().ts || 0) < 60000) {
      throw new HttpsError('resource-exhausted', 'Espera un momento antes de reenviar.');
    }
    await marca.set({ ts: ahora });

    // (1) PERSISTIR la solicitud → cola del Panel (fuente de verdad). Nace 'pendiente'.
    await db.collection('solicitudes').add({
      tipo,                          // 'resuelto' | 'correccion'
      necesidadId: id,
      sector, categoria, urgencia, descripcion,
      motivo, fuente,                // específicos de 'resuelto'
      detalle,                       // específico de 'correccion'
      contacto, url, uid,
      estado: 'pendiente',
      creada_en: FieldValue.serverTimestamp()
    });

    // (2) Avisar por correo — BEST-EFFORT: la solicitud ya quedó guardada; si el
    // correo falla, NO devolvemos error (no se pierde nada; se gestiona en el Panel).
    try {
      const esCorr = tipo === 'correccion';
      const titulo = esCorr ? 'Corrección / más detalles de un punto' : 'Aviso: ya recibieron ayuda — revisar y cerrar';
      const intro = esCorr
        ? 'Un usuario propone una corrección o aporta más detalles sobre este punto. Revísalo en el Panel y actualízalo si procede.'
        : 'Un usuario reporta que este punto ya recibió ayuda. Revísalo en el Panel y, si procede, márcalo resuelto.';
      const especifico = esCorr
        ? `<li><b>Corrección / detalle:</b> ${detalle || '—'}</li>`
        : `<li><b>¿Por qué fue atendido?:</b> ${motivo || '—'}</li><li><b>¿Cómo lo sabe?:</b> ${fuente || '—'}</li>`;
      const html = `
        <h2>${titulo}</h2>
        <p>${intro}</p>
        <ul>
          <li><b>Punto:</b> ${sector || '—'}</li>
          <li><b>Categoría:</b> ${categoria || '—'} · <b>Urgencia:</b> ${urgencia || '—'}</li>
          <li><b>Descripción:</b> ${descripcion || '—'}</li>
          ${especifico}
          <li><b>Contacto del reportante:</b> ${contacto || '—'}</li>
          <li><b>id:</b> ${id}</li>
          <li><b>Enlace al punto:</b> <a href="${url}">${url || '—'}</a></li>
          <li><b>uid:</b> ${uid}</li>
        </ul>
        <p>Gestiónalo en el Panel: solicitudes de la comunidad.</p>`;
      const subject = esCorr ? `Corrección: ${sector || id}` : `Ya recibieron ayuda: ${sector || id}`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: REMITENTE, to: [DESTINO], subject, html })
      });
      if (!res.ok) logger.warn('Resend (solicitud) no envió', res.status, await res.text());
    } catch (e) {
      logger.warn('Resend (solicitud) lanzó, se ignora (solicitud ya guardada)', e?.message || e);
    }

    return { ok: true };
  }
);

// === Editar necesidad (aplicar una corrección) → solo coordinador ============
// Las rules PROHÍBEN que un coordinador reescriba el contenido del reporte (F3:
// `updateGestionValido` solo permite estado/verificacion/reclamada_por). Para aplicar
// una corrección legítima (urgencia/categoría/descripción/sector/ubicación/contacto)
// se usa esta función (Admin SDK = bypassa rules), gateada por App Check + rol de
// coordinador. La ubicación PÚBLICA se mantiene aproximada (el cliente envía `geo`
// ya difuminado vía geoPublico); las coords exactas van al privado (geo_exacta, §9-1).
// Si se pasa `solicitudId`, marca esa solicitud como gestionada en la misma operación.
const CATS_EDIT = ['rescate','medico','agua','alimento','refugio','transporte','acopio','servicios','otro'];
const URGS_EDIT = ['critica','alta','media'];
export const editarNecesidad = onCall(
  { enforceAppCheck: true, region: 'us-central1', cors: true },
  async (req) => {
    if (req.auth?.token?.coordinador !== true) {
      throw new HttpsError('permission-denied', 'Solo un coordinador puede editar.');
    }
    const d = req.data || {};
    const necesidadId = limpio(d.necesidadId, 60);
    if (!necesidadId) throw new HttpsError('invalid-argument', 'Falta necesidadId.');
    const ref = db.collection('necesidades').doc(necesidadId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'La necesidad no existe.');

    // --- Campos públicos (solo los provistos) ---
    // `editado_por_operador`: marca el doc como tocado por un humano. La ingesta
    // recurrente NO volverá a pisar su contenido (regla de propiedad en
    // functions/lib/promocion.js) aunque la necesidad sea de origen ingesta.
    const pub = { editado_por_operador: true };
    if (d.categoria != null) {
      const c = limpio(d.categoria, 40);
      if (!CATS_EDIT.includes(c)) throw new HttpsError('invalid-argument', 'Categoría inválida.');
      pub.categoria = c;
    }
    if (d.urgencia != null) {
      const u = limpio(d.urgencia, 20);
      if (!URGS_EDIT.includes(u)) throw new HttpsError('invalid-argument', 'Urgencia inválida.');
      pub.urgencia = u;
    }
    if (d.descripcion != null) pub.descripcion = limpio(d.descripcion, 500);
    if (d.sector != null) {
      const s = limpio(d.sector, 140);
      if (!s) throw new HttpsError('invalid-argument', 'El sector no puede quedar vacío.');
      pub.sector = s;
    }
    // Ubicación PÚBLICA (aproximada): el cliente la difumina con geoPublico y la envía.
    if (d.geo && Number.isFinite(d.geo.lat) && Number.isFinite(d.geo.lng) && typeof d.geo.geohash === 'string') {
      pub.geo = { lat: d.geo.lat, lng: d.geo.lng, geohash: d.geo.geohash };
      pub.sectorGeo = d.geo.geohash.slice(0, 5);
    }
    if (Object.keys(pub).length) {
      pub.actualizada_en = FieldValue.serverTimestamp();
      await ref.update(pub);
    }

    // --- Subdocumento privado: contacto + coords exactas ---
    const priv = {};
    if (d.contacto != null) priv.contacto = limpio(d.contacto, 140);
    if (d.geo_exacta && Number.isFinite(d.geo_exacta.lat) && Number.isFinite(d.geo_exacta.lng)) {
      priv.geo_exacta = { lat: d.geo_exacta.lat, lng: d.geo_exacta.lng };
    }
    if (Object.keys(priv).length) {
      await ref.collection('privado').doc('datos').set(
        { creador: snap.data().creador || 'coordinador', ...priv },
        { merge: true }
      );
    }

    // --- Cierra la solicitud que originó la edición ---
    const solicitudId = limpio(d.solicitudId, 60);
    if (solicitudId) {
      await db.collection('solicitudes').doc(solicitudId).set({
        estado: 'gestionada',
        nota: limpio(d.nota, 300),
        gestionada_por: req.auth.uid,
        gestionada_en: FieldValue.serverTimestamp()
      }, { merge: true });
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
    // SOLO escala reportes INDIVIDUALES de la app (fuente=='web'): la salvaguarda del
    // aislado (§22.5) protege un grito de ayuda CIUDADANO que no alcanzó N confirmaciones.
    // Los LOTES MASIVOS de fuente (ingesta: fuente=='coordinador') NO escalan — son datos
    // estructurados, ya visibles en el mapa marcados como no_verificada; escalarlos
    // inundaba la cola del operador (cientos de edificios) y diluía su valor.
    const q = db.collection('necesidades')
      .where('verificacion', '==', 'no_verificada')
      .where('fuente', '==', 'web')
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

// === Curador agendado (§25.8): mantiene `necesidades` como fuente de verdad viva
// (enriquece, recalcula prioridad con frescura, deduplica conservador + cola de
// revisión). Vive en su propio módulo por tamaño.
export { curador } from './curador.js';

// === Ingesta agendada (Plan): jala las fuentes externas a staging (upsert
// idempotente) y promueve a `necesidades`/`recursos` sin duplicar. Vive en su módulo.
export { ingesta } from './ingesta.js';

// === Procesador agendado (Plan §"procesar"): estandariza/tipa, mejora la geo con
// info externa y resume (reglas + Claude), idempotente por hash. Vive en su módulo.
export { procesador } from './procesador.js';
