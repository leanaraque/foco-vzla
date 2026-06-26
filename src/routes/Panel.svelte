<script>
  import { onDestroy } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { user, esCoordinador, authListo, entrarCoordinador, salir } from '../lib/stores.js';
  import { suscribirNecesidades } from '../lib/db.js';
  import NeedCard from '../components/NeedCard.svelte';
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
  let vista = 'lista'; // 'lista' | 'mapa'
  let items = [];
  let unsub = null;

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

  onDestroy(() => unsub && unsub());
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

    <!-- Toggle lista / mapa -->
    <div class="toggle">
      <button class:activo={vista === 'lista'} on:click={() => (vista = 'lista')}>{$t('panel.lista')}</button>
      <button class:activo={vista === 'mapa'} on:click={() => (vista = 'mapa')}>{$t('panel.mapa')}</button>
    </div>

    {#if vista === 'mapa'}
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
  .toggle button { flex: 1; }
  .toggle button.activo { background: var(--azul); color: #fff; }
</style>
