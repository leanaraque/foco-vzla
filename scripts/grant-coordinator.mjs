#!/usr/bin/env node
// Alta controlada de coordinadores verificados (Spec §4, §13-D3).
// Asigna el custom claim { coordinador: true } — la ÚNICA fuente de verdad del rol,
// que las security rules consultan. Solo corre server-side.
//
// SECRETO BLINDADO (Spec §14-3): NO incrusta credenciales. Usa Application Default
// Credentials. Antes de correr, autentícate con una de estas:
//   A) gcloud auth application-default login           (cuenta de Lean)
//   B) export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json  (gitignored)
//
// Uso:
//   node scripts/grant-coordinator.mjs <email>            → otorga el rol
//   node scripts/grant-coordinator.mjs <email> --revoke   → revoca el rol
//
// El coordinador debe existir ya en Firebase Auth (registrarse con email/contraseña).

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2];
const revocar = process.argv.includes('--revoke');

if (!email) {
  console.error('Uso: node scripts/grant-coordinator.mjs <email> [--revoke]');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: 'foco-vzla' });
const auth = getAuth();

try {
  const u = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(u.uid, revocar ? { coordinador: false } : { coordinador: true });
  console.log(
    `${revocar ? '⛔ Revocado' : '✅ Otorgado'} rol coordinador a ${email} (uid ${u.uid}).`
  );
  console.log('El usuario debe cerrar y reabrir sesión para refrescar el token.');
} catch (e) {
  if (e.code === 'auth/user-not-found') {
    console.error(`✗ No existe un usuario con email ${email}. Que se registre primero.`);
  } else {
    console.error('Error:', e.message);
  }
  process.exit(1);
}
