<script>
  import { createEventDispatcher } from 'svelte';
  import { t } from '../lib/i18n.js';

  // El padre pasa el texto del campo (bind) y recibe eventos:
  //  - 'seleccion' con { nombre, lat, lng, sectorGeo, municipio } al elegir un lugar
  //  - 'limpiar' al quitar el lugar elegido
  export let valor = '';
  export let elegido = null; // { nombre, lat, lng, sectorGeo, municipio } | null

  const dispatch = createEventDispatcher();

  let lugares = null;       // cargado de forma diferida
  let cargando = false;
  let sugerencias = [];
  let abierto = false;
  let activo = -1;          // índice resaltado (teclado)
  let buscoVacio = false;

  const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g');
  const norm = (s) =>
    (s || '').normalize('NFD').replace(COMBINANTES, '').toLowerCase().trim();

  async function asegurarDatos() {
    if (lugares || cargando) return;
    cargando = true;
    try {
      // Import dinámico: lugares.json NO entra al bundle inicial (§6.3).
      const mod = await import('../lib/lugares.json');
      lugares = mod.default || mod;
    } catch (_) {
      lugares = [];
    } finally {
      cargando = false;
    }
  }

  async function onInput(e) {
    valor = e.target.value;
    // Escribir invalida el lugar previamente elegido (la persona está cambiando).
    if (elegido) { elegido = null; dispatch('limpiar'); }
    dispatch('texto', valor);

    const q = norm(valor);
    if (q.length < 2) { sugerencias = []; abierto = false; buscoVacio = false; return; }
    await asegurarDatos();

    const res = [];
    for (const l of lugares) {
      if (norm(l.nombre).includes(q) || norm(l.municipio).includes(q)) {
        res.push(l);
        if (res.length >= 6) break;
      }
    }
    sugerencias = res;
    abierto = true;
    activo = -1;
    buscoVacio = res.length === 0;
  }

  function elegir(l) {
    elegido = l;
    valor = l.nombre;
    abierto = false;
    sugerencias = [];
    buscoVacio = false;
    dispatch('seleccion', l);
  }

  function quitar() {
    elegido = null;
    valor = '';
    dispatch('limpiar');
  }

  function onKey(e) {
    if (!abierto || sugerencias.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activo = (activo + 1) % sugerencias.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activo = (activo - 1 + sugerencias.length) % sugerencias.length; }
    else if (e.key === 'Enter' && activo >= 0) { e.preventDefault(); elegir(sugerencias[activo]); }
    else if (e.key === 'Escape') { abierto = false; }
  }
</script>

<div class="ac">
  {#if elegido}
    <!-- CHIP claro y borrable: la persona VE qué eligió (evita confusión). -->
    <div class="chip-lugar" role="status">
      <span>📍 {elegido.nombre}<span class="muni"> · {elegido.municipio}</span></span>
      <button type="button" class="x" on:click={quitar} aria-label={$t('reportar.quitar_lugar')}>✕</button>
    </div>
  {:else}
    <input
      type="text"
      autocomplete="off"
      value={valor}
      placeholder={$t('reportar.ubicacion_ph')}
      on:input={onInput}
      on:keydown={onKey}
      on:focus={() => { if (sugerencias.length) abierto = true; }}
      aria-expanded={abierto}
      role="combobox"
      aria-controls="ac-lista"
      aria-autocomplete="list"
    />
    {#if abierto && sugerencias.length}
      <ul class="lista" id="ac-lista" role="listbox">
        {#each sugerencias as l, i}
          <li
            role="option"
            aria-selected={i === activo}
            class:activo={i === activo}
            on:mousedown|preventDefault={() => elegir(l)}
            on:mouseenter={() => (activo = i)}
          >
            <span class="nom">{l.nombre}</span>
            <span class="sub">{l.tipo} · {l.municipio}</span>
          </li>
        {/each}
      </ul>
    {:else if buscoVacio}
      <p class="vacio">{$t('reportar.sin_coincidencias')}</p>
    {/if}
  {/if}
</div>

<style>
  .ac { position: relative; }
  input { width: 100%; }
  .lista {
    position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 2px);
    margin: 0; padding: 0; list-style: none; background: #fff;
    border: 1px solid var(--borde); border-radius: var(--radio);
    box-shadow: 0 6px 20px rgba(0,0,0,0.12); max-height: 280px; overflow: auto;
  }
  .lista li {
    display: flex; flex-direction: column; gap: 2px;
    padding: 0.6rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--gris-claro);
  }
  .lista li:last-child { border-bottom: none; }
  .lista li.activo { background: #eaf2fb; }
  .nom { font-weight: 700; }
  .sub { font-size: 0.8rem; color: var(--gris); }
  .vacio { color: var(--gris); font-size: 0.85rem; margin: 0.4rem 0 0; }
  .chip-lugar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    background: #eaf2fb; border: 1px solid var(--azul-claro); border-radius: var(--radio);
    padding: 0.6rem 0.75rem; font-weight: 600;
  }
  .chip-lugar .muni { font-weight: 400; color: var(--gris); }
  .chip-lugar .x {
    min-height: 0; padding: 0.2rem 0.55rem; background: #fff; border: 1px solid var(--borde);
    border-radius: 999px; font-weight: 700; line-height: 1;
  }
</style>
