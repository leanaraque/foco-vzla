// Lógica PURA de promoción staging→canónico (sin Firebase): decide, por cada doc de
// staging, CREAR/ACTUALIZAR/REVISAR/SALTAR. La E/S vive en functions/promotor.js.
// Testeable sin emulador. Reutiliza el dedup y el motor de prioridad compartidos.
import { norm, GEN, distM, esCiudadano, severidadDe } from './dedup.js';
import { calcularPrioridad, esRescateActivo } from './prioridad.js';
import { mergeFuentes } from './identidad.js';

const nomDe = (sector) => norm((sector || '').split('·')[0]);
const geoDe = (x) => (x && x.geo && Number.isFinite(x.geo.lat)) ? { lat: x.geo.lat, lng: x.geo.lng } : null;

// ¿Qué canónico ya describe esta entidad? Identidad (fuentes[]) → o dedup
// (proximidad <=25m misma categoría, o mismo nombre distintivo <=150m).
export function buscarMatch(st, lista) {
  for (const c of lista) {
    if (Array.isArray(c.fuentes) && c.fuentes.some((f) => f.sistema === st.sistema && f.id_externo === st.id_externo)) return c;
  }
  const g = geoDe(st.publico); const nom = nomDe(st.publico?.sector);
  let best = null, bestD = Infinity;
  for (const c of lista) {
    const cg = geoDe(c); if (!g || !cg) continue;
    const d = distM(g, cg);
    const mismoNombre = nom && nom.length >= 5 && nom === nomDe(c.sector) && !GEN.has(nom);
    if ((c.categoria === st.publico?.categoria && d <= 25) || (mismoNombre && d <= 150)) {
      if (d < bestD) { best = c; bestD = d; }
    }
  }
  return best;
}

// Campos públicos de una necesidad canónica (sin timestamps; la E/S los añade).
export function camposNecesidad(p, ahora) {
  const severidad = p.severidad || severidadDe(p.descripcion);
  const d = {
    categoria: p.categoria, urgencia: p.urgencia || 'alta', severidad,
    sector: p.sector, descripcion: p.descripcion || '',
    geo: p.geo, sectorGeo: p.sectorGeo || (p.geo?.geohash || '').slice(0, 5), precision: p.precision || 'sector'
  };
  if (p.rescate) d.rescate = p.rescate;
  d.rescate_activo = esRescateActivo(d);
  d.prioridad = calcularPrioridad({ ...d, _refMs: ahora, rescate: d.rescate || (d.rescate_activo ? { atrapados: true } : undefined) }, ahora);
  return d;
}

// Campos públicos de un recurso canónico.
export function camposRecurso(p) {
  return {
    categoria: p.categoria, sector: p.sector, descripcion: p.descripcion || '',
    geo: p.geo, precision: p.precision || 'sector', disponible: true
  };
}

// Decide las operaciones. `canonicos` = { necesidades:[...], recursos:[...] } (snapshot).
// Devuelve [{ tipo:'crear'|'actualizar'|'revisar'|'saltar', ... }]. PURO.
export function planearPromocion(stagingDocs, canonicos, ahora = Date.now()) {
  const listas = { necesidad: (canonicos.necesidades || []).slice(), recurso: (canonicos.recursos || []).slice() };
  const ops = [];
  for (const st of stagingDocs) {
    if (st.promovido_a && st.hash_promovido === st.hash) { ops.push({ tipo: 'saltar', stagingId: st.id }); continue; }
    if (st.pii?.tienePII) { ops.push({ tipo: 'revisar', stagingId: st.id, destino: st.destino, motivo: 'pii', motivos: st.pii.motivos || [] }); continue; }
    const lista = listas[st.destino] || listas.necesidad;
    const match = buscarMatch(st, lista);
    if (match) {
      const fuentes = mergeFuentes(match.fuentes, st.fuente);
      match.fuentes = fuentes; // refleja en el snapshot para el resto del lote
      // REGLA DE PROPIEDAD (salvaguarda de producción): solo se REFRESCA el contenido
      // de un canónico si esta fuente es su dueña (creador === sistema). Si es un
      // CIUDADANO (línea roja) o un doc de OTRA fuente/operador/curador, NO se pisa su
      // contenido: solo se le ADJUNTA la procedencia (fuentes[]). Así un cruce de
      // fuentes nunca borra la señal de otra (p.ej. "con vida" de un reporte de IG) ni
      // reintroduce PII que el operador haya editado. Tampoco se pisa una corrección que
      // un COORDINADOR aplicó a mano desde el Panel (`editado_por_operador`, editarNecesidad).
      const refrescar = !esCiudadano(match.creador) && match.creador === st.sistema
        && !match.editado_por_operador;
      const campos = refrescar
        ? (st.destino === 'recurso' ? camposRecurso(st.publico) : camposNecesidad(st.publico, ahora))
        : null;
      ops.push({ tipo: 'actualizar', stagingId: st.id, destino: st.destino, canonId: match.id, fuentes, campos, protegido: !refrescar });
    } else {
      const campos = st.destino === 'recurso' ? camposRecurso(st.publico) : camposNecesidad(st.publico, ahora);
      ops.push({ tipo: 'crear', stagingId: st.id, destino: st.destino, sistema: st.sistema, fuente: st.fuente, campos });
    }
  }
  return ops;
}
