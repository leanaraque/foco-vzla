<script>
  import { t } from '../lib/i18n.js';
</script>

<!-- Spec §5 / §9-2: nunca prometer rescate; dejar claro que no es un servicio de
     rescate y que nadie garantiza que alguien acuda. Las líneas oficiales se
     reemplazaron por el mensaje de ayuda mutua (probablemente saturadas, §23). -->
<div class="banner" role="note">
  <p>{$t('banner.aviso')}</p>
</div>

<style>
  .banner {
    background: #fff7d6; color: #5a4500; border-bottom: 2px solid var(--amarillo);
    padding: 0.6rem 1rem; font-size: 0.86rem;
  }
  .banner p { margin: 0; }
</style>
