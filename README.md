# FOCO — Coordinación de ayuda ciudadana

**Español** · [English summary](#in-english-summary)

PWA offline-first para coordinar ayuda tras una emergencia. Convierte reportes
dispersos en una **vista pública, viva y filtrable** de qué se necesita, dónde y
con qué urgencia — y un flujo de reporte ultraligero para quien está en terreno.

Construida como respuesta al doblete sísmico de Venezuela (24 jun 2026).

> ## FOCO NO es un servicio de emergencia
> No reemplaza a bomberos, Protección Civil ni al 911. Ante peligro inmediato,
> contacta a las líneas oficiales. FOCO **coordina** ayuda ciudadana; no despacha
> rescates ni garantiza respuesta.

---

## In English (summary)

FOCO is an offline-first PWA to coordinate help after an emergency. It turns
scattered reports into a **public, live, filterable view** of what is needed,
where and how urgently — plus an ultra-light reporting flow for people on the
ground. Built in response to Venezuela's earthquake doublet (Jun 24, 2026).

**FOCO is NOT an emergency service.** It does not replace firefighters, civil
protection or emergency lines. It *coordinates* citizen aid; it does not dispatch
rescues or guarantee a response.

- **The web app is bilingual (Spanish / English).** Language auto-detects from the
  browser and can be switched with the ES/EN toggle in the header; the preference
  is remembered. Place names and source descriptions stay in Spanish (data); need
  summaries are translated to English in the pipeline (`resumen_en`) and shown
  according to the selected language.
- **Two audiences:** people who *help* (rescuers, brigades, donors) use the home
  (`/`) and operational map (`/mapa`); people who *report / are affected* use
  `/reportar` and `/recursos`.
- **Privacy by design:** contact info and exact coordinates live in a private
  subdocument readable only by verified coordinators; public location is at
  sector level (~1 km).
- **Open data API:** read-only JSON/CSV at `/api` (see `/api.html`), no personal
  data, with an English summary field (`descripcion_en`).
- **Run your own / contribute:** see the Spanish sections below, `CONTRIBUTING.md`
  and `MVP-Spec-Mapa-Ayuda-Venezuela.md`. The stack is Vite + Svelte + Firebase.

## Para quién es

FOCO sirve a dos audiencias, sin pedirles que entiendan la otra:

- **Quien colabora** (rescatista, brigada, donante, voluntario, diáspora) pregunta
  *"¿dónde y qué se necesita más?"* → la **home** (`/`) lo cuenta como historia de
  datos y el **mapa operativo** (`/mapa`) lo lleva al punto de mayor necesidad.
- **Quien reporta / está afectado** (estrés, poca señal, poca batería) necesita
  *reportar en <60 s* o *encontrar un recurso cercano* → `/reportar` y `/recursos`.

## Cómo funciona (modelo de datos)

A diferencia de un panel cerrado, el centro de FOCO es un **mapa público con
validación por multitud**:

- Una **necesidad** es un documento público a **nivel de sector** (coords
  redondeadas ~1 km). Cualquiera puede verla en el mapa, incluso sin verificar.
- El **contacto** y las **coordenadas exactas** viven aparte, en un subdocumento
  privado (`/privado/datos`) legible **solo** por un coordinador verificado.
- La **validación es ciudadana**: cualquiera puede *confirmar* un caso. Una Cloud
  Function cuenta las confirmaciones (1 por persona) y, al alcanzar un umbral
  sensible a la densidad del sector, marca el caso como `confirmada`. Lo que lleva
  mucho sin alcanzar el umbral **no se oculta**: pasa a `pendiente_revision` (cola
  del operador, *más* visible).
- Un **recurso** (agua, refugio, médico, transporte…) es un documento público
  análogo, mapeado y mostrado junto a las necesidades.

### Prioridad derivada, no auto-declarada

En vez de confiar en la urgencia que marca el usuario (ruidosa: todos marcan
"crítica"), FOCO **deriva** una prioridad `[0,100]` de señales estructuradas del
reporte (personas atrapadas con señales de vida, medicamento crítico, severidad,
vulnerables, escala) y la **decae con el tiempo** si no se reconfirma. El motor es
puro y testeable (`src/lib/prioridad.js`); la urgencia que colorea el mapa se
deriva de la banda de prioridad. Ver `MVP-Spec-Mapa-Ayuda-Venezuela.md` §25.

### El curador mantiene la verdad viva

Una Cloud Function agendada (`functions/curador.js`) corre cada hora y, de forma
**idempotente y conservadora**: enriquece documentos antiguos, recalcula la
prioridad con decaimiento, y **deduplica** marcando `duplicado_de` solo en alta
confianza (lo dudoso va a una cola que revisa un coordinador). Línea roja: nunca
marca como duplicado un reporte ciudadano. Las lecturas ocultan los duplicados.

## Stack

- **Frontend:** Vite + Svelte 4 + vite-plugin-pwa (peso mínimo para 2G/3G).
- **Backend:** Firebase — Firestore (offline + realtime), Auth (anónimo +
  email), Hosting, App Check (reCAPTCHA Enterprise con enforcement), **Cloud
  Functions v2** (Node 22).
- **Mapa:** Leaflet + leaflet.markercluster + OSM (diferido y cacheado).
  **Geo:** geofire-common (geohash). **Correo:** Resend (vía Cloud Function).

## Modelo de seguridad

La seguridad **no** depende de ocultar el código (este repo es público):

1. **App Check con enforcement** en Firestore: rechaza clientes no atestiguados.
2. **Custom claim `coordinador`** (no spoofeable) para leer datos privados y
   gestionar casos.
3. **Security rules** con validación estricta de esquema, valores y autoría
   (`firestore.rules`), cubiertas por tests (`tests/rules.test.js`). El esquema
   canónico v2 y el legado v1 coexisten durante la migración.
4. Lo que toca **secretos** o no debe ser manipulable por el cliente (contador de
   confirmaciones, envío de correo, curado) vive en **Cloud Functions** con Admin
   SDK; la API key de Resend vive en **Secret Manager**, nunca en el cliente.
5. La **API key web** del config de Firebase es **pública por diseño** (va en el
   bundle). No es un secreto; lo que protege los datos son las rules + App Check.

## Cloud Functions

Detalle en [`functions/README.md`](functions/README.md). Las 6 funciones (2ª gen,
`us-central1`):

| Función | Tipo | Qué hace |
|---|---|---|
| `onConfirmacion` | trigger Firestore | Cuenta confirmaciones y marca `confirmada` al umbral (sensible a densidad). |
| `marcarAislados` | agendada (60 min) | Necesidades viejas sin alcanzar umbral → `pendiente_revision`. |
| `curador` | agendada (60 min) | Enriquece, recalcula prioridad con decaimiento, deduplica conservador (§25.8). |
| `solicitarCoordinador` | callable | Postulación de coordinador → correo (Resend). |
| `solicitarResolucion` | callable | "Resuelto" / "Corrección" de un punto del mapa → correo al coordinador (no toca datos). |
| `api` | HTTP público | API de datos abiertos (solo lectura, sin PII), cacheada en CDN. Ver abajo. |

## API pública de datos abiertos

FOCO publica sus datos **públicos** (sin datos personales) para que medios, ONGs,
otros mapas o investigadores los consuman. Solo lectura, CORS abierto, **cacheada
~5 min** en el CDN (no es un servicio de emergencia; uso libre con atribución).

| Endpoint | Devuelve |
|---|---|
| `https://focovenezuela.org/api/necesidades.json` | Necesidades públicas (JSON) |
| `https://focovenezuela.org/api/necesidades.csv` | Necesidades públicas (CSV) |
| `https://focovenezuela.org/api/recursos.json` | Recursos disponibles (JSON) |
| `https://focovenezuela.org/api/recursos.csv` | Recursos disponibles (CSV) |
| `https://focovenezuela.org/api/` | Índice de la API |

**Nunca** expone contacto ni coordenadas exactas (viven en el subdoc privado, solo
coordinador). La ubicación es a **nivel de sector (~1km)** salvo sitios públicos
(`precision: "exacta"`). El texto usa el `resumen` saneado cuando existe.

## Ingesta de datos (operador)

FOCO se nutre de fuentes ciudadanas externas (la mayoría exponen API pública). Los
importadores son reversibles por `tag` y soportan `--dry-run`/`--exacto`/`--clear`:

- `scripts/import-csv.mjs` — importa **necesidades** desde CSV (geocoding Nominatim).
- `scripts/import-recursos.mjs` — importa **recursos** a la colección `recursos`.
- `scripts/import-comentarios.mjs` — triaje de comentarios ciudadanos → señal de
  rescate (dedup por edificio, PII omitida).
- `scripts/extract-*.mjs` — extractores por fuente (terremotovenezuela, ayudavenezuela…).

> Los datos fuente del operador (`*.csv`, backups, comentarios crudos con PII)
> están en `.gitignore` y **nunca** se suben al repo público.

## Desplegar tu propia instancia

```bash
# 1. Requisitos: Node 22, Java 21 (emulador de rules), Firebase CLI,
#    cuenta Firebase (plan Blaze — las Functions 2ª gen lo requieren).
git clone https://github.com/leanaraque/foco-vzla.git
cd foco-vzla
npm install

# 2. Crea tu proyecto Firebase y pon su config en src/lib/firebase.js.
#    Habilita Auth (anónimo + email/password) y crea Firestore (modo nativo).
#    Ajusta el id del proyecto en .firebaserc.

# 3. App Check: crea una key reCAPTCHA Enterprise y ponla en .env.local
cp .env.example .env.local   # rellena VITE_RECAPTCHA_SITE_KEY (key pública del sitio)

# 4. Desarrollo
npm run dev

# 5. Tests
npm run test:unit                                            # capa de datos (sin emulador)
firebase emulators:exec --only firestore "npm run test:rules"  # security rules (Java)

# 6. Secreto del correo (antes de desplegar las callables)
firebase functions:secrets:set RESEND_API_KEY

# 7. Deploy
npm run deploy           # build + hosting + reglas + funciones (firebase deploy)
npm run deploy:hosting   # solo hosting (no toca rules/functions)
npm run deploy:rules     # solo rules + índices
```

> Tras un deploy de hosting, el service worker exige **una recarga** para servir
> lo nuevo. El primer despliegue de Functions 2ª gen requiere conceder roles IAM
> una sola vez (ver [`functions/README.md`](functions/README.md)).

## Alta de coordinador

El coordinador se registra (email/contraseña) y luego, server-side, se le concede
el custom claim:

```bash
gcloud auth application-default login
node scripts/grant-coordinator.mjs persona@ejemplo.com
```

## Datos demo (para pruebas, sin tocar producción)

```bash
node scripts/seed-demo.mjs          # carga datos ficticios en colecciones _demo_*
# Verlos: https://<tu-host>/panel?demo=1  (o /mapa?demo=1)
node scripts/seed-demo.mjs --clear  # limpiar
```

## Estructura

```
src/
  routes/      Inicio · Mapa · Reportar · Recursos · Panel
  components/  EmergencyBanner · MapaUnificado · NeedCard · CoordinatorForm
               LugarAutocomplete · BrechaZona · Composicion · Fuentes
  lib/         firebase.js · db.js · payload.js · prioridad.js · geo.js
               stores.js · i18n.js · autocomplete.js · regiones.js · lugares.json
functions/
  index.js · curador.js          Cloud Functions (confirmación, curado, correo)
firestore.rules                  frontera de privacidad (auditable, con tests)
firestore.indexes.json           índices de las consultas del panel/mapa
scripts/                         importadores, extractores, alta de coord, seed demo
tests/                           rules.test.js · payload · prioridad · autocomplete
MVP-Spec-Mapa-Ayuda-Venezuela.md especificación y registro de decisiones (fuente de verdad)
```

## Documentos

- [`PRIVACY.md`](PRIVACY.md) — qué se guarda y qué no.
- [`SECURITY.md`](SECURITY.md) — modelo de amenaza y divulgación responsable.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — cómo contribuir y correr los tests.
- [`TESTING.md`](TESTING.md) — checklist de QA manual en red lenta / offline.
- [`functions/README.md`](functions/README.md) — Cloud Functions, secretos e IAM.

## Licencia

[MIT](LICENSE).
