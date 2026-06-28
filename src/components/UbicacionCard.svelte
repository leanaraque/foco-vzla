<script>
  // Tarjeta de un punto con UBICACIÓN DUDOSA (coords fuera de la zona del sismo, §zona).
  // Deja al operador CORREGIR el pin y guardar vía `editarNecesidad` (Admin SDK + rol;
  // las rules prohíben que el coordinador reescriba contenido, F3). Respeta la PRECISIÓN:
  //   - exacta (edificio/sitio público): la coord pública es EXACTA (no se redondea).
  //   - sector (persona): pública aproximada (~1km) + exacta solo al subdoc privado (§9-1).
  import { createEventDispatcher } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { aplicarEdicionNecesidad } from '../lib/db.js';
  import { geoPublico, geohashForLocation } from '../lib/geo.js';
  import { CENTRO_ZONA } from '../lib/zona.js';
  import MapaUnificado from './MapaUnificado.svelte';

  export let n; // necesidad { id, sector, categoria, urgencia, precision, geo:{lat,lng} }

  const dispatch = createEventDispatcher();
  let editando = false, trabajando = false, error = '', listoMsg = '';
  let pinLat = null, pinLng = null, centro = null;

  const exacta = n.precision === 'exacta';

  function abrir() {
    error = ''; listoMsg = '';
    pinLat = n.geo?.lat ?? CENTRO_ZONA.lat;
    pinLng = n.geo?.lng ?? CENTRO_ZONA.lng;
    centro = { lat: pinLat, lng: pinLng };
    editando = true;
  }
  function cerrar() { editando = false; }
  // Salta el pin (y el mapa) al centro de la zona afectada: para mover un punto que
  // cayó a 300 km sin tener que arrastrarlo a mano por todo el país.
  function centrarEnZona() { centro = { lat: CENTRO_ZONA.lat, lng: CENTRO_ZONA.lng, t: Date.now() }; }

  async function guardar() {
    if (!Number.isFinite(pinLat) || !Number.isFinite(pinLng)) { error = $t('ubic.error'); return; }
    error = ''; trabajando = true;
    try {
      const cambios = { necesidadId: n.id, nota: 'Ubicación corregida por el operador (§zona).' };
      if (exacta) {
        // Edificio/sitio público: la ubicación pública es exacta.
        cambios.geo = { lat: pinLat, lng: pinLng, geohash: geohashForLocation([pinLat, pinLng]) };
      } else {
        // Persona: pública aproximada a sector; exacta solo al privado.
        cambios.geo = geoPublico(pinLat, pinLng);
        cambios.geo_exacta = { lat: pinLat, lng: pinLng };
      }
      await aplicarEdicionNecesidad(cambios);
      listoMsg = $t('ubic.corregido');
      // Avisa al Panel para sacarlo de la lista (ya no está fuera de zona).
      setTimeout(() => dispatch('corregido', { id: n.id }), 700);
    } catch (e) {
      error = $t('ubic.error');
    } finally {
      trabajando = false;
    }
  }
</script>

<div class="tarjeta ubic">
  <div class="ubic-cab">
    <span class="badge-fuera">{$t('ubic.fuera')}</span>
    {#if n.categoria}<span class="tag">{$t('cat.' + n.categoria)}</span>{/if}
    {#if n.urgencia}<span class="tag tag-u-{n.urgencia}">{$t('urg.' + n.urgencia)}</span>{/if}
    <span class="tag prec">{exacta ? $t('ubic.prec_exacta') : $t('ubic.prec_sector')}</span>
  </div>

  <strong class="sector">{n.sector || '—'}</strong>
  {#if n.resumen || n.descripcion}<p class="desc">{n.resumen || n.descripcion}</p>{/if}
  <p class="coord">{$t('ubic.coord_actual')}: <code>{n.geo?.lat?.toFixed(4)}, {n.geo?.lng?.toFixed(4)}</code></p>

  {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}
  {#if listoMsg}<div class="aviso-ok">{listoMsg}</div>{/if}

  {#if editando}
    <div class="editor">
      <p class="edit-intro">{$t('ubic.nota')}</p>
      <button class="btn-sec" on:click={centrarEnZona} disabled={trabajando}>{$t('ubic.centrar')}</button>
      <MapaUnificado conPin bind:lat={pinLat} bind:lng={pinLng} {centro}
        necesidades={[]} recursos={[]} alto="240px" />
      <div class="edit-acciones">
        <button class="btn-ok" on:click={guardar} disabled={trabajando}>
          {trabajando ? $t('ubic.aplicando') : $t('ubic.aplicar')}
        </button>
        <button on:click={cerrar} disabled={trabajando}>{$t('ubic.cancelar')}</button>
      </div>
    </div>
  {/if}

  <div class="acciones">
    <a class="btn-link" href={`/mapa?focus=${n.id}`}>{$t('ubic.ver_mapa')}</a>
    {#if !editando && !listoMsg}
      <button class="btn-primario" on:click={abrir}>{$t('ubic.corregir')}</button>
    {/if}
  </div>
</div>

<style>
  .ubic { border-left: 4px solid #d97706; }
  .ubic-cab { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .badge-fuera { background: #d97706; color: #fff; font-weight: 700; font-size: 0.74rem; padding: 0.18rem 0.5rem; border-radius: 999px; }
  .prec { background: var(--gris-claro, #eef1f4); color: #334; }
  .sector { display: block; }
  .desc { margin: 0.3rem 0 0; color: var(--texto, #1c2530); font-size: 0.9rem; }
  .coord { margin: 0.3rem 0 0; font-size: 0.82rem; color: var(--texto-suave, #667); }
  .coord code { background: #eef2f5; padding: 0.05rem 0.3rem; border-radius: 4px; }
  .aviso-ok { background: #dcfce7; color: #166534; border-radius: var(--radio, 8px); padding: 0.4rem 0.6rem; margin: 0.4rem 0; font-weight: 600; font-size: 0.9rem; }
  .editor { border: 1px solid var(--borde, #d8dee4); border-radius: var(--radio, 8px); padding: 0.7rem; margin: 0.5rem 0; background: #fff; }
  .edit-intro { font-size: 0.85rem; color: var(--texto-suave, #667); margin: 0 0 0.5rem; }
  .btn-sec { margin-bottom: 0.5rem; }
  .edit-acciones { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.6rem; }
  .acciones { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem; }
  .btn-link { align-self: center; font-weight: 600; }
</style>
