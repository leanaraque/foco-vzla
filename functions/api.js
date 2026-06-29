// API PÚBLICA DE DATOS ABIERTOS (§30) — endpoint HTTP para que terceros (medios,
// ONGs, otros mapas, investigadores) extraigan los datos de FOCO de forma programática.
//
// DECISIONES DE SEGURIDAD/COSTO:
//  - SOLO datos PÚBLICOS: la misma proyección que ya muestra la web (sector, geo a
//    nivel ~1km, estado, verificación, precisión). NUNCA contacto ni `geo_exacta`
//    (viven en el subdoc privado y aquí ni se leen). No expone nada que la web no
//    muestre ya (§6.2-r2 intacto). Se prefiere `resumen` (saneado de PII) sobre
//    `descripcion` cruda cuando existe.
//  - COSTO ACOTADO (§6.2-r1): `Cache-Control: s-maxage` → el CDN de Firebase Hosting
//    cachea la respuesta y solo deja pasar ~1 invocación al origen por ventana, por
//    más consumidores que haya. Mismo principio que la frescura de /mapa (§29).
//  - Sin App Check (es para clientes externos, no el navegador) y CORS abierto. La
//    defensa es que es de SOLO LECTURA y de datos ya públicos.
//  - Se ocultan los duplicados marcados por el curador (`duplicado_de`).
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const MAX = 2000;                                  // tope de documentos por respuesta
const CACHE = 'public, max-age=60, s-maxage=300';  // CDN cachea 5 min (acota el costo)

const tsISO = (t) => (t && t.toDate ? t.toDate().toISOString() : null);
const sistemasDe = (d) => (Array.isArray(d.fuentes) ? d.fuentes.map((f) => f && f.sistema).filter(Boolean) : []);

// Proyección PÚBLICA de una necesidad (sin PII; resumen saneado preferido).
function necPublica(id, n) {
  return {
    id,
    categoria: n.categoria || null,
    urgencia: n.urgencia || null,
    severidad: n.severidad || null,
    prioridad: Number.isFinite(n.prioridad) ? n.prioridad : null,
    rescate_activo: n.rescate_activo === true,
    estado: n.estado || 'sin_atender',
    verificacion: n.verificacion || 'no_verificada',
    confirmaciones: n.confirmaciones || 0,
    precision: n.precision || 'sector',      // 'exacta' (sitio/edificio) | 'sector' (~1km)
    sector: n.sector || '',
    descripcion: n.resumen || n.descripcion || '',
    descripcion_en: n.resumen_en || '',   // traducción al inglés del resumen (vacío si no disponible)
    lat: n.geo && Number.isFinite(n.geo.lat) ? n.geo.lat : null,
    lng: n.geo && Number.isFinite(n.geo.lng) ? n.geo.lng : null,
    geohash: n.geo && n.geo.geohash ? n.geo.geohash : null,
    fuentes: sistemasDe(n),
    creada_en: tsISO(n.creada_en),
    actualizada_en: tsISO(n.actualizada_en)
  };
}

// Proyección PÚBLICA de un recurso.
function recPublico(id, r) {
  return {
    id,
    categoria: r.categoria || null,
    sector: r.sector || '',
    descripcion: r.descripcion || '',
    disponible: r.disponible !== false,
    precision: r.precision || 'sector',
    lat: r.geo && Number.isFinite(r.geo.lat) ? r.geo.lat : null,
    lng: r.geo && Number.isFinite(r.geo.lng) ? r.geo.lng : null,
    geohash: r.geo && r.geo.geohash ? r.geo.geohash : null,
    fuentes: sistemasDe(r),
    creada_en: tsISO(r.creada_en)
  };
}

async function leerPublicas(db, coleccion, proyectar, extraFiltro) {
  let q = db.collection(coleccion).orderBy('creada_en', 'desc').limit(MAX);
  if (extraFiltro) q = extraFiltro(q);
  const snap = await q.get();
  const items = [];
  snap.forEach((d) => {
    const data = d.data();
    if (data.duplicado_de) return;          // oculta duplicados marcados por el curador
    items.push(proyectar(d.id, data));
  });
  return items;
}

const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
function aCsv(items, cols) {
  const filas = [cols.join(',')];
  for (const it of items) filas.push(cols.map((c) => csvCell(it[c])).join(','));
  return filas.join('\r\n');
}

const COLS_NEC = ['id', 'categoria', 'urgencia', 'severidad', 'prioridad', 'rescate_activo',
  'estado', 'verificacion', 'confirmaciones', 'precision', 'sector', 'descripcion', 'descripcion_en',
  'lat', 'lng', 'geohash', 'creada_en', 'actualizada_en'];
const COLS_REC = ['id', 'categoria', 'sector', 'descripcion', 'disponible', 'precision',
  'lat', 'lng', 'geohash', 'creada_en'];

export const api = onRequest({ region: 'us-central1', memory: '256MiB' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Solo GET.' }); return; }

  const db = getFirestore();
  // Con el rewrite de Hosting el path llega como /api/<recurso>.<formato>.
  const ruta = (req.path || '').toLowerCase().replace(/\/+$/, '');
  res.set('Cache-Control', CACHE);

  try {
    if (ruta.endsWith('necesidades.json')) {
      const items = await leerPublicas(db, 'necesidades', necPublica);
      res.json({ generado_en: new Date().toISOString(), total: items.length, necesidades: items });
      return;
    }
    if (ruta.endsWith('necesidades.csv')) {
      const items = await leerPublicas(db, 'necesidades', necPublica);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.send(aCsv(items, COLS_NEC));
      return;
    }
    if (ruta.endsWith('recursos.json')) {
      const items = await leerPublicas(db, 'recursos', recPublico, (q) => q.where('disponible', '==', true));
      res.json({ generado_en: new Date().toISOString(), total: items.length, recursos: items });
      return;
    }
    if (ruta.endsWith('recursos.csv')) {
      const items = await leerPublicas(db, 'recursos', recPublico, (q) => q.where('disponible', '==', true));
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.send(aCsv(items, COLS_REC));
      return;
    }
    // Índice de la API (root /api): describe los endpoints disponibles. Bilingüe:
    // `?lang=en` devuelve la descripción en inglés (por defecto, español).
    const base = `${req.protocol}://${req.get('host')}/api`;
    const en = String(req.query.lang || '').toLowerCase().startsWith('en');
    const meta = en
      ? {
          nombre: 'FOCO Venezuela — public open-data API',
          descripcion: 'Public data on needs and resources after the earthquake. Read-only, no personal data. Location at sector level (~1km) except public sites (precision=exacta). Field descripcion_en carries the English summary when available.',
          licencia: 'Free to use with attribution to focovenezuela.org. Not an emergency service.',
          cache: 'Responses cached ~5 min.'
        }
      : {
          nombre: 'FOCO Venezuela — API pública de datos abiertos',
          descripcion: 'Datos públicos de necesidades y recursos tras el sismo. Solo lectura, sin datos personales. Ubicación a nivel de sector (~1km) salvo sitios públicos (precision=exacta). El campo descripcion_en trae el resumen en inglés cuando está disponible.',
          licencia: 'Uso libre con atribución a focovenezuela.org. No es un servicio de emergencia.',
          cache: 'Respuestas cacheadas ~5 min.'
        };
    res.json({
      ...meta,
      idiomas: ['es', 'en'],
      endpoints: {
        necesidades_json: `${base}/necesidades.json`,
        necesidades_csv: `${base}/necesidades.csv`,
        recursos_json: `${base}/recursos.json`,
        recursos_csv: `${base}/recursos.csv`
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron leer los datos.' });
  }
});
