<script>
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { online, asegurarSesionAnonima } from '../lib/stores.js';
  import { crearNecesidadV2, leerNecesidadesPublicas, leerRecursosPublicos } from '../lib/db.js';
  import LugarAutocomplete from '../components/LugarAutocomplete.svelte';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  // Contexto del mapa (mismo mapa que /mapa): muestra lo existente al reportar.
  let ctxNec = [], ctxRec = [];
  onMount(async () => {
    try { const r = await leerNecesidadesPublicas({}); ctxNec = r.items; } catch (_) {}
    try { ctxRec = await leerRecursosPublicos({}); } catch (_) {}
  });

  const categorias = ['rescate', 'medico', 'agua', 'alimento', 'refugio', 'otro'];
  const paraQuien = ['yo', 'familiar', 'vecino', 'desconocido'];
  const rangos = ['1', '2-5', '6-20', '+20'];
  const desdes = ['<6h', '6-24h', '+24h'];
  const severidades = ['total', 'severo', 'parcial', 'desconocida'];
  const medicoTipos = ['herido', 'medicamento_critico', 'atencion'];
  const medicamentos = ['insulina', 'oxigeno', 'dialisis', 'otro'];
  const vulnerablesOpc = ['ninos', 'mayores', 'discapacidad', 'embarazadas', 'heridos', 'cronicos'];
  const riesgosOpc = ['gas', 'fuego', 'colapso', 'electricidad', 'agua'];

  // --- Mínimo requerido ---
  let categoria = '';
  let para_quien = '';
  let personas_rango = '';
  let sector = '';
  let referencia = null;
  let contacto = '';

  // --- Ubicación exacta (GPS / pin) ---
  let lat = null, lng = null, gpsEstado = '';
  let mostrarMapa = true, pinLat = null, pinLng = null, centroMapa = null;

  // --- Condicionales por categoría ---
  let severidad = '';
  let atrapados = null;          // null | true | false
  let atrapados_cuantas = null;
  let con_vida = null;
  let desde = '';
  let medico_tipo = '';
  let medicamento = '';
  let cant_personas = null, cant_dias = null;

  // --- Opcionales (revelación progresiva) ---
  let mostrarMas = false;
  let vulnerables = [];
  let riesgos = [];
  let como_llegar = '';
  let contacto_alterno = '';
  let descripcion = '';

  let enviando = false, resultado = '', error = '';

  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const esRecurso = (c) => c === 'agua' || c === 'alimento' || c === 'refugio';

  function usarGps() {
    if (!navigator.geolocation) { gpsEstado = 'error'; return; }
    gpsEstado = 'buscando';
    navigator.geolocation.getCurrentPosition(
      (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; gpsEstado = 'ok'; centroMapa = { lat, lng }; mostrarMapa = true; },
      () => { gpsEstado = 'error'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }
  function onLugar(e) { const l = e.detail; if (l && Number.isFinite(l.lat)) centroMapa = { lat: l.lat, lng: l.lng }; }

  async function enviar() {
    error = '';
    if (!categoria) { error = $t('reportar.categoria'); return; }
    if (!para_quien) { error = $t('reportar.falta_para_quien'); return; }
    if (!personas_rango) { error = $t('reportar.falta_personas'); return; }
    const hayPin = pinLat != null && pinLng != null;
    if (!sector && !referencia && !(lat && lng) && !hayPin) { error = $t('reportar.falta_ubicacion'); return; }

    enviando = true;
    try {
      await asegurarSesionAnonima();
      const exacto = hayPin ? { lat: pinLat, lng: pinLng } : (lat != null && lng != null ? { lat, lng } : null);
      const inp = {
        categoria, para_quien, personas_rango,
        sector: sector || (referencia ? referencia.nombre : '(sin sector — ver mapa)'),
        descripcion, gps: exacto, referencia,
        contacto: contacto.trim(), como_llegar: como_llegar.trim(), contacto_alterno: contacto_alterno.trim(),
        vulnerables, riesgos
      };
      if (categoria === 'rescate') {
        if (severidad) inp.severidad = severidad;
        if (atrapados != null) {
          inp.rescate = { atrapados };
          if (atrapados) {
            if (Number.isFinite(atrapados_cuantas)) inp.rescate.cantidad = atrapados_cuantas;
            if (con_vida != null) inp.rescate.con_vida = con_vida;
            if (desde) inp.rescate.desde = desde;
          }
        }
      }
      if (categoria === 'medico' && medico_tipo) {
        inp.medico = { tipo: medico_tipo };
        if (medico_tipo === 'medicamento_critico' && medicamento) inp.medico.medicamento = medicamento;
      }
      if (esRecurso(categoria)) {
        const c = {};
        if (Number.isFinite(cant_personas)) c.personas = cant_personas;
        if (Number.isFinite(cant_dias)) c.dias = cant_dias;
        if (Object.keys(c).length) inp.cantidad = c;
      }

      const { listo } = crearNecesidadV2(inp);
      if ($online) { await listo; resultado = 'ok'; }
      else { resultado = 'ok_offline'; listo.catch(() => {}); }
    } catch (e) {
      error = $t('comun.error');
    } finally {
      enviando = false;
    }
  }

  function reset() {
    categoria = ''; para_quien = ''; personas_rango = ''; sector = ''; referencia = null; contacto = '';
    lat = null; lng = null; gpsEstado = ''; mostrarMapa = true; pinLat = null; pinLng = null; centroMapa = null;
    severidad = ''; atrapados = null; atrapados_cuantas = null; con_vida = null; desde = '';
    medico_tipo = ''; medicamento = ''; cant_personas = null; cant_dias = null;
    mostrarMas = false; vulnerables = []; riesgos = []; como_llegar = ''; contacto_alterno = ''; descripcion = '';
    resultado = ''; error = '';
  }
</script>

<div class="contenedor">
  {#if resultado}
    <div class="aviso-ok" role="status">
      <p><strong>{$t(resultado === 'ok_offline' ? 'reportar.ok_offline' : 'reportar.ok')}</strong></p>
      <button class="btn-primario btn-bloque" on:click={reset}>{$t('reportar.otro')}</button>
    </div>
  {:else}
    <h1>{$t('reportar.titulo')}</h1>
    <p class="intro-seg">{$t('intro.reportar')}</p>
    {#if error}<div class="aviso-error" role="alert">{error}</div>{/if}

    <!-- 1) Categoría -->
    <label id="lbl-cat">{$t('reportar.categoria')}</label>
    <div class="chips" role="group" aria-labelledby="lbl-cat">
      {#each categorias as c}
        <button type="button" class="chip" aria-pressed={categoria === c} on:click={() => (categoria = c)}>{$t('cat.' + c)}</button>
      {/each}
    </div>

    <!-- 2) ¿Para quién? -->
    <label id="lbl-pq">{$t('reportar.para_quien')}</label>
    <div class="chips" role="group" aria-labelledby="lbl-pq">
      {#each paraQuien as q}
        <button type="button" class="chip" aria-pressed={para_quien === q} on:click={() => (para_quien = q)}>{$t('pq.' + q)}</button>
      {/each}
    </div>

    <!-- 3) ¿Cuántas personas? -->
    <label id="lbl-pers">{$t('reportar.personas')}</label>
    <div class="chips" role="group" aria-labelledby="lbl-pers">
      {#each rangos as r}
        <button type="button" class="chip" aria-pressed={personas_rango === r} on:click={() => (personas_rango = r)}>{$t('pers.' + r)}</button>
      {/each}
    </div>

    <!-- 4) Ubicación -->
    <label for="sector">{$t('reportar.ubicacion')}</label>
    <LugarAutocomplete bind:valor={sector} bind:elegido={referencia} on:seleccion={onLugar} />
    <p class="ayuda">{$t('reportar.ubicacion_ayuda')}</p>
    <div style="margin-top:.5rem">
      <button type="button" class="btn-bloque" on:click={usarGps}>
        {$t('reportar.usar_gps')}{#if gpsEstado === 'buscando'} …{:else if gpsEstado === 'ok'} · {$t('reportar.gps_ok')}{:else if gpsEstado === 'error'} · {$t('reportar.gps_error')}{/if}
      </button>
    </div>
    {#if mostrarMapa}
      <div class="mapa-titulo">{$t('reportar.mapa_titulo')}</div>
      <p class="ayuda">{$t('reportar.mapa_ayuda')}</p>
      <MapaUnificado conPin bind:lat={pinLat} bind:lng={pinLng} centro={centroMapa} necesidades={ctxNec} recursos={ctxRec} alto="300px" />
      {#if pinLat != null}<p class="ayuda pin-ok">{$t('reportar.mapa_marcado')}</p>{/if}
      <button type="button" class="enlace-ocultar" on:click={() => (mostrarMapa = false)}>{$t('reportar.mapa_ocultar')}</button>
    {:else}
      <button type="button" class="btn-bloque" style="margin-top:.5rem" on:click={() => (mostrarMapa = true)}>
        {$t('reportar.mapa_toggle')}{#if pinLat != null} · {$t('reportar.marcado')}{/if}
      </button>
    {/if}

    <!-- 5) Condicionales por categoría -->
    {#if categoria === 'rescate'}
      <div class="sub">
        <label id="lbl-atr">{$t('reportar.atrapados')}</label>
        <div class="chips" role="group" aria-labelledby="lbl-atr">
          <button type="button" class="chip chip-urg u-critica" aria-pressed={atrapados === true} on:click={() => (atrapados = true)}>{$t('reportar.si')}</button>
          <button type="button" class="chip" aria-pressed={atrapados === false} on:click={() => (atrapados = false)}>{$t('reportar.no')}</button>
        </div>
        {#if atrapados === true}
          <label for="atr-n">{$t('reportar.atrapados_cuantas')}</label>
          <input id="atr-n" type="number" min="1" inputmode="numeric" bind:value={atrapados_cuantas} />
          <label id="lbl-vida">{$t('reportar.con_vida')}</label>
          <div class="chips" role="group" aria-labelledby="lbl-vida">
            <button type="button" class="chip" aria-pressed={con_vida === true} on:click={() => (con_vida = true)}>{$t('reportar.si')}</button>
            <button type="button" class="chip" aria-pressed={con_vida === false} on:click={() => (con_vida = false)}>{$t('reportar.no')}</button>
          </div>
          <label id="lbl-desde">{$t('reportar.desde')}</label>
          <div class="chips" role="group" aria-labelledby="lbl-desde">
            {#each desdes as d}
              <button type="button" class="chip" aria-pressed={desde === d} on:click={() => (desde = d)}>{$t('desde.' + d)}</button>
            {/each}
          </div>
        {/if}
        <label id="lbl-sev">{$t('reportar.severidad')}</label>
        <div class="chips" role="group" aria-labelledby="lbl-sev">
          {#each severidades as s}
            <button type="button" class="chip" aria-pressed={severidad === s} on:click={() => (severidad = s)}>{$t('sev.' + s)}</button>
          {/each}
        </div>
      </div>
    {:else if categoria === 'medico'}
      <div class="sub">
        <label id="lbl-med">{$t('reportar.medico_tipo')}</label>
        <div class="chips" role="group" aria-labelledby="lbl-med">
          {#each medicoTipos as m}
            <button type="button" class="chip {m === 'medicamento_critico' ? 'chip-urg u-critica' : ''}" aria-pressed={medico_tipo === m} on:click={() => (medico_tipo = m)}>{$t('med.' + m)}</button>
          {/each}
        </div>
        {#if medico_tipo === 'medicamento_critico'}
          <label id="lbl-medic">{$t('reportar.medicamento')}</label>
          <div class="chips" role="group" aria-labelledby="lbl-medic">
            {#each medicamentos as m}
              <button type="button" class="chip" aria-pressed={medicamento === m} on:click={() => (medicamento = m)}>{$t('medic.' + m)}</button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if esRecurso(categoria)}
      <div class="sub fila2">
        <div>
          <label for="cant-p">{$t('reportar.cantidad_personas')}</label>
          <input id="cant-p" type="number" min="1" inputmode="numeric" bind:value={cant_personas} />
        </div>
        <div>
          <label for="cant-d">{$t('reportar.cantidad_dias')}</label>
          <input id="cant-d" type="number" min="1" inputmode="numeric" bind:value={cant_dias} />
        </div>
      </div>
    {/if}

    <!-- 6) Detalles opcionales (revelación progresiva) -->
    <button type="button" class="enlace-mas" on:click={() => (mostrarMas = !mostrarMas)}>
      {$t(mostrarMas ? 'reportar.menos_detalles' : 'reportar.mas_detalles')}
    </button>
    {#if mostrarMas}
      <div class="sub">
        <label id="lbl-vuln">{$t('reportar.vulnerables')}</label>
        <div class="chips" role="group" aria-labelledby="lbl-vuln">
          {#each vulnerablesOpc as v}
            <button type="button" class="chip" aria-pressed={vulnerables.includes(v)} on:click={() => (vulnerables = toggle(vulnerables, v))}>{$t('vuln.' + v)}</button>
          {/each}
        </div>
        <label id="lbl-ries">{$t('reportar.riesgos')}</label>
        <div class="chips" role="group" aria-labelledby="lbl-ries">
          {#each riesgosOpc as r}
            <button type="button" class="chip" aria-pressed={riesgos.includes(r)} on:click={() => (riesgos = toggle(riesgos, r))}>{$t('riesgo.' + r)}</button>
          {/each}
        </div>
        <label for="como">{$t('reportar.como_llegar')} <span class="ayuda">({$t('comun.opcional')})</span></label>
        <input id="como" bind:value={como_llegar} maxlength="200" />
        <p class="ayuda">{$t('reportar.como_llegar_ayuda')}</p>
        <label for="alt">{$t('reportar.contacto_alterno')} <span class="ayuda">({$t('comun.opcional')})</span></label>
        <input id="alt" bind:value={contacto_alterno} maxlength="140" inputmode="tel" />
      </div>
    {/if}

    <!-- 7) Contexto opcional -->
    <label for="desc">{$t('reportar.contexto')} <span class="ayuda">({$t('comun.opcional')})</span></label>
    <textarea id="desc" bind:value={descripcion} maxlength="500" placeholder="Detalle breve que ayude"></textarea>
    <p class="aviso-publico">{$t('reportar.descripcion_aviso')}</p>

    <!-- 8) Contacto privado -->
    <label for="contacto">{$t('reportar.contacto')} <span class="ayuda">({$t('comun.opcional')})</span></label>
    <input id="contacto" bind:value={contacto} inputmode="tel" placeholder="Teléfono o WhatsApp" />
    <p class="ayuda">{$t('reportar.contacto_ayuda')}</p>

    <button class="btn-primario btn-bloque btn-grande" style="margin-top:1rem" on:click={enviar} disabled={enviando}>
      {enviando ? $t('reportar.enviando') : $t('reportar.enviar')}
    </button>
  {/if}
</div>

<style>
  .mapa-titulo { font-weight: 700; margin: 0.9rem 0 0.2rem; }
  .pin-ok { color: var(--verde); font-weight: 600; }
  .enlace-ocultar {
    background: none; border: none; min-height: 0; padding: 0.35rem 0;
    color: var(--gris); text-decoration: underline; font-size: 0.85rem;
  }
  /* Bloque condicional: ligeramente indentado para mostrar que depende de lo de arriba. */
  .sub {
    border-left: 3px solid var(--azul-claro, #cfe3f5); padding: 0.2rem 0 0.2rem 0.8rem;
    margin: 0.6rem 0; background: #f8fbff; border-radius: 0 var(--radio) var(--radio) 0;
  }
  .fila2 { display: flex; gap: 0.8rem; }
  .fila2 > div { flex: 1; }
  .enlace-mas {
    background: none; border: 1px dashed var(--borde); border-radius: var(--radio);
    width: 100%; padding: 0.55rem; margin-top: 0.8rem; color: var(--azul);
    font-weight: 600; font-size: 0.9rem; cursor: pointer; min-height: 0;
  }
  .enlace-mas:active { transform: translateY(1px); }
</style>
