<script>
  // AVISO CRÍTICO (vida en riesgo): silencio en las zonas de rescate y NO acudir a esos
  // puntos. Va DEBAJO del banner de "plataforma abierta" (segunda notificación). Texto
  // breve, enfocado. Visible en TODA la web (montado global en App.svelte). Sin emojis.
  // AUTOCONTENIDO (ES inline): no depende de i18n.js (que se edita en paralelo).
</script>

<div class="aviso" role="alert">
  <div class="inner">
    <strong>Silencio en las zonas de rescate</strong>
    <p>
      <b>Equipos profesionales ya trabajan en La Guaira y alrededores.</b> El ruido y la
      aglomeración impiden oír a posibles <b>sobrevivientes bajo los escombros</b>. Si estás
      cerca, <b>haz silencio</b>; y si pensabas acudir, <b>evita acercarte</b>: menos gente,
      menos ruido.
    </p>
  </div>
</div>

<style>
  .aviso {
    background: var(--rojo, #c0261f); color: #fff;
    padding: 0.7rem 1rem; border-bottom: 2px solid rgba(0, 0, 0, 0.18);
    /* Sticky: se PEGA justo debajo del header (que es sticky en top:0, ~53px de alto,
       .cab en App.svelte). Al hacer scroll, el banner amarillo se va y este aviso queda
       pinchado bajo el header en toda la web. z-index < header (20) para que el header
       lo cubra si hay 1px de solape. */
    position: sticky; top: var(--cab-h, 53px); z-index: 19;
  }
  .inner { max-width: 720px; margin: 0 auto; }
  .inner strong { display: block; font-size: 0.95rem; line-height: 1.25; margin-bottom: 0.15rem; }
  .inner p { margin: 0; font-size: 0.86rem; line-height: 1.4; }
  .inner b { font-weight: 800; }
</style>
