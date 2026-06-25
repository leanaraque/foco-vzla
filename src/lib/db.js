// Capa de acceso a datos. Toda lectura del panel está acotada con limit() y
// paginación para controlar el costo de lecturas de Firestore (Spec §6.2 riesgo 1).
import {
  collection, doc, setDoc, updateDoc, getDoc, getDocs, getDocsFromCache,
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
export function crearNecesidad({ categoria, urgencia, sector, descripcion, gps, referencia, contacto }) {
  // Geo PÚBLICO (siempre a nivel sector ~1km): GPS real si la persona lo compartió
  // (lo más preciso) → o la REFERENCIA de lugar elegida en el autocompletado (zona
  // correcta sin GPS, §22.11) → o el centro de zona como último recurso. Las coords
  // EXACTAS del GPS van SOLO al privado (geo_exacta); la referencia de lugar es un
  // sector público y por eso NUNCA entra en geo_exacta.
  const gLat = gps?.lat, gLng = gps?.lng;
  const rLat = referencia?.lat, rLng = referencia?.lng;
  const geo =
    Number.isFinite(gLat) ? geoPublicoSeguro(gLat, gLng) :
    Number.isFinite(rLat) ? geoPublicoSeguro(rLat, rLng) :
    geoPublicoSeguro(null, null);
  const uid = auth.currentUser?.uid ?? null; // estampa de autor (F1, D2)
  const ref = doc(collection(db, 'necesidades'));

  // (1) Encola la necesidad (padre) PRIMERO. Escritura separada, no batch.
  // `sectorGeo` = prefijo de geohash (5 chars) para el cálculo de densidad del
  // umbral (F6). `confirmaciones` NO se estampa: nace ausente (==0 efectivo) y solo
  // la Cloud Function lo escribe (F10).
  const pNecesidad = setDoc(ref, {
    categoria,
    urgencia,
    sector,
    descripcion: descripcion || '',
    geo,
    sectorGeo: geo.geohash.slice(0, 5),
    estado: 'sin_atender',
    verificacion: 'no_verificada',
    fuente: 'web',
    reclamada_por: null,
    creador: uid,
    creada_en: serverTimestamp(),
    actualizada_en: serverTimestamp()
  });

  // (2) Encola el privado DESPUÉS, solo si hay algo sensible: contacto y/o GPS real.
  //     geo_exacta SOLO desde GPS (la referencia de lugar nunca es "exacta").
  //     Sin await entre ambos: ver punto 3 del comentario superior (offline-first).
  let pPrivado = Promise.resolve();
  const priv = construirPrivado(uid, contacto, gLat, gLng);
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

// --- Vista pública del mapa (PIVOTE §22) — CONTROL DE COSTO (§6.2-r1) ----
// Patrón elegido: lectura PUNTUAL paginada con CACHÉ-PRIMERO, NO un onSnapshot
// abierto. Cada carga intenta servir desde IndexedDB (getDocsFromCache, 0 lecturas
// facturables) y solo va al servidor si la caché está vacía o se fuerza un refresco
// manual (con cooldown en la UI). Así un pico viral no dispara lecturas: N usuarios
// = a lo sumo 1 página por carga/refresco, y las relecturas salen de caché.
// `pendiente_revision` (aislado) se prioriza en la UI; aquí traemos la página
// reciente y la UI lo ordena al frente (salvaguarda §22.5: más visible, no menos).
export async function leerNecesidadesPublicas({ forzarServidor = false, demo = false } = {}) {
  const col = demo ? '_demo_necesidades' : 'necesidades';
  const q = query(collection(db, col), orderBy('creada_en', 'desc'), limit(PAGINA));

  if (!forzarServidor) {
    try {
      const cache = await getDocsFromCache(q);
      if (!cache.empty) {
        return { items: cache.docs.map((d) => ({ id: d.id, ...d.data() })), origen: 'cache' };
      }
    } catch (_) { /* sin caché → al servidor */ }
  }
  const snap = await getDocs(q); // 1 página facturable; solo en frío o refresco manual
  return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })), origen: 'servidor' };
}

// Confirmación ciudadana (§22.5): el usuario crea SU confirmación (id == su uid).
// Una sola vez por uid (lo enforcan las rules). El contador y la transición de
// estado los hace la Cloud Function; aquí solo se registra el voto.
export async function confirmarNecesidad(id) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('sin-sesion');
  await setDoc(doc(db, 'necesidades', id, 'confirmaciones', uid), {
    creador: uid,
    creada_en: serverTimestamp()
  });
}

// ¿Este usuario ya confirmó esta necesidad? (lee solo su propia confirmación)
export async function yaConfirme(id) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'necesidades', id, 'confirmaciones', uid));
    return snap.exists();
  } catch (_) {
    return false;
  }
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
