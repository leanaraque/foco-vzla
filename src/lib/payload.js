// Construcción de payloads para necesidades/recursos. Módulo PURO (sin Firebase)
// para poder unit-testearlo sin emulador. db.js lo usa para armar los documentos.
import { geoPublico } from './geo.js';
import { calcularPrioridad, esRescateActivo } from './prioridad.js';

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
export function construirPrivado(uid, contacto, lat, lng, extra = {}) {
  const conGps = tieneCoords(lat, lng);
  const comoLlegar = (extra.como_llegar || '').trim();
  const alterno = (extra.contacto_alterno || '').trim();
  // Nada sensible que guardar → no se crea el privado.
  if (!contacto && !conGps && !comoLlegar && !alterno) return null;
  const datos = { creador: uid, contacto: contacto || '' };
  if (conGps) datos.geo_exacta = { lat, lng };
  if (comoLlegar) datos.como_llegar = comoLlegar.slice(0, 200);
  if (alterno) datos.contacto_alterno = alterno.slice(0, 140);
  return datos;
}

// === Esquema CANÓNICO v2 (Spec §25.3) — constructor PURO del documento público ===
// Toma las entradas tipadas del nuevo /reportar y arma el documento público (sin
// timestamps ni campos de servidor; eso lo añade db.js). Deriva severidad-resumen,
// rescate_activo y prioridad con el motor puro. NO incluye nada sensible (contacto,
// coords exactas, cómo llegar) → eso va al privado vía construirPrivado.
const ENUM = {
  categoria: ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'servicios', 'otro'],
  urgencia: ['critica', 'alta', 'media'],
  para_quien: ['yo', 'familiar', 'vecino', 'desconocido'],
  personas_rango: ['1', '2-5', '6-20', '+20'],
  severidad: ['total', 'severo', 'parcial', 'desconocida'],
  desde: ['<6h', '6-24h', '+24h'],
  medico_tipo: ['herido', 'medicamento_critico', 'atencion'],
  medicamento: ['insulina', 'oxigeno', 'dialisis', 'otro'],
  vulnerables: ['ninos', 'mayores', 'discapacidad', 'embarazadas', 'heridos', 'cronicos'],
  riesgos: ['gas', 'fuego', 'colapso', 'electricidad', 'agua']
};
const enEnum = (v, lista, def) => (lista.includes(v) ? v : def);
const filtraEnum = (arr, lista) => (Array.isArray(arr) ? arr.filter((x) => lista.includes(x)) : []);
const esEntero = (n) => Number.isInteger(n) && n >= 0;

function limpiaRescate(r) {
  if (!r || r.atrapados == null) return null;
  const out = { atrapados: !!r.atrapados };
  if (esEntero(r.cantidad)) out.cantidad = r.cantidad;
  if (r.con_vida != null) out.con_vida = !!r.con_vida;
  if (ENUM.desde.includes(r.desde)) out.desde = r.desde;
  return out;
}
function limpiaMedico(m) {
  if (!m || !ENUM.medico_tipo.includes(m.tipo)) return null;
  const out = { tipo: m.tipo };
  if (m.tipo === 'medicamento_critico' && ENUM.medicamento.includes(m.medicamento)) out.medicamento = m.medicamento;
  return out;
}
function limpiaCantidad(c) {
  if (!c) return null;
  const out = {};
  if (esEntero(c.personas)) out.personas = c.personas;
  if (esEntero(c.dias)) out.dias = c.dias;
  return Object.keys(out).length ? out : null;
}

export function construirNecesidadPublica(inp = {}) {
  const gLat = inp.gps?.lat, gLng = inp.gps?.lng;
  const rLat = inp.referencia?.lat, rLng = inp.referencia?.lng;
  const geo =
    tieneCoords(gLat, gLng) ? geoPublico(gLat, gLng) :
    tieneCoords(rLat, rLng) ? geoPublico(rLat, rLng) :
    geoPublico(CENTRO_FALLBACK.lat, CENTRO_FALLBACK.lng);
  const precision = tieneCoords(gLat, gLng) ? 'exacta' : 'sector';

  const d = {
    categoria: enEnum(inp.categoria, ENUM.categoria, 'otro'),
    urgencia: enEnum(inp.urgencia, ENUM.urgencia, 'media'),
    para_quien: enEnum(inp.para_quien, ENUM.para_quien, 'desconocido'),
    personas_rango: enEnum(inp.personas_rango, ENUM.personas_rango, '1'),
    severidad: enEnum(inp.severidad, ENUM.severidad, 'desconocida'),
    sector: (inp.sector || inp.referencia?.nombre || '(sin sector)').slice(0, 140),
    descripcion: (inp.descripcion || '').slice(0, 500),
    geo, sectorGeo: geo.geohash.slice(0, 5), precision
  };
  const vuln = filtraEnum(inp.vulnerables, ENUM.vulnerables);
  if (vuln.length) d.vulnerables = vuln;
  const ries = filtraEnum(inp.riesgos, ENUM.riesgos);
  if (ries.length) d.riesgos = ries;
  const resc = limpiaRescate(inp.rescate); if (resc) d.rescate = resc;
  const med = limpiaMedico(inp.medico); if (med) d.medico = med;
  const cant = limpiaCantidad(inp.cantidad); if (cant) d.cantidad = cant;

  // Derivados (Spec §25.5): rescate_activo y prioridad salen de las señales.
  d.rescate_activo = esRescateActivo(d);
  d.prioridad = calcularPrioridad(d); // recién creada → sin decaimiento (frescura 0)
  return d;
}
