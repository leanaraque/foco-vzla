<script>
  import { t } from '../lib/i18n.js';
  import { online, asegurarSesionAnonima } from '../lib/stores.js';
  import { crearNecesidad } from '../lib/db.js';

  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'otro'];
  const urgencias = ['critica', 'alta', 'media'];

  let categoria = '';
  let urgencia = 'alta';
  let sector = '';
  let descripcion = '';
  let contacto = '';
  let lat = null;
  let lng = null;
  let gpsEstado = ''; // '', 'buscando', 'ok', 'error'

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
      },
      () => { gpsEstado = 'error'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  async function enviar() {
    error = '';
    if (!categoria) { error = $t('reportar.categoria'); return; }
    if (!sector && !(lat && lng)) { error = $t('reportar.falta_ubicacion'); return; }

    enviando = true;
    try {
      await asegurarSesionAnonima();
      // Si no hay GPS, usamos un centro aproximado por defecto (se ajustará por el
      // sector textual). Mantiene el flujo bajo 60s sin bloquear por permisos.
      const fLat = lat ?? 10.49; // ~Morón/Carabobo, zona del evento
      const fLng = lng ?? -68.20;

      const { listo } = crearNecesidad({
        categoria, urgencia,
        sector: sector || '(sin sector — ver mapa)',
        descripcion, lat: fLat, lng: fLng,
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
    categoria = ''; urgencia = 'alta'; sector = ''; descripcion = '';
    contacto = ''; lat = null; lng = null; gpsEstado = ''; resultado = ''; error = '';
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
    <input id="sector" bind:value={sector} placeholder="Ej: Morón, sector La Playa, calle 3" />
    <div style="margin-top:.5rem">
      <button type="button" class="btn-bloque" on:click={usarGps}>
        📍 {$t('reportar.usar_gps')}
        {#if gpsEstado === 'buscando'}…{:else if gpsEstado === 'ok'}✓{:else if gpsEstado === 'error'}⚠{/if}
      </button>
    </div>

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
