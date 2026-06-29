<script>
  // "Qué se necesita y qué hay" — composición por categoría (necesidades vs recursos).
  // Presentación pura: cuenta por categoría en cliente y dibuja dos listas de barras.
  // SWD: una idea por lista, orden por magnitud desc, color con propósito coherente
  // con la brecha (rojo = necesidad, verde = recurso). Sin emojis.
  import { t } from '../lib/i18n.js';

  export let necesidades = [];
  export let recursos = [];
  export let cargando = false;

  function porCategoria(items) {
    const m = new Map();
    for (const it of items) { const c = it.categoria || 'otro'; m.set(c, (m.get(c) || 0) + 1); }
    return [...m.entries()].map(([cat, n]) => ({ cat, n })).sort((a, b) => b.n - a.n);
  }
  $: nec = porCategoria(necesidades);
  $: rec = porCategoria(recursos);
  $: maxNec = Math.max(1, ...nec.map((x) => x.n));
  $: maxRec = Math.max(1, ...rec.map((x) => x.n));
  const pct = (v, m) => (v <= 0 ? 0 : Math.max(4, Math.round((v / m) * 100)));
  // Etiqueta legible de la categoría; si no hay traducción, usa el id crudo. Se deriva
  // de `$t` con `$:` para que REACCIONE al cambiar de idioma (si la dependencia de $t
  // quedara oculta dentro de la función, Svelte no la recomputaría al cambiar locale).
  const makeEtiqueta = (translate) => (c) => { const k = 'cat.' + c; const v = translate(k); return v === k ? c : v; };
  $: etiqueta = makeEtiqueta($t);
</script>

<section class="bloque">
  <h2>{$t('inicio.composicion_titulo')}</h2>
  <p class="lede">{$t('comp.lede')}</p>

  {#if cargando}
    <p class="vacio">{$t('inicio.cargando')}</p>
  {:else if nec.length === 0 && rec.length === 0}
    <p class="vacio">{$t('comp.vacio')}</p>
  {:else}
    <div class="cols">
      <div class="grupo">
        <h3 class="g-nec">{$t('comp.necesita')}</h3>
        <ul>
          {#each nec as r (r.cat)}
            <li>
              <span class="cat">{etiqueta(r.cat)}</span>
              <span class="barra"><span class="fill fill-nec" style="width:{pct(r.n, maxNec)}%"></span></span>
              <span class="val">{r.n}</span>
            </li>
          {/each}
        </ul>
      </div>

      <div class="grupo">
        <h3 class="g-rec">{$t('comp.disponible')}</h3>
        <ul>
          {#each rec as r (r.cat)}
            <li>
              <span class="cat">{etiqueta(r.cat)}</span>
              <span class="barra"><span class="fill fill-rec" style="width:{pct(r.n, maxRec)}%"></span></span>
              <span class="val">{r.n}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</section>

<style>
  .bloque { margin: 0 0 1.6rem; }
  .bloque h2 { font-size: 1.05rem; margin: 0 0 0.25rem; }
  .lede { margin: 0 0 0.8rem; color: var(--gris); font-size: 0.9rem; }

  .cols { display: flex; flex-direction: column; gap: 1.1rem; }
  .grupo h3 { font-size: 0.92rem; margin: 0 0 0.55rem; padding-left: 0.5rem; border-left: 4px solid var(--borde); }
  .g-nec { border-left-color: var(--rojo); }
  .g-rec { border-left-color: var(--verde); }

  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: 5.4rem 1fr auto; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
  .cat { font-size: 0.85rem; color: var(--texto); }
  .barra { background: var(--gris-claro); border-radius: 4px; height: 13px; overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 4px; min-width: 2px; transition: width 0.4s ease; }
  .fill-nec { background: var(--rojo); }
  .fill-rec { background: var(--verde); }
  .val { font-size: 0.82rem; font-weight: 700; font-variant-numeric: tabular-nums; }

  .vacio { background: var(--gris-claro); color: var(--gris); border-radius: var(--radio); padding: 1.2rem 1rem; text-align: center; font-size: 0.88rem; margin: 0; }

  @media (min-width: 560px) {
    .cols { flex-direction: row; }
    .grupo { flex: 1; min-width: 0; }
  }
</style>
