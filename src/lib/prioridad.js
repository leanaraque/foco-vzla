// Motor de PRIORIDAD canónica (Spec §25.5). Módulo PURO y testeable (sin Firebase,
// sin DOM): deriva una prioridad [0,100] de señales ESTRUCTURADAS del reporte, en
// vez de confiar en la urgencia auto-declarada (ruidosa: todos marcan "crítica").
// Mayor = más urgente. Calibrable por el operador ajustando los pesos de abajo.
//
// Filosofía (lente "vida en riesgo"): lo que primero sube la prioridad es la vida
// inmediata (personas atrapadas con señales de vida, medicamento crítico). Luego la
// severidad estructural, la vulnerabilidad y la escala. La FRESCURA decae la
// prioridad de lo viejo no reconfirmado (un "atrapado" de hace 3 días no puede
// competir con uno de hace 1 hora). La urgencia del usuario solo desempata.

export const PESOS = {
  atrapados: 45,
  con_vida: 15,            // atrapados + señales de vida
  rescate_reciente: 8,     // atrapados desde <6h
  medicamento_critico: 35, // insulina/oxígeno/diálisis
  herido: 20,
  severidad: { total: 18, severo: 12, parcial: 6, desconocida: 4 },
  vulnerable_unidad: 5, vulnerable_max: 15,
  personas: { '+20': 10, '6-20': 7, '2-5': 4, '1': 1 },
  categoria_base: { rescate: 10, medico: 9, agua: 7, alimento: 6, refugio: 6, servicios: 3, otro: 2 },
  urgencia_reportada: { critica: 3, alta: 1, media: 0 },
  // Decaimiento por frescura (horas sin reconfirmar → puntos que se restan)
  decaimiento: [[72, 25], [24, 12], [6, 4]]
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Horas desde la última señal de vigencia (o creación). `ahora` y los timestamps
// en ms epoch. Si no hay referencia temporal, 0 (no decae).
export function horasDesde(n, ahora = Date.now()) {
  const ref = n?.vigencia?.ultima_confirmacion_en ?? n?.creada_en;
  if (!Number.isFinite(ref)) return 0;
  return Math.max(0, (ahora - ref) / 3.6e6);
}

export function calcularPrioridad(n, ahora = Date.now()) {
  if (!n) return 0;
  let p = 0;
  const P = PESOS;

  // 1) Vida en riesgo inmediato
  if (n.rescate?.atrapados) {
    p += P.atrapados;
    if (n.rescate.con_vida) p += P.con_vida;
    if (n.rescate.desde === '<6h') p += P.rescate_reciente;
  }
  if (n.medico?.tipo === 'medicamento_critico') p += P.medicamento_critico;
  else if (n.medico?.tipo === 'herido') p += P.herido;

  // 2) Severidad estructural
  p += P.severidad[n.severidad] ?? P.severidad.desconocida;

  // 3) Vulnerables (con tope para no dominar)
  p += Math.min(P.vulnerable_max, (n.vulnerables?.length || 0) * P.vulnerable_unidad);

  // 4) Escala (nº de personas)
  p += P.personas[n.personas?.rango] || 0;

  // 5) Base por categoría solo si no hubo señales fuertes (evita que un reporte
  //    sin estructura quede en 0).
  if (p < 10) p += P.categoria_base[n.categoria] ?? 2;

  // 6) Insumo del usuario: desempate menor, NO el eje.
  p += P.urgencia_reportada[n.urgencia_reportada] || 0;

  // 7) Frescura: decae lo viejo no reconfirmado (umbral más alto primero).
  const horas = horasDesde(n, ahora);
  for (const [h, pts] of P.decaimiento) { if (horas > h) { p -= pts; break; } }

  return clamp(Math.round(p), 0, 100);
}

// Banda discreta para la UI (color/orden). Spec §25.5.
export function bandaPrioridad(p) {
  return p >= 60 ? 'critica' : p >= 35 ? 'alta' : p >= 15 ? 'media' : 'baja';
}

// Atajo: ¿es un rescate activo? (resumen booleano, Spec §25.3)
export function esRescateActivo(n) {
  return !!(n?.rescate?.atrapados) || /medicamento_critico/.test(n?.medico?.tipo || '');
}
