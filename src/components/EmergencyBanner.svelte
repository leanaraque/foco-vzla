<script>
  import { t, lineasOficiales } from '../lib/i18n.js';
  let abierto = false;
</script>

<!-- Spec §5 / §9-2: nunca prometer rescate; dejar claro que no es servicio de
     emergencia y exponer líneas oficiales en todo momento. -->
<div class="banner" role="note">
  <p>{$t('banner.aviso')}</p>
  <button class="enlace" on:click={() => (abierto = !abierto)} aria-expanded={abierto}>
    {$t('banner.oficiales')} {abierto ? '▲' : '▼'}
  </button>
  {#if abierto}
    <ul>
      {#each lineasOficiales as l}
        <li><strong>{l.nombre}:</strong> {l.detalle}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .banner {
    background: #fff7d6; color: #5a4500; border-bottom: 2px solid var(--amarillo);
    padding: 0.6rem 1rem; font-size: 0.86rem;
  }
  .banner p { margin: 0; }
  .enlace {
    background: none; border: none; padding: 0.3rem 0; min-height: 0;
    color: var(--rojo-osc); font-weight: 700; text-decoration: underline;
  }
  ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
  li { margin: 0.15rem 0; }
</style>
