# FOCO — Coordinación de ayuda ciudadana

PWA offline-first para coordinar ayuda tras una emergencia. Convierte reportes
dispersos de necesidades en acción coordinada para los **coordinadores en
terreno**: una vista única, verificada y filtrable de qué se necesita, dónde y
con qué urgencia, con un mecanismo para reclamar y cerrar casos.

Construida como respuesta al doblete sísmico de Venezuela (24 jun 2026).

> ## ⚠️ FOCO NO es un servicio de emergencia
> No reemplaza a bomberos, Protección Civil ni al 911. Ante peligro inmediato,
> contacta a las líneas oficiales. FOCO **coordina** ayuda ciudadana; no despacha
> rescates ni garantiza respuesta.

## Qué es y qué no es

- **Es:** un panel para coordinadores (mapa + lista + filtros + reclamar/cerrar)
  y un flujo de reporte ultraligero para afectados/testigos.
- **No es:** servicio de emergencia, buscador de desaparecidos, ni red social.

## Privacidad (lee antes de usar)

- El **contacto** de un afectado y las **coordenadas exactas** nunca son públicos:
  viven en un subdocumento privado legible solo por un coordinador verificado.
- La ubicación pública se muestra a **nivel de sector** (coords redondeadas ~1 km).
- La **descripción** de una necesidad se vuelve pública al verificarse: la app
  advierte no escribir datos personales ahí.
- Ver [PRIVACY.md](PRIVACY.md) y [SECURITY.md](SECURITY.md).

## Stack

- **Frontend:** Vite + Svelte + vite-plugin-pwa (peso mínimo para 2G/3G).
- **Backend:** Firebase — Firestore (offline + realtime), Auth (anónimo +
  email), Hosting, App Check (reCAPTCHA Enterprise con enforcement).
- **Mapa:** Leaflet + OSM, diferido. **Geo:** geofire-common (geohash).

## Modelo de seguridad

La seguridad **no** depende de ocultar el código (este repo es público):

1. **App Check con enforcement** en Firestore: rechaza clientes no atestiguados.
2. **Custom claim `coordinador`** (no spoofeable) para leer datos privados.
3. **Security rules** con validación estricta de esquema, valores y autoría
   (`firestore.rules`), cubiertas por tests (`tests/rules.test.js`).
4. La **API key web** del config de Firebase es **pública por diseño** (va en el
   bundle del navegador). No es un secreto; está restringida por referrer HTTP y
   por servicio. Lo que protege los datos son las rules + App Check.

## Desplegar tu propia instancia

```bash
# 1. Requisitos: Node 22, Java 21 (emulador), Firebase CLI, cuenta Firebase (Blaze).
git clone https://github.com/leanaraque/foco-vzla.git
cd foco-vzla
npm install

# 2. Crea tu proyecto Firebase y pon su config en src/lib/firebase.js
#    Habilita Auth (anónimo + email/password) y crea Firestore (modo nativo).

# 3. App Check: crea una key reCAPTCHA Enterprise y ponla en .env.local
cp .env.example .env.local   # rellena VITE_RECAPTCHA_SITE_KEY

# 4. Desarrollo
npm run dev

# 5. Tests de security rules (requiere emulador + Java)
firebase emulators:exec --only firestore "npm run test:rules"

# 6. Deploy
npm run deploy   # build + hosting + reglas
```

## Alta de coordinador

El coordinador se registra (email/contraseña) y luego, server-side:

```bash
gcloud auth application-default login
node scripts/grant-coordinator.mjs persona@ejemplo.com
```

## Datos demo (para pruebas, sin tocar producción)

```bash
node scripts/seed-demo.mjs          # carga datos ficticios en colecciones _demo_*
# Verlos: https://<tu-host>/panel?demo=1
node scripts/seed-demo.mjs --clear  # limpiar
```

## Estructura

```
src/
  lib/        firebase.js · stores.js · db.js · geo.js · i18n.js
  routes/     Reportar · Panel · Recursos
  components/ EmergencyBanner · NeedCard · MapView
firestore.rules               frontera de privacidad (auditable)
tests/rules.test.js           tests de las rules (24, gate del jurado)
scripts/grant-coordinator.mjs alta de coordinadores (custom claim)
scripts/seed-demo.mjs         datos ficticios _demo
MVP-Spec-Mapa-Ayuda-Venezuela.md   especificación y registro del gate
```

## Licencia

[MIT](LICENSE).
