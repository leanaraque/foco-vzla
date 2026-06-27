// Motor de PRIORIDAD server-side. Extraído de curador.js para compartirlo entre el
// curador y el promotor de ingesta SIN duplicar el motor (mirror de
// src/lib/prioridad.js; mantener en sync con el cliente).
//
// Opera sobre el documento ALMACENADO: `personas_rango` plano, `urgencia` reportada,
// y `_refMs` (ms epoch de la última señal de vigencia o creación) que el caller
// estampa antes de llamar. Deriva prioridad [0,100] de señales estructuradas con
// DECAIMIENTO por frescura. NO cambiar los pesos sin re-verificar el curador.
export const PESOS = {
  atrapados: 45, con_vida: 15, rescate_reciente: 8, medicamento_critico: 35, herido: 20,
  severidad: { total: 18, severo: 12, parcial: 6, desconocida: 4 },
  vulnerable_unidad: 5, vulnerable_max: 15,
  personas: { '+20': 10, '6-20': 7, '2-5': 4, '1': 1 },
  categoria_base: { rescate: 10, medico: 9, agua: 7, alimento: 6, refugio: 6, servicios: 3, otro: 2 },
  urgencia_reportada: { critica: 3, alta: 1, media: 0 }, decaimiento: [[72, 25], [24, 12], [6, 4]]
};

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function calcularPrioridad(n, ahora) {
  let p = 0; const P = PESOS;
  if (n.rescate?.atrapados) { p += P.atrapados; if (n.rescate.con_vida) p += P.con_vida; if (n.rescate.desde === '<6h') p += P.rescate_reciente; }
  if (n.medico?.tipo === 'medicamento_critico') p += P.medicamento_critico; else if (n.medico?.tipo === 'herido') p += P.herido;
  p += P.severidad[n.severidad] ?? P.severidad.desconocida;
  p += Math.min(P.vulnerable_max, (n.vulnerables?.length || 0) * P.vulnerable_unidad);
  p += P.personas[n.personas_rango] || 0;
  if (p < 10) p += P.categoria_base[n.categoria] ?? 2;
  p += P.urgencia_reportada[n.urgencia] || 0;
  const ref = n._refMs; const horas = Number.isFinite(ref) ? Math.max(0, (ahora - ref) / 3.6e6) : 0;
  for (const [h, pts] of P.decaimiento) { if (horas > h) { p -= pts; break; } }
  return clamp(Math.round(p), 0, 100);
}

export const esRescateActivo = (n) => !!(n.rescate?.atrapados) || n.medico?.tipo === 'medicamento_critico';
