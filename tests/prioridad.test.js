import { describe, it, expect } from 'vitest';
import { calcularPrioridad, bandaPrioridad, horasDesde, esRescateActivo } from '../src/lib/prioridad.js';

const AHORA = Date.parse('2026-06-26T12:00:00Z');
const hace = (h) => AHORA - h * 3.6e6;

describe('calcularPrioridad — la vida inmediata manda', () => {
  it('atrapados con señales de vida → banda crítica', () => {
    const n = { categoria: 'rescate', severidad: 'total',
      rescate: { atrapados: true, con_vida: true, desde: '<6h' },
      personas: { rango: '2-5' }, creada_en: AHORA };
    const p = calcularPrioridad(n, AHORA);
    expect(p).toBeGreaterThanOrEqual(60);
    expect(bandaPrioridad(p)).toBe('critica');
  });

  it('medicamento crítico (insulina/oxígeno) pesa alto aunque no haya atrapados', () => {
    const n = { categoria: 'medico', severidad: 'desconocida',
      medico: { tipo: 'medicamento_critico', medicamento: 'insulina' }, creada_en: AHORA };
    expect(calcularPrioridad(n, AHORA)).toBeGreaterThanOrEqual(35);
  });

  it('daño parcial sin señales fuertes → baja/media, no crítica', () => {
    const n = { categoria: 'refugio', severidad: 'parcial', personas: { rango: '1' }, creada_en: AHORA };
    const p = calcularPrioridad(n, AHORA);
    expect(p).toBeLessThan(35);
    expect(['baja', 'media']).toContain(bandaPrioridad(p));
  });
});

describe('frescura — lo viejo no reconfirmado decae', () => {
  it('el mismo caso pierde prioridad con el tiempo sin reconfirmar', () => {
    const base = { categoria: 'rescate', severidad: 'severo', rescate: { atrapados: true, con_vida: true } };
    const fresco = calcularPrioridad({ ...base, creada_en: hace(1) }, AHORA);
    const viejo = calcularPrioridad({ ...base, creada_en: hace(80) }, AHORA);
    expect(viejo).toBeLessThan(fresco);
  });

  it('una reconfirmación de vigencia reciente frena el decaimiento', () => {
    const base = { categoria: 'rescate', severidad: 'severo', rescate: { atrapados: true }, creada_en: hace(80) };
    const sinReconf = calcularPrioridad(base, AHORA);
    const reconf = calcularPrioridad({ ...base, vigencia: { ultima_confirmacion_en: hace(1) } }, AHORA);
    expect(reconf).toBeGreaterThan(sinReconf);
  });

  it('horasDesde usa vigencia si existe, si no creada_en', () => {
    expect(horasDesde({ creada_en: hace(10) }, AHORA)).toBeCloseTo(10, 1);
    expect(horasDesde({ creada_en: hace(99), vigencia: { ultima_confirmacion_en: hace(2) } }, AHORA)).toBeCloseTo(2, 1);
  });
});

describe('vulnerables, escala y límites', () => {
  it('vulnerables suben la prioridad pero con tope', () => {
    const sin = calcularPrioridad({ categoria: 'agua', severidad: 'parcial', creada_en: AHORA }, AHORA);
    const con = calcularPrioridad({ categoria: 'agua', severidad: 'parcial',
      vulnerables: ['ninos', 'mayores', 'embarazadas', 'heridos', 'cronicos', 'discapacidad'], creada_en: AHORA }, AHORA);
    expect(con).toBeGreaterThan(sin);
    expect(con - sin).toBeLessThanOrEqual(15); // tope vulnerable_max
  });

  it('siempre dentro de [0,100]', () => {
    const extremo = { categoria: 'rescate', severidad: 'total',
      rescate: { atrapados: true, con_vida: true, desde: '<6h' },
      medico: { tipo: 'medicamento_critico' }, vulnerables: ['ninos', 'mayores', 'heridos'],
      personas: { rango: '+20' }, urgencia_reportada: 'critica', creada_en: AHORA };
    const p = calcularPrioridad(extremo, AHORA);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(100);
  });

  it('un reporte mínimo sin estructura no queda en 0 (base por categoría)', () => {
    expect(calcularPrioridad({ categoria: 'rescate', creada_en: AHORA }, AHORA)).toBeGreaterThan(0);
  });
});

describe('esRescateActivo', () => {
  it('true si hay atrapados o medicamento crítico', () => {
    expect(esRescateActivo({ rescate: { atrapados: true } })).toBe(true);
    expect(esRescateActivo({ medico: { tipo: 'medicamento_critico' } })).toBe(true);
    expect(esRescateActivo({ categoria: 'agua' })).toBe(false);
  });
});
