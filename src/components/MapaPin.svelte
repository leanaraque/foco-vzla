<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  // Selector de punto exacto con pin arrastrable. El padre obtiene la posición por
  // bind:lat / bind:lng, y puede recentrar pasando `centro={ lat, lng }` (p.ej. al
  // elegir un lugar en el autocompletado o al usar GPS).
  export let lat = null;
  export let lng = null;
  export let centro = null;   // { lat, lng } para recentrar el mapa + pin

  const dispatch = createEventDispatcher();

  let contenedor;
  let mapa = null;
  let L = null;
  let marcador = null;
  let listo = false;

  // Centro por defecto: Caracas (punto medio razonable del país afectado).
  const DEFAULT = { lat: 10.5, lng: -66.91, zoom: 12 };

  function colocar(la, ln, zoom) {
    lat = Math.round(la * 1e6) / 1e6;
    lng = Math.round(ln * 1e6) / 1e6;
    if (mapa) mapa.setView([lat, lng], zoom || mapa.getZoom());
    if (marcador) marcador.setLatLng([lat, lng]);
    dispatch('cambio', { lat, lng });
  }

  onMount(async () => {
    const mod = await import('leaflet');
    await import('leaflet/dist/leaflet.css');
    L = mod.default || mod;

    const ini = (centro && Number.isFinite(centro.lat))
      ? { lat: centro.lat, lng: centro.lng, zoom: 16 }
      : (Number.isFinite(lat) ? { lat, lng, zoom: 16 } : DEFAULT);

    mapa = L.map(contenedor, { zoomControl: true }).setView([ini.lat, ini.lng], ini.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(mapa);

    // Pin arrastrable con icono SVG propio (DivIcon): evita el bug del marcador
    // por defecto de Leaflet con bundlers (PNG que no resuelve → icono roto).
    // Sin imagen externa → funciona offline y no se rompe.
    const icono = L.divIcon({
      className: 'foco-pin',
      html: '<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M17 1C8.7 1 2 7.7 2 16c0 11 15 27 15 27s15-16 15-27C32 7.7 25.3 1 17 1z" ' +
        'fill="#e63946" stroke="#fff" stroke-width="2.5"/>' +
        '<circle cx="17" cy="16" r="6" fill="#fff"/></svg>',
      iconSize: [34, 44],
      iconAnchor: [17, 43]   // la punta del pin apunta a la coordenada
    });

    // Pin arrastrable. Empieza en el centro inicial.
    marcador = L.marker([ini.lat, ini.lng], { draggable: true, autoPan: true, icon: icono }).addTo(mapa);
    marcador.on('dragend', () => {
      const p = marcador.getLatLng();
      colocar(p.lat, p.lng);
    });
    // Tocar/click en el mapa también mueve el pin (más intuitivo en móvil).
    mapa.on('click', (e) => colocar(e.latlng.lat, e.latlng.lng));

    // Estampa la posición inicial como valor (el usuario ya ve dónde quedó).
    lat = Math.round(ini.lat * 1e6) / 1e6;
    lng = Math.round(ini.lng * 1e6) / 1e6;
    dispatch('cambio', { lat, lng });
    listo = true;
    setTimeout(() => mapa && mapa.invalidateSize(), 50);
  });

  onDestroy(() => { if (mapa) mapa.remove(); });

  // Recentrar cuando el padre cambia `centro` (lugar elegido / GPS).
  $: if (listo && centro && Number.isFinite(centro.lat)) {
    colocar(centro.lat, centro.lng, 16);
  }
</script>

<div class="pin-wrap">
  <div class="mapa-pin" bind:this={contenedor}></div>
</div>

<style>
  .pin-wrap { position: relative; }
  .mapa-pin {
    height: 300px; width: 100%; border-radius: var(--radio);
    overflow: hidden; border: 1px solid var(--borde);
  }
  /* DivIcon sin fondo/borde por defecto de Leaflet; sombra suave bajo el pin. */
  :global(.foco-pin) { background: none; border: none; }
  :global(.foco-pin svg) { filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35)); cursor: grab; }
  :global(.foco-pin:active svg) { cursor: grabbing; }
</style>
