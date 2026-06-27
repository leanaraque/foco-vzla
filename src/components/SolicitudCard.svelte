<script>
  // Tarjeta de gestión de una solicitud de la comunidad (Resuelto / Corrección).
  // - Resuelto ("ya recibieron ayuda"): cerrar el reporte (resolver) o descartar.
  // - Corrección: "Gestionar" despliega un EDITOR del reporte (urgencia, categoría,
  //   descripción, sector, contacto y ubicación) para aplicar la corrección. Como las
  //   rules prohíben que el coordinador reescriba contenido (F3), la edición pasa por
  //   la Cloud Function `editarNecesidad` (Admin SDK + rol). Al aplicar, marca la
  //   solicitud gestionada.
  import { t } from '../lib/i18n.js';
  import { resolver, gestionarSolicitud, leerNecesidad, leerContacto, aplicarEdicionNecesidad } from '../lib/db.js';
  import { geoPublico } from '../lib/geo.js';
  import MapaUnificado from './MapaUnificado.svelte';

  export let s; // solicitud

  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'transporte', 'acopio', 'servicios', 'otro'];
  const urgencias = ['critica', 'alta', 'media'];

  let trabajando = false, error = '';
  const esCorr = s.tipo === 'correccion';
  $: pendiente = (s.estado || 'pendiente') === 'pendiente';

  function fecha(ts) {
    try { return ts?.toDate ? ts.toDate().toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
    catch (_) { return ''; }
  }

  async function gestionar(estado) {
    error = ''; trabajando = true;
    try { await gestionarSolicitud(s.id, estado); }
    catch (e) { error = $t('sol.error'); }
    finally { trabajando = false; }
  }

  // Cierra el caso de "ya recibieron ayuda": marca la necesidad resuelta + gestionada.
  async function resolverNecesidad() {
    if (!window.confirm($t('sol.confirma_resolver'))) return;
    error = ''; trabajando = true;
    try {
      await resolver(s.necesidadId);
      await gestionarSolicitud(s.id, 'gestionada');
    } catch (e) { error = $t('sol.error'); }
    finally { trabajando = false; }
  }

  // --- Editor de la corrección ---
  let editando = false, cargandoEdit = false;
  let eUrgencia = '', eCategoria = '', eDescripcion = '', eSector = '', eContacto = '';
  let ePinLat = null, ePinLng = null, eCentro = null;
  let iniLat = null, iniLng = null, oContacto = '';

  async function abrirEditor() {
    error = ''; editando = true; cargandoEdit = true;
    try {
      const nec = await leerNecesidad(s.necesidadId);
      if (!nec) { error = $t('sol.error'); editando = false; return; }
      eUrgencia = nec.urgencia || 'media';
      eCategoria = nec.categoria || 'otro';
      eDescripcion = nec.descripcion || '';
      eSector = nec.sector || '';
      iniLat = nec.geo?.lat ?? null; iniLng = nec.geo?.lng ?? null;
      eCentro = (iniLat != null) ? { lat: iniLat, lng: iniLng } : null;
      ePinLat = iniLat; ePinLng = iniLng;
      const priv = await leerContacto(s.necesidadId).catch(() => null);
      oContacto = priv?.contacto || '';
      eContacto = oContacto;
    } catch (e) { error = $t('sol.error'); }
    finally { cargandoEdit = false; }
  }
  function cerrarEditor() { editando = false; }

  async function aplicar() {
    error = ''; trabajando = true;
    try {
      // Se envían los campos editados; el contacto solo si cambió (no crear privado
      // vacío) y la ubicación solo si el coordinador movió el pin.
      const cambios = {
        necesidadId: s.necesidadId, solicitudId: s.id,
        nota: 'Corrección aplicada por el coordinador.',
        urgencia: eUrgencia, categoria: eCategoria, descripcion: eDescripcion
      };
      if (eSector.trim()) cambios.sector = eSector.trim();
      if (eContacto !== oContacto) cambios.contacto = eContacto.trim();
      const movido = ePinLat != null && iniLat != null &&
        (Math.abs(ePinLat - iniLat) > 1e-7 || Math.abs(ePinLng - iniLng) > 1e-7);
      if (movido) {
        cambios.geo = geoPublico(ePinLat, ePinLng);   // pública aproximada + geohash
        cambios.geo_exacta = { lat: ePinLat, lng: ePinLng };
      }
      await aplicarEdicionNecesidad(cambios);
      editando = false;
    } catch (e) { error = $t('sol.error'); }
    finally { trabajando = false; }
  }
</script>

<div class="tarjeta sol {pendiente ? '' : 'cerrada'}">
  <div class="sol-cab">
    <span class="tag tipo {esCorr ? 'tipo-corr' : 'tipo-res'}">
      {$t(esCorr ? 'sol.tipo_correccion' : 'sol.tipo_resuelto')}
    </span>
    {#if !pendiente}
      <span class="tag estado">{$t(s.estado === 'descartada' ? 'sol.estado_descartada' : 'sol.estado_gestionada')}</span>
    {/if}
    <span class="fecha">{fecha(s.creada_en)}</span>
  </div>

  <div class="ctx">
    <span class="ctx-label">{$t('sol.contexto')}</span>
    <strong class="sector">{s.sector || $t('sol.sin_dato')}</strong>
    <div class="ctx-row">
      {#if s.categoria}<span class="tag">{$t('cat.' + s.categoria)}</span>{/if}
      {#if s.urgencia}<span class="tag tag-u-{s.urgencia}">{$t('urg.' + s.urgencia)}</span>{/if}
    </div>
    {#if s.descripcion}<p class="desc">{s.descripcion}</p>{/if}
  </div>

  <div class="aporte">
    {#if esCorr}
      <p class="campo"><span class="campo-l">{$t('sol.detalle')}</span>{s.detalle || $t('sol.sin_dato')}</p>
    {:else}
      <p class="campo"><span class="campo-l">{$t('sol.motivo')}</span>{s.motivo || $t('sol.sin_dato')}</p>
      <p class="campo"><span class="campo-l">{$t('sol.fuente')}</span>{s.fuente || $t('sol.sin_dato')}</p>
    {/if}
    <p class="campo"><span class="campo-l">{$t('sol.contacto')}</span>{s.contacto || $t('sol.sin_dato')}</p>
  </div>

  {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}

  {#if editando}
    <div class="editor">
      <h4>{$t('sol.edit_titulo')}</h4>
      {#if cargandoEdit}
        <p class="ayuda">{$t('sol.edit_cargando')}</p>
      {:else}
        <p class="edit-intro">{$t('sol.edit_intro')}</p>

        <label for="e-urg-{s.id}">{$t('sol.edit_urgencia')}</label>
        <select id="e-urg-{s.id}" bind:value={eUrgencia}>
          {#each urgencias as u}<option value={u}>{$t('urg.' + u)}</option>{/each}
        </select>

        <label for="e-cat-{s.id}">{$t('sol.edit_categoria')}</label>
        <select id="e-cat-{s.id}" bind:value={eCategoria}>
          {#each categorias as c}<option value={c}>{$t('cat.' + c)}</option>{/each}
        </select>

        <label for="e-sec-{s.id}">{$t('sol.edit_sector')}</label>
        <input id="e-sec-{s.id}" type="text" maxlength="140" bind:value={eSector} />

        <label for="e-desc-{s.id}">{$t('sol.edit_descripcion')}</label>
        <textarea id="e-desc-{s.id}" maxlength="500" bind:value={eDescripcion}></textarea>

        <label for="e-con-{s.id}">{$t('sol.edit_contacto')}</label>
        <input id="e-con-{s.id}" type="text" maxlength="140" bind:value={eContacto} />

        <span class="map-label">{$t('sol.edit_ubicacion')}</span>
        {#if eCentro}
          <MapaUnificado conPin bind:lat={ePinLat} bind:lng={ePinLng} centro={eCentro}
            necesidades={[]} recursos={[]} alto="220px" />
        {/if}
        <p class="ayuda">{$t('sol.edit_ubicacion_nota')}</p>

        <div class="edit-acciones">
          <button class="btn-ok" on:click={aplicar} disabled={trabajando}>
            {trabajando ? $t('sol.edit_aplicando') : $t('sol.edit_aplicar')}
          </button>
          <button on:click={cerrarEditor} disabled={trabajando}>{$t('sol.edit_cancelar')}</button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="acciones">
    <a class="btn-link" href={`/mapa?focus=${s.necesidadId}`}>{$t('sol.ver_mapa')}</a>
    {#if pendiente && !editando}
      {#if esCorr}
        <button class="btn-primario" on:click={abrirEditor} disabled={trabajando}>{$t('sol.gestionar')}</button>
      {:else}
        <button class="btn-ok" on:click={resolverNecesidad} disabled={trabajando}>{$t('sol.marcar_resuelta')}</button>
      {/if}
      <button class="btn-peligro" on:click={() => gestionar('descartada')} disabled={trabajando}>{$t('sol.descartar')}</button>
    {/if}
  </div>
</div>

<style>
  .sol { border-left: 4px solid var(--azul, #0b3d5c); }
  .sol.cerrada { opacity: 0.6; }
  .sol-cab { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .fecha { color: var(--texto-suave, #667); font-size: 0.78rem; margin-left: auto; }
  .tipo { color: #fff; }
  .tipo-res { background: #2a9d54; }
  .tipo-corr { background: #0b3d5c; }
  .estado { background: var(--gris-claro, #eef1f4); color: #334; }
  .ctx { background: var(--gris-claro, #eef1f4); padding: 0.5rem 0.7rem; border-radius: var(--radio, 8px); margin-bottom: 0.5rem; }
  .ctx-label { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--texto-suave, #667); }
  .sector { display: block; margin: 0.1rem 0 0.3rem; }
  .ctx-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .desc { margin: 0.4rem 0 0; font-size: 0.9rem; }
  .aporte { margin-bottom: 0.5rem; }
  .campo { margin: 0.25rem 0; font-size: 0.9rem; }
  .campo-l { display: block; font-weight: 700; font-size: 0.78rem; color: var(--texto-suave, #667); }
  .acciones { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .btn-link { align-self: center; font-weight: 600; }

  .editor { border: 1px solid var(--borde, #d8dee4); border-radius: var(--radio, 8px); padding: 0.7rem; margin-bottom: 0.6rem; background: #fff; }
  .editor h4 { margin: 0 0 0.3rem; }
  .edit-intro { font-size: 0.85rem; color: var(--texto-suave, #667); margin: 0 0 0.5rem; }
  .editor label { display: block; font-weight: 700; font-size: 0.8rem; margin: 0.5rem 0 0.15rem; }
  .editor input, .editor select, .editor textarea { width: 100%; }
  .editor textarea { min-height: 64px; }
  .map-label { display: block; font-weight: 700; font-size: 0.8rem; margin: 0.6rem 0 0.25rem; }
  .edit-acciones { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.6rem; }
</style>
