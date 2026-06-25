// Utilidades geográficas. Geohashing con geofire-common (Spec §6.2): librería de
// utilidades liviana, no el GeoFirestore pesado.
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

// Redondeo de coordenadas para la vista pública: protege ubicación de personas
// vulnerables mostrándola a nivel de sector, no de coordenada exacta (Spec §4 y §9-1).
// ~2 decimales ≈ 1.1 km de granularidad.
export function aproximar(lat, lng, decimales = 2) {
  const f = Math.pow(10, decimales);
  return {
    lat: Math.round(lat * f) / f,
    lng: Math.round(lng * f) / f
  };
}

// geo público: coordenada aproximada + geohash (para consultas de mapa).
export function geoPublico(lat, lng) {
  const aprox = aproximar(lat, lng);
  return {
    lat: aprox.lat,
    lng: aprox.lng,
    geohash: geohashForLocation([aprox.lat, aprox.lng])
  };
}

export { geohashForLocation, geohashQueryBounds, distanceBetween };
