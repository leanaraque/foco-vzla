// Recolector: une un adapter con el staging. `recolectar` es PURO respecto a Firestore
// (descarga + mapea + geocodifica faltantes; no escribe) → testeable con adapter falso.
// `correrAdapter` añade la E/S: escribe a staging (upsert) y avanza el watermark.
import { FieldValue } from 'firebase-admin/firestore';
import { escribirStaging } from './staging.js';
import { geocode as geocodeDefault } from './geocode.js';

export async function recolectar(adapter, { desde, fetchImpl = fetch, geocodeImpl = geocodeDefault, maxGeocode = 60 } = {}) {
  const rows = await adapter.descargar({ desde, fetchImpl });
  const registros = [];
  const rechazos = [];
  let watermark = Number.isFinite(desde) ? desde : null;
  let geocoded = 0;
  for (const row of rows) {
    const w = adapter.watermarkDe ? adapter.watermarkDe(row) : null;
    if (Number.isFinite(w)) watermark = Math.max(watermark || 0, w);
    let rec = adapter.mapear(row);
    if (!rec && adapter.geoQueryDe && geocoded < maxGeocode) {
      const q = adapter.geoQueryDe(row);
      const hit = q ? await geocodeImpl(q) : null;
      if (hit) { rec = adapter.mapear(row, hit); geocoded++; }
    }
    if (rec) registros.push(rec);
    else rechazos.push({ id_externo: row && row.id != null ? String(row.id) : null, motivo: 'sin-ubicacion' });
  }
  return { registros, rechazos, watermark };
}

// E/S: corre el adapter de punta a punta. El watermark SOLO avanza tras escribir
// (resumible ante fallo parcial). Aislado por el caller (ingesta.js) con try/catch.
export async function correrAdapter(db, adapter, { fetchImpl, geocodeImpl } = {}) {
  const estadoRef = db.collection('_ingesta_estado').doc(adapter.sistema);
  const prev = (await estadoRef.get()).data() || {};
  const { registros, rechazos, watermark } = await recolectar(adapter, { desde: prev.ultimo_capturado_en, fetchImpl, geocodeImpl });
  const { col, escritos } = await escribirStaging(db, adapter.sistema, adapter.url, registros);
  await db.collection('_ingesta_fuentes').doc(adapter.sistema).set({
    sistema: adapter.sistema, url: adapter.url, col,
    ultimo_run: FieldValue.serverTimestamp(), ultimo_escritos: escritos, ultimo_rechazos: rechazos.length
  }, { merge: true });
  if (Number.isFinite(watermark)) {
    await estadoRef.set({ ultimo_capturado_en: watermark, ultimo_run: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { sistema: adapter.sistema, escritos, rechazos: rechazos.length };
}
