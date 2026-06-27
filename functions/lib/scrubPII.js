// Detección/saneo de PII en texto libre antes de promover a PÚBLICO (§9-1). FOCO
// coordina ayuda a LUGARES; nombres, cédulas y teléfonos de personas NO se publican.
// Política: si `tienePII`, el promotor NO auto-publica → compuerta de operador.
// `limpio` redacta lo detectable como respaldo. Módulo PURO, testeable.

// Cédula venezolana: V-12.345.678, V12345678, "C.I. 12345678", o la palabra cédula.
const reCedula = /\b[VEJvej]-?\d{1,2}\.?\d{3}\.?\d{3}\b|\bc\.?\s?i\.?\s?:?\s?\d{6,9}\b|c[eé]dula/i;
// Teléfono móvil VE: 0412/0414/0416/0424/0426 + 7 dígitos (con separadores opcionales).
const reTel = /(\+?58[\s-]?|0)?4(1[246]|2[46])[\s-]?\d{3}[\s-]?\d{4}\b/;
// Señal de nombre de persona (heurístico): "se llama X", "mi hijo X", "el señor X".
const reNombre = /\b(se llama|mi (hij[oa]|madre|padre|espos[oa]|herman[oa]|abuel[oa]|t[ií][oa]|prim[oa])|el se[ñn]or|la se[ñn]ora|sra\.?|sr\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/;

export function detectarPII(texto) {
  const t = String(texto || '');
  const motivos = [];
  if (reCedula.test(t)) motivos.push('cedula');
  if (reTel.test(t)) motivos.push('telefono');
  if (reNombre.test(t)) motivos.push('nombre');
  return { tienePII: motivos.length > 0, motivos };
}

export function scrubPII(texto) {
  const t = String(texto || '');
  const { tienePII, motivos } = detectarPII(t);
  const limpio = t.replace(reCedula, '[dato omitido]').replace(reTel, '[contacto omitido]');
  return { tienePII, motivos, limpio };
}
