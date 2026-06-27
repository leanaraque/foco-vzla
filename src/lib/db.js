// Capa de acceso a datos. Toda lectura del panel está acotada con limit() y
// paginación para controlar el costo de lecturas de Firestore (Spec §6.2 riesgo 1).
import {
  collection, doc, setDoc, updateDoc, getDoc, getDocs, getDocsFromCache,
  query, where, orderBy, limit, startAfter, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth, app } from './firebase.js';
import { geoPublicoSeguro, construirPrivado, construirNecesidadPublica } from './payload.js';

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

// --- Crear necesidad v2 (esquema canónico §25.3) -------------------------
// Mismo contrato offline-first que crearNecesidad (escrituras separadas, padre
// antes que privado, sin await intermedio; ver §19). Usa el constructor PURO
// `construirNecesidadPublica` (datos tipados + prioridad/severidad derivadas) y
// añade aquí los campos de servidor (estado/verificación/creador/timestamps/
// vigencia). El contacto, coords exactas, "cómo llegar" y contacto alterno van
// SOLO al privado (frontera §6.2-r2, §25.9). Coexiste con las rules V1||V2.
export function crearNecesidadV2(inp) {
  const uid = auth.currentUser?.uid ?? null;
  const ref = doc(collection(db, 'necesidades'));
  const publico = construirNecesidadPublica(inp);

  const pNec = setDoc(ref, {
    ...publico,
    fuente: 'web',
    estado: 'sin_atender',
    verificacion: 'no_verificada',
    reclamada_por: null,
    creador: uid,
    vigencia: { ultima_confirmacion_en: serverTimestamp(), confirmaciones_vigencia: 0 },
    creada_en: serverTimestamp(),
    actualizada_en: serverTimestamp()
  });

  let pPriv = Promise.resolve();
  const priv = construirPrivado(uid, (inp.contacto || '').trim(), inp.gps?.lat ?? null, inp.gps?.lng ?? null,
    { como_llegar: inp.como_llegar, contacto_alterno: inp.contacto_alterno });
  if (priv) pPriv = setDoc(doc(db, 'necesidades', ref.id, 'privado', 'datos'), priv);

  return { id: ref.id, listo: Promise.all([pNec, pPriv]) };
}

// --- Crear recurso -------------------------------------------------------
// Mismo orden que crearNecesidad: recurso (padre) primero, privado después,
// escrituras separadas (no batch), sin await intermedio. Ver §19.
export function crearRecurso({ categoria, sector, descripcion, gps, referencia, contacto }) {
  // Igual que crearNecesidad (§22.11/§23): geo público a nivel sector (GPS o pin →
  // referencia → centro de zona); coords EXACTAS solo al privado vía gps/pin.
  const gLat = gps?.lat, gLng = gps?.lng;
  const rLat = referencia?.lat, rLng = referencia?.lng;
  const geo =
    Number.isFinite(gLat) ? geoPublicoSeguro(gLat, gLng) :
    Number.isFinite(rLat) ? geoPublicoSeguro(rLat, rLng) :
    geoPublicoSeguro(null, null);
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
  const priv = construirPrivado(uid, contacto, gLat, gLng);
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
export async function leerNecesidadesPublicas({ forzarServidor = false, demo = false, max = 2000 } = {}) {
  // `max` mayor que el panel: el mapa público debe mostrar TODAS las necesidades
  // (no solo una página), y el buscador filtra sobre lo cargado. Sigue siendo una
  // lectura puntual con caché-primero (no listener) → costo acotado (§6.2-r1).
  const col = demo ? '_demo_necesidades' : 'necesidades';
  const q = query(collection(db, col), orderBy('creada_en', 'desc'), limit(max));

  if (!forzarServidor) {
    try {
      const cache = await getDocsFromCache(q);
      if (!cache.empty) {
        return { items: cache.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.duplicado_de), origen: 'cache' };
      }
    } catch (_) { /* sin caché → al servidor */ }
  }
  const snap = await getDocs(q); // 1 página facturable; solo en frío o refresco manual
  // §25: se ocultan los duplicados marcados por el curador/migración (duplicado_de).
  return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.duplicado_de), origen: 'servidor' };
}

// Export CSV de datos PÚBLICOS (§23): cualquiera puede descargar las necesidades
// públicas. NUNCA exporta contacto ni coordenadas exactas (viven en el subdoc
// privado, fuera de esta lectura). Lectura puntual acotada (no listener) para
// controlar el costo (§6.2-r1).
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function exportarNecesidadesCsv({ limite = 2000 } = {}) {
  const q = query(collection(db, 'necesidades'), orderBy('creada_en', 'desc'), limit(limite));
  const snap = await getDocs(q);
  const cols = ['id', 'categoria', 'urgencia', 'sector', 'descripcion', 'estado',
    'verificacion', 'confirmaciones', 'lat_sector', 'lng_sector', 'creada_en'];
  const filas = [cols.join(',')];
  for (const d of snap.docs) {
    const n = d.data();
    if (n.duplicado_de) continue; // no exportar duplicados marcados (§25)
    const fecha = n.creada_en?.toDate ? n.creada_en.toDate().toISOString() : '';
    filas.push([
      d.id, n.categoria, n.urgencia, n.sector, n.descripcion, n.estado,
      n.verificacion, n.confirmaciones || 0,
      n.geo?.lat ?? '', n.geo?.lng ?? '', fecha
    ].map(csvCell).join(','));
  }
  return { csv: filas.join('\r\n'), n: snap.size };
}

// Recursos públicos para el mapa unificado (cache-first, sin listener). Mismo
// patrón de costo que las necesidades. Requiere sesión (rules: read if isSignedIn).
export async function leerRecursosPublicos({ forzarServidor = false, max = 2000 } = {}) {
  const q = query(collection(db, 'recursos'), where('disponible', '==', true), orderBy('creada_en', 'desc'), limit(max));
  if (!forzarServidor) {
    try {
      const cache = await getDocsFromCache(q);
      if (!cache.empty) return cache.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.duplicado_de);
    } catch (_) { /* sin caché → servidor */ }
  }
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.duplicado_de);
  } catch (_) {
    return [];
  }
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

// --- Solicitudes de la comunidad (Resuelto / Corrección) ----------------
// Las crea la Cloud Function `solicitarResolucion` (Admin SDK). Aquí el coordinador
// las LEE (suscripción acotada) y las GESTIONA (estado de gestión). Se ordena por
// recencia y se filtra el estado en cliente para NO requerir índice compuesto.
// `onError` permite al Panel reintentar: el listener puede engancharse con un token
// que aún no propagó el claim `coordinador` (carrera SDK↔auth) → permission-denied,
// que Firestore NO reintenta solo.
export function suscribirSolicitudes(cb, onError) {
  const q = query(collection(db, 'solicitudes'), orderBy('creada_en', 'desc'), limit(80));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

// Marca una solicitud como gestionada o descartada (solo coord; lo enforcan las rules).
export function gestionarSolicitud(id, estado, nota = '') {
  return updateDoc(doc(db, 'solicitudes', id), {
    estado,
    nota,
    gestionada_por: auth.currentUser?.uid ?? null,
    gestionada_en: serverTimestamp()
  });
}

// Lee una necesidad pública por id (para precargar el editor de una corrección).
export async function leerNecesidad(id) {
  const snap = await getDoc(doc(db, 'necesidades', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Aplica la edición de una corrección y marca la solicitud gestionada. Las reglas
// PROHÍBEN que el coordinador reescriba el contenido del reporte (invariante F3), así
// que esto pasa por la Cloud Function `editarNecesidad` (Admin SDK + App Check + rol).
export async function aplicarEdicionNecesidad(payload) {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fn = httpsCallable(getFunctions(app), 'editarNecesidad');
  return (await fn(payload)).data;
}
