// Tests del motor de extracción determinístico (§25 typing) contra patrones REALES
// observados en producción (TV_EDIF, IG_SENSEI, RESCATE_VE, TVAPP, ciudadanos).
import { describe, it, expect } from 'vitest';
import { extraer, extraerSeveridad, extraerNecesidades } from '../functions/lib/extraer.js';
import { resumenDeterminista, construirEntradaIA, resumenIA, afirmaMuerteNoFundada } from '../functions/lib/resumen.js';
import { extraerDireccion, consultasGeo, triangular } from '../functions/lib/geoenrich.js';
import { hashContenido, necesitaProceso, procesarUno } from '../functions/lib/procesar.js';

describe('extraer — severidad', () => {
  it('"Daño parcial/total/severo" → severidad', () => {
    expect(extraerSeveridad('Daño parcial. Fuente: x')).toBe('parcial');
    expect(extraerSeveridad('Daño total. Fuente: x')).toBe('total');
  });
  it('colapso/derrumbe → total; sin derrumbe → parcial', () => {
    expect(extraerSeveridad('Colapso confirmado.')).toBe('total');
    expect(extraerSeveridad('El edificio se desplomó')).toBe('total');
    expect(extraerSeveridad('Edificio sin derrumbe')).toBe('parcial');
  });
  it('sin señal → conserva la previa o desconocida', () => {
    expect(extraerSeveridad('algo', 'severo')).toBe('severo');
    expect(extraerSeveridad('algo')).toBe('desconocida');
  });
});

describe('extraer — necesidades pedidas', () => {
  it('"Necesita: ..." → vocabulario normalizado', () => {
    expect(extraerNecesidades('Necesita: Búsqueda y rescate, Equipos especializados.')).toContain('rescate');
    const n = extraerNecesidades('Necesita: agua, alimentos, ropa, higiene, refugio.');
    expect(n).toEqual(expect.arrayContaining(['agua', 'alimento', 'refugio', 'insumos']));
  });
});

describe('extraer — registro completo (patrones reales)', () => {
  it('TV_EDIF templado: daño parcial, sin rescate activo', () => {
    const r = extraer({ categoria: 'rescate', severidad: 'parcial', descripcion: 'Daño parcial. Fuente: terremotovenezuela.com', sector: 'Edificio San Jacinto · San Bernardino' });
    expect(r.severidad).toBe('parcial');
    expect(r.rescate_activo).toBe(false);
  });

  it('IG_SENSEI: señales de vida + atrapados → rescate activo + reportes', () => {
    const r = extraer({ categoria: 'rescate', descripcion: 'Reportes ciudadanos (46): señales de vida · personas atrapadas. Fuente: IG_SENSEI.', sector: 'Belo Horizonte · playa grande' });
    expect(r.senales.atrapados).toBe(true);
    expect(r.senales.con_vida).toBe(true);
    expect(r.rescate_activo).toBe(true);
    expect(r.categoria).toBe('rescate');
    expect(r.reportes_ciudadanos).toBe(46);
  });

  it('RESCATE_VE: colapso = severidad total, NO infla atrapados; necesita rescate', () => {
    const r = extraer({ categoria: 'rescate', descripcion: 'Necesita: Búsqueda y rescate, Equipos especializados, Personal de emergencia. Colapso confirmado.', sector: 'Residencias Vista al Mar · Caraballeda' });
    expect(r.severidad).toBe('total');
    expect(r.rescate_activo).toBe(false);          // colapso ≠ personas atrapadas (conservador)
    expect(r.necesidades).toContain('rescate');
  });

  it('RESCATE_VE agua: necesidad de insumos, categoría derivada NO rescate', () => {
    const r = extraer({ categoria: 'agua', descripcion: 'Necesita: agua, alimentos, ropa, higiene, refugio. En Morón hay personas damnificadas.', sector: 'Palma Sola, Morón' });
    expect(r.rescate_activo).toBe(false);
    expect(r.categoria).toBe('agua');
    expect(r.necesidades).toContain('agua');
  });

  it('TVAPP: fallecido + afectados; conservador (derrumbe de PARED ≠ daño total)', () => {
    const r = extraer({ categoria: 'rescate', descripcion: 'La persona falleció a causa de un derrumbe de pared. Afectados: 1.', sector: 'Valle alto 1' });
    expect(r.senales.fallecidos).toBe(true);
    expect(r.severidad).toBe('desconocida');   // honesto: una pared no es el edificio entero
    expect(r.afectados).toBe(1);
    expect(r.rescate_activo).toBe(false);
  });

  it('"9 personas por rescatar" → rescate activo (≠ la NECESIDAD "Búsqueda y rescate")', () => {
    const r = extraer({ categoria: 'rescate', descripcion: 'Necesita: Búsqueda y rescate, Equipos especializados. 9 personas por rescatar (reporte 01:23).', sector: 'Edificio San Judas Tadeo · Caracas' });
    expect(r.senales.por_rescatar).toBe(true);
    expect(r.rescate_activo).toBe(true);
    expect(r.necesidades).toContain('rescate');
  });

  it('pedir "Búsqueda y rescate" SIN gente confirmada NO activa rescate', () => {
    const r = extraer({ categoria: 'rescate', descripcion: 'Necesita: Búsqueda y rescate, Equipos especializados. Colapso confirmado.', sector: 'Edif X · Caracas' });
    expect(r.senales.por_rescatar).toBe(false);
    expect(r.rescate_activo).toBe(false);
  });

  it('"Los escuchan entre los escombros" → atrapados/rescate (no solo "bajo escombros")', () => {
    const r = extraer({ descripcion: 'Los escuchan entre los escombros. Necesitan ayuda.', sector: 'Residencia Bahías del Mar' });
    expect(r.senales.atrapados).toBe(true);
    expect(r.rescate_activo).toBe(true);
  });

  it('Ciudadano caótico ("bajos escombros") → atrapados, sin filtrar el nombre', () => {
    const r = extraer({ creador: 'uid', descripcion: 'Sahin Briceño 22 años bajos escombros de su edificio', sector: 'Catia La Mar' });
    expect(r.senales.atrapados).toBe(true);
    expect(r.rescate_activo).toBe(true);
    // la extracción NO emite el nombre (solo campos tipados) → sin PII
    expect(JSON.stringify(r)).not.toMatch(/Sahin|Brice/);
  });
});

describe('resumen — determinístico (fallback seguro, sin LLM)', () => {
  it('arma un resumen claro desde los campos tipados', () => {
    const campos = extraer({ categoria: 'rescate', descripcion: 'Reportes ciudadanos (46): señales de vida · personas atrapadas. Afectados: 9.', sector: 'Belo Horizonte · playa grande' });
    const r = resumenDeterminista(campos, 'Belo Horizonte · playa grande');
    expect(r).toContain('Belo Horizonte');
    expect(r).toContain('Rescate activo');
    expect(r).toContain('personas atrapadas');
    expect(r).toContain('9 afectados');
  });
  it('necesidades de insumos sin rescate', () => {
    const campos = extraer({ categoria: 'agua', descripcion: 'Necesita: agua, alimentos.', sector: 'Morón' });
    expect(resumenDeterminista(campos, 'Morón')).toMatch(/necesita: agua/i);
  });
  it('sin señales → algo útil por categoría', () => {
    expect(resumenDeterminista({ categoria: 'rescate', senales: {} }, 'Edif X')).toMatch(/afectado|reportad/i);
  });
});

describe('resumen — IA anclada (fetch mockeado) + guardas', () => {
  const rec = { sector: 'Belo Horizonte · playa grande', descripcion: 'señales de vida, personas atrapadas. Afectados: 9' };
  const campos = extraer(rec);

  it('construirEntradaIA incluye campos y SANEA teléfono/cédula del texto', () => {
    const e = construirEntradaIA({ sector: 'Edif X', descripcion: 'contacto 0412-1234567, cédula 12345678' }, campos);
    expect(e).toContain('Campos estructurados');
    expect(e).not.toContain('0412-1234567');
    expect(e).not.toMatch(/c[ée]dula 12345678/i);
  });

  it('sin apiKey → cae al determinístico', async () => {
    const { via } = await resumenIA(rec, campos, {});
    expect(via).toBe('reglas');
  });

  it('respuesta válida de la IA → la usa', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Belo Horizonte: personas atrapadas con señales de vida, daño total, 9 afectados.' }] }) });
    const { resumen, via, ok } = await resumenIA(rec, campos, { apiKey: 'k', fetchImpl });
    expect(via).toBe('ia');
    expect(ok).toBe(true);
    expect(resumen).toContain('atrapadas');
  });

  it('si la IA devuelve PII → descarta y usa el determinístico (guarda §9-1)', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Llamar al 0414-5556677, María atrapada.' }] }) });
    const { via } = await resumenIA(rec, campos, { apiKey: 'k', fetchImpl });
    expect(via).toBe('reglas');
  });

  it('error de la API → determinístico, nunca lanza', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    const { via } = await resumenIA(rec, campos, { apiKey: 'k', fetchImpl });
    expect(via).toBe('reglas');
  });

  it('guarda anti-muerte: detecta afirmación de muerte NO fundada en los campos', () => {
    const vivos = extraer({ descripcion: 'Ciudadanos (9): personas atrapadas · sin ayuda aún' });
    expect(afirmaMuerteNoFundada('9 personas atrapadas sin vida aparente, sin ayuda.', vivos)).toBe(true);
    expect(afirmaMuerteNoFundada('9 personas atrapadas con señales de vida.', vivos)).toBe(false); // "de vida" positivo no cae
    const conFallecido = extraer({ descripcion: 'La persona falleció.' });
    expect(afirmaMuerteNoFundada('Se reporta un fallecido.', conFallecido)).toBe(false); // fundado en el campo
  });

  it('IA inventa "sin vida" sin respaldo → descarta y usa el determinístico (seguridad)', async () => {
    const recVivo = { sector: 'Edificio Costa Brava · Caraballeda', descripcion: 'Ciudadanos (9): personas atrapadas · sin ayuda aún' };
    const camposVivo = extraer(recVivo);
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Costa Brava: 9 personas atrapadas sin vida aparente, sin ayuda.' }] }) });
    const { via, resumen } = await resumenIA(recVivo, camposVivo, { apiKey: 'k', fetchImpl });
    expect(via).toBe('reglas');                       // rechazó la alucinación
    expect(resumen).not.toMatch(/sin vida/i);
  });
});

describe('geo-enricher — exactitud con info externa', () => {
  it('extraerDireccion saca pistas de calle/sector del texto', () => {
    const d = extraerDireccion('Edificación afectada. Urbanización Playa Grande, Calle Comercial N° 2. Estructura moderna.');
    expect(d.join(' | ')).toMatch(/calle comercial/i);
    expect(d.length).toBeGreaterThan(0);
  });

  it('consultasGeo arma consultas nombre/zona/dirección + Venezuela', () => {
    const q = consultasGeo({ sector: 'Edificio Oasis Beach · Urimare', municipio: 'La Guaira', descripcion: 'Av. Principal con Calle Los Almendros' });
    expect(q.some((x) => /Venezuela/.test(x))).toBe(true);
    expect(q.some((x) => /Oasis Beach/.test(x))).toBe(true);
  });

  it('triangular: el externo CONFIRMA la coord actual (≤150m) → alta, no mueve', () => {
    const r = triangular({ geoActual: { lat: 10.6100, lng: -67.0100 }, precisionActual: 'exacta', candidatos: [{ lat: 10.6112, lng: -67.0100 }] });
    expect(r.confianza).toBe('alta');
    expect(r.revisar).toBe(false);
    expect(r.fuente_geo).toBe('confirmado_osm');
    expect(r.geo.lat).toBe(10.6100);
  });

  it('triangular: actual aproximada (sector) + externo cercano → mejora la coord', () => {
    const r = triangular({ geoActual: { lat: 10.6100, lng: -67.0200 }, precisionActual: 'sector', candidatos: [{ lat: 10.6120, lng: -67.0180 }] });
    expect(r.fuente_geo).toBe('osm_mejora');
    expect(r.geo.lat).toBeCloseTo(10.6120, 3);
  });

  it('triangular: actual EXACTA vs VARIOS externos lejanos concordantes → conflicto, conserva', () => {
    const r = triangular({ geoActual: { lat: 10.6100, lng: -67.0100 }, precisionActual: 'exacta', candidatos: [{ lat: 10.7000, lng: -67.1000 }, { lat: 10.7005, lng: -67.1002 }] });
    expect(r.confianza).toBe('media');
    expect(r.revisar).toBe(true);
    expect(r.fuente_geo).toBe('conflicto');
    expect(r.geo.lat).toBe(10.6100); // conserva la exacta
  });

  it('triangular: UN solo hit lejano (centroide de ciudad) → NO mueve ni marca revisión', () => {
    // Caso real: "Hotel Eduard" no existe en OSM; solo responde "Maiquetía" (centroide, ~8km).
    const r = triangular({ geoActual: { lat: 10.6000, lng: -67.0400 }, precisionActual: 'sector', candidatos: [{ lat: 10.5966, lng: -66.9597 }] });
    expect(r.revisar).toBe(false);                 // no inunda la cola del operador
    expect(r.fuente_geo).toBe('sin_mejora_externa');
    expect(r.geo.lat).toBe(10.6000);               // conserva la coord actual
  });

  it('triangular: sin coord previa + 2 externos concordantes → coord nueva, alta', () => {
    const r = triangular({ geoActual: null, candidatos: [{ lat: 10.6100, lng: -67.0100 }, { lat: 10.6105, lng: -67.0100 }] });
    expect(r.fuente_geo).toBe('osm_nuevo');
    expect(r.confianza).toBe('alta');
    expect(r.geo.lat).toBeCloseTo(10.61025, 4);
  });

  it('triangular: sin externo ni coord → baja, marca revisión', () => {
    const r = triangular({ geoActual: null, candidatos: [] });
    expect(r.confianza).toBe('baja');
    expect(r.revisar).toBe(true);
    expect(r.geo).toBe(null);
  });
});

describe('procesar — orquestación (procesarUno)', () => {
  const fetchOk = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Resumen claro del punto.' }] }) });

  it('hash estable, cambia con el contenido, y necesitaProceso', () => {
    const rec = { descripcion: 'Daño total', sector: 'X', geo: { lat: 10.6, lng: -67 } };
    const h = hashContenido(rec);
    expect(hashContenido(rec)).toBe(h);                                  // estable
    expect(hashContenido({ ...rec, descripcion: 'Daño parcial' })).not.toBe(h); // cambia
    expect(necesitaProceso(rec)).toBe(true);                            // sin procesar
    expect(necesitaProceso({ ...rec, procesado: { hash: h } })).toBe(false); // ya procesado
  });

  it('coord exacta de fuente: NO re-geocodifica, resume y tipa', async () => {
    let geocodes = 0;
    const rec = { precision: 'exacta', geo: { lat: 10.61, lng: -67.01, geohash: 'd3ze8jdkej' }, sector: 'Belo Horizonte', descripcion: 'Daño total. personas atrapadas con señales de vida.' };
    const { patch, revision } = await procesarUno(rec, { apiKey: 'k', fetchImpl: fetchOk, geocodeImpl: async () => { geocodes++; return null; } });
    expect(geocodes).toBe(0);                          // confía la coord de fuente
    expect(patch.procesado.geo_fuente).toBe('fuente_exacta');
    expect(patch.resumen).toBeTruthy();
    expect(patch.severidad).toBe('total');
    expect(patch.rescate_activo).toBe(true);
    expect(patch.geo).toBeUndefined();                 // no mueve la exacta
    expect(revision).toBe(null);
  });

  it('registro aproximado (sector): geocodifica y mejora la coord cercana', async () => {
    const rec = { precision: 'sector', geo: { lat: 10.6100, lng: -67.0200, geohash: 'd3ze8' }, sector: 'Sector X · Morón', descripcion: 'Necesita agua y alimentos' };
    const { patch } = await procesarUno(rec, { apiKey: 'k', fetchImpl: fetchOk, geocodeImpl: async () => ({ lat: 10.6120, lng: -67.0180 }) });
    expect(patch.geo).toBeDefined();
    expect(patch.procesado.geo_fuente).toBe('osm_mejora');
    expect(patch.necesidades_pedidas).toEqual(expect.arrayContaining(['agua']));
  });

  it('respeta edición manual del operador (no mueve geo aunque OSM mejore)', async () => {
    const rec = { precision: 'sector', editado_por_operador: true, geo: { lat: 10.6100, lng: -67.0200 }, sector: 'X · Morón', descripcion: 'agua' };
    const { patch } = await procesarUno(rec, { apiKey: 'k', fetchImpl: fetchOk, geocodeImpl: async () => ({ lat: 10.6120, lng: -67.0180 }) });
    expect(patch.geo).toBeUndefined();
  });

  it('IA falla → resumen por reglas, nunca lanza, patch íntegro', async () => {
    const rec = { precision: 'exacta', geo: { lat: 10.61, lng: -67.01 }, sector: 'Edif Y · La Guaira', descripcion: 'Daño parcial' };
    const { patch } = await procesarUno(rec, { apiKey: 'k', fetchImpl: async () => ({ ok: false, json: async () => ({}) }), geocodeImpl: async () => null });
    expect(patch.procesado.resumen_via).toBe('reglas');
    expect(patch.resumen).toBeTruthy();
  });
});
