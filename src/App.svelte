<script>
  import { onMount } from 'svelte';
  import { t } from './lib/i18n.js';
  import { online } from './lib/stores.js';
  import EmergencyBanner from './components/EmergencyBanner.svelte';
  import Mapa from './routes/Mapa.svelte';
  import Reportar from './routes/Reportar.svelte';
  import Panel from './routes/Panel.svelte';
  import Recursos from './routes/Recursos.svelte';

  const REPO = 'https://github.com/leanaraque/foco-vzla';
  const SUGERENCIAS = 'https://tally.so/r/A70rVk';

  let descargandoCsv = false;
  async function descargarCsv() {
    if (descargandoCsv) return;
    descargandoCsv = true;
    try {
      const { exportarNecesidadesCsv } = await import('./lib/db.js');
      const { csv } = await exportarNecesidadesCsv();
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `foco-venezuela-necesidades-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert($t('comun.error'));
    } finally {
      descargandoCsv = false;
    }
  }

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
    { p: '/mapa', k: 'nav.mapa' },
    { p: '/reportar', k: 'nav.reportar' },
    { p: '/recursos', k: 'nav.recursos' },
    { p: '/panel', k: 'nav.panel' }
  ];

  $: vista =
    ruta.startsWith('/reportar') ? 'reportar' :
    ruta.startsWith('/panel') ? 'panel' :
    ruta.startsWith('/recursos') ? 'recursos' :
    'mapa'; // raíz e desconocido → mapa público (entrada del pivote §22)
</script>

<header class="cab">
  <a href="/mapa" class="marca" on:click={(e) => navegar('/mapa', e)}>
    <img src="/favicon.svg" alt="" width="34" height="34" />
    <span class="marca-txt">
      <span class="marca-nombre">{$t('app.nombre')}</span>
      <span class="marca-slogan">{$t('app.slogan')}</span>
    </span>
  </a>
  {#if !$online}
    <span class="offline" title={$t('comun.sin_conexion')}>● {$t('comun.sin_conexion')}</span>
  {/if}
</header>

<!-- Banner permanente (Spec §5 y DoD §8): visible en TODAS las vistas -->
<EmergencyBanner />

<main>
  {#if vista === 'mapa'}
    <Mapa />
  {:else if vista === 'reportar'}
    <Reportar />
  {:else if vista === 'panel'}
    <Panel />
  {:else if vista === 'recursos'}
    <Recursos />
  {/if}
</main>

<footer class="pie">
  <a class="pie-btn" href={SUGERENCIAS} target="_blank" rel="noopener">{$t('footer.sugerencias')}</a>
  <button class="pie-btn" on:click={descargarCsv} disabled={descargandoCsv}>
    {descargandoCsv ? $t('footer.csv_cargando') : $t('footer.csv')}
  </button>
  <a class="pie-btn repo" href={REPO} target="_blank" rel="noopener" title={$t('footer.repo_desc')}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
    {$t('footer.repo')}
  </a>
</footer>

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
  .marca { display: flex; align-items: center; gap: 0.55rem; color: #fff; text-decoration: none; }
  .marca-txt { display: flex; flex-direction: column; line-height: 1.1; }
  .marca-nombre { font-weight: 800; font-size: 1.15rem; letter-spacing: 0.3px; }
  .marca-slogan { font-size: 0.72rem; font-weight: 500; color: rgba(255,255,255,0.82); }
  .offline { background: var(--amarillo); color: #4a3b00; font-weight: 700; font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 999px; }

  /* La tabbar es fija abajo; reservamos su alto para que NADA quede tapado. */
  :global(body) { padding-bottom: 3.5rem; }
  main { padding-bottom: 0.5rem; }

  /* Footer en FLUJO normal (no fijo): aparece al final del contenido, sobre la
     tabbar, y nunca se superpone a los mapas (antes era fixed y los tapaba). */
  .pie {
    display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap;
    background: var(--bg); border-top: 1px solid var(--borde);
    padding: 0.7rem 0.6rem; margin-top: 1rem;
  }
  .pie-btn {
    display: inline-flex; align-items: center; gap: 0.3rem;
    background: #fff; border: 1px solid var(--borde); border-radius: 999px;
    padding: 0.35rem 0.7rem; font-size: 0.82rem; font-weight: 600;
    color: var(--azul); text-decoration: none; min-height: 0; cursor: pointer;
  }
  .pie-btn:active { transform: translateY(1px); }
  .pie-btn[disabled] { opacity: 0.6; }
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
