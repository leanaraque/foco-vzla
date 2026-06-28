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
  '5. Devuelve SOLO el resumen, sin preámbulos, sin comillas, sin "Resumen:".'
].join('\n');

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
    // Guarda final: si quedó PII o vacío/larguísimo, usa el determinista.
    if (!texto || texto.length > 280 || scrubPII(texto).tienePII) {
      return { resumen: base, via: 'reglas', ok: false };
    }
    return { resumen: texto, via: 'ia', ok: true };
  } catch (_) {
    return { resumen: base, via: 'reglas', ok: false };
  }
}
