import { describe, it, expect } from 'vitest';
import { aFecha, relativo, absoluta, esViejo } from '../src/lib/tiempo.js';

const ref = new Date('2026-06-29T12:00:00Z').getTime();

describe('aFecha — normaliza cualquier forma de timestamp', () => {
  it('Firestore Timestamp ({ toDate })', () => {
    const d = new Date('2026-06-29T10:00:00Z');
    expect(aFecha({ toDate: () => d }).getTime()).toBe(d.getTime());
  });
  it('objeto { seconds } (REST/caché)', () => {
    expect(aFecha({ seconds: 1781776800 }) instanceof Date).toBe(true);
  });
  it('Date, número (ms) y string ISO', () => {
    const d = new Date('2026-06-29T10:00:00Z');
    expect(aFecha(d).getTime()).toBe(d.getTime());
    expect(aFecha(d.getTime()).getTime()).toBe(d.getTime());
    expect(aFecha('2026-06-29T10:00:00Z').getTime()).toBe(d.getTime());
  });
  it('null/undefined/invalid → null (serverTimestamp pendiente offline)', () => {
    expect(aFecha(null)).toBe(null);
    expect(aFecha(undefined)).toBe(null);
    expect(aFecha('no-date')).toBe(null);
    expect(aFecha({})).toBe(null);
  });
});

describe('relativo — localizado ES/EN', () => {
  it('< 45 s → "ahora mismo" / "just now"', () => {
    expect(relativo(new Date(ref - 10_000), 'es', ref)).toBe('ahora mismo');
    expect(relativo(new Date(ref - 10_000), 'en', ref)).toBe('just now');
  });
  it('minutos en español e inglés', () => {
    expect(relativo(new Date(ref - 5 * 60_000), 'es', ref)).toMatch(/hace 5 min/);
    expect(relativo(new Date(ref - 5 * 60_000), 'en', ref)).toMatch(/5 min/);
  });
  it('horas: ES dice "hace", EN dice "ago"', () => {
    expect(relativo(new Date(ref - 3 * 3600_000), 'es', ref)).toMatch(/hace 3/);
    expect(relativo(new Date(ref - 3 * 3600_000), 'en', ref)).toMatch(/3 .*ago/);
  });
  it('días', () => {
    expect(relativo(new Date(ref - 2 * 86400_000), 'es', ref)).toMatch(/hace 2|anteayer/);
    expect(relativo(new Date(ref - 2 * 86400_000), 'en', ref)).toMatch(/2 days ago/);
  });
  it('fecha futura (reloj desfasado) → acota a "ahora", no "dentro de"', () => {
    expect(relativo(new Date(ref + 60_000), 'es', ref)).toBe('ahora mismo');
  });
  it('sin fecha → cadena vacía', () => {
    expect(relativo(null, 'es', ref)).toBe('');
  });
});

describe('absoluta — fecha+hora localizada para el tooltip', () => {
  it('devuelve algo no vacío con una fecha válida', () => {
    expect(absoluta('2026-06-29T10:00:00Z', 'es').length).toBeGreaterThan(0);
  });
  it('sin fecha → cadena vacía', () => {
    expect(absoluta(null)).toBe('');
  });
});

describe('esViejo — umbral de antigüedad', () => {
  it('> 24 h es viejo; < 24 h no', () => {
    expect(esViejo(new Date(ref - 30 * 3600_000), 24, ref)).toBe(true);
    expect(esViejo(new Date(ref - 2 * 3600_000), 24, ref)).toBe(false);
  });
  it('sin fecha → no es viejo (no marca lo que no tiene timestamp)', () => {
    expect(esViejo(null, 24, ref)).toBe(false);
  });
});
