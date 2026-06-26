<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { t } from '../lib/i18n.js';

  // UN SOLO mapa para toda la app: muestra necesidades y recursos como marcadores,
  // y opcionalmente un PIN arrastrable (modo reporte). Mismo estilo/tiles siempre.
  export let necesidades = [];   // [{ geo:{lat,lng}, urgencia, sector, descripcion, verificacion }]
  export let recursos = [];      // [{ geo:{lat,lng}, categoria, sector, descripcion }]
  export let conPin = false;     // muestra pin arrastrable (reporte)
  export let lat = null;         // bind: posición del pin
  export let lng = null;
  export let centro = null;      // { lat, lng } para recentrar
  export let alto = '62vh';

  const dispatch = createEventDispatcher();
  const colorUrg = { critica: '#e63946', alta: '#d97706', media: '#1666a0' };
  const VERDE = '#2a9d54';
  const DEFAULT = { lat: 10.5, lng: -66.91, zoom: conPin ? 12 : 9 };

  let contenedor, mapa = null, L = null, marcador = null, listo = false;
  let capaNec = null, capaRec = null;

  function colocar(la, ln, zoom) {
    lat = Math.round(la * 1e6) / 1e6;
    lng = Math.round(ln * 1e6) / 1e6;
    if (mapa) mapa.setView([lat, lng], zoom || mapa.getZoom());
    if (marcador) marcador.setLatLng([lat, lng]);
    dispatch('cambio', { lat, lng });
  }

  function dibujar() {
    if (!mapa || !L) return;
    capaNec.clearLayers();
    capaRec.clearLayers();
    const pts = [];
    for (const n of necesidades) {
      if (!n.geo?.lat) continue;
      const m = L.circleMarker([n.geo.lat, n.geo.lng], {
        radius: 8, color: '#fff', weight: 2,
        fillColor: colorUrg[n.urgencia] || '#1666a0', fillOpacity: 0.9
      });
      m.bindPopup(`<b>${esc(n.sector || '')}</b><br>${$t('cat.' + n.categoria) || n.categoria} · ${n.urgencia}<br>${esc(n.descripcion || '')}`);
      m.addTo(capaNec);
      pts.push([n.geo.lat, n.geo.lng]);
    }
    for (const r of recursos) {
      if (!r.geo?.lat) continue;
      const m = L.circleMarker([r.geo.lat, r.geo.lng], {
        radius: 8, color: '#fff', weight: 2, fillColor: VERDE, fillOpacity: 0.9
      });
      m.bindPopup(`<b>${$t('recursos.disponible')}: ${$t('cat.' + r.categoria) || r.categoria}</b><br>${esc(r.sector || '')}<br>${esc(r.descripcion || '')}`);
      m.addTo(capaRec);
      pts.push([r.geo.lat, r.geo.lng]);
    }
    // Encadrar a los datos solo en modo vista (sin pin) y si hay puntos.
    if (!conPin && pts.length) mapa.fitBounds(pts, { padding: [28, 28], maxZoom: 14 });
  }
  const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  onMount(async () => {
    const mod = await import('leaflet');
    await import('leaflet/dist/leaflet.css');
    L = mod.default || mod;

    const ini = (centro && Number.isFinite(centro.lat)) ? { ...centro, zoom: 16 }
      : (Number.isFinite(lat) ? { lat, lng, zoom: 16 } : DEFAULT);

    mapa = L.map(contenedor, { zoomControl: true }).setView([ini.lat, ini.lng], ini.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(mapa);
    capaNec = L.layerGroup().addTo(mapa);
    capaRec = L.layerGroup().addTo(mapa);

    if (conPin) {
      const icono = L.divIcon({
        className: 'foco-pin',
        html: '<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M17 1C8.7 1 2 7.7 2 16c0 11 15 27 15 27s15-16 15-27C32 7.7 25.3 1 17 1z" fill="#e63946" stroke="#fff" stroke-width="2.5"/>' +
          '<circle cx="17" cy="16" r="6" fill="#fff"/></svg>',
        iconSize: [34, 44], iconAnchor: [17, 43]
      });
      marcador = L.marker([ini.lat, ini.lng], { draggable: true, autoPan: true, icon: icono }).addTo(mapa);
      marcador.on('dragend', () => { const p = marcador.getLatLng(); colocar(p.lat, p.lng); });
      mapa.on('click', (e) => colocar(e.latlng.lat, e.latlng.lng));
      lat = Math.round(ini.lat * 1e6) / 1e6; lng = Math.round(ini.lng * 1e6) / 1e6;
      dispatch('cambio', { lat, lng });
    }

    listo = true;
    dibujar();
    setTimeout(() => mapa && mapa.invalidateSize(), 60);
  });

  onDestroy(() => { if (mapa) mapa.remove(); });

  $: if (listo) { necesidades, recursos; dibujar(); }
  $: if (listo && conPin && centro && Number.isFinite(centro.lat)) colocar(centro.lat, centro.lng, 16);
</script>

<div class="mapa-wrap" style="--alto:{alto}">
  <div class="mapa-u" bind:this={contenedor}></div>
  <div class="leyenda">
    <span><i style="background:{colorUrg.critica}"></i>{$t('leyenda.necesidad')}</span>
    <span><i style="background:{VERDE}"></i>{$t('leyenda.recurso')}</span>
    {#if conPin}<span><i class="pin-i"></i>{$t('leyenda.tu_punto')}</span>{/if}
  </div>
</div>

<style>
  .mapa-wrap { position: relative; }
  .mapa-u {
    height: var(--alto); min-height: 240px; width: 100%; border-radius: var(--radio);
    overflow: hidden; border: 1px solid var(--borde);
  }
  .leyenda {
    position: absolute; bottom: 8px; left: 8px; z-index: 500;
    background: rgba(255,255,255,0.92); border: 1px solid var(--borde); border-radius: 8px;
    padding: 0.3rem 0.5rem; font-size: 0.74rem; display: flex; gap: 0.6rem; flex-wrap: wrap;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
  }
  .leyenda span { display: inline-flex; align-items: center; gap: 0.25rem; }
  .leyenda i { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.15); }
  .leyenda i.pin-i { width: 9px; height: 13px; border-radius: 50% 50% 50% 0; transform: rotate(45deg); background: #e63946; }
  :global(.foco-pin) { background: none; border: none; }
  :global(.foco-pin svg) { filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35)); cursor: grab; }
  :global(.foco-pin:active svg) { cursor: grabbing; }
</style>
