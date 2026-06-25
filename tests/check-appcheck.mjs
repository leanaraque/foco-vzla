// Evidencia del gate (Spec §14-1): con App Check ENFORCED en Firestore, una
// escritura SIN token de App Check debe ser rechazada — aunque las rules
// permitan el documento. Usa el SDK Web (el Admin SDK haría bypass de App Check).
//
// El documento es una necesidad VÁLIDA que las rules SÍ aceptarían; por tanto, si
// se rechaza, el bloqueo proviene de App Check, no de las rules.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, doc, setDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyD_nbgZoZ-ymxSmcy9GEC_PniFTZxUrbQ8',
  authDomain: 'foco-vzla.firebaseapp.com',
  projectId: 'foco-vzla',
  appId: '1:843653338754:web:8404ae6e3092da730b469b'
});
// OJO: deliberadamente NO se llama initializeAppCheck → no hay token de App Check.
const auth = getAuth(app);
const db = initializeFirestore(app, {});

try {
  await signInAnonymously(auth); // Auth NO está enforced; el sign-in funciona
  console.log('Sesión anónima OK (uid=%s)', auth.currentUser.uid);
  const necesidadValida = {
    categoria: 'agua', urgencia: 'alta', sector: 'Prueba gate',
    descripcion: 'Escritura de prueba sin App Check', fuente: 'web',
    estado: 'sin_atender', verificacion: 'no_verificada', reclamada_por: null,
    creador: auth.currentUser.uid,
    geo: { lat: 10.49, lng: -68.2, geohash: 'd6n' }
  };
  await setDoc(doc(db, 'necesidades', 'PRUEBA_SIN_APPCHECK'), necesidadValida);
  console.log('❌ FALLO DEL GATE: la escritura SIN App Check fue ACEPTADA.');
  process.exit(2);
} catch (e) {
  console.log('✅ Escritura RECHAZADA sin token de App Check (esperado).');
  console.log('   code:', e.code);
  console.log('   message:', e.message);
  process.exit(0);
}
