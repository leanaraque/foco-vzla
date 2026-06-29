<script>
  // Aviso de RÉPLICAS: las réplicas continúan; peligro real en puentes e infraestructura.
  // Va DEBAJO del aviso de silencio (no sticky: scrollea). Naranja para distinguirlo del
  // rojo (silencio, crítico) y el amarillo (informativo). Texto i18n (ES/EN) vía i18n.js.
  import { t } from '../lib/i18n.js';
</script>

<div class="aviso" role="alert">
  <div class="inner">
    <strong>{$t('aviso.replicas_t')}</strong>
    <span>{$t('aviso.replicas_d')}</span>
  </div>
</div>

<style>
  .aviso {
    background: #c2410c; color: #fff;
    padding: 0.55rem 1rem; border-bottom: 2px solid rgba(0, 0, 0, 0.18);
  }
  .inner {
    max-width: 720px; margin: 0 auto;
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem;
    font-size: 0.86rem; line-height: 1.4;
  }
  .inner strong { font-weight: 800; }
</style>
