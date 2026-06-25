<script>
  import { onDestroy } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { online, asegurarSesionAnonima } from '../lib/stores.js';
  import { crearRecurso, suscribirRecursos } from '../lib/db.js';

  const categorias = ['agua', 'transporte', 'refugio', 'medico', 'alimento', 'otro'];

  let mostrarForm = false;
  let categoria = '';
  let sector = '';
  let descripcion = '';
  let contacto = '';
  let lat = null, lng = null, gpsEstado = '';
  let enviando = false, error = '', okMsg = '';

  let items = [];
  const unsub = suscribirRecursos((data) => (items = data));
  onDestroy(() => unsub && unsub());

  function usarGps() {
    if (!navigator.geolocation) { gpsEstado = 'error'; return; }
    gpsEstado = 'buscando';
    navigator.geolocation.getCurrentPosition(
      (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; gpsEstado = 'ok'; },
      () => { gpsEstado = 'error'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  async function registrar() {
    error = ''; okMsg = '';
    if (!categoria) { error = $t('comun.error'); return; }
    if (!sector && !(lat && lng)) { error = $t('reportar.falta_ubicacion'); return; }
    enviando = true;
    try {
      await asegurarSesionAnonima();
      const { listo } = crearRecurso({
        categoria, sector: sector || '(sin sector)', descripcion,
        lat, lng, contacto: contacto.trim()
      });
      if ($online) await listo; else listo.catch(() => {});
      okMsg = $t('reportar.ok');
      categoria = ''; sector = ''; descripcion = ''; contacto = ''; lat = null; lng = null; gpsEstado = '';
      mostrarForm = false;
    } catch (e) { error = $t('comun.error'); }
    finally { enviando = false; }
  }
</script>

<div class="contenedor">
  <h1>{$t('recursos.titulo')}</h1>

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
      <input id="rsector" bind:value={sector} />
      <button type="button" class="btn-bloque" style="margin-top:.5rem" on:click={usarGps}>
        📍 {$t('reportar.usar_gps')} {gpsEstado === 'ok' ? '✓' : gpsEstado === 'buscando' ? '…' : gpsEstado === 'error' ? '⚠' : ''}
      </button>

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
          <div style="font-weight:600">📍 {r.sector}</div>
          {#if r.descripcion}<p style="margin:.3rem 0">{r.descripcion}</p>{/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
