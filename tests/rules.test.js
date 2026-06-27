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
// geohash realista (~9 chars) y sectorGeo = prefijo de 5 (debe coincidir, F6/F10).
const necesidad = (creador = 'anon1', over = {}) => ({
  categoria: 'agua', urgencia: 'alta', sector: 'Morón centro',
  descripcion: 'Familia sin agua', fuente: 'web',
  estado: 'sin_atender', verificacion: 'no_verificada', reclamada_por: null,
  creador,
  geo: { lat: 10.49, lng: -68.2, geohash: 'd6npq5e8x' },
  sectorGeo: 'd6npq',
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
  test('F10: rechaza nacer con confirmaciones>0 (anti-autoconfirmación)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n4c'), necesidad('anon1', { confirmaciones: 9999 })));
  });
  test('F10: acepta confirmaciones==0 explícito', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'necesidades/n4c0'), necesidad('anon1', { confirmaciones: 0 })));
  });
  test('F10: rechaza clave desconocida (hasOnly)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n4d'), necesidad('anon1', { backdoor: true })));
  });
  test('F10: rechaza clave desconocida dentro de geo', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n4e'), necesidad('anon1', { geo: { lat: 10.49, lng: -68.2, geohash: 'd6npq5e8x', hack: 1 } })));
  });
  test('F6/F10: rechaza sectorGeo que NO coincide con el prefijo del geohash', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/n4f'), necesidad('anon1', { sectorGeo: 'zzzzz' })));
  });
  test('F6/F10: rechaza necesidad SIN sectorGeo', async () => {
    const n = necesidad('anon1'); delete n.sectorGeo;
    await assertFails(setDoc(doc(anon(), 'necesidades/n4g'), n));
  });
});

describe('necesidades — create v2 (esquema canónico §25.3)', () => {
  // Factoría del esquema nuevo. El create acepta V1 || V2 durante la migración.
  const v2 = (creador = 'anon1', over = {}) => ({
    categoria: 'rescate', urgencia: 'alta', para_quien: 'vecino', personas_rango: '2-5',
    severidad: 'severo', rescate_activo: true, prioridad: 72, precision: 'sector',
    sector: 'Edificio X · Maiquetía', descripcion: 'Personas adentro', fuente: 'web',
    estado: 'sin_atender', verificacion: 'no_verificada', reclamada_por: null, creador,
    geo: { lat: 10.6, lng: -66.9, geohash: 'd6npq5e8x' }, sectorGeo: 'd6npq',
    rescate: { atrapados: true, cantidad: 3, con_vida: true, desde: '<6h' },
    vulnerables: ['ninos', 'mayores'], ...over
  });

  test('acepta necesidad v2 válida (rescate + vulnerables)', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'necesidades/v1'), v2('anon1')));
  });
  test('acepta v2 mínima (sin mapas opcionales)', async () => {
    const n = v2('anon1'); delete n.rescate; delete n.vulnerables;
    await assertSucceeds(setDoc(doc(anon(), 'necesidades/v2'), n));
  });
  test('rechaza para_quien inválido', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v3'), v2('anon1', { para_quien: 'nadie' })));
  });
  test('rechaza personas_rango inválido', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v4'), v2('anon1', { personas_rango: '1000' })));
  });
  test('rechaza precision inválida', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v5'), v2('anon1', { precision: 'gps' })));
  });
  test('rechaza prioridad fuera de [0,100]', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v6'), v2('anon1', { prioridad: 999 })));
  });
  test('rechaza rescate_activo no booleano', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v7'), v2('anon1', { rescate_activo: 'si' })));
  });
  test('rechaza rescate con clave desconocida (hasOnly del mapa)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v8'), v2('anon1', { rescate: { atrapados: true, hack: 1 } })));
  });
  test('rechaza medico.tipo fuera del enum', async () => {
    const n = v2('anon1', { categoria: 'medico', medico: { tipo: 'cualquiera' } }); delete n.rescate;
    await assertFails(setDoc(doc(anon(), 'necesidades/v9'), n));
  });
  test('acepta medico con medicamento crítico', async () => {
    const n = v2('anon1', { categoria: 'medico', medico: { tipo: 'medicamento_critico', medicamento: 'insulina' } }); delete n.rescate;
    await assertSucceeds(setDoc(doc(anon(), 'necesidades/v9b'), n));
  });
  test('rechaza vulnerables que no es lista', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v10'), v2('anon1', { vulnerables: 'ninos' })));
  });
  test('rechaza clave desconocida top-level (hasOnly)', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v11'), v2('anon1', { backdoor: true })));
  });
  test('rechaza creador suplantado', async () => {
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/v12'), v2('otro')));
  });
  test('F10: rechaza confirmaciones>0', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v13'), v2('anon1', { confirmaciones: 5 })));
  });
  test('rechaza sectorGeo que no coincide con el geohash', async () => {
    await assertFails(setDoc(doc(anon(), 'necesidades/v14'), v2('anon1', { sectorGeo: 'zzzzz' })));
  });

  test('privado v2: el autor puede crear con como_llegar + contacto_alterno', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/vp'), v2('anon1')));
    await assertSucceeds(setDoc(doc(anon('anon1'), 'necesidades/vp/privado/datos'),
      { creador: 'anon1', contacto: '0414-1234567', como_llegar: 'Piso 3, apto 3B, portón azul', contacto_alterno: '0424-7654321' }));
  });
  test('privado v2: rechaza como_llegar demasiado largo', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/vp2'), v2('anon1')));
    await assertFails(setDoc(doc(anon('anon1'), 'necesidades/vp2/privado/datos'),
      { creador: 'anon1', contacto: '0414', como_llegar: 'x'.repeat(250) }));
  });
});

describe('necesidades — read público (PIVOTE §22)', () => {
  test('§22: no-verificada ES legible públicamente (validación por multitud)', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n5'), necesidad()));
    await assertSucceeds(getDoc(doc(normal(), 'necesidades/n5')));
  });
  test('confirmada es legible públicamente', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n6'), necesidad('anon1', { verificacion: 'confirmada' })));
    await assertSucceeds(getDoc(doc(normal(), 'necesidades/n6')));
  });
  test('SALVAGUARDA §22.5: el aislado (pendiente_revision) NUNCA se oculta', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/nais'), necesidad('anon1', { verificacion: 'pendiente_revision' })));
    await assertSucceeds(getDoc(doc(normal(), 'necesidades/nais')));
  });
  test('coordinador también lee (cualquier estado)', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/n7'), necesidad()));
    await assertSucceeds(getDoc(doc(coord(), 'necesidades/n7')));
  });
});

describe('confirmaciones ciudadanas (validación por multitud §22.5)', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/nc'), necesidad('autor')));
  });
  const conf = (uid) => ({ creador: uid, creada_en: new Date() });

  test('un usuario puede confirmar una vez (crea su confirmación)', async () => {
    await assertSucceeds(setDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userA'), conf('userA')));
  });
  test('NO puede confirmar dos veces (recrear su confirmación = update, denegado)', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/nc/confirmaciones/userA'), conf('userA')));
    await assertFails(updateDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userA'), { creada_en: new Date() }));
  });
  test('NO puede crear la confirmación de OTRO uid (id != su uid)', async () => {
    await assertFails(setDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userB'), conf('userB')));
  });
  test('NO puede suplantar creador (creador != uid escritor)', async () => {
    await assertFails(setDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userA'), conf('userB')));
  });
  test('rechaza campos desconocidos en la confirmación', async () => {
    await assertFails(setDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userA'), { creador: 'userA', creada_en: new Date(), voto: 99 }));
  });
  test('el contador/estado del padre NO es editable por el cliente (solo función/coord)', async () => {
    await assertFails(updateDoc(doc(anon('userA'), 'necesidades/nc'), { confirmaciones: 5, verificacion: 'confirmada' }));
  });
  test('un usuario solo lee su PROPIA confirmación, no la de otros', async () => {
    await seed((db) => setDoc(doc(db, 'necesidades/nc/confirmaciones/userB'), conf('userB')));
    await assertSucceeds(getDoc(doc(anon('userB'), 'necesidades/nc/confirmaciones/userB')));
    await assertFails(getDoc(doc(anon('userA'), 'necesidades/nc/confirmaciones/userB')));
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

  test('§20: privado SIN geo_exacta (reporte con contacto sin GPS) es válido', async () => {
    await assertSucceeds(
      setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), { creador: 'anon1', contacto: '0414-1234567' })
    );
  });

  test('§20: privado con geo_exacta de tipo inválido sigue rechazado', async () => {
    await assertFails(
      setDoc(doc(anon('anon1'), 'necesidades/p1/privado/datos'), { creador: 'anon1', contacto: '0414', geo_exacta: { lat: null, lng: null } })
    );
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

describe('ingesta — staging/estado/fuentes/revisión (solo Admin escribe, solo coord lee)', () => {
  // El pipeline escribe SOLO por Cloud Function (Admin SDK, bypassa rules). Desde el
  // cliente: lectura solo coordinador (el staging puede traer `privado.contacto`),
  // escritura denegada a todos.
  beforeEach(async () => {
    await seed((db) => Promise.all([
      setDoc(doc(db, '_ingesta_staging/TV_EDIF__77'), { sistema: 'TV_EDIF', destino: 'necesidad', publico: { categoria: 'rescate' }, privado: { contacto: '0414-1234567' } }),
      setDoc(doc(db, '_ingesta_estado/TV_EDIF'), { ultimo_capturado_en: 123 }),
      setDoc(doc(db, '_ingesta_fuentes/TV_EDIF'), { sistema: 'TV_EDIF' }),
      setDoc(doc(db, '_revision_ingesta/TV_EDIF__77'), { motivo: 'pii' })
    ]));
  });

  test('coordinador SÍ lee el staging (incluye privado)', async () => {
    await assertSucceeds(getDoc(doc(coord(), '_ingesta_staging/TV_EDIF__77')));
  });
  test('usuario normal NO lee el staging', async () => {
    await assertFails(getDoc(doc(normal(), '_ingesta_staging/TV_EDIF__77')));
  });
  test('reportante anónimo NO lee el staging (contacto sensible)', async () => {
    await assertFails(getDoc(doc(anon(), '_ingesta_staging/TV_EDIF__77')));
  });
  test('nadie (ni coordinador) escribe el staging — solo Admin SDK', async () => {
    await assertFails(setDoc(doc(coord(), '_ingesta_staging/hack'), { x: 1 }));
    await assertFails(setDoc(doc(anon(), '_ingesta_staging/hack2'), { x: 1 }));
  });
  test('coordinador lee estado/fuentes/revisión; el público no', async () => {
    await assertSucceeds(getDoc(doc(coord(), '_ingesta_estado/TV_EDIF')));
    await assertSucceeds(getDoc(doc(coord(), '_ingesta_fuentes/TV_EDIF')));
    await assertSucceeds(getDoc(doc(coord(), '_revision_ingesta/TV_EDIF__77')));
    await assertFails(getDoc(doc(normal(), '_ingesta_estado/TV_EDIF')));
    await assertFails(getDoc(doc(anon(), '_revision_ingesta/TV_EDIF__77')));
  });
  test('nadie escribe estado/fuentes/revisión — solo Admin SDK', async () => {
    await assertFails(setDoc(doc(coord(), '_ingesta_estado/hack'), { x: 1 }));
    await assertFails(setDoc(doc(coord(), '_revision_ingesta/hack'), { x: 1 }));
  });
});
