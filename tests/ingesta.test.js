// Unit tests de la base compartida del pipeline de ingesta (functions/lib/*).
// Módulos PUROS, sin Firebase ni red → corren con `npm run test:unit` (sin emulador).
import { describe, it, expect } from 'vitest';
import {
  sanitizeId, stagingId, fnv1a, idExternoDeEntidad, entradaFuente, mergeFuentes, norm
} from '../functions/lib/identidad.js';
import { detectarPII, scrubPII } from '../functions/lib/scrubPII.js';
import { inVzla } from '../functions/lib/geocode.js';
import { esCiudadano, severidadDe } from '../functions/lib/dedup.js';
import { calcularPrioridad, esRescateActivo } from '../functions/lib/prioridad.js';
import { construirDocStaging } from '../functions/lib/staging.js';
import { recolectar } from '../functions/lib/recolector.js';
import * as TV from '../functions/adapters/terremotovenezuela.js';
import * as TVAPP from '../functions/adapters/terremotovenezuela-app.js';
import * as AV from '../functions/adapters/ayudavenezuela.js';
import { planearPromocion, camposNecesidad } from '../functions/lib/promocion.js';
import * as RV from '../functions/adapters/rescate-ve.js';

describe('identidad — id de staging determinista (núcleo anti-duplicados)', () => {
  it('sanitizeId quita /, espacios y acentos; acota; nunca vacío', () => {
    expect(sanitizeId('a/b c')).toBe('a-b-c');
    expect(sanitizeId('Caraballeda · Vargas')).not.toMatch(/[/·\s]/);
    expect(sanitizeId('')).toBe('x');
    expect(sanitizeId('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });

  it('stagingId es estable: misma (sistema,id_externo) → mismo doc id (upsert)', () => {
    const a = stagingId('TV_EDIF', 'building-123');
    const b = stagingId('TV_EDIF', 'building-123');
    expect(a).toBe(b);
    expect(a).toBe('TV_EDIF__building-123');
  });

  it('stagingId no produce el patrón reservado __.*__ (no empieza con __)', () => {
    expect(stagingId('s', 'id')).not.toMatch(/^__.*__$/);
  });

  it('fnv1a es estable y devuelve 8 hex', () => {
    expect(fnv1a('belo horizonte|playa grande')).toBe(fnv1a('belo horizonte|playa grande'));
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('idExternoDeEntidad: mismo nombre+sector (acentos/mayúsculas distintos) → mismo id', () => {
    expect(idExternoDeEntidad('Belo Horizonte', 'Playa Grande'))
      .toBe(idExternoDeEntidad('belo  horizonte', 'playa grande'));
    expect(idExternoDeEntidad('Belo Horizonte', 'Playa Grande'))
      .not.toBe(idExternoDeEntidad('Oasis Beach', 'Playa Grande'));
  });

  it('norm normaliza acentos/espacios/mayúsculas (la ñ pierde su tilde → n)', () => {
    expect(norm('  ÁÉÍ  Ñ  ')).toBe('aei n');
  });

  it('mergeFuentes acumula y deduplica por (sistema,id_externo)', () => {
    const e1 = entradaFuente('TV_EDIF', '123', 'https://terremotovenezuela.com', 1000);
    const e2 = entradaFuente('IG_SENSEI', 'abc', '', 2000);
    let fuentes = mergeFuentes([], e1);
    fuentes = mergeFuentes(fuentes, e2);
    expect(fuentes).toHaveLength(2);
    // re-ingesta de la misma fuente: actualiza, no duplica
    fuentes = mergeFuentes(fuentes, entradaFuente('TV_EDIF', '123', 'https://terremotovenezuela.com', 9999));
    expect(fuentes).toHaveLength(2);
    expect(fuentes.find((f) => f.sistema === 'TV_EDIF').capturado_en).toBe(9999);
  });
});

describe('scrubPII — frontera de privacidad antes de publicar (§9-1)', () => {
  it('detecta cédula, teléfono y nombre de persona', () => {
    expect(detectarPII('La señora con C.I. 12345678').tienePII).toBe(true);
    expect(detectarPII('llamar al 0412-1234567').motivos).toContain('telefono');
    expect(detectarPII('se llama Maria').motivos).toContain('nombre');
    expect(detectarPII('V-12.345.678').motivos).toContain('cedula');
  });

  it('texto sin PII no marca', () => {
    const r = detectarPII('Edificio Belo Horizonte, personas atrapadas, necesitan maquinaria');
    expect(r.tienePII).toBe(false);
    expect(r.motivos).toHaveLength(0);
  });

  it('scrubPII redacta cédula y teléfono', () => {
    const { limpio, tienePII } = scrubPII('contacto 0414-5556677 y cédula 12345678');
    expect(tienePII).toBe(true);
    expect(limpio).not.toMatch(/0414-5556677/);
    expect(limpio).toContain('[contacto omitido]');
  });
});

describe('geocode.inVzla — bounds de Venezuela', () => {
  it('dentro de Venezuela = true; fuera/NaN = false', () => {
    expect(inVzla(10.6, -66.9)).toBe(true);   // La Guaira
    expect(inVzla(40.7, -74.0)).toBe(false);  // Nueva York
    expect(inVzla(NaN, -66.9)).toBe(false);
    expect(inVzla('10', '-66')).toBe(false);
  });
});

describe('dedup/prioridad compartidos (mirror de curador, no cambiar sin re-verificar)', () => {
  it('esCiudadano distingue uid de Auth de los TAGS de lote', () => {
    expect(esCiudadano('r0Xq511iBHY8fw0FIBmoRPdO2UP2')).toBe(true); // uid real (28 chars)
    expect(esCiudadano('TV_EDIF')).toBe(false);
    expect(esCiudadano('IMPORT_LAGUAIRA')).toBe(false);
  });

  it('severidadDe extrae la severidad del texto libre', () => {
    expect(severidadDe('Edificio con daño total')).toBe('total');
    expect(severidadDe('sin info')).toBe('desconocida');
  });

  it('calcularPrioridad: atrapado con vida + daño total ≈ crítica; decae con el tiempo', () => {
    const ahora = Date.now();
    const fresco = { rescate: { atrapados: true, con_vida: true }, severidad: 'total', _refMs: ahora };
    expect(calcularPrioridad(fresco, ahora)).toBe(78); // 45+15+18
    const viejo = { ...fresco, _refMs: ahora - 80 * 3.6e6 }; // 80h → -25
    expect(calcularPrioridad(viejo, ahora)).toBe(53);
    expect(esRescateActivo(fresco)).toBe(true);
  });
});

describe('staging — doc idempotente por id + hash de contenido', () => {
  it('mismo registro → mismo id y mismo hash (upsert, no duplica)', () => {
    const rec = { destino: 'necesidad', id_externo: 'b-1', publico: { sector: 'Belo Horizonte · Playa Grande', descripcion: 'Daño total', categoria: 'rescate' } };
    const a = construirDocStaging('TV_EDIF', 'https://terremotovenezuela.com', rec, 1000);
    const b = construirDocStaging('TV_EDIF', 'https://terremotovenezuela.com', rec, 9999);
    expect(a.id).toBe('TV_EDIF__b-1');
    expect(b.id).toBe(a.id);
    expect(b.doc.hash).toBe(a.doc.hash); // el hash NO depende de capturado_en
  });
  it('contenido distinto → hash distinto (gatilla re-promoción)', () => {
    const base = { destino: 'necesidad', id_externo: 'b-1', publico: { sector: 'X', descripcion: 'Daño parcial', categoria: 'rescate' } };
    const a = construirDocStaging('TV_EDIF', 'u', base);
    const b = construirDocStaging('TV_EDIF', 'u', { ...base, publico: { ...base.publico, descripcion: 'Daño total' } });
    expect(b.doc.hash).not.toBe(a.doc.hash);
  });
  it('marca PII en el contenido (compuerta del promotor)', () => {
    const rec = { destino: 'necesidad', id_externo: 'x', publico: { sector: 'Edificio X', descripcion: 'la señora se llama Maria, cédula 12345678' } };
    expect(construirDocStaging('IG', 'u', rec).doc.pii.tienePII).toBe(true);
  });
});

describe('adapters — mapeo puro de fila de fuente', () => {
  it('TV_EDIF: edificio con coords → necesidad rescate, precisión exacta, identidad estable', () => {
    const row = { id: '77', name: 'Belo Horizonte', zone: 'Playa Grande', city: 'La Guaira', lat: 10.61, lng: -67.01, damage_level: 'total', last_updated_at: '2026-06-25T10:00:00Z' };
    const rec = TV.mapear(row);
    expect(rec.destino).toBe('necesidad');
    expect(rec.id_externo).toBe('77');
    expect(rec.publico.urgencia).toBe('critica');
    expect(rec.publico.severidad).toBe('total');
    expect(rec.publico.precision).toBe('exacta');
    expect(rec.publico.sectorGeo).toBe(rec.publico.geo.geohash.slice(0, 5));
    expect(TV.watermarkDe(row)).toBe(Date.parse('2026-06-25T10:00:00Z'));
  });
  it('TV_EDIF: sin coords → null; con coords geocodificadas → precisión sector', () => {
    const row = { id: '9', name: 'X', lat: null, lng: null, damage_level: 'severo' };
    expect(TV.mapear(row)).toBeNull();
    const rec = TV.mapear(row, { lat: 10.6, lng: -66.9 });
    expect(rec.publico.precision).toBe('sector');
    expect(rec.publico.urgencia).toBe('alta');
  });
  it('TVAPP: critical → necesidad; shelter → recurso; missing → null', () => {
    const base = { lat: 10.6, lng: -66.9, place: 'Sector X', createdAt: '2026-06-25T09:00:00Z' };
    expect(TVAPP.mapear({ ...base, id: 1, type: 'critical' }).destino).toBe('necesidad');
    expect(TVAPP.mapear({ ...base, id: 2, type: 'shelter' }).destino).toBe('recurso');
    expect(TVAPP.mapear({ ...base, id: 3, type: 'missing' })).toBeNull();
  });
  it('AV_REC: hospital con teléfono → recurso médico + contacto al PRIVADO (no público)', () => {
    const rec = AV.mapear({ _t: 'hospital', id: 5, name: 'Hospital X', lat: 10.5, lng: -66.9, phone: '0212-1234567', needs: ['oxigeno'] });
    expect(rec.destino).toBe('recurso');
    expect(rec.publico.categoria).toBe('medico');
    expect(rec.publico.descripcion).not.toContain('0212-1234567');
    expect(rec.privado.contacto).toBe('0212-1234567');
    expect(rec.id_externo).toBe('hospital-5');
  });
  it('RESCATE_VE: centro → recurso; punto → necesidad SIN filtrar el nombre del reportante (PII)', () => {
    const centro = RV.mapear({ _t: 'centro', id: 'c1', name: 'Acopio Valencia', city: 'Valencia', latitude: 10.18, longitude: -68.0, supply_types: ['agua', 'alimentos'], is_active: true });
    expect(centro.destino).toBe('recurso');
    expect(centro.publico.descripcion).toContain('Recibe: agua, alimentos');

    const punto = RV.mapear({ _t: 'punto', id: 'p1', name: 'Iglesia San Bernardino', city: 'Caracas', latitude: 10.51, longitude: -66.90, needs: ['higiene', 'ropa'], status: 'urgent', reporter_name: 'Publicado por Cristian Onorato', reporter_contact: '0414-9998877', is_active: true });
    expect(punto.destino).toBe('necesidad');
    expect(punto.publico.urgencia).toBe('alta');
    expect(punto.publico.descripcion).not.toContain('Cristian'); // el nombre del reportante NO se publica
    expect(punto.privado.contacto).toBe('0414-9998877');         // el contacto va al privado
  });
});

describe('recolector — descarga + mapeo + geocode + watermark', () => {
  const fakeAdapter = {
    sistema: 'FAKE', url: 'http://x',
    async descargar() {
      return [
        { id: 'a', lat: 10.6, lng: -66.9, t: 'ok', _w: 2000 },
        { id: 'b', lat: null, lng: null, t: 'geo', _w: 5000 },
        { id: 'c', lat: null, lng: null, t: 'drop', _w: 3000 }
      ];
    },
    watermarkDe: (r) => r._w,
    geoQueryDe: (r) => (r.t === 'geo' ? 'sitio b' : ''),
    mapear(r, coords) {
      const mk = (lat, lng, precision) => ({ destino: 'necesidad', id_externo: String(r.id), publico: { categoria: 'otro', sector: 's' + r.id, descripcion: 'd', geo: { lat, lng, geohash: 'aaaaaaaaaa' }, sectorGeo: 'aaaaa', precision } });
      if (r.lat != null) return mk(r.lat, r.lng, 'exacta');
      if (coords) return mk(coords.lat, coords.lng, 'sector');
      return null;
    }
  };
  it('mapea, geocodifica el faltante, descarta lo irrecuperable y toma el watermark máximo', async () => {
    const geocodeImpl = async (q) => (q === 'sitio b' ? { lat: 10.61, lng: -66.91 } : null);
    const { registros, rechazos, watermark } = await recolectar(fakeAdapter, { geocodeImpl });
    expect(registros.map((r) => r.id_externo).sort()).toEqual(['a', 'b']);
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0].id_externo).toBe('c');
    expect(watermark).toBe(5000);
  });
});

describe('promotor — planearPromocion (decisión pura)', () => {
  const pub = (lat, lng, extra = {}) => ({
    categoria: 'rescate', urgencia: 'critica', severidad: 'total',
    sector: 'Belo Horizonte · Playa Grande', descripcion: 'Daño total. Fuente: x',
    geo: { lat, lng, geohash: 'd3ze8jdkej' }, sectorGeo: 'd3ze8', precision: 'exacta', ...extra
  });
  const stg = (sistema, idExt, publico, opts = {}) => {
    const { id, doc } = construirDocStaging(sistema, 'http://u', { destino: opts.destino || 'necesidad', id_externo: idExt, publico, privado: opts.privado || null });
    const flat = { id, ...doc };
    if (opts.promovido_a) { flat.promovido_a = opts.promovido_a; flat.hash_promovido = opts.hash_promovido === 'mismo' ? doc.hash : opts.hash_promovido; }
    return flat;
  };

  it('sin canónico → CREAR', () => {
    const ops = planearPromocion([stg('TV_EDIF', '77', pub(10.61, -67.01))], { necesidades: [], recursos: [] });
    expect(ops[0].tipo).toBe('crear');
    expect(ops[0].campos.categoria).toBe('rescate');
  });

  it('ya promovido sin cambios (hash igual) → SALTAR', () => {
    const st = stg('TV_EDIF', '77', pub(10.61, -67.01), { promovido_a: 'C9', hash_promovido: 'mismo' });
    expect(planearPromocion([st], { necesidades: [], recursos: [] })[0].tipo).toBe('saltar');
  });

  it('PII en el contenido → REVISAR (compuerta del operador, no auto-publica)', () => {
    const st = stg('IG', 'x', pub(10.61, -67.01, { descripcion: 'la señora se llama Ana, cédula 12345678' }));
    const op = planearPromocion([st], { necesidades: [], recursos: [] })[0];
    expect(op.tipo).toBe('revisar');
    expect(op.motivo).toBe('pii');
  });

  it('match por IDENTIDAD (fuentes[]) → ACTUALIZAR ese canónico', () => {
    const canon = { id: 'C1', creador: 'TV_EDIF', categoria: 'rescate', sector: 'otro', geo: { lat: 9, lng: -70 }, fuentes: [{ sistema: 'TV_EDIF', id_externo: '77' }] };
    const op = planearPromocion([stg('TV_EDIF', '77', pub(10.61, -67.01))], { necesidades: [canon], recursos: [] })[0];
    expect(op.tipo).toBe('actualizar');
    expect(op.canonId).toBe('C1');
  });

  it('match por DEDUP (proximidad, misma categoría) → ACTUALIZAR', () => {
    const canon = { id: 'C2', creador: 'OTRO_LOTE', categoria: 'rescate', sector: 'Algo', geo: { lat: 10.6100, lng: -67.0100 } };
    const op = planearPromocion([stg('TV_EDIF', '99', pub(10.6100, -67.0100))], { necesidades: [canon], recursos: [] })[0];
    expect(op.tipo).toBe('actualizar');
    expect(op.canonId).toBe('C2');
  });

  it('LÍNEA ROJA: si el canónico es CIUDADANO, solo adjunta fuente (campos null)', () => {
    const canon = { id: 'C3', creador: 'r0Xq511iBHY8fw0FIBmoRPdO2UP2', categoria: 'rescate', sector: 'Belo Horizonte', geo: { lat: 10.6100, lng: -67.0100 } };
    const op = planearPromocion([stg('TV_EDIF', '99', pub(10.6100, -67.0100))], { necesidades: [canon], recursos: [] })[0];
    expect(op.tipo).toBe('actualizar');
    expect(op.protegido).toBe(true);
    expect(op.campos).toBeNull();
    expect(op.fuentes.some((f) => f.sistema === 'TV_EDIF' && f.id_externo === '99')).toBe(true);
  });

  it('REGLA DE PROPIEDAD: cruce de fuentes (otro dueño) solo adjunta procedencia, NO refresca contenido', () => {
    const canon = { id: 'C4', creador: 'IG_SENSEI', categoria: 'rescate', sector: 'Belo Horizonte', geo: { lat: 10.6100, lng: -67.0100 } };
    const op = planearPromocion([stg('TV_EDIF', '99', pub(10.6100, -67.0100))], { necesidades: [canon], recursos: [] })[0];
    expect(op.tipo).toBe('actualizar');
    expect(op.campos).toBeNull();         // no pisa el contenido de IG (p.ej. "con vida")
    expect(op.protegido).toBe(true);
    expect(op.fuentes.some((f) => f.sistema === 'TV_EDIF' && f.id_externo === '99')).toBe(true);
  });
  it('mismo dueño (creador === sistema) SÍ refresca su propio contenido', () => {
    const canon = { id: 'C5', creador: 'TV_EDIF', categoria: 'rescate', sector: 'Belo Horizonte', geo: { lat: 10.6100, lng: -67.0100 } };
    const op = planearPromocion([stg('TV_EDIF', '99', pub(10.6100, -67.0100))], { necesidades: [canon], recursos: [] })[0];
    expect(op.tipo).toBe('actualizar');
    expect(op.campos).not.toBeNull();
    expect(op.campos.categoria).toBe('rescate');
  });

  it('camposNecesidad deriva severidad y prioridad', () => {
    const c = camposNecesidad({ categoria: 'rescate', sector: 'X', descripcion: 'Edificio con daño total', geo: { lat: 10.6, lng: -66.9, geohash: 'd3ze8jdkej' }, precision: 'exacta' }, Date.now());
    expect(c.severidad).toBe('total');
    expect(c.prioridad).toBeGreaterThan(0);
    expect(c.rescate_activo).toBe(false);
  });
});
