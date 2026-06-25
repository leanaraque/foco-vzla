// Tests del módulo puro src/lib/autocomplete.js. No requieren emulador ni red.
import { describe, test, expect } from 'vitest';
import {
  normaliza,
  empiezaPorPalabra,
  puntuar,
  filtrarLocal,
  photonATipo,
  photonAGusto,
  dedupe,
  dentroDeVenezuela,
  BBOX_VENEZUELA,
  normalizarEstadoPhoton,
  normalizarCiudadPhoton,
  marcar
} from '../src/lib/autocomplete.js';

describe('normaliza', () => {
  test('quita acentos y baja a minúsculas', () => {
    expect(normaliza('Morón')).toBe('moron');
    expect(normaliza('Maiquetía')).toBe('maiquetia');
    expect(normaliza('  ÚrbAniZación  ')).toBe('urbanizacion');
  });
  test('tolera vacíos', () => {
    expect(normaliza('')).toBe('');
    expect(normaliza(null)).toBe('');
    expect(normaliza(undefined)).toBe('');
  });
});

describe('empiezaPorPalabra', () => {
  test('match al inicio del string', () => {
    expect(empiezaPorPalabra('plaza bolivar', 'plaza')).toBe(true);
  });
  test('match después de espacio/guion/paréntesis/punto/coma/slash', () => {
    expect(empiezaPorPalabra('av. san martin', 'san')).toBe(true);
    expect(empiezaPorPalabra('barrio-san-jose', 'san')).toBe(true);
    expect(empiezaPorPalabra('caracas (libertador)', 'libertador')).toBe(true);
    expect(empiezaPorPalabra('av/sucre', 'sucre')).toBe(true);
  });
  test('NO matchea en mitad de palabra', () => {
    expect(empiezaPorPalabra('barrio', 'arr')).toBe(false);
    expect(empiezaPorPalabra('moron', 'ron')).toBe(false);
  });
});

describe('puntuar (ranking de relevancia)', () => {
  const l = (nombre, municipio = 'Caracas (Libertador), Distrito Capital') => ({ nombre, municipio });

  test('nombre empieza por q → score 0 (mejor)', () => {
    expect(puntuar(l('Morón'), 'mor').score).toBe(0);
  });
  test('palabra interna del nombre empieza por q → score 1', () => {
    expect(puntuar(l('Plaza Bolívar'), 'bolivar').score).toBe(1);
  });
  test('nombre contiene q sin empezar palabra → score 2', () => {
    expect(puntuar(l('Urbanización'), 'baniz').score).toBe(2);
  });
  test('municipio empieza por q → score 3', () => {
    expect(puntuar(l('Casco Histórico', 'Maracay, Aragua'), 'mara').score).toBe(3);
  });
  test('municipio contiene q → score 4', () => {
    expect(puntuar(l('Sector X', 'Puerto Cabello, Carabobo'), 'carab').score).toBe(4);
  });
  test('sin match → null', () => {
    expect(puntuar(l('Morón'), 'xxqq')).toBeNull();
  });
  test('compara contra el nombre/municipio normalizados (la query ya viene normalizada por filtrarLocal)', () => {
    expect(puntuar(l('Mérida'), 'merida').score).toBe(0);
  });
});

describe('filtrarLocal', () => {
  const dataset = [
    { nombre: 'Morón', tipo: 'ciudad', municipio: 'Morón, Carabobo' },
    { nombre: 'Barrio Coro', tipo: 'sector', municipio: 'Morón, Carabobo' },
    { nombre: 'Caraballeda', tipo: 'municipio', municipio: 'Caraballeda, La Guaira' },
    { nombre: 'Puerto Cabello', tipo: 'municipio', municipio: 'Puerto Cabello, Carabobo' },
    { nombre: 'Hospital Padre Justo', tipo: 'hospital', municipio: 'Rubio, Táchira' },
    { nombre: 'Plaza Bolívar', tipo: 'plaza/parque', municipio: 'Sucre (Petare), Miranda' }
  ];

  test('"mor" → Morón primero (startsWith)', () => {
    const r = filtrarLocal(dataset, 'mor');
    expect(r[0].nombre).toBe('Morón');
  });

  test('"bolivar" → Plaza Bolívar (palabra interna)', () => {
    const r = filtrarLocal(dataset, 'bolivar');
    expect(r[0].nombre).toBe('Plaza Bolívar');
  });

  test('"carab" → Caraballeda antes que matches por municipio', () => {
    const r = filtrarLocal(dataset, 'carab');
    expect(r[0].nombre).toBe('Caraballeda');
    // Puerto Cabello matchea por municipio "Carabobo" → score 4, va después
    expect(r.find((x) => x.nombre === 'Puerto Cabello')).toBeDefined();
  });

  test('"hospital" → Hospital Padre Justo (score 0)', () => {
    const r = filtrarLocal(dataset, 'hospital');
    expect(r[0].nombre).toBe('Hospital Padre Justo');
  });

  test('mínimo 2 chars', () => {
    expect(filtrarLocal(dataset, 'a')).toEqual([]);
    expect(filtrarLocal(dataset, '')).toEqual([]);
  });

  test('respeta el max', () => {
    expect(filtrarLocal(dataset, 'a', 2).length).toBeLessThanOrEqual(2);
  });
});

describe('dentroDeVenezuela', () => {
  test('Caracas dentro', () => {
    expect(dentroDeVenezuela(10.5061, -66.9146)).toBe(true);
  });
  test('Bogotá fuera (al oeste)', () => {
    expect(dentroDeVenezuela(4.71, -74.07)).toBe(false);
  });
  test('Caribe fuera (al norte)', () => {
    expect(dentroDeVenezuela(15.0, -68.0)).toBe(false);
  });
  test('bbox como string para Photon', () => {
    expect(BBOX_VENEZUELA).toBe('-73.4,0.6,-59.8,12.2');
  });
});

describe('photonATipo', () => {
  test('place=city → ciudad', () => {
    expect(photonATipo({ osm_key: 'place', osm_value: 'city' })).toBe('ciudad');
  });
  test('place=town/village → pueblo', () => {
    expect(photonATipo({ osm_key: 'place', osm_value: 'town' })).toBe('pueblo');
    expect(photonATipo({ osm_key: 'place', osm_value: 'village' })).toBe('pueblo');
  });
  test('amenity=hospital → hospital', () => {
    expect(photonATipo({ osm_key: 'amenity', osm_value: 'hospital' })).toBe('hospital');
  });
  test('highway → calle', () => {
    expect(photonATipo({ osm_key: 'highway', osm_value: 'residential' })).toBe('calle');
  });
  test('building → edificio', () => {
    expect(photonATipo({ osm_key: 'building', osm_value: 'yes' })).toBe('edificio');
  });
  test('desconocido → lugar', () => {
    expect(photonATipo({ osm_key: 'xxx', osm_value: 'yyy' })).toBe('lugar');
    expect(photonATipo({})).toBe('lugar');
  });
});

describe('photonAGusto', () => {
  const feature = (over = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-66.9146, 10.5061] }, // [lng, lat]
    properties: {
      name: 'Plaza Caracas',
      osm_key: 'place',
      osm_value: 'square',
      city: 'Caracas',
      state: 'Distrito Capital',
      country: 'Venezuela',
      ...over
    }
  });

  test('feature válido → shape interno con _origen=photon', () => {
    const r = photonAGusto(feature());
    expect(r.nombre).toBe('Plaza Caracas');
    expect(r.lat).toBeCloseTo(10.5061, 4);
    expect(r.lng).toBeCloseTo(-66.9146, 4);
    expect(r.municipio).toBe('Caracas, Distrito Capital');
    expect(r.sectorGeo).toHaveLength(5);
    expect(r.geohash.length).toBeGreaterThanOrEqual(5);
    expect(r._origen).toBe('photon');
  });

  test('fuera de Venezuela → null', () => {
    const f = feature();
    f.geometry.coordinates = [-74.07, 4.71]; // Bogotá
    expect(photonAGusto(f)).toBeNull();
  });

  test('país != Venezuela → null aunque coords caigan dentro', () => {
    expect(photonAGusto(feature({ country: 'Colombia' }))).toBeNull();
  });

  test('sin name → null', () => {
    expect(photonAGusto(feature({ name: '' }))).toBeNull();
  });

  test('sin geometry → null', () => {
    expect(photonAGusto({ properties: { name: 'X', country: 'Venezuela' } })).toBeNull();
  });

  test('fallback a county si no hay city', () => {
    const r = photonAGusto(feature({ city: undefined, county: 'Vargas' }));
    expect(r.municipio).toBe('Vargas, Distrito Capital');
  });

  test('sin city ni county → solo estado', () => {
    const r = photonAGusto(feature({ city: undefined, county: undefined }));
    expect(r.municipio).toBe('Distrito Capital');
  });
});

describe('normalizarEstadoPhoton', () => {
  test('estados de Venezuela en inglés → español con tildes', () => {
    expect(normalizarEstadoPhoton('Sucre State')).toBe('Sucre');
    expect(normalizarEstadoPhoton('Tachira State')).toBe('Táchira');
    expect(normalizarEstadoPhoton('Merida State')).toBe('Mérida');
    expect(normalizarEstadoPhoton('Capital District')).toBe('Distrito Capital');
    expect(normalizarEstadoPhoton('Bolivar State')).toBe('Bolívar');
    expect(normalizarEstadoPhoton('Anzoategui State')).toBe('Anzoátegui');
    expect(normalizarEstadoPhoton('Vargas State')).toBe('La Guaira'); // alias histórico
  });
  test('estado desconocido → se devuelve tal cual', () => {
    expect(normalizarEstadoPhoton('Pasadena State')).toBe('Pasadena State');
  });
  test('vacío/null pasa derecho', () => {
    expect(normalizarEstadoPhoton('')).toBe('');
    expect(normalizarEstadoPhoton(null)).toBe(null);
  });
});

describe('normalizarCiudadPhoton', () => {
  test('"Municipality of X" → "Municipio X"', () => {
    expect(normalizarCiudadPhoton('Municipality of Chacao')).toBe('Municipio Chacao');
  });
  test('"Parish of X" → "Parroquia X"', () => {
    expect(normalizarCiudadPhoton('Parish of Lechería')).toBe('Parroquia Lechería');
  });
  test('si ya viene en español → no cambia', () => {
    expect(normalizarCiudadPhoton('Municipio Liberta')).toBe('Municipio Liberta');
    expect(normalizarCiudadPhoton('Caracas')).toBe('Caracas');
  });
});

describe('photonAGusto (con normalización Iter 3)', () => {
  const feature = (over = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-66.9146, 10.5061] },
    properties: {
      name: 'Av Sucre', osm_key: 'highway', osm_value: 'residential',
      city: 'Caracas', state: 'Capital District', country: 'Venezuela', ...over
    }
  });
  test('estado en inglés → español tildado', () => {
    const r = photonAGusto(feature({ state: 'Tachira State', city: 'San Cristóbal' }));
    expect(r.municipio).toBe('San Cristóbal, Táchira');
  });
  test('Capital District → Distrito Capital', () => {
    const r = photonAGusto(feature());
    expect(r.municipio).toBe('Caracas, Distrito Capital');
  });
});

describe('marcar (highlight de matches)', () => {
  test('match al inicio', () => {
    expect(marcar('Plaza Bolívar', 'plaza')).toEqual([
      { t: 'Plaza', match: true },
      { t: ' Bolívar', match: false }
    ]);
  });
  test('match con acento en el texto (query sin acento)', () => {
    const r = marcar('Mérida', 'merida');
    expect(r).toEqual([{ t: 'Mérida', match: true }]);
  });
  test('match parcial en mitad', () => {
    expect(marcar('Maiquetía', 'queti')).toEqual([
      { t: 'Mai', match: false },
      { t: 'quetí', match: true },
      { t: 'a', match: false }
    ]);
  });
  test('sin match → un solo fragmento sin marcar', () => {
    expect(marcar('Caracas', 'xyz')).toEqual([{ t: 'Caracas', match: false }]);
  });
  test('query vacía → texto entero sin marcar', () => {
    expect(marcar('Caracas', '')).toEqual([{ t: 'Caracas', match: false }]);
  });
  test('texto vacío → []', () => {
    expect(marcar('', 'x')).toEqual([]);
  });
  test('uniendo todos los fragmentos se recupera el texto original', () => {
    const casos = ['Mérida', 'Av. Sucre', 'San Cristóbal del Táchira', 'Plaza Bolívar'];
    const queries = ['mer', 'sucre', 'san', 'plaza'];
    for (let i = 0; i < casos.length; i++) {
      const partes = marcar(casos[i], queries[i]);
      const reconstruido = partes.map((p) => p.t).join('');
      expect(reconstruido).toBe(casos[i]);
    }
  });
});

describe('dedupe', () => {
  test('mantiene el primer ocurrente por nombre+municipio', () => {
    const r = dedupe([
      { nombre: 'Morón', municipio: 'Morón, Carabobo', _origen: 'local' },
      { nombre: 'Caracas', municipio: 'Caracas, DC', _origen: 'local' },
      { nombre: 'Morón', municipio: 'Morón, Carabobo', _origen: 'photon' }   // dup
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]._origen).toBe('local');
  });

  test('distintos municipios cuentan como distintos', () => {
    const r = dedupe([
      { nombre: 'San Cristóbal', municipio: 'San Cristóbal, Táchira' },
      { nombre: 'San Cristóbal', municipio: 'Mérida, Mérida' }
    ]);
    expect(r).toHaveLength(2);
  });
});
