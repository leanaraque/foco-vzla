// EXTRACCIÓN DETERMINÍSTICA (§25 "tipar los datos") — parte segura/auditable del
// motor híbrido de procesado. Toma el texto libre + campos existentes de un registro
// y deriva campos TIPADOS (severidad, señales de rescate, afectados, necesidades) con
// reglas explícitas (sin LLM, sin alucinación). El resumen LEGIBLE final lo pule
// Claude anclado a esto (functions/lib/resumen). Módulo PURO, testeable.
//
// Diseñado contra los patrones reales observados:
//   TV_EDIF:   "Daño parcial. Fuente: …"
//   IG_SENSEI: "Reportes ciudadanos (46): señales de vida · personas atrapadas. …"
//   RESCATE_VE:"Necesita: Búsqueda y rescate, … Colapso confirmado. …"
//   TVAPP:     texto libre ciudadano ("… se desplomó. Afectados: 9. …")

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Señales de rescate (regex sobre texto normalizado) ---
// SOLO personas atrapadas explícitas. El colapso/derrumbe estructural va a SEVERIDAD
// (extraerSeveridad), no a "atrapados": un edificio caído no implica gente atrapada
// salvo que el texto lo diga. Conservador para no inflar rescate_activo (fuente de verdad).
const reAtrap = /atrapad|tapiad|sepultad|enterrad|bajo[s]?\s+(los\s+)?escombros|(gente|personas?|familia|hij[oa]s?)\s+(dentro|adentro|atrapad|bajo)/;
const reVida = /con vida|senales de vida|vivo|viva|vivos|vivas|gritan|gritos|responden|piden ayuda|se escuchan|escuchan voces|toques/;
const reSinAyuda = /sin ayuda|no (ha|han) llegado|nadie ha|no hay (nadie|ayuda|rescatistas)|aun no (han|ha) (ido|llegado)/;
const reMaq = /maquinaria|excavadora|cavadora|gatos hidraulic|herramientas|palas|grua/;
const reFallecido = /fallec|murio|muerto|muerta|sin vida|cadaver|deceso/;

// --- Severidad estructural ---
export function extraerSeveridad(texto, severidadPrevia) {
  const t = norm(texto);
  const m = /da[nñ]o\s+(total|severo|parcial)/.exec(t);
  if (m) return m[1];
  if (/colaps|se desplom|derrumbe total|coleg|edificio (se )?cay/.test(t)) return 'total';
  if (/grietas?|fisuras?|da[nñ]os? estructural|inclinad|ladead/.test(t)) return 'severo';
  if (/sin derrumbe|sin da[nñ]o|leve|menor/.test(t)) return 'parcial';
  return severidadPrevia && severidadPrevia !== 'desconocida' ? severidadPrevia : 'desconocida';
}

// --- Necesidades pedidas: "Necesita: a, b, c" → vocabulario normalizado ---
const NEED_MAP = [
  [/busqueda y rescate|rescate|equipos especializados|personal de emergencia|victimas/i, 'rescate'],
  [/agua/i, 'agua'], [/aliment|comida|viver/i, 'alimento'],
  [/medic|salud|insulina|oxigeno|dialisis|paramedic/i, 'medico'],
  [/refugio|alojam|albergue|carpa/i, 'refugio'],
  [/ropa|higiene|colch|cobij|panal|bebe/i, 'insumos']
];
export function extraerNecesidades(texto) {
  const m = /necesita[n]?:\s*([^.·]+)/i.exec(texto || '');
  const fuente = m ? m[1] : (texto || '');
  const out = new Set();
  for (const [re, cat] of NEED_MAP) if (re.test(fuente)) out.add(cat);
  return [...out];
}

const num = (re, texto) => { const m = re.exec(texto || ''); return m ? parseInt(m[1], 10) : null; };

// --- Extracción principal: registro → campos tipados (sin PII; PII se omite aparte) ---
export function extraer(rec = {}) {
  const texto = `${rec.sector || ''} . ${rec.descripcion || ''}`;
  const t = norm(texto);
  const senales = {
    atrapados: reAtrap.test(t),
    con_vida: reVida.test(t),
    sin_ayuda: reSinAyuda.test(t),
    maquinaria: reMaq.test(t),
    fallecidos: reFallecido.test(t)
  };
  const severidad = extraerSeveridad(texto, rec.severidad);
  const necesidades = extraerNecesidades(rec.descripcion);
  const afectados = num(/afectad[oa]s?:?\s*(\d+)/i, texto) ?? num(/(\d+)\s+afectad/i, texto);
  const reportes = num(/(?:reportes?\s+)?ciudadanos?\s*\((\d+)\)/i, rec.descripcion) ?? num(/\((\d+)\)\s*:/i, rec.descripcion);

  const rescate = (senales.atrapados || senales.con_vida)
    ? { atrapados: senales.atrapados, con_vida: senales.con_vida }
    : null;
  const rescate_activo = !!(senales.atrapados || senales.con_vida);

  // Categoría derivada: si pide insumos sin señal de rescate, NO es rescate (corrige
  // el ruido tipo "Edificio sin derrumbe" → alimento). Rescate manda si hay señal viva.
  let categoria = rec.categoria;
  if (rescate_activo) categoria = 'rescate';
  else if (necesidades.length && !necesidades.includes('rescate')) categoria = necesidades[0] === 'insumos' ? 'otro' : necesidades[0];

  return {
    categoria,
    severidad,
    rescate, rescate_activo,
    necesidades,
    afectados: Number.isFinite(afectados) ? afectados : null,
    reportes_ciudadanos: Number.isFinite(reportes) ? reportes : null,
    senales,
    // confianza de la extracción: cuántas señales fuertes hallamos (para la compuerta)
    confianza: (severidad !== 'desconocida' ? 1 : 0) + (rescate_activo ? 1 : 0) + (necesidades.length ? 1 : 0) + (afectados ? 1 : 0)
  };
}
