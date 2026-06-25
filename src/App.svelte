<script>
  import { onMount } from 'svelte';
  import { t } from './lib/i18n.js';
  import { online } from './lib/stores.js';
  import EmergencyBanner from './components/EmergencyBanner.svelte';
  import Reportar from './routes/Reportar.svelte';
  import Panel from './routes/Panel.svelte';
  import Recursos from './routes/Recursos.svelte';

  // Router mínimo por pathname (sin dependencia). Hosting reescribe a index.html.
  let ruta = window.location.pathname;

  function navegar(p, e) {
    if (e) e.preventDefault();
    if (p !== ruta) {
      history.pushState({}, '', p);
      ruta = p;
      window.scrollTo(0, 0);
    }
  }
  onMount(() => {
    const onPop = () => (ruta = window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  const nav = [
    { p: '/reportar', k: 'nav.reportar' },
    { p: '/panel', k: 'nav.panel' },
    { p: '/recursos', k: 'nav.recursos' }
  ];

  $: vista =
    ruta.startsWith('/panel') ? 'panel' :
    ruta.startsWith('/recursos') ? 'recursos' :
    'reportar'; // raíz e desconocido → reportar (camino del afectado)
</script>

<header class="cab">
  <a href="/reportar" class="marca" on:click={(e) => navegar('/reportar', e)}>
    <img src="/favicon.svg" alt="" width="28" height="28" />
    <span>{$t('app.nombre')}</span>
  </a>
  {#if !$online}
    <span class="offline" title={$t('comun.sin_conexion')}>● {$t('comun.sin_conexion')}</span>
  {/if}
</header>

<!-- Banner permanente (Spec §5 y DoD §8): visible en TODAS las vistas -->
<EmergencyBanner />

<main>
  {#if vista === 'reportar'}
    <Reportar />
  {:else if vista === 'panel'}
    <Panel />
  {:else if vista === 'recursos'}
    <Recursos />
  {/if}
</main>

<nav class="tabbar">
  {#each nav as item}
    <a
      href={item.p}
      class:activo={vista === item.k.split('.')[1]}
      on:click={(e) => navegar(item.p, e)}
    >{$t(item.k)}</a>
  {/each}
</nav>

<style>
  .cab {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1rem; background: var(--azul); color: #fff;
    position: sticky; top: 0; z-index: 20;
  }
  .marca { display: flex; align-items: center; gap: 0.5rem; color: #fff; text-decoration: none; font-weight: 800; font-size: 1.15rem; letter-spacing: 0.5px; }
  .offline { background: var(--amarillo); color: #4a3b00; font-weight: 700; font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 999px; }
  main { padding-bottom: 4rem; }
  .tabbar {
    position: fixed; bottom: 0; left: 0; right: 0; display: flex;
    background: #fff; border-top: 1px solid var(--borde); z-index: 20;
  }
  .tabbar a {
    flex: 1; text-align: center; padding: 0.8rem 0; text-decoration: none;
    color: var(--gris); font-weight: 600; font-size: 0.9rem;
  }
  .tabbar a.activo { color: var(--azul); box-shadow: inset 0 3px 0 var(--azul); }
</style>
