// Mirror server-side de src/lib/geo.js (geohash con geofire-common). El geo PÚBLICO
// es a nivel SECTOR (~1.1km): coords redondeadas a 2 decimales + geohash. Mantener en
// sync con el cliente para que las rules acepten sectorGeo == geo.geohash[0:5].
import { geohashForLocation } from 'geofire-common';

export function aproximar(lat, lng, decimales = 2) {
  const f = Math.pow(10, decimales);
  return { lat: Math.round(lat * f) / f, lng: Math.round(lng * f) / f };
}

// geo público (nivel sector). Para coords EXACTAS de un sitio público de desastre,
// usar geoExacto; para personas, SIEMPRE geoPublico (la exacta va al privado).
export function geoPublico(lat, lng) {
  const a = aproximar(lat, lng);
  return { lat: a.lat, lng: a.lng, geohash: geohashForLocation([a.lat, a.lng]) };
}

export function geoExacto(lat, lng) {
  return { lat, lng, geohash: geohashForLocation([lat, lng]) };
}
