<script>
  import { t } from '../lib/i18n.js';
  import { app } from '../lib/firebase.js';
  import { asegurarSesionAnonima } from '../lib/stores.js';

  let nombre = '', organizacion = '', zona = '', contacto = '', motivo = '';
  let enviando = false, resultado = '', error = '';

  const COOLDOWN_MS = 60000;

  async function enviar() {
    error = '';
    if (!nombre.trim() || !zona.trim() || !contacto.trim()) { error = $t('coordform.faltan'); return; }

    // Rate-limit en cliente (defensa de cortesía; el server también valida).
    const ultimo = Number(localStorage.getItem('foco_coordform_ts') || 0);
    if (Date.now() - ultimo < COOLDOWN_MS) { error = $t('coordform.espera'); return; }

    enviando = true;
    try {
      await asegurarSesionAnonima(); // App Check + sesión para invocar la función
      // Carga diferida de functions (no pesa hasta que alguien se postula).
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const fn = httpsCallable(getFunctions(app), 'solicitarCoordinador');
      await fn({
        nombre: nombre.trim(),
        organizacion: organizacion.trim(),
        zona: zona.trim(),
        contacto: contacto.trim(),
        motivo: motivo.trim()
      });
      localStorage.setItem('foco_coordform_ts', String(Date.now()));
      resultado = 'ok';
    } catch (e) {
      error = $t('coordform.error');
    } finally {
      enviando = false;
    }
  }
</script>

<div class="coordform">
  {#if resultado === 'ok'}
    <div class="aviso-ok" role="status">{$t('coordform.ok')}</div>
  {:else}
    <h2>{$t('coordform.titulo')}</h2>
    <p class="intro-seg">{$t('coordform.intro')}</p>
    {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}

    <label for="cf-nombre">{$t('coordform.nombre')}</label>
    <input id="cf-nombre" bind:value={nombre} maxlength="80" autocomplete="name" />

    <label for="cf-org">{$t('coordform.org')} <span class="ayuda">({$t('comun.opcional')})</span></label>
    <input id="cf-org" bind:value={organizacion} maxlength="120" />

    <label for="cf-zona">{$t('coordform.zona')}</label>
    <input id="cf-zona" bind:value={zona} maxlength="120" />

    <label for="cf-contacto">{$t('coordform.contacto')}</label>
    <input id="cf-contacto" bind:value={contacto} maxlength="120" inputmode="email" />

    <label for="cf-motivo">{$t('coordform.motivo')} <span class="ayuda">({$t('comun.opcional')})</span></label>
    <textarea id="cf-motivo" bind:value={motivo} maxlength="500"></textarea>

    <button class="btn-primario btn-bloque btn-grande" style="margin-top:1rem"
      on:click={enviar} disabled={enviando}>
      {enviando ? $t('coordform.enviando') : $t('coordform.enviar')}
    </button>
  {/if}
</div>

<style>
  .coordform { margin-top: 1.5rem; border-top: 1px solid var(--borde); padding-top: 1rem; }
</style>
