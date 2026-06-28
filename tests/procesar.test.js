// Tests del motor de extracción determinístico (§25 typing) contra patrones REALES
// observados en producción (TV_EDIF, IG_SENSEI, RESCATE_VE, TVAPP, ciudadanos).
import { describe, it, expect } from 'vitest';
import { extraer, extraerSeveridad, extraerNecesidades } from '../functions/lib/extraer.js';
import { resumenDeterminista, construirEntradaIA, resumenIA } from '../functions/lib/resumen.js';
import { extraerDireccion, consultasGeo, triangular } from '../functions/lib/geoenrich.js';

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

  it('triangular: actual EXACTA vs externo lejano → conflicto, conserva y marca revisión', () => {
    const r = triangular({ geoActual: { lat: 10.6100, lng: -67.0100 }, precisionActual: 'exacta', candidatos: [{ lat: 10.7000, lng: -67.1000 }] });
    expect(r.confianza).toBe('media');
    expect(r.revisar).toBe(true);
    expect(r.fuente_geo).toBe('conflicto');
    expect(r.geo.lat).toBe(10.6100); // conserva la exacta
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
