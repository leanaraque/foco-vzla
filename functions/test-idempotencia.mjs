// Prueba de IDEMPOTENCIA del pipeline contra el emulador de Firestore (Admin SDK).
// Vive DENTRO de functions/ para que firebase-admin resuelva a la MISMA copia que el
// código de funciones (evita el choque ServerTimestampTransform entre node_modules
// raíz y de functions/). Corre el ciclo real varias veces con una fuente determinista:
//   RUN 1 → crea los canónicos.
//   RUN 2 (sin cambios) → NO crea NADA (todo se salta): prueba anti-duplicados.
//   RUN 3 (un registro cambia) → ACTUALIZA el canónico vinculado (no crea uno nuevo).
// Ejecuta (desde functions/): firebase emulators:exec --only firestore "node test-idempotencia.mjs"
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { correrAdapter } from './lib/recolector.js';
import { promoverTodo } from './promotor.js';

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'foco-vzla-test' });
const db = getFirestore();

let version = 1;
const fakeAdapter = {
  sistema: 'TEST_SRC', url: 'http://test',
  async descargar() {
    return [
      { id: 'e1', lat: 10.61, lng: -67.01, dmg: version === 1 ? 'parcial' : 'total', tipo: 'nec' },
      { id: 'e2', lat: 10.62, lng: -67.02, dmg: 'severo', tipo: 'nec' },
      { id: 'e3', lat: 10.63, lng: -67.03, dmg: 'parcial', tipo: 'nec' },
      { id: 'r1', lat: 10.50, lng: -66.90, tipo: 'rec' }
    ];
  },
  watermarkDe: () => null,
  mapear(row) {
    const geo = { lat: row.lat, lng: row.lng, geohash: 'd3ze8jdkej' };
    if (row.tipo === 'rec') {
      return { destino: 'recurso', id_externo: row.id, privado: null,
        publico: { categoria: 'refugio', sector: 'Refugio ' + row.id, descripcion: 'd', geo, precision: 'exacta', disponible: true } };
    }
    return { destino: 'necesidad', id_externo: row.id, privado: null,
      publico: { categoria: 'rescate', urgencia: 'alta', severidad: row.dmg === 'total' ? 'total' : 'desconocida',
        sector: 'Edif ' + row.id, descripcion: 'Daño ' + row.dmg, geo, sectorGeo: 'd3ze8', precision: 'exacta' } };
  }
};

const count = async (col) => (await db.collection(col).count().get()).data().count;
const snap = async () => ({ nec: await count('necesidades'), rec: await count('recursos'), stg: await count('_ingesta_staging') });
const ciclo = async () => { await correrAdapter(db, fakeAdapter); return promoverTodo(db); };

let ok = true;
const check = (nombre, cond, extra = '') => { console.log((cond ? '✅' : '❌'), nombre, extra); if (!cond) ok = false; };

console.log('— RUN 1 (alta inicial) —');
const r1 = await ciclo(); const s1 = await snap();
console.log('  promoción:', r1, '| conteos:', s1);

console.log('— RUN 2 (misma fuente, sin cambios) —');
const r2 = await ciclo(); const s2 = await snap();
console.log('  promoción:', r2, '| conteos:', s2);

console.log('— RUN 3 (e1 cambia de "parcial" a "total") —');
version = 2;
const r3 = await ciclo(); const s3 = await snap();
console.log('  promoción:', r3, '| conteos:', s3);

const e1 = (await db.collection('necesidades').where('sector', '==', 'Edif e1').get()).docs[0]?.data();

console.log('\n=== VERIFICACIÓN ===');
check('RUN1 creó 3 necesidades + 1 recurso', s1.nec === 3 && s1.rec === 1, JSON.stringify(s1));
check('RUN1: 4 docs en staging', s1.stg === 4);
check('RUN2 NO crea (creados=0, saltados=4)', r2.creados === 0 && r2.saltados === 4, JSON.stringify(r2));
check('RUN2: conteos idénticos a RUN1 (sin duplicados)', s2.nec === s1.nec && s2.rec === s1.rec && s2.stg === s1.stg);
check('RUN3: cambio → ACTUALIZA (actualizados>=1, creados=0)', r3.creados === 0 && r3.actualizados >= 1, JSON.stringify(r3));
check('RUN3: sigue habiendo 3 necesidades (no duplicó e1)', s3.nec === 3, JSON.stringify(s3));
check('RUN3: el contenido de e1 se refrescó (severidad=total)', e1?.severidad === 'total', JSON.stringify(e1?.severidad));
check('e1 conserva su procedencia fuentes[] (TEST_SRC/e1)', Array.isArray(e1?.fuentes) && e1.fuentes.some((f) => f.sistema === 'TEST_SRC' && f.id_externo === 'e1'));

console.log(ok ? '\n✅ IDEMPOTENCIA OK' : '\n❌ FALLÓ');
process.exit(ok ? 0 : 1);
