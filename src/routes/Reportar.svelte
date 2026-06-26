<script>
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { online, asegurarSesionAnonima } from '../lib/stores.js';
  import { crearNecesidad, leerNecesidadesPublicas, leerRecursosPublicos } from '../lib/db.js';
  import LugarAutocomplete from '../components/LugarAutocomplete.svelte';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  // Contexto del mapa: las necesidades/recursos ya cargados (caché-primero, barato)
  // para que el mapa de reporte sea EL MISMO que el de /mapa (muestra lo existente).
  let ctxNec = [], ctxRec = [];
  onMount(async () => {
    try { const r = await leerNecesidadesPublicas({}); ctxNec = r.items; } catch (_) {}
    try { ctxRec = await leerRecursosPublicos({}); } catch (_) {}
  });

  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'otro'];
  const urgencias = ['critica', 'alta', 'media'];

  let categoria = '';
  let urgencia = 'alta';
  let sector = '';           // texto del campo de ubicación (libre o nombre del lugar)
  let referencia = null;     // lugar elegido del autocompletado { nombre, lat, lng, sectorGeo, municipio }
  let descripcion = '';
  let contacto = '';
  let lat = null;            // GPS preciso (solo si la persona lo usa)
  let lng = null;
  let gpsEstado = ''; // '', 'buscando', 'ok', 'error'

  // Selector de pin en mapa (punto exacto calle/edificio) — camino SUGERIDO,
  // visible por defecto para mejorar la exactitud.
  let mostrarMapa = true;
  let pinLat = null, pinLng = null;     // posición del pin (punto exacto del usuario)
  let centroMapa = null;                // { lat, lng } para recentrar el mapa

  let enviando = false;
  let resultado = ''; // '', 'ok', 'ok_offline'
  let error = '';

  function usarGps() {
    if (!navigator.geolocation) { gpsEstado = 'error'; return; }
    gpsEstado = 'buscando';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        gpsEstado = 'ok';
        // El GPS recentra/posiciona el pin del mapa también.
        centroMapa = { lat, lng };
        mostrarMapa = true;
      },
      () => { gpsEstado = 'error'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  // Al elegir un lugar del autocompletado, centra el mapa ahí para afinar el pin.
  function onLugar(e) {
    const l = e.detail;
    if (l && Number.isFinite(l.lat)) centroMapa = { lat: l.lat, lng: l.lng };
  }

  async function enviar() {
    error = '';
    if (!categoria) { error = $t('reportar.categoria'); return; }
    const hayPin = pinLat != null && pinLng != null;
    if (!sector && !referencia && !(lat && lng) && !hayPin) { error = $t('reportar.falta_ubicacion'); return; }

    enviando = true;
    try {
      await asegurarSesionAnonima();
      // Punto EXACTO (→ privado, geo_exacta): el pin del mapa si el usuario lo marcó,
      // o el GPS. Es lo más preciso que el coordinador necesita para llegar.
      // referencia = lugar elegido (→ zona pública correcta). El mapa público siempre
      // muestra a nivel sector (§9-1, §22.11).
      const exacto = hayPin ? { lat: pinLat, lng: pinLng }
                   : (lat != null && lng != null ? { lat, lng } : null);
      const { listo } = crearNecesidad({
        categoria, urgencia,
        sector: sector || (referencia ? referencia.nombre : '(sin sector — ver mapa)'),
        descripcion,
        gps: exacto,
        referencia,
        contacto: contacto.trim()
      });

      if ($online) {
        await listo;            // confirmación del servidor
        resultado = 'ok';
      } else {
        resultado = 'ok_offline'; // ya quedó en cola local; sincroniza al reconectar
        listo.catch(() => {});    // evita unhandledrejection mientras está offline
      }
    } catch (e) {
      error = $t('comun.error');
    } finally {
      enviando = false;
    }
  }

  function reset() {
    categoria = ''; urgencia = 'alta'; sector = ''; referencia = null; descripcion = '';
    contacto = ''; lat = null; lng = null; gpsEstado = ''; resultado = ''; error = '';
    mostrarMapa = false; pinLat = null; pinLng = null; centroMapa = null;
  }
</script>

<div class="contenedor">
  {#if resultado}
    <div class="aviso-ok" role="status">
      <p><strong>{$t(resultado === 'ok_offline' ? 'reportar.ok_offline' : 'reportar.ok')}</strong></p>
      <button class="btn-primario btn-bloque" on:click={reset}>{$t('reportar.otro')}</button>
    </div>
  {:else}
    <h1>{$t('reportar.titulo')}</h1>
    <p class="intro-seg">{$t('intro.reportar')}</p>

    {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}

    <label id="lbl-cat">{$t('reportar.categoria')}</label>
    <div class="chips" role="group" aria-labelledby="lbl-cat">
      {#each categorias as c}
        <button type="button" class="chip" aria-pressed={categoria === c}
          on:click={() => (categoria = c)}>{$t('cat.' + c)}</button>
      {/each}
    </div>

    <label id="lbl-urg">{$t('reportar.urgencia')}</label>
    <div class="chips" role="group" aria-labelledby="lbl-urg">
      {#each urgencias as u}
        <button type="button" class="chip chip-urg u-{u}" aria-pressed={urgencia === u}
          on:click={() => (urgencia = u)}>{$t('urg.' + u)}</button>
      {/each}
    </div>

    <label for="sector">{$t('reportar.ubicacion')}</label>
    <LugarAutocomplete
      bind:valor={sector}
      bind:elegido={referencia}
      on:seleccion={onLugar}
    />
    <p class="ayuda">{$t('reportar.ubicacion_ayuda')}</p>
    <div style="margin-top:.5rem">
      <button type="button" class="btn-bloque" on:click={usarGps}>
        📍 {$t('reportar.usar_gps')}
        {#if gpsEstado === 'buscando'}…{:else if gpsEstado === 'ok'}✓{:else if gpsEstado === 'error'}⚠{/if}
      </button>
    </div>

    <!-- Punto exacto (calle/edificio) — camino SUGERIDO, visible por defecto. -->
    {#if mostrarMapa}
      <div class="mapa-titulo">{$t('reportar.mapa_titulo')}</div>
      <p class="ayuda">{$t('reportar.mapa_ayuda')}</p>
      <MapaUnificado conPin bind:lat={pinLat} bind:lng={pinLng} centro={centroMapa} necesidades={ctxNec} recursos={ctxRec} alto="300px" />
      {#if pinLat != null}
        <p class="ayuda pin-ok">✓ {$t('reportar.mapa_marcado')}</p>
      {/if}
      <button type="button" class="enlace-ocultar" on:click={() => (mostrarMapa = false)}>
        {$t('reportar.mapa_ocultar')}
      </button>
    {:else}
      <button type="button" class="btn-bloque" style="margin-top:.5rem" on:click={() => (mostrarMapa = true)}>
        {$t('reportar.mapa_toggle')}{#if pinLat != null} ✓{/if}
      </button>
    {/if}

    <label for="desc">{$t('reportar.descripcion')}</label>
    <textarea id="desc" bind:value={descripcion} maxlength="500"
      placeholder="¿Cuántas personas? ¿Qué exactamente?"></textarea>
    <p class="aviso-publico">{$t('reportar.descripcion_aviso')}</p>

    <label for="contacto">{$t('reportar.contacto')} <span class="ayuda">({$t('comun.opcional')})</span></label>
    <input id="contacto" bind:value={contacto} inputmode="tel" placeholder="Teléfono o WhatsApp" />
    <p class="ayuda">{$t('reportar.contacto_ayuda')}</p>

    <button class="btn-primario btn-bloque btn-grande" style="margin-top:1rem"
      on:click={enviar} disabled={enviando}>
      {enviando ? $t('reportar.enviando') : $t('reportar.enviar')}
    </button>
  {/if}
</div>

<style>
  .mapa-titulo { font-weight: 700; margin: 0.9rem 0 0.2rem; }
  .pin-ok { color: var(--verde); font-weight: 600; }
  .enlace-ocultar {
    background: none; border: none; min-height: 0; padding: 0.35rem 0;
    color: var(--gris); text-decoration: underline; font-size: 0.85rem;
  }
</style>
