#!/usr/bin/env node
// Datos SEMILLA para el testeo 3G de Lean. FICTICIOS y en colecciones AISLADAS
// (_demo_necesidades / _demo_recursos), nunca en las colecciones reales.
// No contienen datos de personas reales.
//
// Uso (Admin SDK, server-side):
//   gcloud auth application-default login   # o GOOGLE_APPLICATION_CREDENTIALS
//   node scripts/seed-demo.mjs              # carga datos demo
//   node scripts/seed-demo.mjs --clear      # borra datos demo
//
// Las rules dan lectura pública a _demo_* y NIEGAN escritura desde cliente; este
// script escribe con Admin SDK (bypass). Para verlos en el panel: añade ?demo=1.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'foco-vzla' });
const db = getFirestore();

const limpiar = process.argv.includes('--clear');

const NECESIDADES = [
  { categoria: 'rescate', urgencia: 'critica', sector: '[DEMO] Morón, edificio Las Acacias', descripcion: 'Posibles personas atrapadas (simulado).', verificacion: 'verificada', estado: 'sin_atender', lat: 10.49, lng: -68.20 },
  { categoria: 'medico', urgencia: 'alta', sector: '[DEMO] Puerto Cabello, ambulatorio norte', descripcion: 'Faltan insumos de curación (simulado).', verificacion: 'verificada', estado: 'asignada', lat: 10.47, lng: -68.01 },
  { categoria: 'agua', urgencia: 'alta', sector: '[DEMO] Valencia, sector San Blas', descripcion: 'Familias sin agua potable (simulado).', verificacion: 'verificada', estado: 'sin_atender', lat: 10.17, lng: -68.00 },
  { categoria: 'refugio', urgencia: 'media', sector: '[DEMO] Naguanagua', descripcion: 'Se necesita espacio techado (simulado).', verificacion: 'no_verificada', estado: 'sin_atender', lat: 10.24, lng: -68.02 },
  { categoria: 'alimento', urgencia: 'media', sector: '[DEMO] Guacara centro', descripcion: 'Comida para 20 personas (simulado).', verificacion: 'verificada', estado: 'resuelta', lat: 10.23, lng: -67.88 }
];

const RECURSOS = [
  { categoria: 'agua', sector: '[DEMO] Valencia — camión cisterna', descripcion: 'Cisterna disponible mañanas (simulado).', lat: 10.18, lng: -68.00 },
  { categoria: 'transporte', sector: '[DEMO] Puerto Cabello — camioneta', descripcion: 'Traslado de insumos (simulado).', lat: 10.47, lng: -68.01 },
  { categoria: 'medico', sector: '[DEMO] Naguanagua — brigada de primeros auxilios', descripcion: 'Voluntarios con botiquín (simulado).', lat: 10.24, lng: -68.02 }
];

async function borrarColeccion(nombre) {
  const snap = await db.collection(nombre).get();
  const batch = db.batch();
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

if (limpiar) {
  const a = await borrarColeccion('_demo_necesidades');
  const b = await borrarColeccion('_demo_recursos');
  console.log(`🧹 Borrados ${a} necesidades demo y ${b} recursos demo.`);
  process.exit(0);
}

let n = 0;
for (const it of NECESIDADES) {
  await db.collection('_demo_necesidades').add({
    categoria: it.categoria, urgencia: it.urgencia, sector: it.sector,
    descripcion: it.descripcion, verificacion: it.verificacion, estado: it.estado,
    fuente: 'web', reclamada_por: null, creador: 'DEMO',
    geo: { lat: it.lat, lng: it.lng, geohash: 'demo' },
    creada_en: FieldValue.serverTimestamp(), actualizada_en: FieldValue.serverTimestamp()
  });
  n++;
}
let r = 0;
for (const it of RECURSOS) {
  await db.collection('_demo_recursos').add({
    categoria: it.categoria, sector: it.sector, descripcion: it.descripcion,
    disponible: true, creador: 'DEMO',
    geo: { lat: it.lat, lng: it.lng, geohash: 'demo' },
    creada_en: FieldValue.serverTimestamp()
  });
  r++;
}
console.log(`✅ Sembrados ${n} necesidades demo y ${r} recursos demo (ficticios, colecciones _demo_*).`);
console.log('   Verlos en el panel: https://foco-vzla.web.app/panel?demo=1');
