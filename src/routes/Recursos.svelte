<script>
  import { onDestroy } from 'svelte';
  import { t, tiempo } from '../lib/i18n.js';
  import { online, asegurarSesionAnonima } from '../lib/stores.js';
  import { crearRecurso, suscribirRecursos, leerNecesidadesPublicas, leerRecursosPublicos } from '../lib/db.js';
  import LugarAutocomplete from '../components/LugarAutocomplete.svelte';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  // Contexto del mapa (mismo mapa que /mapa): muestra lo existente al registrar.
  let ctxNec = [], ctxRec = [];
  (async () => {
    try { const r = await leerNecesidadesPublicas({}); ctxNec = r.items; } catch (_) {}
    try { ctxRec = await leerRecursosPublicos({}); } catch (_) {}
  })();

  const categorias = ['agua', 'transporte', 'refugio', 'medico', 'alimento', 'otro'];

  let mostrarForm = false;
  let categoria = '';
  let sector = '';
  let referencia = null;     // lugar elegido del autocompletado
  let descripcion = '';
  let contacto = '';
  let lat = null, lng = null, gpsEstado = '';   // GPS preciso
  // Selector de pin (camino sugerido, igual que Reportar).
  let mostrarMapa = true;
  let pinLat = null, pinLng = null, centroMapa = null;
  let enviando = false, error = '', okMsg = '';

  let items = [];
  const unsub = suscribirRecursos((data) => (items = data));
  onDestroy(() => unsub && unsub());

  function usarGps() {
    if (!navigator.geolocation) { gpsEstado = 'error'; return; }
    gpsEstado = 'buscando';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lat = pos.coords.latitude; lng = pos.coords.longitude; gpsEstado = 'ok';
        centroMapa = { lat, lng }; mostrarMapa = true;
      },
      () => { gpsEstado = 'error'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function onLugar(e) {
    const l = e.detail;
    if (l && Number.isFinite(l.lat)) centroMapa = { lat: l.lat, lng: l.lng };
  }

  async function registrar() {
    error = ''; okMsg = '';
    if (!categoria) { error = $t('comun.error'); return; }
    const hayPin = pinLat != null && pinLng != null;
    if (!sector && !referencia && !(lat && lng) && !hayPin) { error = $t('reportar.falta_ubicacion'); return; }
    enviando = true;
    try {
      await asegurarSesionAnonima();
      const exacto = hayPin ? { lat: pinLat, lng: pinLng }
                   : (lat != null && lng != null ? { lat, lng } : null);
      const { listo } = crearRecurso({
        categoria,
        sector: sector || (referencia ? referencia.nombre : '(sin sector)'),
        descripcion,
        gps: exacto,
        referencia,
        contacto: contacto.trim()
      });
      if ($online) await listo; else listo.catch(() => {});
      okMsg = $t('reportar.ok');
      categoria = ''; sector = ''; referencia = null; descripcion = ''; contacto = '';
      lat = null; lng = null; gpsEstado = ''; pinLat = null; pinLng = null; centroMapa = null; mostrarMapa = true;
      mostrarForm = false;
    } catch (e) { error = $t('comun.error'); }
    finally { enviando = false; }
  }
</script>

<div class="contenedor">
  <h1>{$t('recursos.titulo')}</h1>
  <p class="intro-seg">{$t('intro.recursos')}</p>

  {#if okMsg}<div class="aviso-ok" role="status">{okMsg}</div>{/if}

  <button class="btn-primario btn-bloque" on:click={() => (mostrarForm = !mostrarForm)}>
    + {$t('recursos.registrar')}
  </button>

  {#if mostrarForm}
    <div class="tarjeta" style="margin-top:.7rem">
      {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}
      <label for="rcat">{$t('reportar.categoria')}</label>
      <select id="rcat" bind:value={categoria}>
        <option value="" disabled>—</option>
        {#each categorias as c}<option value={c}>{$t('cat.' + c)}</option>{/each}
      </select>

      <label for="rsector">{$t('reportar.ubicacion')}</label>
      <LugarAutocomplete bind:valor={sector} bind:elegido={referencia} on:seleccion={onLugar} />
      <p class="ayuda">{$t('reportar.ubicacion_ayuda')}</p>
      <button type="button" class="btn-bloque" style="margin-top:.5rem" on:click={usarGps}>
        {$t('reportar.usar_gps')}{#if gpsEstado === 'buscando'} …{:else if gpsEstado === 'ok'} · {$t('reportar.gps_ok')}{:else if gpsEstado === 'error'} · {$t('reportar.gps_error')}{/if}
      </button>

      <!-- Punto exacto en mapa — camino sugerido, igual que Reportar. -->
      {#if mostrarMapa}
        <div class="mapa-titulo">{$t('reportar.mapa_titulo')}</div>
        <p class="ayuda">{$t('reportar.mapa_ayuda')}</p>
        <MapaUnificado conPin bind:lat={pinLat} bind:lng={pinLng} centro={centroMapa} necesidades={ctxNec} recursos={ctxRec} alto="300px" />
        {#if pinLat != null}<p class="ayuda pin-ok">{$t('reportar.mapa_marcado')}</p>{/if}
        <button type="button" class="enlace-ocultar" on:click={() => (mostrarMapa = false)}>
          {$t('reportar.mapa_ocultar')}
        </button>
      {:else}
        <button type="button" class="btn-bloque" style="margin-top:.5rem" on:click={() => (mostrarMapa = true)}>
          {$t('reportar.mapa_toggle')}{#if pinLat != null} · {$t('reportar.marcado')}{/if}
        </button>
      {/if}

      <label for="rdesc">{$t('reportar.descripcion')}</label>
      <textarea id="rdesc" bind:value={descripcion} maxlength="500"></textarea>

      <label for="rcont">{$t('reportar.contacto')} <span class="ayuda">({$t('comun.opcional')})</span></label>
      <input id="rcont" bind:value={contacto} inputmode="tel" />

      <button class="btn-primario btn-bloque btn-grande" style="margin-top:1rem"
        on:click={registrar} disabled={enviando}>
        {enviando ? $t('reportar.enviando') : $t('comun.guardar')}
      </button>
    </div>
  {/if}

  <div style="margin-top:1rem">
    {#if items.length === 0}
      <p class="ayuda">{$t('recursos.vacio')}</p>
    {:else}
      {#each items as r (r.id)}
        <div class="tarjeta">
          <div class="tarjeta-row">
            <span class="tag">{$t('cat.' + r.categoria)}</span>
            {#if r.disponible}<span class="tag tag-resuelta">{$t('recursos.disponible')}</span>{/if}
          </div>
          <div style="font-weight:600">{r.sector}</div>
          {#if r.descripcion}<p style="margin:.3rem 0">{r.descripcion}</p>{/if}
          {#if $tiempo.rel(r.creada_en)}<p class="sello" class:viejo={$tiempo.viejo(r.creada_en)} title={$tiempo.abs(r.creada_en)}>{$t('tiempo.subido')} {$tiempo.rel(r.creada_en)}</p>{/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .mapa-titulo { font-weight: 700; margin: 0.9rem 0 0.2rem; }
  .pin-ok { color: var(--verde); font-weight: 600; }
  .sello { margin: 0.25rem 0 0; font-size: 0.76rem; color: var(--gris); font-variant-numeric: tabular-nums; }
  .sello.viejo { color: #b45309; }
  .enlace-ocultar {
    background: none; border: none; min-height: 0; padding: 0.35rem 0;
    color: var(--gris); text-decoration: underline; font-size: 0.85rem;
  }
</style>
