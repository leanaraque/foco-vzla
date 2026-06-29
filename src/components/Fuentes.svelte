<script>
  // "De dónde vienen estos datos" — procedencia, el cierre del marco fuente de verdad.
  // Presentación pura: atribuye cada registro a su origen leyendo (read-only) el campo
  // `creador` (las etiquetas de las cargas) y lo cuenta en cliente. Forward-compatible:
  // si el esquema §25 trae `fuentes[].sistema`, lo prefiere. Sin emojis.
  import { t } from '../lib/i18n.js';

  export let necesidades = [];
  export let recursos = [];
  export let cargando = false;

  // Etiqueta de carga (creador) → nombre de fuente legible.
  const MAPA = {
    TV_EDIF: 'terremotovenezuela.com',
    TVAPP_NEC: 'terremotovenezuela.app', TVAPP_REC: 'terremotovenezuela.app',
    RVE_NEC: 'rescate-ve', RVE_REC: 'rescate-ve',
    AV_REC: 'ayudavenezuela.app',
    ZS_REC: 'zonasegura',
    IMPORT_LAGUAIRA: 'Carga del operador'
  };

  $: todos = [...necesidades, ...recursos];
  // Se referencia `$t('fuentes.ciudadanos')` DENTRO del bloque reactivo para que Svelte
  // rastree la dependencia de idioma y recompute al cambiar locale (si la llamada a $t
  // viviera oculta en una función auxiliar, el cambio de idioma no recomputaría).
  $: fuentes = (() => {
    const ciudadanos = $t('fuentes.ciudadanos'); // uids reales → reportes ciudadanos
    const fuenteDe = (it) => {
      const sis = Array.isArray(it.fuentes) && it.fuentes[0]?.sistema; // §25 (futuro)
      if (sis) return sis;
      return MAPA[it.creador || ''] || ciudadanos;
    };
    const m = new Map();
    for (const it of todos) { const f = fuenteDe(it); m.set(f, (m.get(f) || 0) + 1); }
    return [...m.entries()].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
  })();
  $: total = todos.length;
  $: max = Math.max(1, ...fuentes.map((f) => f.n));
  const pct = (v, m) => (v <= 0 ? 0 : Math.max(3, Math.round((v / m) * 100)));
</script>

<section class="bloque">
  <h2>{$t('inicio.confianza_titulo')}</h2>
  <p class="lede">{$t('fuentes.lede')}</p>

  {#if cargando}
    <p class="vacio">{$t('inicio.cargando')}</p>
  {:else if fuentes.length === 0}
    <p class="confianza-txt">{$t('inicio.confianza_txt')}</p>
  {:else}
    <ul class="lista">
      {#each fuentes as f (f.nombre)}
        <li>
          <span class="nom">{f.nombre}</span>
          <span class="barra"><span class="fill" style="width:{pct(f.n, max)}%"></span></span>
          <span class="val">{f.n}</span>
        </li>
      {/each}
    </ul>
    <p class="total">{total} {$t('fuentes.total')}</p>
    <p class="confianza-txt">{$t('inicio.confianza_txt')}</p>
  {/if}
</section>

<style>
  .bloque { margin: 0 0 1.6rem; }
  .bloque h2 { font-size: 1.05rem; margin: 0 0 0.25rem; }
  .lede { margin: 0 0 0.8rem; color: var(--gris); font-size: 0.9rem; }

  .lista { list-style: none; margin: 0 0 0.5rem; padding: 0; }
  .lista li { display: grid; grid-template-columns: 9.5rem 1fr auto; align-items: center; gap: 0.5rem; padding: 0.28rem 0; }
  .nom { font-size: 0.85rem; }
  .barra { background: var(--gris-claro); border-radius: 4px; height: 12px; overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--azul-claro); border-radius: 4px; min-width: 2px; transition: width 0.4s ease; }
  .val { font-size: 0.82rem; font-weight: 700; font-variant-numeric: tabular-nums; }

  .total { margin: 0 0 0.8rem; color: var(--gris); font-size: 0.8rem; font-weight: 600; }
  .confianza-txt { color: var(--gris); font-size: 0.88rem; margin: 0; }
  .vacio { background: var(--gris-claro); color: var(--gris); border-radius: var(--radio); padding: 1.2rem 1rem; text-align: center; font-size: 0.88rem; margin: 0; }
</style>
