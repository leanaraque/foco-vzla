<script>
  // "Dónde está la brecha" — barras horizontales por zona (necesidades vs recursos).
  // Presentación pura: recibe los arrays ya leídos y agrupa con regiones.js. SWD:
  // escala compartida, orden por necesidad desc, color con propósito (rojo=necesidad,
  // verde=recurso). La brecha visual (roja larga vs verde corta) es el mensaje.
  import { t } from '../lib/i18n.js';
  import { agruparPorZona } from '../lib/regiones.js';

  export let necesidades = [];
  export let recursos = [];
  export let cargando = false;

  $: zonas = agruparPorZona(necesidades, recursos);
  // Escala compartida entre ambas series para que las barras sean comparables.
  $: max = Math.max(1, ...zonas.map((z) => Math.max(z.nec, z.rec)));
  // Una barra con dato > 0 nunca baja de 4% para que se vea.
  const pct = (v, m) => (v <= 0 ? 0 : Math.max(4, Math.round((v / m) * 100)));
</script>

<section class="bloque">
  <h2>{$t('brecha.titulo')}</h2>
  <p class="lede">{$t('brecha.lede')}</p>

  <div class="leyenda" aria-hidden="true">
    <span class="ll"><i class="sw sw-nec"></i>{$t('brecha.necesidades')}</span>
    <span class="ll"><i class="sw sw-rec"></i>{$t('brecha.recursos')}</span>
  </div>

  {#if cargando}
    <p class="vacio">{$t('inicio.cargando')}</p>
  {:else if zonas.length === 0}
    <p class="vacio">{$t('brecha.vacio')}</p>
  {:else}
    <ul class="zonas">
      {#each zonas as z (z.id)}
        <li class="zona">
          <div class="zona-nom">{z.nombre}</div>
          <div class="par">
            <div class="barra">
              <span class="fill fill-nec" style="width:{pct(z.nec, max)}%"></span>
              <span class="val">{z.nec}</span>
            </div>
            <div class="barra">
              <span class="fill fill-rec" style="width:{pct(z.rec, max)}%"></span>
              <span class="val">{z.rec}</span>
            </div>
          </div>
        </li>
      {/each}
    </ul>
    <p class="nota">{$t('brecha.nota')}</p>
  {/if}
</section>

<style>
  .bloque { margin: 0 0 1.6rem; }
  .bloque h2 { font-size: 1.05rem; margin: 0 0 0.25rem; }
  .lede { margin: 0 0 0.7rem; color: var(--gris); font-size: 0.9rem; }

  .leyenda { display: flex; gap: 1rem; margin-bottom: 0.6rem; font-size: 0.8rem; color: var(--gris); }
  .ll { display: inline-flex; align-items: center; gap: 0.35rem; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .sw-nec { background: var(--rojo); }
  .sw-rec { background: var(--verde); }

  .zonas { list-style: none; margin: 0; padding: 0; }
  .zona { padding: 0.55rem 0; border-bottom: 1px solid var(--gris-claro); }
  .zona:last-child { border-bottom: none; }
  .zona-nom { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.35rem; }

  .par { display: flex; flex-direction: column; gap: 0.28rem; }
  .barra { display: flex; align-items: center; gap: 0.45rem; }
  .fill {
    height: 14px; border-radius: 4px; min-width: 2px; transition: width 0.4s ease;
  }
  .fill-nec { background: var(--rojo); }
  .fill-rec { background: var(--verde); }
  .val { font-size: 0.82rem; font-weight: 700; color: var(--texto); font-variant-numeric: tabular-nums; }

  .vacio { background: var(--gris-claro); color: var(--gris); border-radius: var(--radio); padding: 1.2rem 1rem; text-align: center; font-size: 0.88rem; margin: 0; }
  .nota { margin: 0.6rem 0 0; color: var(--gris); font-size: 0.76rem; }
</style>
