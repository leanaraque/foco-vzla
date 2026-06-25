// Capa de acceso a datos. Toda lectura del panel está acotada con limit() y
// paginación para controlar el costo de lecturas de Firestore (Spec §6.2 riesgo 1).
import {
  collection, doc, setDoc, updateDoc, getDoc,
  query, where, orderBy, limit, startAfter, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from './firebase.js';
import { geoPublicoSeguro, construirPrivado } from './payload.js';

const PAGINA = 25; // tope de documentos por página → factura acotada

// --- Crear necesidad (reportante) ---------------------------------------
// El documento público NO lleva contacto ni coordenadas exactas. Esos datos
// sensibles van al subdocumento privado /privado/datos (Spec §4, frontera §6.2).
//
// ORDEN DE ESCRITURA — correctitud offline-first (nota del jurado, §19):
// La regla de `create` del privado hace get() de la necesidad padre para validar
// la autoría (creadorDe(...) == uid, F1). Por eso:
//   1) NO usar writeBatch ni runTransaction: en un commit atómico el get() de la
//      regla del privado NO ve la necesidad (se evalúan en el mismo instante) y el
//      contacto se rechazaría al sincronizar.
//   2) Encolar la necesidad (padre) ANTES que el privado. Firestore mantiene una
//      cola FIFO de mutaciones y las confirma una a una; así el padre se commitea
//      primero y la regla del privado ya lo ve al sincronizar.
//   3) NO hacer `await setDoc(padre)` antes de encolar el privado: estando OFFLINE
//      esa promesa no resuelve hasta reconectar (resuelve con el ack del servidor),
//      y el contacto NUNCA llegaría a la cola local → se perdería offline. Por eso
//      ambos setDoc se invocan de forma síncrona (encolan en orden) y solo
//      esperamos su confirmación con Promise.all en `listo`.
// Devolvemos { id, listo } donde `listo` se resuelve al confirmar el servidor.
export function crearNecesidad({ categoria, urgencia, sector, descripcion, lat, lng, contacto }) {
  // `lat`/`lng` son las coords REALES del GPS, o null/undefined si no se compartió.
  // El geo público siempre es válido (coords reales o centro de zona); geo_exacta
  // solo se guarda en el privado si hay GPS real (§20).
  const geo = geoPublicoSeguro(lat, lng);
  const uid = auth.currentUser?.uid ?? null; // estampa de autor (F1, D2)
  const ref = doc(collection(db, 'necesidades'));

  // (1) Encola la necesidad (padre) PRIMERO. Escritura separada, no batch.
  const pNecesidad = setDoc(ref, {
    categoria,
    urgencia,
    sector,
    descripcion: descripcion || '',
    geo,
    estado: 'sin_atender',
    verificacion: 'no_verificada',
    fuente: 'web',
    reclamada_por: null,
    creador: uid,
    creada_en: serverTimestamp(),
    actualizada_en: serverTimestamp()
  });

  // (2) Encola el privado DESPUÉS, solo si hay algo sensible (contacto y/o GPS).
  //     Sin await entre ambos: ver punto 3 del comentario superior (offline-first).
  let pPrivado = Promise.resolve();
  const priv = construirPrivado(uid, contacto, lat, lng);
  if (priv) {
    pPrivado = setDoc(doc(db, 'necesidades', ref.id, 'privado', 'datos'), priv);
  }

  return { id: ref.id, listo: Promise.all([pNecesidad, pPrivado]) };
}

// --- Crear recurso -------------------------------------------------------
// Mismo orden que crearNecesidad: recurso (padre) primero, privado después,
// escrituras separadas (no batch), sin await intermedio. Ver §19.
export function crearRecurso({ categoria, sector, descripcion, lat, lng, contacto }) {
  const geo = geoPublicoSeguro(lat, lng);
  const uid = auth.currentUser?.uid ?? null;
  const ref = doc(collection(db, 'recursos'));

  const pRecurso = setDoc(ref, {
    categoria,
    sector,
    descripcion: descripcion || '',
    geo,
    disponible: true,
    creador: uid,
    creada_en: serverTimestamp()
  });

  let pPrivado = Promise.resolve();
  const priv = construirPrivado(uid, contacto, lat, lng);
  if (priv) {
    pPrivado = setDoc(doc(db, 'recursos', ref.id, 'privado', 'datos'), priv);
  }

  return { id: ref.id, listo: Promise.all([pRecurso, pPrivado]) };
}

// --- Suscripción del panel (realtime acotado) ---------------------------
// Devuelve la función de desuscripción. Filtros: verificación (por defecto solo
// verificadas), categoría, urgencia. Orden por recencia.
export function suscribirNecesidades({ soloVerificadas = true, categoria = null, urgencia = null, demo = false }, cb) {
  // Modo demo (testeo 3G de Lean): colección aislada _demo_necesidades, sin
  // filtros server-side para no requerir índices propios; ficticio.
  if (demo) {
    const q = query(collection(db, '_demo_necesidades'), orderBy('creada_en', 'desc'), limit(PAGINA));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }

  const cond = [];
  if (soloVerificadas) cond.push(where('verificacion', '==', 'verificada'));
  if (categoria) cond.push(where('categoria', '==', categoria));
  if (urgencia) cond.push(where('urgencia', '==', urgencia));

  const q = query(
    collection(db, 'necesidades'),
    ...cond,
    orderBy('creada_en', 'desc'),
    limit(PAGINA)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function suscribirRecursos(cb) {
  const q = query(
    collection(db, 'recursos'),
    where('disponible', '==', true),
    orderBy('creada_en', 'desc'),
    limit(PAGINA)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// --- Acciones del coordinador (Spec casos 2–4) --------------------------
export function reclamar(id) {
  return updateDoc(doc(db, 'necesidades', id), {
    estado: 'asignada',
    reclamada_por: auth.currentUser?.uid ?? null,
    actualizada_en: serverTimestamp()
  });
}

export function resolver(id) {
  return updateDoc(doc(db, 'necesidades', id), {
    estado: 'resuelta',
    actualizada_en: serverTimestamp()
  });
}

export function reabrir(id) {
  return updateDoc(doc(db, 'necesidades', id), {
    estado: 'asignada',
    actualizada_en: serverTimestamp()
  });
}

export function verificar(id) {
  return updateDoc(doc(db, 'necesidades', id), {
    verificacion: 'verificada',
    actualizada_en: serverTimestamp()
  });
}

export function invalidar(id) {
  return updateDoc(doc(db, 'necesidades', id), {
    estado: 'cerrada_invalida',
    actualizada_en: serverTimestamp()
  });
}

// Contacto privado: solo lo puede leer un coordinador (lo enforcan las rules).
export async function leerContacto(necesidadId) {
  const snap = await getDoc(doc(db, 'necesidades', necesidadId, 'privado', 'datos'));
  return snap.exists() ? snap.data() : null;
}
