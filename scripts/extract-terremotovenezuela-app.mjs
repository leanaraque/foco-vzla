#!/usr/bin/env node
// Extractor: terremotovenezuela.app /api/reports → CSV necesidades + CSV recursos
// ---------------------------------------------------------------------------
// API REST pública propia (no Supabase). /api/reports devuelve reportes ciudadanos
// con coords reales: { id, type, lat, lng, place, affected, needs, confirmations,
// createdAt }. Mapeo por `type`:
//   critical → necesidad rescate/critica   (personas atrapadas, rescate activo)
//   building → necesidad rescate/alta       (daño estructural)
//   supplies → necesidad alimento/alta      (insumos)
//   nopower  → necesidad otro/media         (sin electricidad)
//   shelter  → RECURSO refugio              (refugio disponible)
//   missing  → DESCARTADO                   (personas; fuera de alcance §3)
//
// USO:
//   node scripts/extract-terremotovenezuela-app.mjs <salida_necesidades.csv> <salida_recursos.csv>
// Luego:
//   node scripts/import-csv.mjs <necesidades.csv> --tag=TVAPP_NEC
//   node scripts/import-recursos.mjs <recursos.csv> --exacto --tag=TVAPP_REC

import { writeFileSync } from 'node:fs';

const URL = 'https://terremotovenezuela.app/api/reports';
const VENEZUELA = [0.6, 12.2, -73.4, -59.8];
const inVe = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= VENEZUELA[0] && lat <= VENEZUELA[1] && lng >= VENEZUELA[2] && lng <= VENEZUELA[3];

// type → { destino: 'nec'|'rec', categoria, urgencia? }
const MAP = {
  critical: { destino: 'nec', categoria: 'rescate', urgencia: 'critica' },
  building: { destino: 'nec', categoria: 'rescate', urgencia: 'alta' },
  supplies: { destino: 'nec', categoria: 'alimento', urgencia: 'alta' },
  nopower:  { destino: 'nec', categoria: 'otro', urgencia: 'media' },
  shelter:  { destino: 'rec', categoria: 'refugio' }
  // missing: omitido a propósito
};

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outNec = args[0] || 'tvapp-necesidades.csv';
const outRec = args[1] || 'tvapp-recursos.csv';

const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const cap = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

console.log('Descargando /api/reports …');
const resp = await fetch(URL, { headers: { accept: 'application/json' } });
if (!resp.ok) { console.error('Fallo:', resp.status); process.exit(1); }
const reports = (await resp.json()).reports || [];
console.log(`Recibidos ${reports.length} reportes.`);

const colsNec = ['nombre', 'zona', 'municipio', 'referencia', 'lat', 'lng', 'urgencia', 'categoria', 'notas'];
const colsRec = ['nombre', 'categoria', 'zona', 'municipio', 'referencia', 'contacto', 'lat', 'lng', 'notas'];
const filasNec = [colsNec.join(',')];
const filasRec = [colsRec.join(',')];
const cont = { nec: 0, rec: 0, missing: 0, sinMapa: 0, sinCoord: 0 };

for (const r of reports) {
  if (r.type === 'missing') { cont.missing++; continue; }
  const m = MAP[r.type];
  if (!m) { cont.sinMapa++; continue; }
  if (!inVe(r.lat, r.lng)) { cont.sinCoord++; continue; }

  const nombre = cap(r.place || `Reporte ${r.type}`, 140);
  const meta = [r.affected ? `Afectados: ${r.affected}` : '', r.confirmations ? `Confirmaciones: ${r.confirmations}` : ''].filter(Boolean).join('. ');
  const notas = cap([r.needs, meta, 'Fuente: terremotovenezuela.app'].filter(Boolean).join('. '), 500);

  if (m.destino === 'nec') {
    filasNec.push([nombre, '', '', '', r.lat, r.lng, m.urgencia, m.categoria, notas].map(csvCell).join(','));
    cont.nec++;
  } else {
    filasRec.push([nombre, m.categoria, '', '', '', '', r.lat, r.lng, notas].map(csvCell).join(','));
    cont.rec++;
  }
}

writeFileSync(outNec, filasNec.join('\r\n'), 'utf8');
writeFileSync(outRec, filasRec.join('\r\n'), 'utf8');
console.log(`\n✅ Necesidades: ${cont.nec} → ${outNec}`);
console.log(`✅ Recursos (refugios): ${cont.rec} → ${outRec}`);
console.log(`   Descartados: missing=${cont.missing}, type sin mapeo=${cont.sinMapa}, sin coords=${cont.sinCoord}`);
console.log(`\nSiguiente:`);
console.log(`  node scripts/import-csv.mjs ${outNec} --tag=TVAPP_NEC`);
console.log(`  node scripts/import-recursos.mjs ${outRec} --exacto --tag=TVAPP_REC`);
