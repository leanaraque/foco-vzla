import { writable } from 'svelte/store';
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { auth } from './firebase.js';

// Estado de sesión + rol de coordinador (leído del custom claim del token).
export const user = writable(null);
export const esCoordinador = writable(false);
export const authListo = writable(false);

onAuthStateChanged(auth, async (u) => {
  user.set(u);
  if (u) {
    // El rol real vive en el custom claim, no en Firestore (Spec §6.2 / rules).
    const token = await u.getIdTokenResult();
    esCoordinador.set(token.claims.coordinador === true);
  } else {
    esCoordinador.set(false);
  }
  authListo.set(true);
});

// Reportante: sesión anónima silenciosa para poder escribir bajo las rules
// (Spec caso 6, reporte en <60s sin registro).
export async function asegurarSesionAnonima() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
}

export async function entrarCoordinador(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // Forzar refresco para traer el claim recién asignado por el Admin SDK.
  const token = await cred.user.getIdTokenResult(true);
  return token.claims.coordinador === true;
}

export async function salir() {
  await signOut(auth);
}

// Estado de conexión, para el indicador offline y el copy de "guardado sin conexión".
export const online = writable(typeof navigator !== 'undefined' ? navigator.onLine : true);
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => online.set(true));
  window.addEventListener('offline', () => online.set(false));
}
