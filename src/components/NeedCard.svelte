<script>
  import { t } from '../lib/i18n.js';
  import { reclamar, resolver, reabrir, verificar, invalidar, leerContacto } from '../lib/db.js';

  export let n; // necesidad

  let contacto = null;
  let cargandoContacto = false;
  let trabajando = false;

  async function accion(fn) {
    trabajando = true;
    try { await fn(n.id); } catch (e) { /* offline: se sincroniza luego */ }
    finally { trabajando = false; }
  }

  async function verContacto() {
    cargandoContacto = true;
    try { contacto = await leerContacto(n.id); }
    finally { cargandoContacto = false; }
  }
</script>

<div class="tarjeta">
  <div class="tarjeta-row">
    <span class="tag tag-u-{n.urgencia}">{$t('urg.' + n.urgencia)}</span>
    <span class="tag">{$t('cat.' + n.categoria)}</span>
    <span class="tag tag-{n.estado}">{$t('estado.' + n.estado)}</span>
    <span class="tag {n.verificacion === 'verificada' ? 'tag-verif' : 'tag-noverif'}">
      {$t('verif.' + n.verificacion)}
    </span>
  </div>

  <div class="sector">📍 {n.sector}</div>
  <!-- Procesado §25: prefiere el resumen estandarizado/anclado (claro y sin PII); si
       aún no se procesó, cae al texto crudo de la fuente. -->
  {#if n.resumen || n.descripcion}<p class="desc">{n.resumen || n.descripcion}</p>{/if}

  {#if n.reclamada_por}
    <p class="ayuda">{$t('reclamada_por')}: <code>{n.reclamada_por.slice(0, 6)}</code></p>
  {/if}

  {#if contacto}
    <div class="contacto-box">
      <strong>{contacto.contacto || '—'}</strong>
      {#if contacto.geo_exacta}
        <a href={`https://www.openstreetmap.org/?mlat=${contacto.geo_exacta.lat}&mlon=${contacto.geo_exacta.lng}#map=18/${contacto.geo_exacta.lat}/${contacto.geo_exacta.lng}`}
           target="_blank" rel="noopener">ver punto exacto</a>
      {/if}
    </div>
  {/if}

  <div class="acciones">
    {#if n.estado === 'sin_atender'}
      <button class="btn-primario" on:click={() => accion(reclamar)} disabled={trabajando}>{$t('accion.reclamar')}</button>
    {/if}
    {#if n.estado === 'asignada'}
      <button class="btn-ok" on:click={() => accion(resolver)} disabled={trabajando}>{$t('accion.resolver')}</button>
    {/if}
    {#if n.estado === 'resuelta'}
      <button on:click={() => accion(reabrir)} disabled={trabajando}>{$t('accion.reabrir')}</button>
    {/if}

    <!-- Aprobar manualmente: tanto un caso sin validar como uno ESCALADO por la
         salvaguarda del aislado (pendiente_revision, §22.5). Verificar → verificada.
         En el caso prioritario es la acción esperada de la "revisión del operador",
         por eso resalta. -->
    {#if (n.verificacion === 'no_verificada' || n.verificacion === 'pendiente_revision') && n.estado !== 'cerrada_invalida'}
      <button class={n.verificacion === 'pendiente_revision' ? 'btn-ok' : ''}
        on:click={() => accion(verificar)} disabled={trabajando}>
        {$t(n.verificacion === 'pendiente_revision' ? 'accion.aprobar_revision' : 'accion.verificar')}
      </button>
    {/if}

    <button on:click={verContacto} disabled={cargandoContacto}>
      {cargandoContacto ? '…' : $t('accion.ver_contacto')}
    </button>

    {#if n.estado !== 'cerrada_invalida'}
      <button class="btn-peligro" on:click={() => accion(invalidar)} disabled={trabajando}>{$t('accion.invalidar')}</button>
    {/if}
  </div>
</div>

<style>
  .sector { font-weight: 600; margin-bottom: 0.2rem; }
  .desc { margin: 0.3rem 0; }
  .contacto-box { background: var(--gris-claro); padding: 0.5rem 0.7rem; border-radius: var(--radio); margin: 0.5rem 0; }
  .contacto-box a { display: inline-block; margin-left: 0.5rem; }
  code { background: var(--gris-claro); padding: 0 0.3rem; border-radius: 4px; }
</style>
