// Identidad externa estable para INGESTA idempotente. Es el núcleo anti-duplicados
// (Plan §"Núcleo del diseño" #1): cada registro de una fuente se mapea a un id de
// STAGING determinista `sistema__id_externo`, de modo que re-ingerir SOBRESCRIBE el
// mismo documento en vez de crear uno nuevo. Módulo PURO (sin Firebase), testeable.

// Normalizador compartido (acentos fuera, minúsculas, espacios colapsados).
export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Segmento de id seguro para Firestore: sin '/', sin caracteres raros, acotado.
// Firestore prohíbe '/', '.', '..' y el patrón reservado __.*__ . Como el id final
// es `sistema__<esto>`, este segmento nunca empieza con '__', así que basta sanear.
export function sanitizeId(s) {
  const out = String(s ?? '').normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return out.slice(0, 200) || 'x';
}

// Id de documento de staging: determinista por (sistema, id_externo) → upsert.
export function stagingId(sistema, idExterno) {
  return `${sanitizeId(sistema)}__${sanitizeId(idExterno)}`;
}

// Hash estable (FNV-1a, 32-bit → hex) para fuentes SIN id propio (p.ej. comentarios):
// el id_externo se deriva del identificador de ENTIDAD (nombre+sector normalizados),
// de modo que el mismo edificio reportado de nuevo cae en el MISMO documento.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Clave de entidad (id_externo derivado) para fuentes sin id estable.
export function idExternoDeEntidad(nombre, sector = '') {
  return fnv1a(norm(nombre) + '|' + norm(sector));
}

// Entrada de procedencia (§25.3 fuentes[]): {sistema,id_externo,capturado_en,url}.
export function entradaFuente(sistema, idExterno, url = '', capturadoEnMs = Date.now()) {
  return { sistema, id_externo: String(idExterno), url: url || '', capturado_en: capturadoEnMs };
}

// Mezcla una entrada de fuente en un fuentes[] existente, dedup por (sistema,id_externo).
// Devuelve un arreglo NUEVO (no muta) → un canónico acumula la procedencia de todas
// las fuentes que lo describen sin repetir.
export function mergeFuentes(prev, entrada) {
  const arr = Array.isArray(prev) ? prev.slice() : [];
  const i = arr.findIndex((f) => f.sistema === entrada.sistema && f.id_externo === entrada.id_externo);
  if (i >= 0) arr[i] = { ...arr[i], ...entrada };
  else arr.push(entrada);
  return arr;
}
