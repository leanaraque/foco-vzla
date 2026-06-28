#!/usr/bin/env node
// MUESTRA del procesado (Plan §"procesar") — SOLO LECTURA, NO ESCRIBE NADA.
// Corre el pipeline real (extracción §25 + geo-enricher OSM + resumen híbrido Claude)
// sobre una muestra representativa de necesidades de PRODUCCIÓN y muestra, por registro,
// el ANTES (texto crudo de la fuente) vs la PROPUESTA (resumen, tipado, decisión de geo).
// Sirve para que Lean revise la salida ANTES de aplicar a producción (gate §12).
//
// USO:
//   node scripts/procesar-muestra.mjs           # muestra ~8 registros variados
//   node scripts/procesar-muestra.mjs --n=12     # tamaño de muestra
//   node scripts/procesar-muestra.mjs --id=<id>  # un registro puntual
import { execSync } from 'node:child_process';
import { procesarUno } from '../functions/lib/procesar.js';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const N = opt.n ? +opt.n : 8;

const PROJECT = 'foco-vzla';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = () => execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = () => ({ Authorization: `Bearer ${token()}` });

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

// La key vive en Secret Manager; se lee SOLO en memoria para esta corrida.
function apiKeyDeSecretManager() {
  try { return execSync(`gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY --project=${PROJECT}`, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

// Muestra estratificada: variedad de fuentes y de precisión (donde el geo aporta).
function muestra(necs, n) {
  const vivos = necs.filter(r => !r.duplicado_de && r.descripcion);
  const sector = vivos.filter(r => r.precision === 'sector');
  const exacta = vivos.filter(r => r.precision === 'exacta');
  const ciudadano = vivos.filter(r => r.fuente === 'web' || (r.creador && !/^[A-Z_]+$/.test(r.creador)));
  const ricos = (arr) => [...arr].sort((a, b) => (b.descripcion?.length || 0) - (a.descripcion?.length || 0));
  const pick = [];
  const add = (arr, k) => { for (const r of ricos(arr)) { if (pick.length >= n) break; if (!pick.find(x => x.id === r.id)) pick.push(r); if (pick.filter(x => arr.includes(x)).length >= k) break; } };
  add(sector, Math.ceil(n * 0.4));     // donde el geo-enricher trabaja
  add(ciudadano, 2);                   // reportes humanos (línea roja)
  add(exacta, n);                      // el grueso (edificios)
  return pick.slice(0, n);
}

const fmtGeo = (g) => g ? `${(+g.lat).toFixed(4)}, ${(+g.lng).toFixed(4)}` : '—';
const corta = (s, n = 220) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

console.log(`\n=== MUESTRA DEL PROCESADO (solo lectura, sin escribir) — ${PROJECT} ===\n`);
const apiKey = apiKeyDeSecretManager();
console.log(apiKey ? `Clave Anthropic: OK (Secret Manager, ${apiKey.slice(0, 7)}…)\n` : `Clave Anthropic: NO disponible → resumen por reglas (fallback)\n`);

const necs = await leerColeccion('necesidades');
const sel = opt.id ? necs.filter(r => r.id === opt.id) : muestra(necs, N);
console.log(`Necesidades en prod: ${necs.length} · muestra: ${sel.length}\n${'─'.repeat(78)}`);

let i = 0;
for (const rec of sel) {
  i++;
  const { patch, revision, _geo } = await procesarUno(rec, { apiKey });
  const necs2 = patch.necesidades_pedidas?.join(', ') || '—';
  console.log(`\n[${i}/${sel.length}] ${rec.id}  ·  fuente=${rec.creador || rec.fuente || '?'}  ·  precision=${rec.precision || '?'}`);
  console.log(`  sector:    ${rec.sector || '—'}`);
  console.log(`  ORIGINAL:  ${corta(rec.descripcion)}`);
  console.log(`  ──────────── propuesta ────────────`);
  console.log(`  RESUMEN:   ${patch.resumen}   [${patch.procesado.resumen_via}]`);
  console.log(`  TIPADO:    severidad=${patch.severidad} · rescate_activo=${patch.rescate_activo}` + (Number.isFinite(patch.afectados) ? ` · afectados=${patch.afectados}` : '') + ` · necesidades=[${necs2}]`);
  const move = patch.geo ? `→ NUEVA ${fmtGeo(patch.geo)}` : 'sin cambio';
  console.log(`  GEO:       actual ${fmtGeo(rec.geo)} · ${_geo.fuente_geo} (conf ${_geo.confianza}, Δ${_geo.movimiento_m}m) · ${move}`);
  if (revision) console.log(`  ⚠ REVISIÓN: ${revision.motivo} (Δ${revision.movimiento_m}m → cola del operador, NO se auto-aplica)`);
}
console.log(`\n${'─'.repeat(78)}\nFin de la muestra. Nada fue escrito en producción.\n`);
