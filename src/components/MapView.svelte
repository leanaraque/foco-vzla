<script>
  import { onMount, onDestroy } from 'svelte';

  export let items = []; // necesidades con geo.{lat,lng}

  let contenedor;
  let mapa = null;
  let L = null;
  let capaMarcadores = null;

  const colorUrg = { critica: '#e63946', alta: '#d97706', media: '#1666a0' };

  onMount(async () => {
    // Carga diferida de Leaflet + su CSS: no pesa hasta abrir el mapa (Spec §6.3).
    const mod = await import('leaflet');
    await import('leaflet/dist/leaflet.css');
    L = mod.default || mod;

    mapa = L.map(contenedor, { zoomControl: true }).setView([10.49, -68.20], 9); // zona del evento
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap'
    }).addTo(mapa);
    capaMarcadores = L.layerGroup().addTo(mapa);
    dibujar();
  });

  onDestroy(() => { if (mapa) mapa.remove(); });

  function dibujar() {
    if (!mapa || !L || !capaMarcadores) return;
    capaMarcadores.clearLayers();
    const puntos = [];
    for (const n of items) {
      if (!n.geo?.lat) continue;
      const m = L.circleMarker([n.geo.lat, n.geo.lng], {
        radius: 9,
        color: colorUrg[n.urgencia] || '#1666a0',
        fillColor: colorUrg[n.urgencia] || '#1666a0',
        fillOpacity: 0.8,
        weight: 2
      });
      m.bindPopup(`<strong>${n.sector || ''}</strong><br>${n.categoria} · ${n.urgencia}<br>${n.descripcion || ''}`);
      m.addTo(capaMarcadores);
      puntos.push([n.geo.lat, n.geo.lng]);
    }
    if (puntos.length) mapa.fitBounds(puntos, { padding: [30, 30], maxZoom: 13 });
  }

  // Redibuja al cambiar la lista (filtros / realtime)
  $: items, dibujar();
</script>

<div class="mapa" bind:this={contenedor}></div>

<style>
  .mapa { height: 60vh; width: 100%; border-radius: var(--radio); overflow: hidden; border: 1px solid var(--borde); }
</style>
