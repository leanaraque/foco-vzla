<script>
  // Tarjeta de gestión de una solicitud de la comunidad (Resuelto / Corrección).
  // El coordinador la lee y la cierra desde el Panel. "Marcar resuelta" cambia el
  // estado de la NECESIDAD vinculada (resolver) y deja la solicitud como gestionada.
  import { t } from '../lib/i18n.js';
  import { resolver, gestionarSolicitud } from '../lib/db.js';

  export let s; // solicitud

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

  // Cierra el caso: marca la necesidad como resuelta y la solicitud como gestionada.
  async function resolverNecesidad() {
    if (!window.confirm($t('sol.confirma_resolver'))) return;
    error = ''; trabajando = true;
    try {
      await resolver(s.necesidadId);
      await gestionarSolicitud(s.id, 'gestionada');
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

  <div class="acciones">
    <a class="btn-link" href={`/mapa?focus=${s.necesidadId}`}>{$t('sol.ver_mapa')}</a>
    {#if pendiente}
      {#if !esCorr}
        <button class="btn-ok" on:click={resolverNecesidad} disabled={trabajando}>{$t('sol.marcar_resuelta')}</button>
      {/if}
      <button class="btn-primario" on:click={() => gestionar('gestionada')} disabled={trabajando}>{$t('sol.gestionada')}</button>
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
</style>
