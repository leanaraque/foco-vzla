#!/usr/bin/env node
// MIGRACIÓN/RECONCILIACIÓN (Plan §"Migración", una vez) — DRY-RUN por defecto.
// Antes del primer run recurrente del pipeline: estampa `fuentes[]` (identidad
// estable sistema+id_externo) sobre los documentos YA existentes, re-jalando cada
// fuente API y emparejando cada registro con el canónico existente por la MISMA
// lógica del promotor (identidad → dedup nombre/proximidad). Así el primer run
// concilia por IDENTIDAD (robusto) en vez de depender solo del dedup difuso, y NO
// duplica. Solo AÑADE fuentes[] (idempotente, reversible); nunca borra ni pisa.
//
// Reporta, por fuente: cuántos existentes recibirían identidad, cuántos registros de
// la fuente NO tienen match (se CREARÍAN en el primer run) y cuántos existentes no
// matchean (ciudadanos / IG / CSV La Guaira → se dejan intactos).
//
// USO (lee con el token de gcloud, como import-csv.mjs):
//   node scripts/migrar-fuentes.mjs            # DRY-RUN: solo reporta
//   node scripts/migrar-fuentes.mjs --apply    # estampa fuentes[] (PATCH) en los match
//   node scripts/migrar-fuentes.mjs --solo=RESCATE_VE   # una sola fuente
import { execSync } from 'node:child_process';
import { ADAPTERS } from '../functions/ingesta.js';
import { buscarMatch } from '../functions/lib/promocion.js';
import { mergeFuentes, entradaFuente } from '../functions/lib/identidad.js';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const APPLY = !!opt.apply;
const SOLO = opt.solo ? String(opt.solo).split(',') : null;

const PROJECT = 'foco-vzla';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = () => execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

// Decodifica un documento REST de Firestore a JS plano (solo los campos que usamos).
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
// Codifica un arreglo fuentes[] a formato REST para el PATCH.
const enc = (v) => Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : (v && typeof v === 'object') ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };

console.log(`MIGRACIÓN fuentes[] — ${APPLY ? 'APLICAR (PATCH)' : 'DRY-RUN (solo reporta)'}`);
const [necesidades, recursos] = await Promise.all([leerColeccion('necesidades'), leerColeccion('recursos')]);
console.log(`Canónicos: ${necesidades.length} necesidades, ${recursos.length} recursos\n`);

const tocados = new Set();
for (const adapter of ADAPTERS) {
  if (SOLO && !SOLO.includes(adapter.sistema)) continue;
  let rows;
  try { rows = await adapter.descargar({ fetchImpl: fetch }); }
  catch (e) { console.log(`✗ ${adapter.sistema}: no se pudo descargar (${e.message})`); continue; }
  const recs = rows.map(r => { const m = adapter.mapear(r); return m ? { ...m, sistema: adapter.sistema } : null; }).filter(Boolean);
  let match = 0, nuevos = 0, yaIdent = 0;
  for (const st of recs) {
    const lista = st.destino === 'recurso' ? recursos : necesidades;
    const m = buscarMatch(st, lista);
    if (!m) { nuevos++; continue; }
    if (Array.isArray(m.fuentes) && m.fuentes.some(f => f.sistema === st.sistema && f.id_externo === st.id_externo)) { yaIdent++; continue; }
    match++;
    if (APPLY) {
      const fuentes = mergeFuentes(m.fuentes, entradaFuente(st.sistema, st.id_externo, adapter.url));
      m.fuentes = fuentes; // refleja para el resto del lote
      const col = st.destino === 'recurso' ? 'recursos' : 'necesidades';
      const r = await fetch(`${BASE}/${col}/${m.id}?updateMask.fieldPaths=fuentes`, { method: 'PATCH', headers: H(), body: JSON.stringify({ fields: { fuentes: enc(fuentes) } }) });
      if (!r.ok) console.log(`  ✗ PATCH ${col}/${m.id}: ${r.status}`);
    }
    tocados.add(m.id);
  }
  console.log(`${adapter.sistema}: ${recs.length} registros de fuente → match con existentes ${match}, ya con identidad ${yaIdent}, nuevos (se crearían) ${nuevos}`);
}

const conIdent = necesidades.concat(recursos).filter(d => Array.isArray(d.fuentes) && d.fuentes.length).length;
console.log(`\nResumen: ${APPLY ? `estampados ${tocados.size} canónicos con fuentes[]` : `${tocados.size} canónicos recibirían fuentes[] (dry-run)`}.`);
console.log(`Canónicos con fuentes[] actualmente: ${conIdent}. Los SIN match (ciudadanos / IG / CSV La Guaira) se dejan intactos.`);
if (!APPLY) console.log('\n(DRY-RUN. Repetir con --apply para estampar. Solo AÑADE fuentes[]; reversible.)');
