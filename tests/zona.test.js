import { describe, it, expect } from 'vitest';
import { dentroDeZona, fueraDeZona, ZONA_AFECTADA } from '../src/lib/zona.js';

describe('zona afectada — detección de ubicación dudosa', () => {
  it('puntos del área del sismo están DENTRO', () => {
    expect(dentroDeZona(10.60, -66.93)).toBe(true); // La Guaira
    expect(dentroDeZona(10.49, -66.87)).toBe(true); // Caracas
    expect(dentroDeZona(10.51, -68.20)).toBe(true); // Morón (Carabobo, epicentro)
    expect(dentroDeZona(10.47, -68.01)).toBe(true); // Puerto Cabello
    expect(dentroDeZona(10.25, -67.60)).toBe(true); // Maracay (tierra adentro, no falso positivo)
  });

  it('errores de geocodificación reales caen FUERA', () => {
    expect(fueraDeZona({ lat: 11.03, lng: -63.87 })).toBe(true);  // Margarita ("El Limón")
    expect(fueraDeZona({ lat: 9.631, lng: -63.534 })).toBe(true); // oriente ("Morón" equivocado)
    expect(fueraDeZona({ lat: 10.06, lng: -69.37 })).toBe(true);  // Barquisimeto
    expect(fueraDeZona({ lat: 7.89, lng: -67.47 })).toBe(true);   // San Fernando de Apure
    expect(fueraDeZona({ lat: 8.59, lng: -71.14 })).toBe(true);   // Mérida
  });

  it('un punto dentro de la zona NO es "fuera"', () => {
    expect(fueraDeZona({ lat: 10.6, lng: -66.9 })).toBe(false);
  });

  it('sin coordenadas válidas no se marca como fuera', () => {
    expect(fueraDeZona(null)).toBe(false);
    expect(fueraDeZona({})).toBe(false);
    expect(fueraDeZona({ lat: 'x', lng: 1 })).toBe(false);
    expect(fueraDeZona({ lat: NaN, lng: NaN })).toBe(false);
  });

  it('el bounding box es el esperado', () => {
    expect(ZONA_AFECTADA).toEqual({ latMin: 9.7, latMax: 11.0, lngMin: -68.8, lngMax: -65.8 });
  });
});
