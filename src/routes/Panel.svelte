<script>
  import { onDestroy } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { user, esCoordinador, authListo, entrarCoordinador, salir } from '../lib/stores.js';
  import { suscribirNecesidades, suscribirSolicitudes, suscribirPorRevisar, contarPorRevisar } from '../lib/db.js';
  import NeedCard from '../components/NeedCard.svelte';
  import SolicitudCard from '../components/SolicitudCard.svelte';
  import MapaUnificado from '../components/MapaUnificado.svelte';
  import CoordinatorForm from '../components/CoordinatorForm.svelte';

  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'otro'];
  const urgencias = ['critica', 'alta', 'media'];

  // --- login ---
  let email = '', password = '', entrando = false, errorLogin = '';
  async function login() {
    errorLogin = ''; entrando = true;
    try {
      const ok = await entrarCoordinador(email, password);
      if (!ok) errorLogin = $t('auth.no_coord');
    } catch (e) { errorLogin = $t('auth.error'); }
    finally { entrando = false; }
  }

  // --- filtros + suscripción ---
  let verNoVerificadas = false;
  let fCategoria = '';
  let fUrgencia = '';
  let vista = 'lista'; // 'lista' | 'mapa' | 'solicitudes'
  let items = [];
  let unsub = null;

  // --- cola de revisión del operador (pendiente_revision) ---
  const REV_LIMITE = 150;
  let porRevisar = [];
  let porRevisarTotal = null;       // conteo REAL (agregación), puede superar el render
  let unsubRev = null, revArrancado = false;
  function subRevisar() {
    if (unsubRev) { unsubRev(); unsubRev = null; }
    const filtros = { categoria: fCategoria || null, urgencia: fUrgencia || null, limite: REV_LIMITE };
    unsubRev = suscribirPorRevisar((data) => (porRevisar = data), filtros);
    contarPorRevisar(filtros).then((n) => (porRevisarTotal = n));
  }

  // --- solicitudes de la comunidad (Resuelto / Corrección) ---
  let solicitudes = [];
  let unsubSol = null;
  let solArrancado = false, solIntentos = 0;
  let verGestionadas = false;
  $: solPendientes = solicitudes.filter((s) => (s.estado || 'pendiente') === 'pendiente');
  $: solVisibles = verGestionadas ? solicitudes : solPendientes;

  // Suscribe con reintento: el primer listener puede atacar con un token que aún no
  // propagó el claim `coordinador` (carrera SDK↔auth) → permission-denied, que NO se
  // reintenta solo. Re-suscribimos con el token ya asentado, unas pocas veces.
  function subSolicitudes() {
    if (unsubSol) { unsubSol(); unsubSol = null; }
    unsubSol = suscribirSolicitudes(
      (data) => (solicitudes = data),
      () => {
        if (unsubSol) { unsubSol(); unsubSol = null; }
        if (solIntentos++ < 6) setTimeout(subSolicitudes, 1500);
      }
    );
  }

  // Modo demo para el testeo 3G de Lean (datos ficticios, sin login de coord).
  const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

  function resuscribir() {
    if (unsub) unsub();
    unsub = suscribirNecesidades(
      {
        demo,
        soloVerificadas: !verNoVerificadas,
        categoria: fCategoria || null,
        urgencia: fUrgencia || null
      },
      (data) => (items = data)
    );
  }

  // Re-suscribe cuando cambian los filtros (coordinador, o modo demo abierto).
  $: if ($esCoordinador || demo) { verNoVerificadas, fCategoria, fUrgencia; resuscribir(); }

  // Suscribe a las solicitudes de la comunidad (solo coordinador; las rules requieren
  // rol). En modo demo no hay solicitudes reales, así que no se suscribe. Arranca una
  // sola vez por sesión de coordinador; al cerrar sesión se limpia y se rearma.
  $: if ($esCoordinador && !solArrancado) { solArrancado = true; solIntentos = 0; subSolicitudes(); }
  $: if (!$esCoordinador && solArrancado) { if (unsubSol) { unsubSol(); unsubSol = null; } solArrancado = false; solicitudes = []; }

  // Cola de revisión (necesidades son lectura pública → sin carrera de claim).
  // Re-suscribe al cambiar los filtros de categoría/urgencia (acotan la cola).
  $: if ($esCoordinador) { fCategoria; fUrgencia; revArrancado = true; subRevisar(); }
  $: if (!$esCoordinador && revArrancado) { if (unsubRev) { unsubRev(); unsubRev = null; } revArrancado = false; porRevisar = []; porRevisarTotal = null; }

  onDestroy(() => { unsub && unsub(); unsubSol && unsubSol(); unsubRev && unsubRev(); });
</script>

<div class="contenedor">
  {#if !$authListo && !demo}
    <p>…</p>

  {:else if !$esCoordinador && !demo}
    <!-- Acceso de coordinador (rol por custom claim; alta controlada) -->
    <h1>{$t('auth.coord_titulo')}</h1>
    <p class="intro-seg">{$t('intro.panel')}</p>
    {#if errorLogin}<div class="aviso-error" role="alert">{errorLogin}</div>{/if}
    <label for="email">{$t('auth.email')}</label>
    <input id="email" type="email" bind:value={email} autocomplete="username" />
    <label for="pass">{$t('auth.password')}</label>
    <input id="pass" type="password" bind:value={password} autocomplete="current-password" />
    <button class="btn-primario btn-bloque btn-grande" style="margin-top:1rem"
      on:click={login} disabled={entrando}>{$t('auth.entrar')}</button>
    {#if $user && !$esCoordinador && $user.email}
      <p class="ayuda" style="margin-top:1rem">{$t('auth.no_coord')}</p>
    {/if}

    <!-- Formulario de postulación de coordinadores (§22.7-4) -->
    <CoordinatorForm />

  {:else}
    {#if demo}
      <div class="aviso-publico" style="margin-bottom:.6rem">
        Modo DEMO — datos ficticios para pruebas. No son reportes reales.
      </div>
    {/if}
    <div class="cab-panel">
      <h1>{$t('panel.titulo')}</h1>
      {#if !demo}<button on:click={salir}>{$t('auth.salir')}</button>{/if}
    </div>

    <!-- Filtros -->
    <div class="filtros">
      <select bind:value={fCategoria} aria-label={$t('panel.filtros')}>
        <option value="">{$t('panel.todas_categorias')}</option>
        {#each categorias as c}<option value={c}>{$t('cat.' + c)}</option>{/each}
      </select>
      <select bind:value={fUrgencia}>
        <option value="">{$t('panel.todas_urgencias')}</option>
        {#each urgencias as u}<option value={u}>{$t('urg.' + u)}</option>{/each}
      </select>
      <label class="check">
        <input type="checkbox" bind:checked={verNoVerificadas} />
        {$t('panel.ver_no_verificadas')}
      </label>
    </div>

    <!-- Toggle lista / por revisar / mapa / solicitudes -->
    <div class="toggle">
      <button class:activo={vista === 'lista'} on:click={() => (vista = 'lista')}>{$t('panel.lista')}</button>
      <button class:activo={vista === 'revisar'} on:click={() => (vista = 'revisar')}>
        {$t('panel.por_revisar')}
        {#if (porRevisarTotal ?? porRevisar.length) > 0}<span class="badge-num">{porRevisarTotal ?? porRevisar.length}</span>{/if}
      </button>
      <button class:activo={vista === 'mapa'} on:click={() => (vista = 'mapa')}>{$t('panel.mapa')}</button>
      <button class:activo={vista === 'solicitudes'} on:click={() => (vista = 'solicitudes')}>
        {$t('panel.solicitudes')}
        {#if solPendientes.length}<span class="badge-num">{solPendientes.length}</span>{/if}
      </button>
    </div>

    {#if vista === 'revisar'}
      <h2 class="sub">{$t('panel.por_revisar_titulo')}</h2>
      <p class="intro-seg">{$t('panel.por_revisar_intro')}</p>
      {#if porRevisarTotal != null}
        <p class="ayuda">
          {$t('panel.por_revisar_total').replace('{n}', porRevisarTotal)}
          {#if porRevisarTotal > porRevisar.length}
            · {$t('panel.por_revisar_capado').replace('{n}', porRevisar.length)}
          {/if}
        </p>
      {/if}
      {#if porRevisar.length === 0}
        <p class="ayuda">{$t('panel.por_revisar_vacio')}</p>
      {:else}
        {#each porRevisar as n (n.id)}
          <NeedCard {n} />
        {/each}
      {/if}

    {:else if vista === 'solicitudes'}
      <h2 class="sub">{$t('sol.titulo')}</h2>
      <p class="intro-seg">{$t('sol.intro')}</p>
      <label class="check">
        <input type="checkbox" bind:checked={verGestionadas} />
        {$t('sol.ver_gestionadas')}
      </label>
      {#if solVisibles.length === 0}
        <p class="ayuda">{$t('sol.vacio')}</p>
      {:else}
        {#each solVisibles as s (s.id)}
          <SolicitudCard {s} />
        {/each}
      {/if}

    {:else if vista === 'mapa'}
      {#if items.length}
        <MapaUnificado necesidades={items} />
      {:else}
        <p class="ayuda">{$t('panel.vacio')}</p>
      {/if}

    {:else}
      {#if items.length === 0}
        <p class="ayuda">{$t('panel.vacio')}</p>
      {:else}
        {#each items as n (n.id)}
          <NeedCard {n} />
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .cab-panel { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .filtros { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0; }
  .filtros select { width: auto; flex: 1; min-width: 140px; }
  .check { display: flex; align-items: center; gap: 0.4rem; font-weight: 600; margin: 0; width: 100%; }
  .check input { width: auto; }
  .toggle { display: flex; gap: 0.4rem; margin: 0.6rem 0; }
  .toggle button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; }
  .toggle button.activo { background: var(--azul); color: #fff; }
  .badge-num { background: #e63946; color: #fff; font-size: 0.72rem; font-weight: 800;
    min-width: 1.1rem; height: 1.1rem; padding: 0 0.25rem; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
  .sub { margin: 0.4rem 0 0.2rem; }
</style>
