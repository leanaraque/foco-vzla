// Zona afectada por el doblete sísmico (costa centro-norte): La Guaira/Vargas,
// Distrito Capital, Miranda metropolitana, costa de Carabobo y Aragua.
//
// Sirve para DETECTAR puntos cuya geocodificación cayó FUERA de esa zona — el síntoma
// real de mala ubicación que encontramos en la auditoría: un nombre ambiguo ("El Limón",
// "Morón") que el geocoder (Nominatim, limit=1) emparejó con OTRO lugar del país
// (Margarita, oriente, los llanos). El bounding box es GENEROSO para no marcar como
// dudoso ningún punto del área real del sismo (incluye Valencia/Maracay tierra adentro).
// Módulo PURO (sin Firebase) → unit-testeable.
export const ZONA_AFECTADA = { latMin: 9.7, latMax: 11.0, lngMin: -68.8, lngMax: -65.8 };

// Centro aproximado de la zona (La Guaira / Caracas): punto de partida para recentrar
// el mapa al corregir un punto que está lejísimos (no arrastrar 300 km a mano).
export const CENTRO_ZONA = { lat: 10.55, lng: -66.9 };

export function dentroDeZona(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= ZONA_AFECTADA.latMin && lat <= ZONA_AFECTADA.latMax
    && lng >= ZONA_AFECTADA.lngMin && lng <= ZONA_AFECTADA.lngMax;
}

// ¿El punto tiene coordenada pero cae FUERA de la zona? (sospechoso de mala ubicación)
// Sin coords no es "fuera": es otro problema (no se marca aquí).
export function fueraDeZona(geo) {
  return !!geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && !dentroDeZona(geo.lat, geo.lng);
}
