<script>
  // PANEL OPERATIVO de ayuda (§22 + principios de mapas de respuesta: conciencia
  // situacional, color consistente, triaje, capas/filtros, estado, vigencia).
  // Presentación: consume db.js (read-only) + invoca la callable solicitarResolucion
  // (Resend) para avisar a un coordinador. Reutiliza MapaUnificado. Mobile-first.
  import { onMount, onDestroy } from 'svelte';
  import { t, textoNec, tiempo } from '../lib/i18n.js';
  import { aFecha } from '../lib/tiempo.js';
  import { app } from '../lib/firebase.js';
  import { normaliza } from '../lib/autocomplete.js';
  import { asegurarSesionAnonima } from '../lib/stores.js';
  import { leerNecesidadesPublicas, leerRecursosPublicos, confirmarNecesidad, cacheVieja } from '../lib/db.js';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

  let items = [], recursos = [], origen = '', cargando = true;
  let vista = 'mapa';             // móvil: por defecto el MAPA (panel para ayudar)
  let esDesktop = false;
  let enfocado = null;            // { id, t } → MapaUnificado vuela al punto

  // --- Filtros (control de capas + triaje) ---
  let busca = '', fTipo = 'todo', fCat = '', fUrg = '', fEstado = '', fFecha = '';
  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'transporte', 'acopio', 'servicios', 'otro'];
  const urgencias = ['critica', 'alta', 'media'];
  const estados = ['sin_atender', 'asignada', 'resuelta'];
  // Filtro por ANTIGÜEDAD (frescura): la pregunta clave en una emergencia es "¿qué es
  // nuevo?". Buckets de recencia sobre `creada_en` (cuándo se subió), no un date-picker
  // (los datos abarcan pocos días). Aplica a necesidades Y recursos.
  const fechas = [
    { k: '1h', h: 1 },
    { k: '6h', h: 6 },
    { k: '24h', h: 24 },
    { k: '72h', h: 72 },
    { k: '7d', h: 24 * 7 }
  ];
  const horasFecha = (k) => (fechas.find((f) => f.k === k)?.h ?? 0);
  const dentroDe = (ts, cutoff) => { const d = aFecha(ts); return d ? d.getTime() >= cutoff : false; };
  const limpiar = () => { busca = ''; fTipo = 'todo'; fCat = ''; fUrg = ''; fEstado = ''; fFecha = ''; };

  const qn = (s) => normaliza(s || '');
  $: q = qn(busca);
  const ordU = { critica: 0, alta: 1, media: 2 };
  function triar(arr) {
    const peso = (n) => (n.verificacion === 'pendiente_revision' ? 0 : 1);
    return [...arr].sort((a, b) =>
      peso(a) - peso(b)
      || ((b.rescate_activo === true) - (a.rescate_activo === true))
      || (ordU[a.urgencia] ?? 3) - (ordU[b.urgencia] ?? 3)
      || (b.creada_en?.seconds || 0) - (a.creada_en?.seconds || 0)
    );
  }

  // Corte de antigüedad: se recalcula al cambiar `fFecha` (referenciado en los bloques
  // de filtrado para que Svelte rastree la dependencia y recompute, sin gotcha oculto).
  $: cutoffFecha = fFecha ? Date.now() - horasFecha(fFecha) * 3600000 : 0;

  // q se referencia DIRECTAMENTE aquí para que Svelte recompute al teclear (el bug
  // anterior era que la comparación vivía en una función y no se rastreaba).
  $: necFiltradas = (fTipo === 'rec') ? [] : triar(items.filter((n) =>
    (!fCat || n.categoria === fCat) &&
    (!fUrg || n.urgencia === fUrg) &&
    (!fEstado || (n.estado || 'sin_atender') === fEstado) &&
    (!fFecha || dentroDe(n.creada_en, cutoffFecha)) &&
    (q.length < 2 || qn(`${n.sector} ${n.resumen || ''} ${n.resumen_en || ''} ${n.descripcion} ${n.categoria} ${n.urgencia}`).includes(q))
  ));
  $: recFiltrados = (fTipo === 'nec' || fUrg || fEstado) ? [] : recursos.filter((r) =>
    (!fCat || r.categoria === fCat) &&
    (!fFecha || dentroDe(r.creada_en, cutoffFecha)) &&
    (q.length < 2 || qn(`${r.sector} ${r.descripcion} ${r.categoria}`).includes(q))
  );
  $: totalMostrado = necFiltradas.length + recFiltrados.length;

  // KPIs de conciencia situacional (sobre el total).
  $: kCritica = items.filter((n) => n.rescate_activo === true || n.urgencia === 'critica').length;
  $: kSinAtender = items.filter((n) => (n.estado || 'sin_atender') === 'sin_atender').length;
  $: kRecursos = recursos.length;
  $: mapaAlto = esDesktop ? 'calc(100vh - 188px)' : '58vh';

  // Clic en la lista → vuela al punto en el mapa (en móvil cambia a la vista mapa).
  function irAlPunto(item) {
    enfocado = { id: item.id, t: Date.now() };
    if (!esDesktop) vista = 'mapa';
  }

  // --- Acciones del popup (emitidas por MapaUnificado) ---
  async function onConfirmar(e) {
    const { id, btn } = e.detail || {};
    if (demo || !id) return;
    try { await confirmarNecesidad(id); } catch (_) { /* ya confirmó o falla: igual agradecemos */ }
    if (btn) { btn.textContent = $t('pmapa.confirmado_ok'); btn.disabled = true; }
  }
  function onResuelto(e) { const it = items.find((n) => n.id === (e.detail || {}).id); if (it) abrirRevision(it, 'resuelto'); }
  function onCorregir(e) { const it = items.find((n) => n.id === (e.detail || {}).id); if (it) abrirRevision(it, 'correccion'); }

  // --- Formulario de revisión (Resuelto / Corrección) → email a un coordinador.
  // Honeypot + límite local; el server también valida (App Check + rate-limit). ---
  let resolItem = null, rModo = 'resuelto';
  let rMotivo = '', rFuente = '', rDetalle = '', rContacto = '', rHoney = '';
  let rEnviando = false, rResult = '', rError = '';
  function abrirRevision(n, modo) {
    resolItem = n; rModo = modo;
    rMotivo = ''; rFuente = ''; rDetalle = ''; rContacto = ''; rHoney = ''; rResult = ''; rError = '';
  }
  function cerrarResol() { resolItem = null; }
  async function enviarResol() {
    rError = '';
    if (rHoney) { resolItem = null; return; }                 // honeypot: bot → descartar
    const esCorr = rModo === 'correccion';
    if (esCorr ? !rDetalle.trim() : !rMotivo.trim()) { rError = $t(esCorr ? 'corr.falta' : 'resol.falta'); return; }
    const ultimo = Number(localStorage.getItem('foco_resol_ts') || 0);
    if (Date.now() - ultimo < 60000) { rError = $t('resol.espera'); return; } // límite local
    rEnviando = true;
    try {
      await asegurarSesionAnonima(); // App Check + sesión para invocar la función
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const fn = httpsCallable(getFunctions(app), 'solicitarResolucion');
      await fn({
        tipo: rModo,
        id: resolItem.id, sector: resolItem.sector || '', categoria: resolItem.categoria || '',
        urgencia: resolItem.urgencia || '', descripcion: resolItem.descripcion || '',
        motivo: rMotivo.trim(), fuente: rFuente.trim(), detalle: rDetalle.trim(), contacto: rContacto.trim(),
        url: location.origin + '/mapa?focus=' + resolItem.id
      });
      localStorage.setItem('foco_resol_ts', String(Date.now()));
      rResult = 'ok';
    } catch (e) { rError = $t('resol.error'); } finally { rEnviando = false; }
  }

  // --- carga ---
  // `background`: revalidación silenciosa (no muestra el spinner principal; pinta lo que
  // ya hay y solo intercambia los datos al llegar los frescos). Evita parpadeo al entrar.
  let revalidando = false;
  async function cargar(forzarServidor = false, background = false) {
    if (background) revalidando = true; else cargando = true;
    try {
      const r = await leerNecesidadesPublicas({ forzarServidor, demo });
      items = r.items; origen = r.origen;
      if (!demo) recursos = await leerRecursosPublicos({ forzarServidor }).catch(() => recursos);
    } finally { if (background) revalidando = false; else cargando = false; }
  }

  // Stale-while-revalidate: si pintamos desde CACHÉ y esta superó la ventana de frescura
  // (TTL), traemos 1 página de servidor en segundo plano y actualizamos sin botón. El TTL
  // acota el costo: por más que el usuario entre/salga, a lo sumo 1 lectura por ventana.
  // Si falla (offline), se conserva lo que ya estaba en pantalla.
  async function revalidarSiHaceFalta() {
    if (demo) return;
    if (origen === 'cache' && cacheVieja()) {
      try { await cargar(true, true); } catch (_) { /* offline/falla: mantenemos la caché */ }
    }
  }

  let cooldown = false;
  async function actualizar() {
    if (cooldown) return; cooldown = true; await cargar(true);
    setTimeout(() => (cooldown = false), 15000);
  }

  let mq, onMq, onVis;
  onMount(async () => {
    mq = window.matchMedia('(min-width: 900px)');
    esDesktop = mq.matches;
    onMq = (e) => (esDesktop = e.matches);
    mq.addEventListener('change', onMq);
    // Enlace profundo del correo (?focus=<id>): marcar ANTES de cargar para que el
    // mapa no se auto-encuadre a todo; cuando el punto exista, se vuela a él.
    const f = new URLSearchParams(window.location.search).get('focus');
    if (f) { enfocado = { id: f, t: Date.now() }; if (!esDesktop) vista = 'mapa'; }
    if (!demo) { try { await asegurarSesionAnonima(); } catch (_) { /* necesidades es público */ } }
    await cargar(false);            // pinta al instante (caché o, en frío, servidor)
    await revalidarSiHaceFalta();   // y refresca solo si la caché ya es vieja (sin botón)
    // Al volver a la pestaña tras un rato (cambio de app, pantalla apagada), refresca
    // solo si superó el TTL. Es el caso típico de "entré y vi datos viejos".
    onVis = () => { if (document.visibilityState === 'visible') revalidarSiHaceFalta(); };
    document.addEventListener('visibilitychange', onVis);
  });
  onDestroy(() => {
    if (mq && onMq) mq.removeEventListener('change', onMq);
    if (onVis) document.removeEventListener('visibilitychange', onVis);
  });
</script>

<div class="panel">
  <header class="cab">
    <h1>{$t('pmapa.titulo')}</h1>
    <button class="actualizar" on:click={actualizar} disabled={cooldown || cargando || revalidando}>
      {(cargando || revalidando) ? $t('mapa.actualizando') : $t('mapa.actualizar')}
    </button>
  </header>

  <div class="kpis">
    <div class="kpi k-rojo"><span class="n">{kCritica}</span><span class="l">{$t('pmapa.kpi_critica')}</span></div>
    <div class="kpi"><span class="n">{kSinAtender}</span><span class="l">{$t('pmapa.kpi_sin_atender')}</span></div>
    <div class="kpi k-verde"><span class="n">{kRecursos}</span><span class="l">{$t('pmapa.kpi_recursos')}</span></div>
  </div>
  <p class="kpi-nota">{$t('pmapa.kpi_sin_atender_nota')}</p>

  <div class="filtros">
    <input class="buscar" name="buscar" type="search" bind:value={busca} placeholder={$t('mapa.buscar_ph')} aria-label={$t('mapa.buscar_ph')} />
    <div class="tipo" role="group" aria-label="tipo">
      <button class:on={fTipo === 'todo'} on:click={() => (fTipo = 'todo')}>{$t('filtro.tipo_todo')}</button>
      <button class:on={fTipo === 'nec'} on:click={() => (fTipo = 'nec')}>{$t('filtro.tipo_nec')}</button>
      <button class:on={fTipo === 'rec'} on:click={() => (fTipo = 'rec')}>{$t('filtro.tipo_rec')}</button>
    </div>
    <div class="selects">
      <select name="cat" bind:value={fCat} aria-label={$t('filtro.cat_todas')}>
        <option value="">{$t('filtro.cat_todas')}</option>
        {#each categorias as c}<option value={c}>{$t('cat.' + c)}</option>{/each}
      </select>
      <select name="urg" bind:value={fUrg} disabled={fTipo === 'rec'} aria-label={$t('filtro.urg_todas')}>
        <option value="">{$t('filtro.urg_todas')}</option>
        {#each urgencias as u}<option value={u}>{$t('urg.' + u)}</option>{/each}
      </select>
      <select name="estado" bind:value={fEstado} disabled={fTipo === 'rec'} aria-label={$t('filtro.estado_todos')}>
        <option value="">{$t('filtro.estado_todos')}</option>
        {#each estados as e}<option value={e}>{$t('estado.' + e)}</option>{/each}
      </select>
      <select name="fecha" bind:value={fFecha} aria-label={$t('filtro.fecha_todas')}>
        <option value="">{$t('filtro.fecha_todas')}</option>
        {#each fechas as f}<option value={f.k}>{$t('filtro.fecha_' + f.k)}</option>{/each}
      </select>
    </div>
    <div class="meta">
      <span class="cuenta">{$t('pmapa.mostrando')} <b>{totalMostrado}</b></span>
      <button class="link" on:click={limpiar}>{$t('filtro.limpiar')}</button>
      <div class="toggle">
        <button class:on={vista === 'lista'} on:click={() => (vista = 'lista')}>{$t('mapa.lista')}</button>
        <button class:on={vista === 'mapa'} on:click={() => (vista = 'mapa')}>{$t('mapa.mapa')}</button>
      </div>
    </div>
    {#if origen === 'cache'}<p class="ayuda cache">{$t('mapa.desde_cache')}</p>{/if}
  </div>

  <div class="cuerpo">
    {#if esDesktop || vista === 'lista'}
      <aside class="lista">
        <p class="aviso-sector">{$t('mapa.sector_aviso')}</p>
        {#if cargando && items.length === 0}
          <p class="ayuda">…</p>
        {:else if totalMostrado === 0}
          <p class="ayuda">{$t('pmapa.sin_resultados')}</p>
        {:else}
          {#each necFiltradas as n (n.id)}
            <button class="tarjeta item {n.verificacion === 'pendiente_revision' ? 'prioritario' : ''}" on:click={() => irAlPunto(n)}>
              {#if n.verificacion === 'pendiente_revision'}<div class="badge-prio">{$t('mapa.revisar')}</div>{/if}
              <div class="tarjeta-row">
                <span class="tag tag-u-{n.urgencia}">{$t('urg.' + n.urgencia)}</span>
                <span class="tag">{$t('cat.' + n.categoria)}</span>
                <span class="tag tag-{(n.estado || 'sin_atender')}">{$t('estado.' + (n.estado || 'sin_atender'))}</span>
                {#if n.confirmaciones}<span class="tag">{n.confirmaciones} {$t('mapa.confirmaciones')}</span>{/if}
              </div>
              <div class="sector-txt">{n.sector}</div>
              {#if $textoNec(n)}<p class="desc">{$textoNec(n)}</p>{/if}
              {#if $tiempo.rel(n.creada_en)}<p class="sello" class:viejo={$tiempo.viejo(n.creada_en)} title={$tiempo.abs(n.creada_en)}>{$t('tiempo.subido')} {$tiempo.rel(n.creada_en)}</p>{/if}
            </button>
          {/each}
          {#each recFiltrados as r (r.id)}
            <button class="tarjeta item item-rec" on:click={() => irAlPunto(r)}>
              <div class="tarjeta-row">
                <span class="tag tag-rec">{$t('pmapa.recurso')}</span>
                <span class="tag">{$t('cat.' + r.categoria)}</span>
              </div>
              <div class="sector-txt">{r.sector}</div>
              {#if r.descripcion}<p class="desc">{r.descripcion}</p>{/if}
              {#if $tiempo.rel(r.creada_en)}<p class="sello" class:viejo={$tiempo.viejo(r.creada_en)} title={$tiempo.abs(r.creada_en)}>{$t('tiempo.subido')} {$tiempo.rel(r.creada_en)}</p>{/if}
            </button>
          {/each}
        {/if}
      </aside>
    {/if}

    {#if esDesktop || vista === 'mapa'}
      <div class="mapa-col">
        <MapaUnificado necesidades={necFiltradas} recursos={recFiltrados} alto={mapaAlto}
          acciones={true} {enfocado} on:confirmar={onConfirmar} on:resuelto={onResuelto} on:corregir={onCorregir} />
      </div>
    {/if}
  </div>
</div>

<!-- Formulario "¿Resuelto?" → avisa a un coordinador (no cambia el estado) -->
{#if resolItem}
  <div class="overlay" on:click={cerrarResol} role="presentation">
    <div class="hoja" on:click|stopPropagation role="dialog" aria-modal="true">
      {#if rResult === 'ok'}
        <p class="aviso-ok">{$t(rModo === 'correccion' ? 'corr.ok' : 'resol.ok')}</p>
        <button class="btn-bloque" on:click={cerrarResol}>{$t('mapa.cerrar')}</button>
      {:else}
        <h2>{$t(rModo === 'correccion' ? 'corr.titulo' : 'resol.titulo')}</h2>
        <p class="r-sector">{resolItem.sector}</p>
        <p class="r-intro">{$t(rModo === 'correccion' ? 'corr.intro' : 'resol.intro')}</p>

        {#if rModo === 'correccion'}
          <label for="r-detalle">{$t('corr.detalle')}</label>
          <textarea id="r-detalle" name="detalle" bind:value={rDetalle} placeholder={$t('corr.detalle_ph')}></textarea>
        {:else}
          <label for="r-motivo">{$t('resol.motivo')}</label>
          <textarea id="r-motivo" name="motivo" bind:value={rMotivo} placeholder={$t('resol.motivo_ph')}></textarea>
          <label for="r-fuente">{$t('resol.fuente')}</label>
          <input id="r-fuente" name="fuente" type="text" bind:value={rFuente} placeholder={$t('resol.fuente_ph')} />
        {/if}

        <label for="r-contacto">{$t('resol.contacto')}</label>
        <input id="r-contacto" name="contacto" type="text" bind:value={rContacto} />

        <!-- honeypot: oculto a humanos; si un bot lo rellena, se descarta -->
        <input class="hp" tabindex="-1" autocomplete="off" name="website" bind:value={rHoney} aria-hidden="true" />

        {#if rError}<p class="aviso-error">{rError}</p>{/if}
        <button class="btn-ok btn-bloque btn-grande" on:click={enviarResol} disabled={rEnviando}>
          {rEnviando ? $t('resol.enviando') : $t('resol.enviar')}
        </button>
        <button class="btn-bloque" on:click={cerrarResol}>{$t('resol.cancelar')}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel { max-width: 1280px; margin: 0 auto; padding: 0.7rem 0.8rem 4rem; }
  .cab { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
  .cab h1 { font-size: 1.25rem; margin: 0; }
  .actualizar { white-space: nowrap; }

  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin: 0.6rem 0 0.3rem; }
  .kpi-nota { margin: 0 0 0.6rem; font-size: 0.74rem; color: var(--gris); line-height: 1.35; }
  .kpi { background: #fff; border: 1px solid var(--borde); border-radius: var(--radio); padding: 0.5rem 0.7rem; box-shadow: var(--sombra); }
  .kpi .n { display: block; font-size: 1.5rem; font-weight: 800; line-height: 1; }
  .kpi .l { font-size: 0.76rem; color: var(--gris); }
  .k-rojo .n { color: var(--rojo); }
  .k-verde .n { color: var(--verde); }

  .filtros { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.6rem; }
  .buscar { width: 100%; }
  .tipo { display: flex; border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; }
  .tipo button { flex: 1; border: none; border-radius: 0; background: #fff; min-height: 42px; font-weight: 600; }
  .tipo button.on { background: var(--azul); color: #fff; }
  /* Mobile-first: 4 filtros en una rejilla 2×2 limpia (sin huérfanos). En pantallas
     anchas pasan a una sola fila de 4. Así no se aprieta en móvil ni desbalancea en
     escritorio. */
  .selects { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
  .selects select { min-height: 42px; padding: 0.4rem 0.5rem; min-width: 0; width: 100%; }
  @media (min-width: 600px) {
    .selects { grid-template-columns: repeat(4, 1fr); }
  }
  .meta { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
  .cuenta { color: var(--gris); font-size: 0.85rem; }
  .cuenta b { color: var(--texto); }
  .link { background: none; border: none; color: var(--azul); font-weight: 600; padding: 0; min-height: 0; font-size: 0.85rem; }
  .toggle { display: flex; gap: 0.3rem; margin-left: auto; }
  .toggle button { padding: 0.4rem 0.8rem; min-height: 0; }
  .toggle button.on { background: var(--azul); color: #fff; }
  .cache { margin: 0; }

  .cuerpo { display: block; }
  .aviso-sector { background: var(--gris-claro); color: var(--gris); font-size: 0.78rem; padding: 0.4rem 0.6rem; border-radius: var(--radio); margin: 0 0 0.6rem; }
  .item { display: block; width: 100%; text-align: left; cursor: pointer; }
  .item.prioritario { border-color: var(--rojo); border-width: 2px; }
  .item-rec { border-left: 4px solid var(--verde); }
  .badge-prio { background: var(--rojo); color: #fff; font-weight: 700; font-size: 0.76rem; padding: 0.2rem 0.5rem; border-radius: 999px; display: inline-block; margin-bottom: 0.4rem; }
  .tag-rec { background: var(--verde); color: #fff; }
  .tag-sin_atender { background: var(--gris-claro); color: var(--gris); }
  .tag-asignada { background: #dbeafe; color: #1666a0; }
  .tag-resuelta { background: #dcfce7; color: #166534; }
  .sector-txt { font-weight: 600; }
  .desc { margin: 0.3rem 0 0; color: var(--texto); }
  /* Sello de frescura: cuándo se subió (nuevo vs. antiguo) — lectura limpia. */
  .sello { margin: 0.25rem 0 0; font-size: 0.76rem; color: var(--gris); font-variant-numeric: tabular-nums; }
  .sello.viejo { color: #b45309; }
  .ayuda { color: var(--gris); }

  @media (min-width: 900px) {
    .cuerpo { display: grid; grid-template-columns: 360px 1fr; gap: 0.9rem; align-items: start; }
    .lista { max-height: calc(100vh - 188px); overflow-y: auto; padding-right: 0.3rem; }
    .mapa-col { position: sticky; top: 0.7rem; }
    .toggle { display: none; }
  }

  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center; z-index: 40; }
  .hoja { background: #fff; width: 100%; max-width: 640px; border-radius: 16px 16px 0 0; padding: 1.1rem; max-height: 85vh; overflow: auto; }
  .r-sector { font-weight: 700; margin: 0.2rem 0 0.6rem; }
  .r-intro { color: var(--gris); margin: 0 0 0.4rem; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
</style>
