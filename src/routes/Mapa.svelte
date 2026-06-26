<script>
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { normaliza } from '../lib/autocomplete.js';
  import { asegurarSesionAnonima } from '../lib/stores.js';
  import { leerNecesidadesPublicas, leerRecursosPublicos, confirmarNecesidad, yaConfirme } from '../lib/db.js';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

  let items = [];
  let recursos = [];
  let busca = '';   // texto del buscador
  let origen = '';
  let cargando = true;
  let vista = 'lista'; // 'lista' | 'mapa'

  // Filtro del buscador (cliente, insensible a acentos): sector, descripción,
  // categoría y urgencia. La lista y el mapa usan los items filtrados.
  $: filtrados = (() => {
    const q = normaliza(busca);
    if (q.length < 2) return items;
    return items.filter((n) =>
      normaliza(`${n.sector} ${n.descripcion} ${n.categoria} ${n.urgencia}`).includes(q)
    );
  })();
  let seleccion = null; // necesidad abierta en el detalle
  let confirmadas = {}; // id → bool (si este usuario ya confirmó)
  let confirmando = false;
  let cooldown = false;

  // Salvaguarda §22.5: el aislado (pendiente_revision) va SIEMPRE primero y MÁS
  // visible; luego por recencia. Nunca se filtra ni se oculta.
  function ordenar(arr) {
    const peso = (n) => (n.verificacion === 'pendiente_revision' ? 0 : 1);
    return [...arr].sort((a, b) => {
      const d = peso(a) - peso(b);
      if (d !== 0) return d;
      return (b.creada_en?.seconds || 0) - (a.creada_en?.seconds || 0);
    });
  }

  async function cargar(forzarServidor = false) {
    cargando = true;
    try {
      const r = await leerNecesidadesPublicas({ forzarServidor, demo });
      items = ordenar(r.items);
      origen = r.origen;
      // Recursos en el mismo mapa (no en modo demo).
      if (!demo) recursos = await leerRecursosPublicos({ forzarServidor }).catch(() => []);
    } finally {
      cargando = false;
    }
  }

  async function actualizar() {
    if (cooldown) return;
    cooldown = true;
    await cargar(true);
    setTimeout(() => (cooldown = false), 15000); // cooldown anti-abuso de lecturas
  }

  async function abrir(n) {
    seleccion = n;
    if (!demo) confirmadas[n.id] = await yaConfirme(n.id);
  }

  async function confirmar() {
    if (!seleccion || demo) return;
    confirmando = true;
    try {
      await confirmarNecesidad(seleccion.id);
      confirmadas[seleccion.id] = true;
      confirmadas = { ...confirmadas };
    } catch (_) {
      // si ya confirmó o falla, lo reflejamos como confirmado igualmente
      confirmadas[seleccion.id] = true;
    } finally {
      confirmando = false;
    }
  }

  onMount(async () => {
    if (!demo) asegurarSesionAnonima().catch(() => {});
    await cargar(false);
  });
</script>

<div class="contenedor">
  <h1>{$t('mapa.titulo')}</h1>
  <p class="intro">{$t('intro.mapa')}</p>
  <p class="ayuda sector">🛈 {$t('mapa.sector_aviso')}</p>

  <div class="barra">
    <div class="toggle">
      <button class:activo={vista === 'lista'} on:click={() => (vista = 'lista')}>{$t('mapa.lista')}</button>
      <button class:activo={vista === 'mapa'} on:click={() => (vista = 'mapa')}>{$t('mapa.mapa')}</button>
    </div>
    <button class="actualizar" on:click={actualizar} disabled={cooldown || cargando}>
      {cargando ? $t('mapa.actualizando') : $t('mapa.actualizar')}
    </button>
  </div>

  <div class="buscador">
    <input type="search" bind:value={busca} placeholder={$t('mapa.buscar_ph')} aria-label={$t('mapa.buscar_ph')} />
    {#if busca.length >= 2}
      <span class="buscador-n">{filtrados.length} / {items.length}</span>
    {/if}
  </div>

  {#if origen === 'cache'}
    <p class="ayuda">{$t('mapa.desde_cache')}</p>
  {/if}

  {#if cargando && items.length === 0}
    <p class="ayuda">…</p>
  {:else if items.length === 0}
    <p class="ayuda">{$t('mapa.vacio')}</p>
  {:else if vista === 'mapa'}
    <MapaUnificado necesidades={filtrados} {recursos} />
  {:else if filtrados.length === 0}
    <p class="ayuda">{$t('mapa.sin_resultados')}</p>
  {:else}
    {#each filtrados as n (n.id)}
      <button class="tarjeta item {n.verificacion === 'pendiente_revision' ? 'prioritario' : ''}" on:click={() => abrir(n)}>
        {#if n.verificacion === 'pendiente_revision'}
          <div class="badge-prio">★ {$t('mapa.revisar')}</div>
        {/if}
        <div class="tarjeta-row">
          <span class="tag tag-u-{n.urgencia}">{$t('urg.' + n.urgencia)}</span>
          <span class="tag">{$t('cat.' + n.categoria)}</span>
          <span class="tag {n.verificacion === 'confirmada' || n.verificacion === 'verificada' ? 'tag-verif' : 'tag-noverif'}">
            {$t('verif.' + n.verificacion)}
          </span>
          {#if n.confirmaciones}
            <span class="tag">✓ {n.confirmaciones} {$t('mapa.confirmaciones')}</span>
          {/if}
        </div>
        <div class="sector-txt">📍 {n.sector}</div>
        {#if n.descripcion}<p class="desc">{n.descripcion}</p>{/if}
      </button>
    {/each}
  {/if}
</div>

{#if seleccion}
  <div class="overlay" on:click={() => (seleccion = null)} role="presentation">
    <div class="hoja" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="tarjeta-row">
        <span class="tag tag-u-{seleccion.urgencia}">{$t('urg.' + seleccion.urgencia)}</span>
        <span class="tag">{$t('cat.' + seleccion.categoria)}</span>
        <span class="tag {seleccion.verificacion === 'confirmada' || seleccion.verificacion === 'verificada' ? 'tag-verif' : 'tag-noverif'}">
          {$t('verif.' + seleccion.verificacion)}
        </span>
      </div>
      <h2>📍 {seleccion.sector}</h2>
      {#if seleccion.descripcion}<p>{seleccion.descripcion}</p>{/if}

      {#if !demo}
        {#if confirmadas[seleccion.id]}
          <p class="aviso-ok">{$t('mapa.ya_confirmaste')}</p>
        {:else}
          <button class="btn-primario btn-bloque btn-grande" on:click={confirmar} disabled={confirmando}>
            {confirmando ? $t('mapa.confirmando') : $t('mapa.confirmar')}
          </button>
        {/if}
      {/if}

      <details class="ayudar">
        <summary>{$t('mapa.como_ayudar')}</summary>
        <p>{$t('mapa.como_ayudar_texto')}</p>
      </details>

      <button class="btn-bloque" on:click={() => (seleccion = null)}>{$t('mapa.cerrar')}</button>
    </div>
  </div>
{/if}

<style>
  .intro { color: var(--gris); margin: 0 0 0.4rem; }
  .sector { background: var(--gris-claro); padding: 0.4rem 0.6rem; border-radius: var(--radio); }
  .barra { display: flex; gap: 0.5rem; align-items: center; margin: 0.6rem 0; }
  .toggle { display: flex; gap: 0.4rem; flex: 1; }
  .toggle button { flex: 1; }
  .toggle button.activo { background: var(--azul); color: #fff; }
  .actualizar { white-space: nowrap; }
  .buscador { position: relative; margin-bottom: 0.7rem; }
  .buscador input { width: 100%; padding-right: 3.5rem; }
  .buscador-n { position: absolute; right: 0.7rem; top: 50%; transform: translateY(-50%); color: var(--gris); font-size: 0.8rem; font-weight: 600; }
  .item { display: block; width: 100%; text-align: left; cursor: pointer; }
  .item.prioritario { border-color: var(--rojo); border-width: 2px; }
  .badge-prio { background: var(--rojo); color: #fff; font-weight: 700; font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 999px; display: inline-block; margin-bottom: 0.4rem; }
  .sector-txt { font-weight: 600; }
  .desc { margin: 0.3rem 0 0; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center; z-index: 40; }
  .hoja { background: #fff; width: 100%; max-width: 720px; border-radius: 16px 16px 0 0; padding: 1.1rem; max-height: 85vh; overflow:auto; }
  .ayudar { margin: 0.8rem 0; }
  .ayudar summary { font-weight: 700; cursor: pointer; padding: 0.4rem 0; }
</style>
