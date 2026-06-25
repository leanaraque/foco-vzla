// Capa de acceso a datos. Toda lectura del panel está acotada con limit() y
// paginación para controlar el costo de lecturas de Firestore (Spec §6.2 riesgo 1).
import {
  collection, doc, setDoc, updateDoc, getDoc,
  query, where, orderBy, limit, startAfter, onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from './firebase.js';
import { geoPublico } from './geo.js';

const PAGINA = 25; // tope de documentos por página → factura acotada

// --- Crear necesidad (reportante) ---------------------------------------
// El documento público NO lleva contacto ni coordenadas exactas. Esos datos
// sensibles van al subdocumento privado /privado/datos (Spec §4, frontera §6.2).
// Generamos el ID en cliente y encolamos AMBAS escrituras sin esperar al
// servidor: así el reporte funciona sin conexión (Spec §6.1) y sincroniza luego.
// Devolvemos { id, listo } donde `listo` se resuelve al confirmar el servidor.
export function crearNecesidad({ categoria, urgencia, sector, descripcion, lat, lng, contacto }) {
  const geo = geoPublico(lat, lng);
  const uid = auth.currentUser?.uid ?? null; // estampa de autor (F1, D2)
  const ref = doc(collection(db, 'necesidades'));
  const escrituras = [
    setDoc(ref, {
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
    })
  ];

  // Datos sensibles: solo si hay contacto o coordenadas exactas que proteger.
  // El privado se encola DESPUÉS del padre: Firestore preserva el orden de
  // mutaciones del cliente, así la regla del privado (get del padre) lo ve.
  if (contacto || (lat && lng)) {
    escrituras.push(
      setDoc(doc(db, 'necesidades', ref.id, 'privado', 'datos'), {
        creador: uid,
        contacto: contacto || '',
        geo_exacta: { lat, lng }
      })
    );
  }
  return { id: ref.id, listo: Promise.all(escrituras) };
}

// --- Crear recurso -------------------------------------------------------
export function crearRecurso({ categoria, sector, descripcion, lat, lng, contacto }) {
  const geo = geoPublico(lat, lng);
  const uid = auth.currentUser?.uid ?? null;
  const ref = doc(collection(db, 'recursos'));
  const escrituras = [
    setDoc(ref, {
      categoria,
      sector,
      descripcion: descripcion || '',
      geo,
      disponible: true,
      creador: uid,
      creada_en: serverTimestamp()
    })
  ];
  if (contacto) {
    escrituras.push(
      setDoc(doc(db, 'recursos', ref.id, 'privado', 'datos'), { creador: uid, contacto })
    );
  }
  return { id: ref.id, listo: Promise.all(escrituras) };
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
