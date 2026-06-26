<script>
  // HOME / fuente de verdad — capa de PRESENTACIÓN (data storytelling §25, libro
  // "Storytelling with Data"). NO toca la capa de datos: solo CONSUME funciones de
  // lectura de db.js (read-only) y computa los agregados de la narrativa en cliente.
  // Mobile-first: el scroll vertical es la narrativa; cada sección es una "escena".
  import { onMount, createEventDispatcher } from 'svelte';
  import { t } from '../lib/i18n.js';
  import { asegurarSesionAnonima } from '../lib/stores.js';
  import { leerNecesidadesPublicas, leerRecursosPublicos } from '../lib/db.js';
  import BrechaZona from '../components/BrechaZona.svelte';
  import Composicion from '../components/Composicion.svelte';
  import Fuentes from '../components/Fuentes.svelte';
  import MapaUnificado from '../components/MapaUnificado.svelte';

  const ir = createEventDispatcher();
  const navega = (p) => ir('ir', p);

  // --- Estado (datos reales, computados en cliente) --------------------------
  let cargando = true;
  let necesidades = [], recursos = []; // arrays crudos para las secciones de gráficos
  let pulso = { rescate: 0, sinAtender: 0, recursos: 0, refugios: 0 };
  let totalNec = 0, totalRec = 0, actualizado = null;

  // Una necesidad de rescate "activa" = categoría rescate (o flag rescate_activo del
  // esquema v2 cuando exista) y aún no resuelta. Resiliente a ambos esquemas.
  const esRescateActivo = (n) =>
    (n.rescate_activo === true || (n.rescate_activo == null && n.categoria === 'rescate')) &&
    n.estado !== 'resuelta' && n.estado !== 'cerrada_invalida';

  const fechaDe = (x) => (x?.creada_en?.toDate ? x.creada_en.toDate() : null);

  onMount(async () => {
    try {
      // recursos exige sesión (rules: read if isSignedIn); necesidades es público.
      try { await asegurarSesionAnonima(); } catch (_) { /* necesidades igual carga */ }
      const [resNec, recs] = await Promise.all([
        leerNecesidadesPublicas({ max: 2000 }),
        leerRecursosPublicos({ max: 2000 })
      ]);
      const nec = resNec.items || [];
      necesidades = nec;            // se pasan a las secciones de gráficos
      recursos = recs;
      totalNec = nec.length;
      totalRec = recs.length;
      pulso = {
        rescate: nec.filter(esRescateActivo).length,
        sinAtender: nec.filter((n) => n.estado === 'sin_atender').length || totalNec,
        recursos: totalRec,
        refugios: recs.filter((r) => r.categoria === 'refugio').length
      };
      // Sello de frescura: la fecha del reporte más reciente.
      const fechas = nec.map(fechaDe).filter(Boolean).sort((a, b) => b - a);
      actualizado = fechas[0] || null;
    } catch (_) {
      // Sin backend accesible (p.ej. App Check en local): la home se muestra igual
      // con cifras en 0; no es un error que el usuario deba ver.
    } finally {
      cargando = false;
    }
  });

  // Tiempo relativo compacto para el sello ("hace 2 h").
  function relativo(d) {
    if (!d) return '';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return $t('inicio.ahora');
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h`;
    return `${Math.round(h / 24)} d`;
  }

  // KPI clickeable → abre un mapa filtrado SOLO a los puntos de ese KPI.
  let kpi = null;
  function abrirKpi(tipo) {
    if (tipo === 'rescate') kpi = { t: $t('inicio.pulso_rescate'), def: $t('inicio.def_rescate'), nec: necesidades.filter(esRescateActivo), rec: [] };
    else if (tipo === 'sinatender') kpi = { t: $t('inicio.pulso_sin_atender'), def: $t('inicio.def_sin_atender'), nec: necesidades.filter((n) => n.estado === 'sin_atender'), rec: [] };
    else if (tipo === 'recursos') kpi = { t: $t('inicio.pulso_recursos'), def: $t('inicio.def_recursos'), nec: [], rec: recursos };
    else if (tipo === 'refugios') kpi = { t: $t('inicio.pulso_refugios'), def: $t('inicio.def_refugios'), nec: [], rec: recursos.filter((r) => r.categoria === 'refugio') };
  }
</script>

<div class="home">
  <!-- 1) HERO — la idea grande en una frase -->
  <section class="hero">
    <p class="kicker">{$t('inicio.kicker')}</p>
    <h1>{$t('inicio.titulo')}</h1>
    <p class="sub">{$t('inicio.subtitulo')}</p>
  </section>

  <!-- 2) DOS PUERTAS — bifurcación por intención (Persona 2 primero) -->
  <section class="puertas" aria-label={$t('inicio.puertas_aria')}>
    <button class="puerta puerta-roja btn-bloque" on:click={() => navega('/reportar')}>
      <span class="puerta-txt">
        <strong>{$t('inicio.puerta_reportar_t')}</strong>
        <small>{$t('inicio.puerta_reportar_d')}</small>
      </span>
    </button>
    <button class="puerta puerta-azul btn-bloque" on:click={() => navega('/mapa')}>
      <span class="puerta-txt">
        <strong>{$t('inicio.puerta_ayudar_t')}</strong>
        <small>{$t('inicio.puerta_ayudar_d')}</small>
      </span>
    </button>
    <button class="ofrecer" on:click={() => navega('/recursos')}>{$t('inicio.ofrecer')}</button>
  </section>

  <!-- Sello de VERDAD: procedencia + frescura -->
  <p class="sello" aria-live="polite">
    {#if cargando}
      <span class="sello-pt">{$t('inicio.cargando')}</span>
    {:else}
      <span class="sello-pt"><b>{totalNec}</b> {$t('inicio.necesidades')}</span>
      <span class="sep">·</span>
      <span class="sello-pt"><b>{totalRec}</b> {$t('inicio.recursos')}</span>
      {#if actualizado}
        <span class="sep">·</span>
        <span class="sello-pt">{$t('inicio.actualizado')} {relativo(actualizado)}</span>
      {/if}
    {/if}
  </p>

  <!-- 3) EL PULSO — 4 cifras grandes (rejilla 2x2 en móvil) -->
  <section class="bloque">
    <h2>{$t('inicio.pulso_titulo')}</h2>
    <div class="pulso">
      <button class="cifra cifra-roja" on:click={() => abrirKpi('rescate')} disabled={cargando}>
        <span class="num">{cargando ? '—' : pulso.rescate}</span>
        <span class="lbl">{$t('inicio.pulso_rescate')}</span>
        <span class="sub">{$t('inicio.sub_rescate')}</span>
      </button>
      <button class="cifra" on:click={() => abrirKpi('sinatender')} disabled={cargando}>
        <span class="num">{cargando ? '—' : pulso.sinAtender}</span>
        <span class="lbl">{$t('inicio.pulso_sin_atender')}</span>
        <span class="sub">{$t('inicio.sub_sin_atender')}</span>
      </button>
      <button class="cifra cifra-verde" on:click={() => abrirKpi('recursos')} disabled={cargando}>
        <span class="num">{cargando ? '—' : pulso.recursos}</span>
        <span class="lbl">{$t('inicio.pulso_recursos')}</span>
        <span class="sub">{$t('inicio.sub_recursos')}</span>
      </button>
      <button class="cifra" on:click={() => abrirKpi('refugios')} disabled={cargando}>
        <span class="num">{cargando ? '—' : pulso.refugios}</span>
        <span class="lbl">{$t('inicio.pulso_refugios')}</span>
        <span class="sub">{$t('inicio.sub_refugios')}</span>
      </button>
    </div>
  </section>

  <!-- 4) DÓNDE — la brecha por zona (necesidades vs recursos) -->
  <BrechaZona {necesidades} {recursos} {cargando} />

  <!-- 5) QUÉ — composición por categoría (necesidades vs recursos) -->
  <Composicion {necesidades} {recursos} {cargando} />

  <!-- 6) CONFIANZA — procedencia: de dónde vienen los datos -->
  <Fuentes {necesidades} {recursos} {cargando} />
</div>

<!-- Detalle de un KPI: mapa filtrado SOLO a sus puntos + qué significa -->
{#if kpi}
  <div class="kpi-overlay" on:click={() => (kpi = null)} role="presentation">
    <div class="kpi-modal" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="kpi-head">
        <div class="kpi-tit">
          <h2>{kpi.t} <span class="kpi-n">{kpi.nec.length + kpi.rec.length}</span></h2>
          <p class="kpi-def">{kpi.def}</p>
        </div>
        <button class="kpi-x" on:click={() => (kpi = null)} aria-label={$t('inicio.kpi_cerrar')}>✕</button>
      </div>
      {#if kpi.nec.length + kpi.rec.length === 0}
        <p class="kpi-vacio">{$t('inicio.kpi_vacio')}</p>
      {:else}
        <MapaUnificado necesidades={kpi.nec} recursos={kpi.rec} alto="56vh" />
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Mobile-first: una columna, todo a un pulgar. */
  .home { max-width: 720px; margin: 0 auto; padding: 1rem 1rem 2rem; }

  .hero { padding: 0.6rem 0 1rem; }
  .kicker {
    margin: 0 0 0.35rem; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--rojo);
  }
  .hero h1 { font-size: 1.55rem; line-height: 1.2; margin: 0 0 0.5rem; }
  .hero .sub { margin: 0; color: var(--gris); font-size: 1rem; }

  /* Dos puertas: botones grandes apilados, objetivo táctil amplio. */
  .puertas { display: flex; flex-direction: column; gap: 0.6rem; margin: 0.4rem 0 0.8rem; }
  .puerta {
    display: flex; align-items: center; gap: 0.8rem; text-align: left;
    padding: 0.95rem 1rem; border: none; color: #fff; min-height: 64px;
  }
  .puerta-txt { display: flex; flex-direction: column; line-height: 1.25; }
  .puerta-txt strong { font-size: 1.1rem; }
  .puerta-txt small { font-size: 0.85rem; opacity: 0.92; }
  .puerta-roja { background: var(--rojo); }
  .puerta-azul { background: var(--azul); }
  .ofrecer {
    background: none; border: 1px solid var(--borde); color: var(--azul);
    font-weight: 600; font-size: 0.9rem; min-height: 48px;
  }

  .sello {
    display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; justify-content: center;
    margin: 0 0 1.2rem; color: var(--gris); font-size: 0.84rem;
  }
  .sello b { color: var(--texto); }
  .sello .sep { opacity: 0.5; }

  .bloque { margin: 0 0 1.6rem; }
  .bloque h2 { font-size: 1.05rem; margin: 0 0 0.7rem; }

  /* Pulso: rejilla 2x2 en móvil, 4 en fila si hay ancho. */
  .pulso { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .cifra {
    background: #fff; border: 1px solid var(--borde); border-radius: var(--radio);
    padding: 0.9rem; box-shadow: var(--sombra); display: flex; flex-direction: column; gap: 0.15rem;
    text-align: left; align-items: flex-start; width: 100%; font: inherit; cursor: pointer;
    transition: box-shadow 0.15s ease, transform 0.05s ease;
  }
  .cifra:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); border-color: var(--azul-claro, #cfe3f5); }
  .cifra:active { transform: translateY(1px); }
  .cifra[disabled] { cursor: default; opacity: 0.65; }
  .cifra .num { font-size: 1.9rem; font-weight: 800; line-height: 1; }
  .cifra .lbl { font-size: 0.82rem; color: var(--texto); font-weight: 600; }
  .cifra .sub { font-size: 0.7rem; color: var(--gris); line-height: 1.2; }
  /* Color con propósito (preatentivo): solo lo crítico y lo disponible llevan color. */
  .cifra-roja .num { color: var(--rojo); }
  .cifra-verde .num { color: var(--verde); }

  @media (min-width: 560px) {
    .pulso { grid-template-columns: repeat(4, 1fr); }
  }

  /* Detalle de un KPI (modal con mapa filtrado) */
  .kpi-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-end; justify-content: center; z-index: 60;
  }
  .kpi-modal {
    background: #fff; width: 100%; max-width: 760px; border-radius: 16px 16px 0 0;
    padding: 1rem; max-height: 92vh; overflow: auto;
  }
  .kpi-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; margin-bottom: 0.7rem; }
  .kpi-tit h2 { font-size: 1.1rem; margin: 0 0 0.25rem; }
  .kpi-n { color: var(--rojo); font-weight: 800; }
  .kpi-def { margin: 0; color: var(--gris); font-size: 0.86rem; line-height: 1.4; }
  .kpi-x {
    background: var(--gris-claro, #eef1f4); border: none; border-radius: 999px;
    width: 34px; height: 34px; min-height: 34px; font-weight: 700; cursor: pointer; flex-shrink: 0;
  }
  .kpi-vacio { color: var(--gris); padding: 1.5rem 0; text-align: center; }
</style>
