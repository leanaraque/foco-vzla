// RESUMEN HÍBRIDO (parte legible del motor de procesado). Toma los campos TIPADOS
// (functions/lib/extraer.js) y produce un resumen estandarizado, claro para un
// rescatista. Dos capas:
//   1) resumenDeterminista() — plantilla pura desde los campos (sin LLM): base SEGURA
//      y FALLBACK garantizado (cero costo, sin alucinación, siempre disponible).
//   2) resumenIA() — Claude (Haiku 4.5) redacta una versión legible ANCLADA a los
//      campos+texto: NUNCA inventa datos, NUNCA incluye nombres/PII, temp 0. Si la API
//      falla o devuelve algo sospechoso, cae al determinista.
// El operador revisa antes de publicar (compuerta en el procesador agendado).
import { scrubPII } from './scrubPII.js';

const cap = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// --- 1) Determinístico: plantilla "·"-separada desde los campos tipados ---
export function resumenDeterminista(campos = {}, sector = '') {
  const p = [];
  if (campos.rescate_activo) p.push('Rescate activo');
  const s = campos.senales || {};
  const sen = [];
  if (s.atrapados) sen.push('personas atrapadas');
  else if (s.por_rescatar) sen.push('personas por rescatar');
  if (s.con_vida) sen.push('con señales de vida');
  if (s.sin_ayuda) sen.push('sin ayuda aún');
  if (s.maquinaria) sen.push('requiere maquinaria');
  if (sen.length) p.push(sen.join(', '));
  if (campos.severidad && campos.severidad !== 'desconocida') p.push(`daño ${campos.severidad}`);
  if (Number.isFinite(campos.afectados)) p.push(`${campos.afectados} afectado${campos.afectados === 1 ? '' : 's'}`);
  if (s.fallecidos) p.push('se reporta fallecido(s)');
  if (Array.isArray(campos.necesidades) && campos.necesidades.length) p.push(`necesita: ${campos.necesidades.join(', ')}`);
  // Si no hubo ninguna señal, da algo útil con la categoría.
  if (!p.length) p.push(campos.categoria === 'rescate' ? 'Edificio reportado como afectado' : `Necesidad: ${campos.categoria || 'otro'}`);
  const nombre = (sector || '').split('·')[0].trim();
  return cap(nombre ? `${nombre} — ${p.join(' · ')}` : p.join(' · '), 240);
}

// --- 2) Resumen con IA, anclado y sin PII ---
export const MODELO_RESUMEN = process.env.MODELO_RESUMEN || 'claude-haiku-4-5';

const SYSTEM_RESUMEN = [
  'Eres un asistente que ESTANDARIZA reportes de una emergencia sísmica para que un rescatista los entienda al instante.',
  'REGLAS ESTRICTAS (es información de vida o muerte, fuente de la verdad):',
  '1. Resume SOLO con la información provista (campos estructurados + texto). NUNCA inventes ni infieras datos que no estén (número de atrapados, de afectados, severidad, etc.).',
  '2. NUNCA incluyas datos personales: nombres de personas, cédulas, teléfonos. Refiérete a lugares y situaciones, no a personas por su nombre.',
  '3. Español neutro, 1 frase, máximo ~30 palabras. Directo: qué se necesita, gravedad, señales clave (atrapados/con vida/sin ayuda), referencia del lugar.',
  '4. Si la información es insuficiente, dilo brevemente (ej. "Edificio reportado como afectado; faltan detalles").',
  '5. Devuelve SOLO el resumen, sin preámbulos, sin comillas, sin "Resumen:".',
  '6. NUNCA afirmes ni insinúes que hay personas muertas, fallecidas o "sin vida" salvo que el texto lo diga EXPLÍCITAMENTE. La ausencia de "señales de vida" NO significa que estén sin vida: ante la duda, no menciones el estado vital. Esto puede costar una vida.'
].join('\n');

// Guarda de SEGURIDAD (rescate): el resumen NO puede afirmar/insinuar muerte o ausencia
// de vida a menos que el campo TIPADO `senales.fallecidos` lo confirme. Evita que la IA
// infiera "sin vida" desde la mera ausencia de señales — un error que despriorizaría a
// alguien que sigue vivo. (Palabras positivas como "con vida"/"señales de vida" no caen.)
const RE_MUERTE = /\bsin vida\b|sin signos?(?:\s+de)?\s+vida|sin signos vitales|sin sobrevivientes|fallec|muert|cad[aá]ver|deceso|occis/i;
export const afirmaMuerteNoFundada = (texto, campos = {}) =>
  RE_MUERTE.test(String(texto || '')) && !(campos.senales && campos.senales.fallecidos);

// Arma la entrada para la IA (PURO): campos tipados + texto saneado de PII.
export function construirEntradaIA(record = {}, campos = {}) {
  const limpio = scrubPII(`${record.sector || ''}. ${record.descripcion || ''}`).limpio;
  const datos = {
    categoria: campos.categoria,
    severidad: campos.severidad,
    rescate_activo: campos.rescate_activo,
    señales: campos.senales,
    afectados: campos.afectados,
    necesidades: campos.necesidades,
    lugar: (record.sector || '').split('·')[0].trim()
  };
  return `Campos estructurados (verdad):\n${JSON.stringify(datos)}\n\nTexto original (ya sin datos personales):\n${cap(limpio, 600)}`;
}

// === TRADUCCIÓN AL INGLÉS (§i18n datos) ====================================
// Traduce el `resumen` YA SANEADO (sin PII, ya pasado por la guarda anti-muerte en
// español) al inglés. La entrada es segura por construcción; aun así se reaplica la
// guarda anti-muerte EN INGLÉS sobre la salida: una traducción no debe introducir
// una afirmación de muerte no fundada. Sin IA o ante cualquier fallo/sospecha,
// devuelve vacío → la UI/API caen al `resumen` español (degradación segura).
const SYSTEM_TRADUCCION = [
  'You translate short earthquake-emergency summaries from Spanish to English for rescuers.',
  'STRICT RULES (life-or-death, source of truth):',
  '1. Translate ONLY what the text says. Never add, infer or omit facts (number trapped, affected, severity, etc.).',
  '2. Never include personal data (names, ID numbers, phone numbers).',
  '3. Natural English, 1 sentence, keep it as short as the original. Keep place names as-is.',
  '4. Never state or imply that people are dead, deceased or "lifeless" unless the Spanish text says so EXPLICITLY.',
  '5. Return ONLY the translation, with no preamble, no quotes, no "Translation:".'
].join('\n');

// Guarda anti-muerte en inglés (espejo de RE_MUERTE). Patrones que afirman/insinúan
// muerte o ausencia de vida. Términos positivos ("signs of life") NO caen.
const RE_MUERTE_EN = /\bno signs? of life\b|\blifeless\b|\bdeceased\b|\bdead\b|\bfatalit(?:y|ies)\b|\bcadaver\b|\bcorpse\b|\bperished\b|\bcasualt(?:y|ies)\b/i;
export const afirmaMuerteNoFundadaEN = (texto, campos = {}) =>
  RE_MUERTE_EN.test(String(texto || '')) && !(campos.senales && campos.senales.fallecidos);

export async function traducirResumenEN(resumenEs, campos = {}, { apiKey, fetchImpl = fetch, modelo = MODELO_RESUMEN } = {}) {
  const base = String(resumenEs || '').trim();
  if (!apiKey || !base) return { resumen_en: '', via: 'ninguno', ok: false };
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelo, max_tokens: 200, temperature: 0,
        system: SYSTEM_TRADUCCION,
        messages: [{ role: 'user', content: base }]
      })
    });
    if (!r.ok) return { resumen_en: '', via: 'ninguno', ok: false };
    const j = await r.json();
    let texto = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    texto = texto.replace(/^["“']|["”']$/g, '').replace(/^translation:\s*/i, '').trim();
    // Guarda final: PII, vacío/larguísimo, o AFIRMA MUERTE no fundada → descarta.
    if (!texto || texto.length > 280 || scrubPII(texto).tienePII || afirmaMuerteNoFundadaEN(texto, campos)) {
      return { resumen_en: '', via: 'ninguno', ok: false };
    }
    return { resumen_en: texto, via: 'ia', ok: true };
  } catch (_) {
    return { resumen_en: '', via: 'ninguno', ok: false };
  }
}

// Llama a la API de Mensajes (fetch crudo, como Resend). Devuelve { resumen, via, ok }.
// Anclado: temp 0, max_tokens corto. Valida la salida (no PII, longitud) o cae al
// determinista. Nunca lanza: ante cualquier fallo devuelve el determinista.
export async function resumenIA(record, campos, { apiKey, fetchImpl = fetch, modelo = MODELO_RESUMEN } = {}) {
  const base = resumenDeterminista(campos, record.sector);
  if (!apiKey) return { resumen: base, via: 'reglas', ok: false };
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelo, max_tokens: 200, temperature: 0,
        system: SYSTEM_RESUMEN,
        messages: [{ role: 'user', content: construirEntradaIA(record, campos) }]
      })
    });
    if (!r.ok) return { resumen: base, via: 'reglas', ok: false };
    const j = await r.json();
    let texto = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    texto = texto.replace(/^["“']|["”']$/g, '').replace(/^resumen:\s*/i, '').trim();
    // Guarda final: si quedó PII, vacío/larguísimo, o AFIRMA MUERTE no fundada → descarta
    // y usa el determinista (seguro, anclado a los campos tipados).
    if (!texto || texto.length > 280 || scrubPII(texto).tienePII || afirmaMuerteNoFundada(texto, campos)) {
      return { resumen: base, via: 'reglas', ok: false };
    }
    return { resumen: texto, via: 'ia', ok: true };
  } catch (_) {
    return { resumen: base, via: 'reglas', ok: false };
  }
}
