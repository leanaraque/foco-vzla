// Inicialización de Firebase — SDK modular (tree-shaken) para peso mínimo.
// NOTA: NO usamos getAnalytics. Spec §9-5 "sin recolección oculta" + peso.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD_nbgZoZ-ymxSmcy9GEC_PniFTZxUrbQ8',
  authDomain: 'foco-vzla.firebaseapp.com',
  projectId: 'foco-vzla',
  storageBucket: 'foco-vzla.firebasestorage.app',
  messagingSenderId: '843653338754',
  appId: '1:843653338754:web:8404ae6e3092da730b469b'
};

export const app = initializeApp(firebaseConfig);

// App Check (Spec §14-1): defensa contra abuso del Auth anónimo (UIDs ilimitados)
// y contra el costo descontrolado de lecturas (§6.2-r1). Usa reCAPTCHA Enterprise
// (provisionado por API; ver §13-D7). Con enforcement ACTIVO en Firestore, toda
// escritura/lectura sin token válido de App Check es rechazada.
// La site key se inyecta en build (VITE_RECAPTCHA_SITE_KEY). En desarrollo local
// se usa el token de debug (VITE_APPCHECK_DEBUG / consola Firebase → App Check).
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG) {
  // eslint-disable-next-line no-undef
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG;
}
if (siteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
} else if (import.meta.env.PROD) {
  // Falla ruidosa en producción si se olvidó la key: es una condición del gate.
  console.error('[FOCO] FALTA VITE_RECAPTCHA_SITE_KEY — App Check deshabilitado (viola §14-1).');
}

export const auth = getAuth(app);

// Offline-first (Spec §6.1 restricción #1): IndexedDB cachea lecturas y permite
// reportar sin conexión; Firestore sincroniza al recuperar señal. La caché local
// también reduce lecturas facturables (Spec §6.2 riesgo 1).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
