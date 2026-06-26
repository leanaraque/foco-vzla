#!/usr/bin/env node
// Importador de COMENTARIOS ciudadanos (reels de rescate) → necesidades de FOCO.
// Convierte miles de comentarios libres (Instagram/redes) en un mapa de TRIAJE
// deduplicado: 1 entidad por edificio, con señal de rescate agregada y "confianza"
// = nº de menciones. La señal humana en vivo (quién está atrapado/con vida) es el
// dato que la carga de escritorio NO tiene.
//
// LÍNEA ROJA DE PRIVACIDAD: el edificio + situación van al doc PÚBLICO; los
// NOMBRES/CÉDULAS de personas NO se publican (FOCO coordina ayuda a LUGARES; los
// desaparecidos son un registro aparte). Aquí se detectan para poder OMITIRLOS.
//
// USO:
//   node scripts/import-comentarios.mjs <comentarios.txt> [--fuente=IG_SENSEI] [--import]
//   (sin --import = DRY-RUN: escribe triaje a comentarios-triaje.md y .json, no toca Firestore)
//
// Empareja por nombre con las necesidades existentes (enriquece) o crea nuevas a
// nivel SECTOR (centroide de la zona). El curador agendado afina la deduplicación.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const FUENTE = opt.fuente || 'IG_COMENTARIOS';
if (!file) { console.error('Falta el archivo de comentarios. Ver cabecera.'); process.exit(1); }

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

// Centroides de sector (nivel ~1km, La Guaira). Coords PÚBLICAS por zona.
const SECTORES = {
  'playa grande': [10.6095, -67.0130], 'catia la mar': [10.6030, -67.0250], 'urimare': [10.6085, -67.0100],
  'maiquetia': [10.5990, -66.9800], 'los corales': [10.6090, -66.8800], 'caraballeda': [10.6125, -66.8540],
  'caribe': [10.6110, -66.8700], 'tanaguarena': [10.6160, -66.8200], 'macuto': [10.6020, -66.8900],
  'los cocos': [10.6020, -66.9300], 'puerto viejo': [10.6060, -66.9600], 'naiguata': [10.6210, -66.7400]
};
const SECTOR_DEFECTO = 'playa grande';

// Normalización de nombres de edificio (variantes/typos vistos en los comentarios).
const ALIAS = [
  [/belo|bela|bello|velo/, /horizonte|horozonte|horizontes/, 'Belo Horizonte'],
  [/aguja|agua|ajuga/, /azul/, 'Aguja Azul'],
  [/oasis/, /beach|bleach/, 'Oasis Beach'],
  [/los|el/, /monjes|monge|monges|molino|molinos/, null], // se resuelve abajo
];
// Mapa directo nombre-normalizado-parcial → canónico (los más mencionados).
const CANON = new Map(Object.entries({
  'belo horizonte': 'Belo Horizonte', 'bello horizonte': 'Belo Horizonte', 'bela horizonte': 'Belo Horizonte', 'velo horizonte': 'Belo Horizonte',
  'oasis beach': 'Oasis Beach', 'oasis': 'Oasis Beach', 'oasis bleach': 'Oasis Beach',
  'aguja azul': 'Aguja Azul', 'agua azul': 'Aguja Azul',
  'los monjes': 'Los Monjes', 'monjes': 'Los Monjes',
  'aquarium': 'Aquarium', 'aquarius': 'Aquarium', 'aquuaruim': 'Aquarium',
  'villa mar': 'Villa Mar', 'villamar': 'Villa Mar', 'viliamar': 'Villa Mar', 'viliamar': 'Villa Mar',
  'cumanagoto': 'Cumanagoto', 'cumangoto': 'Cumanagoto',
  'el jurel': 'El Jurel', 'jurel': 'El Jurel', 'juriel': 'El Jurel',
  'sol marino garden': 'Sol Marino Garden 2', 'sol marino grande': 'Sol Marino Garden 2', 'sol marino': 'Sol Marino Garden 2',
  'los corsarios': 'Los Corsarios', 'corsarios': 'Los Corsarios', 'corsario': 'Los Corsarios',
  'hotel chipis beach': "Hotel Chipi's Beach", 'chipis': "Hotel Chipi's Beach", 'chipis beach': "Hotel Chipi's Beach",
  'pelicanos': 'Pelícanos', 'pelicano': 'Pelícanos', 'pellicano': 'Pelícanos', 'pellicanos': 'Pelícanos',
  'orca': 'Orca', 'la orca': 'Orca', 'el orca': 'Orca',
  'relax vista mar': 'Relax Vista Mar', 'relaxvistamr': 'Relax Vista Mar', 'relax': 'Relax Vista Mar',
  'pez vela': 'Pez Vela', 'costa dorada': 'Costa Dorada', 'bucaneros': 'Bucaneros',
  'nautilus': 'Nautilus', 'nautilius': 'Nautilus', 'vallarta': 'Vallarta', 'vista mar': 'Vista Mar', 'vistamar': 'Vista Mar',
  'mi club': 'Mi Club', 'el club': 'Mi Club', 'cambural': 'Cambural', 'capri': 'Capri', 'malecon': 'Malecón',
  'costa brava': 'Costa Brava', 'arichuna': 'Arichuna', 'solymar': 'Solymar', 'solimar': 'Solymar',
  'coral mar': 'Coral Mar', 'ritasol palace': 'Rita Sol Palace', 'rita sol palace': 'Rita Sol Palace',
  'gradisca': 'Gradisca', 'bellevue': 'Bellevue', 'bahia mar': 'Bahía Mar', 'riomar': 'Riomar', 'rio mar': 'Riomar',
  'carabamar': 'Carabamar', 'country mar': 'Country Mar', 'tahiti': 'Tahiti', 'tamiami': 'Tamiami',
  'punta brisa': 'Punta Brisa', 'punta brisas': 'Punta Brisa', 'albatros': 'Albatros', 'maratea': 'Maratea',
  'caraballeda suite': 'Caraballeda Suites', 'caraballeda suites': 'Caraballeda Suites', 'mar de leva': 'Mar de Leva',
  'palmar este': 'Palmar Este', 'los delfines': 'Los Delfines', 'mision vivienda': 'Misión Vivienda', 'urbanismo hugo chavez': 'Urb. Hugo Chávez'
}));

// ---- Señales de rescate (regex sobre el texto del comentario, normalizado) ----
const reAtrap = /atrapad|tapiad|tapad|escombros|debajo|bajo los|sepultad|enterrad/;
const reVida = /con vida|vivo|viva|vivos|vivas|senales de vida|gritan|gritos|responden|piden ayuda|pidiendo|aun viva|aun vivo|toques|se escuchan|escuchan voces/;
const reMaq = /maquinaria|excavadora|cavadora|gatos hidraulic|herramientas|maquina|palas/;
const reSinAyuda = /no ha llegado|no han llegado|sin ayuda|nadie ha|no hay nadie|no hay ayuda|no hay rescatistas|aun no|no han ido|no ha ido|no ido nadie/;
const reCedula = /\b\d{6,9}\b|c\.?i\.?\s*\d|cedula/i;
const reTel = /(\+?58|0)?4\d{2}[\s-]?\d{3}[\s-]?\d{4}/;

// Ruido a descartar (no son reportes de edificio).
const RUIDO = /^(gracias|dios te bendiga|dios los bendiga|amen|compartido|excelente|bien|si alguien|🙏|hola|buenas|foto disponible|http|www\.|@\w+|eso es|sigue asi|que dios)/i;

function detectarSector(t) { for (const s of Object.keys(SECTORES)) if (t.includes(s)) return s; return null; }

function detectarEdificio(t) {
  // 1) match directo contra el diccionario canónico (substring del normalizado)
  for (const [k, v] of CANON) if (t.includes(k)) return v;
  // 2) patrón "edificio|residencia(s)|res|conjunto|urb|hotel|torre <Nombre>"
  const m = /(?:edificio|edif|residencias?|res|conjunto|urb(?:anizacion)?|hotel|torre|recidencias?)\s+([a-z0-9ñ]+(?:\s+[a-z0-9ñ]+){0,2})/.exec(t);
  if (m) { const cand = m[1].replace(/\b(de|la|el|los|en|por|favor|playa|grande|catia|mar|del)\b/g, ' ').replace(/\s+/g, ' ').trim(); const ws = cand.split(' ').filter(Boolean); if (ws.join('').length >= 3) return ws.map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
  return null;
}

// ---- Parseo del archivo en comentarios ----
const raw = readFileSync(file, 'utf8');
let comentarios;
if (file.toLowerCase().endsWith('.json')) {
  // Export estructurado: array de { text } (o strings). Usa el texto del comentario.
  const arr = JSON.parse(raw);
  comentarios = (Array.isArray(arr) ? arr : []).map(x => typeof x === 'string' ? x : (x && x.text) || '')
    .map(c => c.replace(/\s+/g, ' ').trim()).filter(c => c.length > 3);
} else {
  // Texto pegado: separa por las líneas de metadatos de IG (tiempo + Me gusta/Responder).
  comentarios = raw.split(/\n?\s*\d+\s*(?:h|min|s)\d*\s*(?:Me gusta)?Responder|\nResponder|Foto disponible en la aplicacion/i)
    .map(c => c.replace(/\s+/g, ' ').trim()).filter(c => c.length > 3);
}

const mapa = new Map(); // canónico → agregado
let conPII = 0, ruido = 0, sinEdificio = 0;
for (const c of comentarios) {
  if (RUIDO.test(c.trim())) { ruido++; continue; }
  const t = norm(c);
  const edi = detectarEdificio(t);
  if (!edi) { sinEdificio++; continue; }
  const sector = detectarSector(t) || SECTOR_DEFECTO;
  if (reCedula.test(c) || reTel.test(c)) conPII++;
  const key = norm(edi);
  const a = mapa.get(key) || { nombre: edi, sector, menciones: 0, atrapados: false, con_vida: false, maquinaria: false, sin_ayuda: false, sectores: {} };
  a.menciones++;
  a.atrapados ||= reAtrap.test(t);
  a.con_vida ||= reVida.test(t);
  a.maquinaria ||= reMaq.test(t);
  a.sin_ayuda ||= reSinAyuda.test(t);
  a.sectores[sector] = (a.sectores[sector] || 0) + 1;
  mapa.set(key, a);
}

// Prioridad de triaje: menciones + bonus por señales (con vida pesa más).
const score = a => a.menciones + (a.con_vida ? 30 : 0) + (a.atrapados ? 10 : 0) + (a.sin_ayuda ? 5 : 0);
const lista = [...mapa.values()].map(a => ({ ...a, sector: Object.entries(a.sectores).sort((x, y) => y[1] - x[1])[0][0], score: score(a) }))
  .filter(a => a.menciones >= 1).sort((x, y) => y.score - x.score);

// ---- Salida de triaje (dry-run) ----
let md = `# Triaje de comentarios ciudadanos — ${file}\n`;
md += `${comentarios.length} comentarios → ${lista.length} edificios únicos | ruido descartado: ${ruido} | sin edificio: ${sinEdificio} | con PII detectada (omitida del público): ${conPII}\n\n`;
md += `| # | Edificio | Sector | Menciones | 🆘 con vida | atrapados | sin ayuda |\n|--|--|--|--:|:--:|:--:|:--:|\n`;
lista.forEach((a, i) => { md += `| ${i + 1} | ${a.nombre} | ${a.sector} | ${a.menciones} | ${a.con_vida ? '✅' : ''} | ${a.atrapados ? '✅' : ''} | ${a.sin_ayuda ? '✅' : ''} |\n`; });
writeFileSync('comentarios-triaje.md', md);
writeFileSync('comentarios-triaje.json', JSON.stringify(lista, null, 0));
console.log(md.split('\n').slice(0, 45).join('\n'));
console.log(`\n(triaje completo en comentarios-triaje.md — ${lista.length} edificios)`);

if (!opt.import) { console.log('\nDRY-RUN. Repite con --import para escribir a FOCO (necesidades, deduplicado por el curador).'); process.exit(0); }

// ---- Import a Firestore (Admin REST) ----
const PROJECT = 'foco-vzla';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = () => execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });
const S = v => ({ stringValue: String(v) }); const N = v => ({ integerValue: String(v) }); const B = v => ({ booleanValue: v }); const D = v => ({ doubleValue: v }); const TS = () => ({ timestampValue: new Date().toISOString() });
const require2 = (await import('node:module')).createRequire(import.meta.url);
const { geohashForLocation } = require2('geofire-common');

// Traer existentes para EMPAREJAR por nombre (enriquecer en vez de duplicar).
async function pageAll(col) { const o = []; let p; do { const j = await fetch(`${BASE}/${col}?pageSize=300${p ? '&pageToken=' + p : ''}`, { headers: H() }).then(r => r.json()); p = j.nextPageToken; for (const d of j.documents || []) o.push({ id: d.name.split('/').pop(), f: d.fields || {} }); } while (p); return o; }
const existentes = await pageAll('necesidades');
// Clave de emparejamiento: nombre SIN prefijo de tipo (así "Orca" == "Residencias Orca").
const clave = s => norm(s).replace(/^(residencias?|recidencias?|edificios?|edif|res|conjunto residencial|conjunto|urb(?:anizacion)?|hotel|torre)\s+/, '');
const idx = new Map();
for (const d of existentes) { if (d.f.duplicado_de) continue; const k = clave((d.f.sector?.stringValue || '').split('·')[0]); if (k && !idx.has(k)) idx.set(k, d); }
const CANON_SET = new Set([...CANON.values()].map(clave));
// Calidad: importa solo lo relevante (ya existe, conocido, o >=2 menciones) — corta la cola de basura.
const relevante = a => idx.has(clave(a.nombre)) || CANON_SET.has(clave(a.nombre)) || a.menciones >= 2;

const sitDe = a => [a.con_vida && 'señales de vida', a.atrapados && 'personas atrapadas', a.sin_ayuda && 'sin ayuda aún', a.maquinaria && 'necesita maquinaria'].filter(Boolean).join(' · ');
let creados = 0, enriquecidos = 0, omitidos = 0;
for (const a of lista) {
  if (!relevante(a)) { omitidos++; continue; }
  const sit = sitDe(a);
  const prio = Math.min(100, 60 + (a.con_vida ? 25 : 0) + Math.min(15, a.menciones));
  const ex = idx.get(clave(a.nombre));
  if (ex) {
    // ENRIQUECER el existente con la señal viva (sin PII, sin pisar lo demás).
    const descPrev = ex.f.descripcion?.stringValue || '';
    const fields = {
      rescate_activo: B(a.con_vida || a.atrapados),
      rescate: { mapValue: { fields: { atrapados: B(a.atrapados), con_vida: B(a.con_vida) } } },
      urgencia: S(a.con_vida || a.atrapados ? 'critica' : (ex.f.urgencia?.stringValue || 'alta')),
      prioridad: N(prio), reportes_ciudadanos: N(a.menciones),
      descripcion: S(`${descPrev} · Ciudadanos (${a.menciones}): ${sit || 'reporte'}`.slice(0, 500)),
      actualizada_en: TS()
    };
    const mask = ['rescate_activo', 'rescate', 'urgencia', 'prioridad', 'reportes_ciudadanos', 'descripcion', 'actualizada_en'].map(m => `updateMask.fieldPaths=${m}`).join('&');
    const r = await fetch(`${BASE}/necesidades/${ex.id}?${mask}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ fields }) });
    if (r.ok) enriquecidos++; else console.log('✗ enriquecer', a.nombre, r.status);
  } else {
    const [lat, lng] = SECTORES[a.sector] || SECTORES[SECTOR_DEFECTO];
    const gh = geohashForLocation([lat, lng]);
    const fields = {
      categoria: S('rescate'), urgencia: S(a.con_vida || a.atrapados ? 'critica' : 'alta'),
      severidad: S('total'), rescate_activo: B(a.con_vida || a.atrapados),
      rescate: { mapValue: { fields: { atrapados: B(a.atrapados), con_vida: B(a.con_vida) } } },
      para_quien: S('vecino'), personas_rango: S('2-5'), prioridad: N(prio), reportes_ciudadanos: N(a.menciones),
      fuente: S('whatsapp'), estado: S('sin_atender'), verificacion: S('no_verificada'), reclamada_por: { nullValue: null },
      creador: S(FUENTE), confirmaciones: N(0),
      sector: S(`${a.nombre} · ${a.sector}`.slice(0, 140)),
      descripcion: S(`Reportes ciudadanos (${a.menciones}): ${sit || 'reporte de afectación'}. Fuente: ${FUENTE}.`),
      geo: { mapValue: { fields: { lat: D(lat), lng: D(lng), geohash: S(gh) } } }, sectorGeo: S(gh.slice(0, 5)),
      precision: S('sector'), vigencia: { mapValue: { fields: { ultima_confirmacion_en: TS(), confirmaciones_vigencia: N(0) } } },
      creada_en: TS(), actualizada_en: TS()
    };
    const r = await fetch(`${BASE}/necesidades`, { method: 'POST', headers: H(), body: JSON.stringify({ fields }) });
    if (r.ok) creados++; else console.log('✗ crear', a.nombre, r.status, (await r.text()).slice(0, 80));
  }
}
console.log(`\n✅ Enriquecidos ${enriquecidos} existentes | creados ${creados} nuevos | omitidos ${omitidos} (baja confianza). tag=${FUENTE}. El curador afina el dedup.`);
console.log(`Revertir nuevos: node scripts/import-csv.mjs --clear=${FUENTE}`);
