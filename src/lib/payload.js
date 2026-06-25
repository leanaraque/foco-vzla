// Construcción de payloads para necesidades/recursos. Módulo PURO (sin Firebase)
// para poder unit-testearlo sin emulador. db.js lo usa para armar los documentos.
import { geoPublico } from './geo.js';

// Centro aproximado de la zona del evento (Morón/Carabobo). Se usa SOLO para el
// geo PÚBLICO cuando el reportante no comparte GPS; el sector textual aporta el
// detalle. NUNCA se usa para geo_exacta: inventar una "coordenada exacta" sería
// una ubicación falsa y violaría §9-1.
export const CENTRO_FALLBACK = { lat: 10.49, lng: -68.20 };

export function tieneCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

// geo público SIEMPRE válido (las rules exigen geo.lat/lng numéricos + geohash):
// coords reales aproximadas si hay GPS, o el centro de la zona si no lo hay.
export function geoPublicoSeguro(lat, lng) {
  return tieneCoords(lat, lng)
    ? geoPublico(lat, lng)
    : geoPublico(CENTRO_FALLBACK.lat, CENTRO_FALLBACK.lng);
}

// Payload del subdocumento privado, o `null` si no hay nada sensible que guardar.
// BUG OFFLINE CORREGIDO (§20): `geo_exacta` se incluye SOLO si hay GPS real. Sin
// GPS se omite (la regla validPrivado lo permite ausente). Antes se incluía
// siempre con coords inválidas/falsas, lo que rompía el create o hacía que el
// privado se rechazara al sincronizar y el CONTACTO se perdiera en silencio.
export function construirPrivado(uid, contacto, lat, lng) {
  const conGps = tieneCoords(lat, lng);
  if (!contacto && !conGps) return null; // nada que proteger → no se crea privado
  const datos = { creador: uid, contacto: contacto || '' };
  if (conGps) datos.geo_exacta = { lat, lng };
  return datos;
}
