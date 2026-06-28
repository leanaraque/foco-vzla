# Fase "procesar" (§25) — estado y handoff

Estandariza, **resume** y mejora la **geo** de cada punto para que un rescatista entienda
el contenido exacto al instante, de forma **recurrente, idempotente y con compuerta**.

**Estado: DESPLEGADO en producción + backfill completo.** Última actualización: 2026-06-28.

## Qué quedó funcionando

- **Función agendada `procesador`** (`functions/procesador.js`): `onSchedule` cada 2h.
  Toma un lote de necesidades **nuevas o cambiadas** (filtro por hash de contenido →
  no re-llama al LLM por lo ya procesado, controla costo) y por cada una corre
  `procesarUno`. Auto-aplica lo confiable; la geo dudosa va a `_procesar_revision`
  (cola del operador). `ANTHROPIC_API_KEY` vive en Secret Manager.
- **Orquestación pura** (`functions/lib/procesar.js`): `procesarUno(rec)` =
  `extraer` (tipado §25) + `enriquecer` (geo OSM) + `resumenIA` (reglas + Claude Haiku
  anclado). `hashContenido` / `necesitaProceso` dan la idempotencia.
- **Backfill único** (`scripts/procesar-backfill.mjs`): ya corrido →
  **832/832 necesidades vivas, 100% vía IA, 0 fallos, 0 a revisión** (~23 min). Los 103
  sin procesar son los duplicados (correcto). Idempotente y no destructivo (`updateMask`).
- **Muestra de revisión** (`scripts/procesar-muestra.mjs`): SOLO LECTURA, para ver la
  propuesta sobre datos reales antes de aplicar (se usó para el gate).
- **Web**: mapa (popup), lista y `NeedCard` prefieren `resumen` (cae a `descripcion`).
- **Tests**: `tests/procesar.test.js` (36) — suite total 150 verde.

### Verificado en vivo (focovenezuela.org/mapa, 2026-06-28)
1.376 tarjetas: **0 teléfonos, 0 cédulas** visibles; menciones de muerte solo cuando la
fuente la confirma (la guarda de seguridad bloquea la inventada).

## Guardas de seguridad (cazadas en el gate sobre muestra real)
- **Anti-muerte**: el resumen NUNCA afirma/insinúa "sin vida"/fallecido salvo que el
  campo tipado `senales.fallecidos` lo confirme. La IA había inferido "sin vida aparente"
  desde la *ausencia* de señales — en rescate despriorizaría a alguien vivo.
- **Sin PII**: `scrubPII` sobre la entrada y guarda final sobre la salida; si la IA
  devuelve PII → descarta y usa el determinista.
- **Rescate conservador pero completo**: "N personas por rescatar" y "entre los escombros"
  cuentan como `rescate_activo` (sin confundir con la *necesidad* "Búsqueda y rescate").

## Limitación geográfica (decisión: conservador con OSM gratis)
OSM/Nominatim **no tiene** los edificios puntuales de La Guaira/Caracas (solo responde
centroides de ciudad). Por eso el enricher **confía las coords exactas de la fuente** y
no finge precisión: un único hit lejano no mueve coords ni marca conflicto. Para exactitud
a nivel edificio haría falta **geocoder pago** (Google) o **pin manual del operador** —
pendiente de decisión si se retoma.

## Operación / comandos
```bash
# Ver propuesta sobre muestra real (no escribe):
node scripts/procesar-muestra.mjs --n=8
# Backfill manual (idempotente; salta lo ya procesado):
node scripts/procesar-backfill.mjs            # dry-run
node scripts/procesar-backfill.mjs --apply
# Desplegar:
npx firebase-tools deploy --only functions:procesador,firestore:rules
```

---

# PENDIENTE para retomar: procesar RECURSOS / acopio

Hoy el procesador solo toca **necesidades**. Los **recursos** (acopio, refugio, hospitales;
~280, de rescate-ve + CSV) siguen mostrando su **texto crudo** (p.ej. "Fuente: rescate-ve
(acopio)"). Falta darles el mismo tratamiento.

### Plan concreto (mismo patrón, reutilizando lo construido)
1. **`functions/lib/extraerRecurso.js`** — tipa el recurso: `tipo` (acopio/refugio/medico/
   agua), `ofrece`/`recibe` (vocabulario normalizado de `supply_types`), `estado`
   (activo/lleno/cerrado), `horario` si aparece. Espejo de `extraer.js` pero para oferta.
2. **Resumen** — extender `resumen.js` con un `SYSTEM_RESUMEN_RECURSO` (o un determinista
   de recursos): 1 frase clara tipo *"Centro de acopio en X — recibe agua, alimentos y
   medicinas. Activo."* Misma guarda sin-PII.
3. **Geo** — los recursos de rescate-ve traen lat/lng (precision exacta) → confiar; los de
   solo-sector → `enriquecer` como las necesidades. Reusar `procesarUno` con una rama
   `destino==='recurso'`, o un `procesarRecurso` análogo.
4. **Procesador** — que la función agendada también itere `recursos` (mismo hash/idempotencia
   y tope por run), o una segunda función gemela. Reglas: añadir `_procesar_revision` ya
   cubre; no hace falta colección nueva.
5. **Backfill** — `scripts/procesar-backfill.mjs` parametrizado por colección (`--col=recursos`).
6. **Web** — preferir `resumen` en los popups/tarjetas de recursos:
   `MapaUnificado.svelte` (popup recurso, ~línea 82), `Mapa.svelte` (lista recurso, ~217),
   `Recursos.svelte`, `Mapa.svelte` buscador de recursos (~51). Mismo `r.resumen || r.descripcion`.
7. **Tests** + dry-run de muestra (`--col=recursos`) → gate (mostrar a Lean) → desplegar.

### Resto del backlog §25 (menor prioridad)
- Dedup **cross-source** endurecido (el mismo edificio por 2-3 fuentes; ver Plan).
- **Frescura / decay** de prioridad por antigüedad.
- Adapters Supabase pendientes (ver `functions/adapters/PENDIENTES.md`).
