// Harness de STAGING: convierte un registro normalizado de un adapter en el documento
// de _ingesta_<sistema> y lo escribe con UPSERT idempotente (set merge por id
// determinista `sistema__id_externo`). El control de promoción (promovido_a /
// hash_promovido) lo gestiona EXCLUSIVAMENTE el promotor; aquí solo se escribe el
// CONTENIDO + procedencia + hash. Así re-ingerir el mismo registro:
//   - mismo contenido → mismo hash → el promotor lo salta (no re-promueve).
//   - contenido cambiado → hash distinto → el promotor refresca el canónico vinculado.
import { FieldValue } from 'firebase-admin/firestore';
import { stagingId, entradaFuente, fnv1a } from './identidad.js';
import { scrubPII } from './scrubPII.js';

// UNA sola colección de staging para todas las fuentes. Los docs llevan id
// determinista `sistema__id_externo` (únicos entre fuentes) y el campo `sistema`/
// `destino` los distingue. Una sola colección simplifica las security rules (no se
// puede hacer match por prefijo de nombre de colección) y la lectura del promotor.
export const COL_STAGING = '_ingesta_staging';

// PURO: arma { id, doc } de staging a partir de un registro del adapter:
//   rec = { destino:'necesidad'|'recurso', id_externo, publico:{...}, privado?:{...}, descripcion_cruda? }
// El `hash` cubre SOLO el contenido (destino/publico/privado) → estable si la fuente
// no cambió. `promovido_a`/`hash_promovido` NO se incluyen (los pone el promotor).
export function construirDocStaging(sistema, url, rec, capturadoMs = Date.now()) {
  const idExterno = String(rec.id_externo);
  const contenido = { destino: rec.destino, publico: rec.publico, privado: rec.privado || null };
  const hash = fnv1a(JSON.stringify(contenido));
  const texto = `${rec.publico?.sector || ''} ${rec.publico?.descripcion || rec.descripcion_cruda || ''}`;
  const pii = scrubPII(texto);
  return {
    id: stagingId(sistema, idExterno),
    doc: {
      ...contenido,
      sistema, id_externo: idExterno,
      fuente: entradaFuente(sistema, idExterno, url, capturadoMs),
      capturado_en: capturadoMs,
      hash,
      pii: { tienePII: pii.tienePII, motivos: pii.motivos }
    }
  };
}

// I/O: escribe los registros a la colección de staging con merge (upsert). Devuelve
// { col, escritos }. No toca producción (necesidades/recursos).
export async function escribirStaging(db, sistema, url, registros, capturadoMs = Date.now()) {
  let escritos = 0;
  for (let i = 0; i < registros.length; i += 400) {
    const batch = db.batch();
    for (const rec of registros.slice(i, i + 400)) {
      const { id, doc } = construirDocStaging(sistema, url, rec, capturadoMs);
      batch.set(db.collection(COL_STAGING).doc(id), { ...doc, ingerido_en: FieldValue.serverTimestamp() }, { merge: true });
      escritos++;
    }
    await batch.commit();
  }
  return { col: COL_STAGING, escritos };
}
