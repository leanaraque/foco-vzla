// Tests de la capa de datos (módulo puro src/lib/payload.js). NO requieren
// emulador. Cubren el bug offline corregido (§20): geo_exacta solo con GPS real.
import { describe, test, expect } from 'vitest';
import { construirPrivado, geoPublicoSeguro, tieneCoords, CENTRO_FALLBACK } from '../src/lib/payload.js';

describe('construirPrivado — geo_exacta solo con GPS real (§20)', () => {
  test('(a) CON contacto y SIN GPS → privado válido sin geo_exacta', () => {
    const p = construirPrivado('u1', '0414-1234567', null, null);
    expect(p).toEqual({ creador: 'u1', contacto: '0414-1234567' });
    expect('geo_exacta' in p).toBe(false);
  });

  test('(b) SIN contacto y SIN GPS → no se crea privado (null)', () => {
    expect(construirPrivado('u1', '', null, null)).toBeNull();
    expect(construirPrivado('u1', undefined, undefined, undefined)).toBeNull();
  });

  test('(c) CON GPS → geo_exacta presente y válida', () => {
    const p = construirPrivado('u1', '0414-1234567', 10.4912, -68.2031);
    expect(p.geo_exacta).toEqual({ lat: 10.4912, lng: -68.2031 });
    expect(typeof p.geo_exacta.lat).toBe('number');
    expect(typeof p.geo_exacta.lng).toBe('number');
  });

  test('CON GPS y SIN contacto → privado con geo_exacta y contacto vacío', () => {
    const p = construirPrivado('u1', '', 10.49, -68.20);
    expect(p).toEqual({ creador: 'u1', contacto: '', geo_exacta: { lat: 10.49, lng: -68.20 } });
  });

  test('coords no numéricas (NaN/strings) se tratan como SIN GPS', () => {
    expect(construirPrivado('u1', '', NaN, NaN)).toBeNull();
    expect(construirPrivado('u1', '', '10.49', '-68.20')).toBeNull();
    // con contacto + coords inválidas → privado sin geo_exacta (no se pierde el contacto)
    const p = construirPrivado('u1', '0414', NaN, undefined);
    expect(p).toEqual({ creador: 'u1', contacto: '0414' });
  });
});

describe('geoPublicoSeguro — geo público siempre válido', () => {
  test('SIN GPS → usa el centro de zona, con números finitos + geohash', () => {
    const g = geoPublicoSeguro(null, null);
    expect(Number.isFinite(g.lat)).toBe(true);
    expect(Number.isFinite(g.lng)).toBe(true);
    expect(typeof g.geohash).toBe('string');
    expect(g.geohash.length).toBeGreaterThan(0);
    // centro de zona, aproximado a 2 decimales
    expect(g.lat).toBeCloseTo(CENTRO_FALLBACK.lat, 2);
  });

  test('CON GPS → coords reales aproximadas (~1km) + geohash', () => {
    const g = geoPublicoSeguro(10.49123, -68.20456);
    expect(g.lat).toBe(10.49);   // redondeo a 2 decimales
    expect(g.lng).toBe(-68.2);
    expect(typeof g.geohash).toBe('string');
  });

  test('coords inválidas → cae al centro de zona, nunca NaN', () => {
    const g = geoPublicoSeguro(NaN, undefined);
    expect(Number.isFinite(g.lat)).toBe(true);
    expect(Number.isFinite(g.lng)).toBe(true);
  });
});

describe('tieneCoords', () => {
  test('solo números finitos cuentan como coords', () => {
    expect(tieneCoords(10, -68)).toBe(true);
    expect(tieneCoords(0, 0)).toBe(true);
    expect(tieneCoords(null, null)).toBe(false);
    expect(tieneCoords(undefined, 1)).toBe(false);
    expect(tieneCoords(NaN, 1)).toBe(false);
    expect(tieneCoords('1', '2')).toBe(false);
  });
});
