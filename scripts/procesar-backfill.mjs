#!/usr/bin/env node
// BACKFILL del procesado (Plan §"procesar", una vez) — procesa TODAS las necesidades
// pendientes ahora, en lugar de esperar ~37 corridas agendadas. Misma lógica que la
// función `procesador` (procesarUno): extracción §25 + geo-enricher + resumen híbrido.
// IDEMPOTENTE (salta lo ya procesado por hash) y NO destructivo: escribe SOLO los campos
// del procesado vía updateMask (resumen, tipado, procesado, geo si mejora). Sin PII.
//
// USO:
//   node scripts/procesar-backfill.mjs                 # DRY-RUN: cuenta y estima, no escribe
//   node scripts/procesar-backfill.mjs --apply         # escribe el procesado en prod
//   node scripts/procesar-backfill.mjs --apply --limit=50   # tope (para una prueba acotada)
import { execSync } from 'node:child_process';
import { procesarUno } from '../functions/lib/procesar.js';
import { necesitaProceso } from '../functions/lib/procesar.js';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const APPLY = !!opt.apply;
const LIMIT = opt.limit ? +opt.limit : Infinity;

const PROJECT = 'foco-vzla';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let _tok = null;
const refrescaTok = () => { _tok = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); return _tok; };
const H = () => ({ Authorization: `Bearer ${_tok || refrescaTok()}`, 'Content-Type': 'application/json' });

function val(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = val(x); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
async function leerColeccion(col) {
  const out = []; let page;
  do {
    const j = await fetch(`${BASE}/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`, { headers: H() }).then(r => r.json());
    if (j.error) throw new Error(`${col}: ${j.error.message}`);
    page = j.nextPageToken;
    for (const d of j.documents || []) { const f = {}; for (const [k, x] of Object.entries(d.fields || {})) f[k] = val(x); out.push({ id: d.name.split('/').pop(), ...f }); }
  } while (page);
  return out;
}
const enc = (v) => v instanceof Date ? { timestampValue: v.toISOString() }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : (v && typeof v === 'object') ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v }
  : v == null ? { nullValue: null } : { stringValue: String(v) };

// PATCH idempotente con updateMask (solo los campos del patch); refresca token en 401.
async function patchDoc(col, id, patch) {
  const mask = Object.keys(patch).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const body = JSON.stringify({ fields: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, enc(v)])) });
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(`${BASE}/${col}/${id}?${mask}`, { method: 'PATCH', headers: H(), body });
    if (r.ok) return true;
    if (r.status === 401) { refrescaTok(); continue; }
    console.log(`  ✗ PATCH ${col}/${id}: ${r.status} ${await r.text()}`);
    return false;
  }
  return false;
}

const apiKey = (() => { try { return execSync(`gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY --project=${PROJECT}`, { encoding: 'utf8' }).trim(); } catch { return ''; } })();
console.log(`\n=== BACKFILL PROCESADO — ${APPLY ? 'APLICAR (escribe en prod)' : 'DRY-RUN (no escribe)'} ===`);
console.log(apiKey ? `Clave Anthropic: OK\n` : `Clave Anthropic: NO disponible → resumen por reglas\n`);

const necs = await leerColeccion('necesidades');
const pendientes = necs.filter(d => !d.duplicado_de && necesitaProceso(d)).slice(0, LIMIT);
console.log(`Necesidades: ${necs.length} · pendientes de procesar: ${pendientes.length}${LIMIT < Infinity ? ` (tope ${LIMIT})` : ''}\n`);
if (!APPLY) { console.log('DRY-RUN: agrega --apply para escribir. Nada fue modificado.'); process.exit(0); }

let ok = 0, ia = 0, rev = 0, fail = 0;
const t0 = Date.now();
for (let i = 0; i < pendientes.length; i++) {
  const d = pendientes[i];
  try {
    const { patch, revision, _resumen } = await procesarUno(d, { apiKey, ahoraTs: new Date() });
    const w = await patchDoc('necesidades', d.id, patch);
    if (!w) { fail++; continue; }
    if (_resumen?.via === 'ia') ia++;
    if (revision) { await patchDoc('_procesar_revision', d.id, { necesidad_id: d.id, sector: d.sector || '', ...revision, creada_en: new Date() }); rev++; }
    ok++;
  } catch (e) { fail++; console.log(`  ✗ ${d.id}: ${e?.message || e}`); }
  if ((i + 1) % 25 === 0 || i === pendientes.length - 1) {
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`  … ${i + 1}/${pendientes.length} · ok ${ok} (IA ${ia}) · revisión ${rev} · fallos ${fail} · ${min} min`);
  }
}
console.log(`\nFIN. Procesados ${ok}/${pendientes.length} (IA ${ia}) · geo a revisión ${rev} · fallos ${fail}.`);
