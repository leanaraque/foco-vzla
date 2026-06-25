<script>
  import { createEventDispatcher } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { normaliza, filtrarLocal, photonAGusto, dedupe } from '../lib/autocomplete.js';

  // El padre pasa el texto del campo (bind) y recibe eventos:
  //  - 'seleccion' con { nombre, lat, lng, sectorGeo, municipio } al elegir un lugar
  //  - 'limpiar' al quitar el lugar elegido
  export let valor = '';
  export let elegido = null; // { nombre, lat, lng, sectorGeo, municipio } | null

  const dispatch = createEventDispatcher();

  let lugares = null;       // cargado de forma diferida
  let cargandoDatos = false;
  let cargandoRemoto = false;
  let sugerencias = [];
  let abierto = false;
  let activo = -1;          // índice resaltado (teclado)
  let buscoVacio = false;

  // --- Photon (fallback remoto) ----------------------------------------
  // Cuando lo local devuelve <4 sugerencias, consultamos Photon limitado a
  // Venezuela (gratis, sin API key). Debounce 300 ms + AbortController para no
  // saturar; cache por sesión para no repetir queries idénticas.
  const PHOTON_URL = 'https://photon.komoot.io/api';
  const DEBOUNCE_MS = 300;
  const UMBRAL_REMOTO = 4;   // si el local trae menos, pedimos a Photon
  const cachePhoton = new Map();
  let timerPhoton = null;
  let abortePhoton = null;

  function cacheGet(q) {
    if (cachePhoton.has(q)) return cachePhoton.get(q);
    try {
      const raw = sessionStorage.getItem('foco_photon:' + q);
      if (raw) {
        const v = JSON.parse(raw);
        cachePhoton.set(q, v);
        return v;
      }
    } catch (_) { /* sessionStorage no disponible */ }
    return null;
  }
  function cacheSet(q, v) {
    cachePhoton.set(q, v);
    try { sessionStorage.setItem('foco_photon:' + q, JSON.stringify(v)); } catch (_) { /* ignorar */ }
  }

  async function consultarPhoton(qOriginal, qNormalizada) {
    const cached = cacheGet(qNormalizada);
    if (cached) return cached;
    // Cancela petición anterior si seguía viva.
    if (abortePhoton) abortePhoton.abort();
    abortePhoton = new AbortController();
    // Photon oficial: NO soporta `bbox` (solo lat/lon + location_bias_scale como
    // sesgo) NI `lang=es` (solo default/de/en/fr; el `name` nativo de OSM para
    // Venezuela ya está en español). Sesgamos hacia el centro de Venezuela
    // (~8°N, -66°W) y filtramos en cliente con dentroDeVenezuela (en photonAGusto).
    const url = `${PHOTON_URL}/?q=${encodeURIComponent(qOriginal)}&limit=10` +
      '&lat=8&lon=-66&location_bias_scale=0.6';
    try {
      const r = await fetch(url, { signal: abortePhoton.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      const items = (j.features || []).map(photonAGusto).filter(Boolean);
      cacheSet(qNormalizada, items);
      return items;
    } catch (e) {
      if (e.name === 'AbortError') return null; // sobreescrito por petición más reciente
      return []; // cualquier otro fallo → graceful (lo local sigue)
    }
  }

  function programarPhoton(qOriginal, qNormalizada, locales) {
    clearTimeout(timerPhoton);
    timerPhoton = setTimeout(async () => {
      // Si la query cambió mientras esperábamos, no procesar (evita races).
      if (normaliza(valor) !== qNormalizada) return;
      cargandoRemoto = true;
      const remotos = await consultarPhoton(qOriginal, qNormalizada);
      cargandoRemoto = false;
      if (remotos === null) return;                       // abortado por una más nueva
      if (normaliza(valor) !== qNormalizada) return;      // el usuario siguió tecleando
      // Mezcla: locales primero (ya rankeados), luego remotos, dedupe por nombre+municipio.
      sugerencias = dedupe([...locales, ...remotos]).slice(0, 8);
      buscoVacio = sugerencias.length === 0;
    }, DEBOUNCE_MS);
  }

  async function asegurarDatos() {
    if (lugares || cargandoDatos) return;
    cargandoDatos = true;
    try {
      const mod = await import('../lib/lugares.json');
      lugares = mod.default || mod;
    } catch (_) {
      lugares = [];
    } finally {
      cargandoDatos = false;
    }
  }

  async function onInput(e) {
    valor = e.target.value;
    if (elegido) { elegido = null; dispatch('limpiar'); }
    dispatch('texto', valor);

    const q = normaliza(valor);
    if (q.length < 2) {
      sugerencias = []; abierto = false; buscoVacio = false;
      clearTimeout(timerPhoton); if (abortePhoton) abortePhoton.abort();
      return;
    }
    await asegurarDatos();

    // 1) Resultado inmediato del dataset local (no espera red).
    const locales = filtrarLocal(lugares, q, 6);
    sugerencias = locales;
    abierto = true;
    activo = -1;
    buscoVacio = false;

    // 2) Fallback Photon si los locales no bastan (debounced + cache).
    if (locales.length < UMBRAL_REMOTO) {
      programarPhoton(valor, q, locales);
    } else {
      clearTimeout(timerPhoton);
    }
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
      <span>📍 {elegido.nombre} <span class="muni">· {elegido.municipio}</span></span>
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
            <span class="nom">
              {l.nombre}
              {#if l._origen === 'photon'}<span class="badge-osm" title="Resultado adicional de OpenStreetMap">+ OSM</span>{/if}
            </span>
            <span class="sub">{l.tipo} · {l.municipio}</span>
          </li>
        {/each}
        {#if cargandoRemoto}
          <li class="estado" aria-live="polite">{$t('reportar.buscando_mas')}</li>
        {/if}
      </ul>
    {:else if abierto && cargandoRemoto}
      <p class="vacio" aria-live="polite">{$t('reportar.buscando_mas')}</p>
    {:else if buscoVacio && !cargandoRemoto}
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
    box-shadow: 0 6px 20px rgba(0,0,0,0.12); max-height: 320px; overflow: auto;
  }
  .lista li {
    display: flex; flex-direction: column; gap: 2px;
    padding: 0.6rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--gris-claro);
  }
  .lista li:last-child { border-bottom: none; }
  .lista li.activo { background: #eaf2fb; }
  .lista li.estado { cursor: default; color: var(--gris); font-size: 0.82rem; font-style: italic; }
  .nom { font-weight: 700; display: flex; align-items: center; gap: 0.4rem; }
  .badge-osm {
    background: var(--gris-claro); color: var(--gris); font-weight: 700;
    font-size: 0.68rem; padding: 0.05rem 0.4rem; border-radius: 999px;
  }
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
