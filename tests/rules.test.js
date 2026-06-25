// Tests de las security rules = evidencia auditable para el gate del jurado
// (Spec §6.2-r2, §12, §14-2, §17). Requiere el emulador de Firestore.
// Ejecuta: firebase emulators:exec --only firestore "npm run test:rules"
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, test } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv;

// Fábrica de necesidad válida estampada con un uid de autor.
const necesidad = (creador = 'anon1', over = {}) => ({
  categoria: 'agua', urgencia: 'alta', sector: 'Morón centro',
  descripcion: 'Familia sin agua', fuente: 'web',
  estado: 'sin_atender', verificacion: 'no_verificada', reclamada_por: null,
  creador,
  geo: { lat: 10.49, lng: -68.2, geohash: 'd6n' },
  ...over
});

const privado = (creador = 'anon1', over = {}) => ({
  creador, contacto: '0414-1234567', geo_exacta: { lat: 10.491, lng: -68.201 }, ...over
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'foco-vzla-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
afterAll(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

// Contextos
const anon = (uid = 'anon1') => testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const coord = () => testEnv.authenticatedContext('coord1', { coordinador: true }).firestore();
const normal = () => testEnv.authenticatedContext('user2').firestore();
const seed = (fn) => testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

describe('necesidades — create', () => {
  test('reportante anónimo puede crear necesidad válida', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'necesidades/n1'), necesidad('anon1')));
  });
  test('rechaza enum de categoría inválido (§14-2)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n2'), necesidad('anon1', { categoria: 'hackeo' })));
  });
  test('rechaza nacer verificada (anti-rumor §9-3)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n3'), necesidad('anon1', { verificacion: 'verificada' })));
  });
  test('rechaza descripción demasiado larga', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n4'), necesidad('anon1', { descripcion: 'x'.repeat(600) })));
  });
  test('rechaza creador suplantado (creador != uid del que escribe)', async () => {
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/n4b'), necesidad('otro_uid')));
  });
});

describe('necesidades — read / verificación', () => {
  test('no-verificada NO es legible por usuario normal', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n5'), necesidad()));
    await assertFails(getDoc(doc(normal(), 'necesidades/n5')));
  });
  test('verificada SÍ es legible (preparado vista pública Fase 2)', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n6'), necesidad('anon1', { verificacion: 'verificada' })));
    await assertSucceeds(getDoc(doc(normal(), 'necesidades/n6')));
  });
  test('coordinador lee las no-verificadas', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n7'), necesidad()));
    await assertSucceeds(getDoc(doc(coord(), 'necesidades/n7')));
  });
});

describe('necesidades — update (gestión solo coordinador) [F3]', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n8'), necesidad()));
  });
  test('coordinador puede verificar', async () => {
    await assertSucceeds(updateDoc(doc(coord(), 'necesidades/n8'), { verificacion: 'verificada' }));
  });
  test('reportante anónimo NO puede verificar', async () => {
    await assertFails(updateDoc(doc(anon(), 'necesidades/n8'), { verificacion: 'verificada' }));
  });
  test('coordinador NO puede reescribir contenido reportado (categoría)', async () => {
    await assertFails(updateDoc(doc(coord(), 'necesidades/n8'), { categoria: 'rescate' }));
  });
  test('F3: rechaza valor de estado fuera del enum', async () => {
    await assertFails(updateDoc(doc(coord(), 'necesidades/n8'), { estado: 'hackeado' }));
  });
  test('F3: rechaza valor de verificacion fuera del enum', async () => {
    await assertFails(updateDoc(doc(coord(), 'necesidades/n8'), { verificacion: 'super_verificada' }));
  });
  test('F3: acepta transición de estado válida', async () => {
    await assertSucceeds(updateDoc(doc(coord(), 'necesidades/n8'), { estado: 'asignada' }));
  });
});

describe('privado — contacto/coords exactas (frontera §6.2-r2)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'necesidades/n9'), necesidad('anon1'));
      await setDoc(doc(db, 'necesidades/n9/privado/datos'), privado('anon1'));
    });
  });
  test('coordinador SÍ lee el contacto privado', async () => {
    await assertSucceeds(getDoc(doc(coord(), 'necesidades/n9/privado/datos')));
  });
  test('usuario normal NO lee el contacto privado', async () => {
    await assertFails(getDoc(doc(normal(), 'necesidades/n9/privado/datos')));
  });
  test('reportante anónimo NO lee el contacto privado', async () => {
    await assertFails(getDoc(doc(anon(), 'necesidades/n9/privado/datos')));
  });
});

describe('privado — escritura abusiva [F1]', () => {
  // Padre creado por anon1.
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/p1'), necesidad('anon1')));
  });

  test('el autor (anon1) SÍ puede crear el privado de su propia necesidad', async () => {
    await assertSucceeds(setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), privado('anon1')));
  });

  test('otro anónimo NO puede inyectar el privado de una necesidad ajena', async () => {
    await assertFails(setDoc(doc(anon('anon2'), 'necesidades/p1/privado/datos'), privado('anon2')));
  });

  test('no se puede suplantar al autor (creador del privado != uid escritor)', async () => {
    await assertFails(setDoc(doc(anon('anon2'), 'necesidades/p1/privado/datos'), privado('anon1')));
  });

  test('NO se puede sobrescribir un contacto ya existente (update solo coord)', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/p1/privado/datos'), privado('anon1')));
    await assertFails(setDoc(doc(anon('anon2'), 'necesidades/p1/privado/datos'), privado('anon2')));
    await assertFails(updateDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), { contacto: 'pisado' }));
  });

  test('rechaza contacto demasiado largo', async () => {
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), privado('anon1', { contacto: 'x'.repeat(200) })));
  });

  test('rechaza campos desconocidos en el privado', async () => {
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), privado('anon1', { backdoor: true })));
  });

  test('rechaza geo_exacta con tipo inválido', async () => {
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), privado('anon1', { geo_exacta: { lat: 'x', lng: 'y' } })));
  });
});
