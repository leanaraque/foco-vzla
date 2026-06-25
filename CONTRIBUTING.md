# Contribuir a FOCO

Gracias por querer ayudar. FOCO es una herramienta de **respuesta a emergencia**:
coordina ayuda ciudadana tras un desastre. Eso fija nuestras prioridades —
**privacidad de las personas afectadas, fiabilidad en redes malas y simplicidad**
por encima de funcionalidades vistosas.

> Antes de empezar, lee [`SECURITY.md`](SECURITY.md), [`PRIVACY.md`](PRIVACY.md) y
> el [Código de Conducta](CODE_OF_CONDUCT.md). El alcance del producto está en
> `MVP-Spec-Mapa-Ayuda-Venezuela.md` (fuente de verdad).

## Principios que no se negocian

- **No es un servicio de emergencia.** Nada en la app debe prometer rescate.
- **Privacidad por diseño.** El contacto y las coordenadas exactas viven en el
  subdocumento privado; nunca los expongas en documentos públicos ni en logs.
- **Offline-first y liviano.** Debe funcionar en 2G/3G y sin conexión. Piensa el
  peso de cada dependencia antes de añadirla.
- **Anti-rumor.** Lo no verificado se marca; nunca se presenta como hecho.

## Poner en marcha el proyecto

```bash
npm install
cp .env.example .env.local   # rellena VITE_RECAPTCHA_SITE_KEY (App Check)
npm run dev
```

## Correr los tests (obligatorio antes de un PR)

```bash
npm run test:unit    # tests de la capa de datos (no requieren emulador)
# tests de security rules (requieren el emulador de Firestore + Java 21):
firebase emulators:exec --only firestore "npm run test:rules"
```

Las **security rules son la frontera de privacidad**: cualquier cambio en
`firestore.rules` debe venir con tests que lo cubran. Un PR que toque las rules
sin tests no se acepta. El CI (`.github/workflows/`) corre los rules tests y el
secret-scanning en cada PR.

## Estilo de código

- JavaScript moderno (ESM), Svelte para la UI. Sin TypeScript en Fase 1.
- Sigue el estilo del código que rodea tu cambio (naming, comentarios, densidad).
- Comenta **el porqué**, no el qué — especialmente en seguridad y offline, donde
  hay sutilezas (mira los comentarios de `src/lib/db.js`).
- No metas dependencias pesadas sin justificar el coste en peso (objetivo 2G/3G).

## Flujo de Pull Request

1. Crea una rama desde `main`: `git checkout -b fix/breve-descripcion`.
2. Haz cambios pequeños y enfocados; un PR, un tema.
3. Corre los tests (unit + rules) y, si tocas UI, pruébalo en throttling 3G
   (ver [`TESTING.md`](TESTING.md)).
4. Abre el PR con la plantilla; describe el qué, el porqué y cómo lo probaste.
5. Si tu cambio afecta privacidad, costo de Firestore o el alcance de la spec,
   dilo explícitamente — esos PRs reciben revisión extra.

## Seguridad

¿Encontraste una vulnerabilidad? **No abras un issue público.** Sigue el proceso
de divulgación responsable de [`SECURITY.md`](SECURITY.md).

## Datos

Nunca subas datos reales de personas afectadas a fixtures, tests, capturas ni
issues. Usa solo datos ficticios (las colecciones `_demo_*` y `scripts/seed-demo.mjs`).
