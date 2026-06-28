# Especificación de MVP — Plataforma de Coordinación de Ayuda
## Respuesta al doblete sísmico de Venezuela (24 jun 2026)

> **Estado:** Borrador para construcción por el agente de Claude Code.
> **Rol del autor:** Estratega/juez. Esta spec define *qué* y *por qué*; el agente decide los detalles de *cómo* dentro de las restricciones aquí fijadas.
> **Fecha:** 25 jun 2026.

---

## 1. Contexto y propósito

El 24 de junio de 2026 un doblete sísmico (M7.2 + M7.5, ~40s de diferencia) golpeó la costa norte de Venezuela cerca de Morón (Carabobo). Saldo preliminar: 164+ fallecidos, ~971 heridos, colapsos en Caracas, servicios suspendidos y ~100% de probabilidad de réplicas (USGS). **Es una emergencia activa.**

**Propósito del producto:** convertir reportes dispersos de necesidades en acción coordinada, dándole a los coordinadores de ayuda en terreno una vista única, verificada y filtrable de qué se necesita, dónde y con qué urgencia — y un mecanismo para reclamar y cerrar casos.

**Lo que NO es:** no es un servicio de emergencia (no reemplaza a bomberos/Protección Civil/911), no es un buscador de desaparecidos, no es red social. Estas exclusiones son deliberadas.

---

## 2. Usuarios

| Prioridad | Usuario | Rol en el sistema | Diseñamos para él |
|---|---|---|---|
| **Primario** | Coordinador de ayuda local (voluntario, brigada vecinal, rescatista, ONG en terreno) | Ve, filtra, reclama y cierra necesidades | **Sí — el panel es para él** |
| Secundario | Afectado / testigo en terreno | Reporta una necesidad | Flujo de reporte ultraligero, no el panel |
| Terciario (Fase 2) | Diáspora / donante | Financia necesidades verificadas | Vista pública de solo lectura, después |

**Decisión clave:** el sistema se ancla en el coordinador porque es el cuello de botella real (sobran reportes, falta quién actúe), es reclutable e identificable, y su presencia evita el daño de generar falsas esperanzas.

---

## 3. Casos de uso (Fase 1)

**Coordinador:**
1. Ver todas las necesidades en mapa y lista, filtradas por zona, categoría y urgencia.
2. Ver el estado de cada necesidad (sin atender / asignada / resuelta) y quién la reclamó.
3. Reclamar una necesidad ("yo me encargo") y luego marcarla resuelta o reabrirla.
4. Ver solo necesidades verificadas por defecto; las no verificadas van marcadas.
5. Registrar un recurso disponible (agua, transporte, refugio, médico) para que otros lo vean.

**Afectado / testigo:**
6. Reportar una necesidad en <60s: categoría, urgencia, ubicación, descripción corta, contacto opcional.
7. Reportar vía web O vía SMS/WhatsApp cuando no hay datos móviles (fallback).

**Sistema:**
8. Marcar como "verificada" una necesidad confirmada por ≥2 fuentes o por un coordinador.
9. Deduplicar reportes cercanos de la misma necesidad.

---

## 4. Modelo de datos (mínimo)

```
Necesidad
  id
  categoria        # rescate | medico | agua | alimento | refugio | otro
  urgencia         # critica | alta | media
  ubicacion        # lat/lng aproximada + texto libre (sector/referencia)
  descripcion      # texto corto
  contacto         # opcional, NO público por defecto
  estado           # sin_atender | asignada | resuelta | cerrada_invalida
  verificacion     # no_verificada | verificada
  fuente           # web | sms | whatsapp | coordinador
  reclamada_por    # id de coordinador, nullable
  creada_en / actualizada_en

Recurso
  id
  categoria        # agua | transporte | refugio | medico | alimento | otro
  ubicacion
  descripcion
  contacto
  disponible       # bool
  creada_en

Coordinador
  id
  nombre / organizacion
  zona
  verificado       # bool (alta controlada)
```

**Principio de privacidad:** el contacto de un afectado nunca es público; solo visible para coordinadores verificados que reclaman el caso. La ubicación de personas vulnerables se muestra a nivel de sector, no de coordenada exacta.

---

## 5. Reglas de verificación y anti-desinformación

- Toda necesidad nace como `no_verificada` y se muestra **claramente marcada** como tal.
- Pasa a `verificada` por: (a) confirmación de ≥2 reportes independientes en el mismo punto, o (b) validación manual de un coordinador verificado.
- El panel del coordinador filtra a `verificada` por defecto; ver no-verificadas es una acción explícita.
- Enlaces a fuentes oficiales (Protección Civil, Funvisis, bomberos) visibles en todo momento.
- Banner permanente: *"Esto coordina ayuda ciudadana; no es un servicio de emergencia. Ante peligro inmediato, contacte a [líneas oficiales]."*

---

## 6. Restricciones técnicas (no negociables)

1. **Offline-first.** PWA que cachea datos y permite reportar sin conexión; sincroniza al recuperar señal. La conectividad en Venezuela es intermitente.
2. **Fallback sin datos.** Ingesta de reportes por SMS y/o WhatsApp para zonas sin internet. (Fase 1b si no entra en el primer corte.)
3. **Liviano.** Debe cargar en redes 2G/3G; presupuesto de peso estricto, sin librerías pesadas innecesarias.
4. **Móvil primero.** El 90% de afectados y coordinadores usará teléfono.
5. **Bilingüe-ready.** Español por defecto; arquitectura que permita i18n.
6. **Bajo costo y desplegable rápido.** Stack que un equipo pequeño pueda hostear barato y escalar.

### 6.1 Stack: Firebase (decidido)

El stack es **Firebase**, decisión validada estratégicamente: maximiza velocidad de entrega bajo emergencia, el equipo ya lo domina, y encaja con las restricciones — Firestore trae *offline-first* y sincronización nativos (restricción #1), tiempo real para el panel, auth con roles, serverless (resuelve el handoff sin ops) y Cloud Functions para el gateway SMS y la deduplicación.

**Componentes:**
- **Firestore** — base de datos (offline + realtime).
- **Firebase Auth** — roles coordinador-verificado vs. público.
- **Firebase Hosting** — PWA.
- **Cloud Functions** — gateway SMS/WhatsApp y deduplicación (Fase 1b).

### 6.2 Riesgos de Firebase como restricciones de diseño (obligatorias)

Estos dos riesgos se tratan como restricciones de diseño desde el día 1, no como parches posteriores:

1. **Control de costo de lecturas (Firestore cobra por lectura de documento).** La vista pública/mapa puede disparar lecturas y factura. Mitigaciones obligatorias en Fase 1: caché agresivo, *bundles* / snapshots agregados para la vista pública, límites de frecuencia de refresco, paginación. Meta: que un pico viral no quiebre el presupuesto.
2. **Reglas de seguridad de Firestore = frontera de privacidad.** Las guardas (contacto privado por rol, ubicación a nivel sector) se enforcan en las *security rules*. Es el punto exacto donde se filtran datos sensibles. Requisito: auditoría explícita de reglas antes de cada lanzamiento de fase.

> Consultas geográficas: Firestore requiere geohashing (p. ej. GeoFirestore) para el mapa; problema conocido y resuelto, presupuestar tiempo para ello.

---

## 7. Alcance por fases

**Fase 1 (MVP, objetivo: días):**
- Reporte web de necesidades (casos 6).
- Panel de coordinador: mapa + lista + filtros + reclamar/cerrar (casos 1–4).
- Verificación básica (sección 5).
- Registro de recursos (caso 5).

**Fase 1b:**
- Fallback SMS/WhatsApp (caso 7).
- Deduplicación automática (caso 9).

**Fase 2:**
- Vista pública para diáspora/donantes con necesidades verificadas.
- Interoperabilidad: si se integra búsqueda de personas, usar el estándar **PFIF (Google Person Finder)** en vez de reconstruir — no competir con los sitios existentes.

**Fuera de alcance (explícito):** chat entre usuarios, cuentas sociales, gamificación, pagos dentro de la app en Fase 1.

---

## 8. Criterios de "listo" (Definition of Done)

Una funcionalidad está lista cuando:
- Funciona en móvil en una red lenta simulada (throttling 3G).
- El flujo de reporte se completa en <60s en un teléfono de gama baja.
- Los datos persisten offline y sincronizan sin pérdida al reconectar.
- Ningún dato de contacto personal es visible sin rol de coordinador verificado.
- Toda necesidad muestra su estado de verificación.
- El banner de "no es servicio de emergencia" es visible en todas las vistas.

---

## 9. Guardas éticas (veto del juez)

Estas son condiciones de aprobación, no sugerencias:
1. **Privacidad por diseño** — mínimos datos personales; contacto nunca público. **El contacto y las coordenadas exactas viven en un subdocumento privado** legible solo por coordinador verificado. La **descripción** de una necesidad es texto libre y **se hace pública al verificarse**; por eso (a) el flujo de reporte advierte explícitamente *"no escribas datos personales, son públicos"* (F2), y (b) **el coordinador debe revisar la descripción antes de verificar** y descartar/editar lo que contenga datos personales — verificar es el punto de control humano de privacidad, no solo de veracidad.
   - **Campo `creador` (decisión D8):** el documento público lleva el `creador` (uid **anónimo** del reportante). Mientras la necesidad está `no_verificada` solo lo ven coordinadores; al verificarse, ese uid queda públicamente legible. Se mantiene en el doc público a propósito porque la regla F1 (impedir que alguien adjunte un contacto falso a una necesidad ajena) valida la autoría leyendo `parent.creador`, y la dedup de Fase 1b lo requiere. **Riesgo residual:** un observador podría agrupar reportes verificados del mismo uid anónimo (correlación), aunque el uid no mapea a identidad sin acceso Admin y no es PII. **Mitigación futura (Fase 1b):** si la correlación resulta dañina, mover la dedup a una función server-side que lea un campo privado, o despojar `creador` del padre al verificar mediante Cloud Function.
2. **No falsas esperanzas** — nada que prometa rescate; el rol del software es coordinar.
3. **Anti-rumor** — lo no verificado se marca; nunca se presenta como hecho.
4. **Plan de handoff** — definir quién opera la plataforma en la semana 2 antes de lanzar. Sin operador, no se lanza.
5. **Sin recolección oculta** — transparencia sobre qué se guarda y por qué.

---

## 10. Métricas de éxito (primeras 2 semanas)

- N.º de necesidades verificadas y % que llega a estado `resuelta`.
- Tiempo mediano de `sin_atender` → `asignada`.
- N.º de coordinadores activos recurrentes (el indicador que más importa: si ellos vuelven, el producto vive).
- % de reportes que entran por fallback SMS (mide alcance en zonas sin datos).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cold-start: panel vacío sin coordinadores | Reclutar 5–10 coordinadores ANTES del lanzamiento; sembrar zonas. |
| Desinformación / reportes falsos | Verificación de doble fuente + validación de coordinador. |
| Exposición de datos sensibles | Contacto privado por rol; ubicación a nivel sector. |
| Sobrecarga si se viraliza | Stack escalable + rate-limiting en reportes. |
| Abandono post-emergencia | Plan de handoff definido desde el día 1. |

---

---

## 12. Metodología de trabajo (gate por fases)

Trabajamos **fase a fase**, con un *gate* de validación entre cada una. Ninguna fase empieza hasta que la anterior pase los tres pasos:

1. **Construcción** — el agente de Claude Code implementa la fase contra esta spec.
2. **Validación del jurado** — revisión contra: criterios de "listo" (§8), guardas éticas (§9) y las restricciones de Firebase (§6.2, con auditoría de *security rules*). El jurado da check o devuelve con observaciones.
3. **Testeo del responsable (Lean)** — prueba funcional en condiciones reales (móvil, red lenta). Da check o reporta.

**Regla de avance:** solo con los tres checks (construcción + jurado + testeo) se pasa a la siguiente fase. Si algo falla, se corrige y se vuelve a validar antes de avanzar.

| Gate | Construye | Valida jurado | Testea Lean |
|---|---|---|---|
| Fase 1 | Agente | ✅ requerido | ✅ requerido |
| Fase 1b | Agente | ✅ requerido | ✅ requerido |
| Fase 2 | Agente | ✅ requerido | ✅ requerido |

---

---

## 13. Registro de decisiones técnicas

Decisiones cerradas (no se vuelven a litigar salvo cambio de contexto):

| # | Decisión | Justificación |
|---|---|---|
| D1 | **Frontend: Vite + Svelte + vite-plugin-pwa** | Menor peso en cliente (Svelte compila y elimina el framework); óptimo para 2G/3G (§6). Preact era fallback aceptable. |
| D2 | **Reportante: Firebase Anonymous Auth** | Sin fricción para el afectado (<60s) pero con UID estable para rules, dedup y rate-limiting. Escritura abierta **vetada**. |
| D3 | **Coordinador: Auth Google/email + custom claim `coordinador:true`** | Rol no spoofeable; alta controlada vía Admin SDK (§4). |
| D4 | **Privacidad por subdocumento** `necesidades/{id}/privado/datos` | Las rules de Firestore son por-documento y no ocultan campos; separar contacto y coords exactas es la forma correcta de cumplir §6.2-r2. |
| D5 | **Geo: geofire-common (geohash)** | Ligero frente a GeoFirestore; coords públicas redondeadas (~1km), exactas solo en subdoc privado. |
| D6 | **Proyecto Firebase: `foco-vzla`** | Creado. El config web (apiKey) es público por diseño; la seguridad la dan las rules. |
| D7 | **App Check con reCAPTCHA *Enterprise*** (no v3 clásico) | El v3 clásico exige la consola de reCAPTCHA; Enterprise es 100% provisionable por API (`gcloud recaptcha keys create` + Admin API de App Check), lo que permitió automatizar el cierre de §14-1. Site key pública por diseño; la defensa la da el *enforcement* server-side. Site key: `6LfQ2zMtAAAAAEQgln84biLpIQ7HodgCK6pXL3MH`. |
| D8 | **`creador` (uid anónimo) permanece en el doc público** | Decisión tras nota del jurado (§19). La regla F1 que impide adjuntar un `/privado/datos` falso a una necesidad ajena hace `get()` de `parent.creador` para verificar autoría; ese campo debe vivir en el padre (única fuente legible por la regla en el momento de crear el privado). Además la **dedup de Fase 1b** (caso 9) lo necesita. Es un **uid anónimo, no PII**, y solo se hace público cuando un coordinador verifica la necesidad. Riesgo residual (correlación de reportes del mismo anónimo) y mitigación futura documentados en §9-1. |

## 14. Condiciones de aprobación del gate de Fase 1 (jurado)

El plan de Fase 1 del agente queda **aprobado para construir**, pero el *check del jurado* (§12) no se otorga hasta cumplir:

1. **Firebase App Check (reCAPTCHA web) habilitado.** Auth anónimo permite UIDs ilimitados; sin App Check no hay defensa real contra spam ni contra el costo descontrolado (§6.2-r1). Es la mitigación anti-desinformación de fondo.
2. **Reglas `create` con validación de esquema estricta** (tipos, tamaños y enums de `categoria`/`urgencia`), porque `necesidades/{id}` es de lectura pública.
3. **Secreto del Admin SDK blindado** — el service account del script de alta de coordinadores nunca al repo (`.gitignore` + secret manager); el script corre solo server-side. El config web NO es el secreto.
4. **Analytics evaluado contra el presupuesto de peso/datos** (§6) — diferir o cargar condicional en redes lentas. Prioridad baja pero registrado.

**Bloqueante de lanzamiento (no de build), §9-4:** sin operador definido para la semana 2, no se lanza a producción. Decisión humana de Lean.

---

---

## 15. Estado del gate de Fase 1 (auditoría del jurado — 25 jun 2026)

**Veredicto: GATE NO CERRADO.** App desplegada en staging (`https://foco-vzla.web.app`); construcción completa. Pendiente de cerrar antes del check del jurado y el testeo de Lean.

**Bloqueantes:**

| # | Bloqueante | Por qué bloquea |
|---|---|---|
| B1 | **Rules tests escritos pero NO ejecutados** | La privacidad (§6.2-r2) es la guarda de veto y descansa en tests sin correr. El ✅ de "contacto no visible sin rol" es inválido hasta que el emulador los ejecute y pasen. Un test sin correr no es evidencia. |
| B2 | **App Check sin enforcement (§14-1)** | Solo cableado en cliente; falta key reCAPTCHA + activar enforcement. Defensa #1 contra abuso/costo con auth anónimo. |

**Correcciones de sobre-acreditación (pasan a "construido, sin probar"):**
- "Carga en 2G/3G" — pendiente del testeo en dispositivo real (bundle Firebase 138 KB gzip es el riesgo a exponer).
- "Persiste offline y sincroniza" — pendiente de verificación en testeo de Lean.

**Aprobado por el jurado:** aislamiento de subdoc privado (diseño), §14-2 enums estrictos, §14-3 secreto Admin SDK (ADC), §14-4 Analytics omitido, guardas §9 1–3 y 5 (diseño).

**Restricción de proceso:** staging permitido; **sin usuarios reales ni datos de víctimas** hasta cerrar B1 + B2.

**Orden acordado para cerrar:** (1) agente configura App Check + enforcement; (2) agente ejecuta rules tests y entrega salida; (3) jurado audita seguridad; (4) Lean hace testeo móvil 3G; (5) Lean define handoff §9-4 antes de cualquier lanzamiento real.

---

## 16. Remediación de bloqueantes — resultados (responsable de doc, 25 jun 2026)

> El agente es responsable del documento. El jurado audita estas salidas; no las edita. Estado: **B1 y B2 remediados con evidencia; pendiente la auditoría final del jurado.**

### B1 — Rules tests EJECUTADOS ✅ (13/13)

Comando: `firebase emulators:exec --only firestore "npm run test:rules"` (emulador Firestore, vitest 2.1.9, Java 21).

```
 ✓ tests/rules.test.js (13 tests) 1985ms
   ✓ necesidades — create > reportante anónimo puede crear necesidad válida
   ✓ necesidades — create > rechaza enum de categoría inválido (§14-2)
   ✓ necesidades — create > rechaza nacer verificada (anti-rumor §9-3)
   ✓ necesidades — create > rechaza descripción demasiado larga
   ✓ necesidades — read > no-verificada NO es legible por usuario normal
   ✓ necesidades — read > verificada SÍ es legible (vista pública Fase 2)
   ✓ necesidades — read > coordinador lee las no-verificadas
   ✓ necesidades — update > coordinador puede verificar
   ✓ necesidades — update > reportante anónimo NO puede verificar
   ✓ necesidades — update > coordinador NO puede reescribir contenido (categoría)
   ✓ privado — coordinador SÍ lee el contacto privado
   ✓ privado — usuario normal NO lee el contacto privado
   ✓ privado — reportante anónimo NO lee el contacto privado

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

Cubre las tres guardas exigidas: contacto/coords exactas ilegibles sin claim `coordinador`, `no_verificada` oculta al público, y validación de enums/tipos/tamaños en `create`. Los `PERMISSION_DENIED` en stderr son los tests negativos (`assertFails`) confirmando la denegación.

### B2 — App Check con enforcement ✅

- **Decisión D7:** reCAPTCHA **Enterprise** (automatizable por API).
- Key creada por API: `gcloud recaptcha keys create --web --domains=foco-vzla.web.app,foco-vzla.firebaseapp.com,localhost --integration-type=score` → `6LfQ2zMtAAAAAEQgln84biLpIQ7HodgCK6pXL3MH`.
- Registrada en App Check (`recaptchaEnterpriseConfig`, `minValidScore 0.5`).
- **Enforcement en Firestore: `ENFORCED`** (App Check Admin API, `services/firestore.googleapis.com`).
- Cliente: `ReCaptchaEnterpriseProvider`; key en `.env.local` (gitignored); rebuild + deploy.

**Evidencia de rechazo** (`node tests/check-appcheck.mjs`, SDK Web SIN `initializeAppCheck`, documento que las rules SÍ aceptan):

```
Sesión anónima OK (uid=Mjc6zxt4PmUz7C3NGVp53L3zSkE3)
✅ Escritura RECHAZADA sin token de App Check (esperado).
   code: permission-denied
   message: 7 PERMISSION_DENIED: Missing or insufficient permissions.
```

Como el rules-test B1 prueba que ese mismo documento es *permitido por las rules*, el rechazo del documento idéntico en producción proviene de App Check, no de las rules.

### Corrección del DoD (§8) — sobre-acreditación retirada

| Criterio §8 | Estado corregido |
|---|---|
| Carga en red lenta 2G/3G | 🔨 **Construido, sin probar** — requiere testeo en dispositivo real (Lean). Riesgo a exponer: bundle Firebase ~140 KB gzip. |
| Persiste offline y sincroniza | 🔨 **Construido, sin probar** — lógica implementada (cola local + ID en cliente); requiere verificación en testeo de Lean. |
| Reporte `<60s` gama baja | 🔨 Construido — a confirmar en testeo de Lean. |
| Contacto no visible sin rol coordinador | ✅ **Verificado** por rules tests (B1). |
| Toda necesidad muestra verificación | ✅ Construido (UI). |
| Banner "no es servicio de emergencia" en todas las vistas | ✅ Construido (global). |

### Estado del gate tras remediación

- ✅ B1 cerrado (tests ejecutados, 13/13).
- ✅ B2 cerrado (App Check enforced, rechazo demostrado).
- ⏳ **Auditoría final del jurado** sobre estas salidas (lo decide el jurado, no el agente).
- ⏳ **Testeo móvil 3G de Lean** en dispositivo real (DoD 2G/3G, offline, <60s).
- ⛔ **Handoff §9-4** — operador para la semana 2; bloquea el lanzamiento (no el build). Decisión de Lean.

**El gate NO se da por cerrado por el agente.** La app sigue en staging sin usuarios reales ni datos de víctimas hasta el visto bueno del jurado y el handoff.

---

## 17. Hallazgos de seguridad de rules — corregidos (25 jun 2026)

> Auditoría del jurado tras aceptar B1/B2: con las rules **públicas** (repo público) cambia el modelo de amenaza — se asume que el atacante las lee. Tres hallazgos abiertos en `firestore.rules`, corregidos y testeados.

**Nuevo modelo de amenaza (documentado en `firestore.rules` y `SECURITY.md`):** la seguridad NO depende de oscuridad sino de (a) App Check con enforcement, (b) custom claim `coordinador` no spoofeable, (c) validación estricta de esquema/valores, (d) ligar cada escritura a su `creador` (uid).

| Hallazgo | Antes | Corrección |
|---|---|---|
| **F1** (prioritario) — `create` del subdoc `/privado/datos` era `if isSignedIn()`: cualquier UID anónimo podía escribir/pisar el contacto de **cualquier id**. | Sin validación de autoría ni esquema. | Ahora exige: esquema/tamaño acotado (`validPrivado`: `keys().hasOnly`, `contacto`≤140, `geo_exacta` tipada), estampa `creador==uid`, y que el autor sea **el mismo que creó la necesidad padre** (`get()` al padre). Sobrescribir un privado existente es `update` → solo coordinador. |
| **F3** — el `update` validaba *qué* campos cambian pero no *los valores*. | `estado`/`verificacion` aceptaban cualquier string. | `updateGestionValido` valida los **enums** de `estado` y `verificacion`. |
| **F2** — `descripcion` es texto libre y queda pública al verificar. | Sin aviso ni control. | (a) Aviso en `/reportar`: *"no escribas datos personales, son públicos"*. (b) Documentado en §9-1: **el coordinador revisa la descripción antes de verificar** (control humano de privacidad). |

**Endurecimiento adicional:** `update` de `recursos` acotado a `disponible`(bool)+`actualizada_en`; colecciones `_demo_*` con lectura pública y escritura solo Admin (datos ficticios para el test 3G).

### Rules tests AMPLIADOS — ejecutados ✅ (24/24, antes 13)

```
 ✓ tests/rules.test.js (24 tests) 2092ms
   necesidades — create:
     ✓ reportante anónimo puede crear necesidad válida
     ✓ rechaza enum de categoría inválido (§14-2)
     ✓ rechaza nacer verificada (anti-rumor §9-3)
     ✓ rechaza descripción demasiado larga
     ✓ rechaza creador suplantado (creador != uid del que escribe)
   necesidades — read / verificación:
     ✓ no-verificada NO es legible por usuario normal
     ✓ verificada SÍ es legible (vista pública Fase 2)
     ✓ coordinador lee las no-verificadas
   necesidades — update (gestión solo coordinador) [F3]:
     ✓ coordinador puede verificar
     ✓ reportante anónimo NO puede verificar
     ✓ coordinador NO puede reescribir contenido reportado (categoría)
     ✓ F3: rechaza valor de estado fuera del enum
     ✓ F3: rechaza valor de verificacion fuera del enum
     ✓ F3: acepta transición de estado válida
   privado — contacto/coords exactas (frontera §6.2-r2):
     ✓ coordinador SÍ lee el contacto privado
     ✓ usuario normal NO lee el contacto privado
     ✓ reportante anónimo NO lee el contacto privado
   privado — escritura abusiva [F1]:
     ✓ el autor SÍ puede crear el privado de su propia necesidad
     ✓ otro anónimo NO puede inyectar el privado de una necesidad ajena
     ✓ no se puede suplantar al autor (creador del privado != uid escritor)
     ✓ NO se puede sobrescribir un contacto ya existente (update solo coord)
     ✓ rechaza contacto demasiado largo
     ✓ rechaza campos desconocidos en el privado
     ✓ rechaza geo_exacta con tipo inválido

 Test Files  1 passed (1)
      Tests  24 passed (24)
```

Rules y frontend (que ahora estampa `creador`) desplegados juntos a `foco-vzla`.

---

## 18. Repositorio público (https://github.com/leanaraque/foco-vzla.git)

El repo será **público**. Implicaciones tratadas:

**Secretos (auditoría P2):**
- `git init` + escaneo: **sin claves privadas, service accounts, `.env` ni contraseñas** en archivos rastreados. `.env.local` confirmado ignorado.
- **Secret-scanning en CI:** workflow `gitleaks` (`.github/workflows/gitleaks.yml`) escanea todo el historial en cada push/PR; `.gitleaks.toml` permite solo los valores públicos-por-diseño. Workflow `rules-tests` corre los 24 tests en cada PR.
- El script de alta de coordinadores usa **ADC** (nunca incrusta credenciales); `serviceAccountKey.json` en `.gitignore`.

**API key web restringida (P2-6):** la key del config (`AIza…`) es **pública por diseño** — va en el bundle del navegador; la seguridad la dan las rules + App Check, no la key. Restringida en GCP a: **referrers HTTP** (`foco-vzla.web.app`, `firebaseapp.com`, `localhost`) y **servicios** (Identity Toolkit, Secure Token, Firestore, App Check, Installations).

**Sin datos reales:** seeds/fixtures solo ficticios (marcados `[DEMO]`, teléfonos inventados) en colecciones `_demo_*` aisladas; sin capturas con datos.

**Andamiaje de repo responsable:**
- `LICENSE` — **MIT**.
- `SECURITY.md` — divulgación responsable (email `hey@leanaraque.com`, alcance, modelo de seguridad).
- `README.md` público — qué es / qué NO es FOCO, advertencia de "no es servicio de emergencia", privacidad, y **cómo desplegar tu propia instancia**.
- `PRIVACY.md` — nota de privacidad y manejo de datos.

**Datos demo para el test 3G de Lean:** `scripts/seed-demo.mjs` (Admin SDK) carga 5 necesidades + 3 recursos ficticios en `_demo_necesidades`/`_demo_recursos`. Visibles en `https://foco-vzla.web.app/panel?demo=1` (sin login, banner "modo DEMO"). Ya sembrados en staging.

### Estado del gate tras §17–§18

- ✅ B1, B2 (aceptados por el jurado).
- ✅ F1, F2, F3 corregidos y testeados (24/24).
- ✅ Repo público asegurado (secretos, API key, licencia, security/privacy, demo).
- ⏳ **Auditoría final del jurado** sobre §17–§18.
- ⏳ **Testeo móvil 3G de Lean** (DoD 2G/3G, offline, <60s) — usar `/panel?demo=1`.
- ⛔ **Handoff §9-4** y **reclutar 5–10 coordinadores** — pendientes de Lean; bloquean lanzamiento, no build.

**El gate NO se da por cerrado por el agente.** Staging sin usuarios reales ni datos de víctimas hasta el visto bueno del jurado y el handoff.

---

## 19. Correctitud offline-first + decisión `creador` (25 jun 2026)

> Mitad de seguridad del gate aprobada por el jurado (F1/F2/F3 verificados en código). Estas son notas de cierre de los pendientes **del agente**; los que faltan son de Lean.

### Corrección — orden de escritura del par necesidad + contacto

**Nota del jurado (correctitud offline-first):** la regla `create` de `/privado/datos` hace `get()` de la necesidad padre para validar autoría (F1). Por tanto el par necesidad+contacto **no puede** escribirse como `writeBatch`/transacción atómica: en un commit atómico el `get()` no ve aún el padre y el contacto se rechaza al sincronizar.

**Estado del código corregido** (`src/lib/db.js`, `crearNecesidad`/`crearRecurso`):
- **No se usa `writeBatch` ni `runTransaction`** en ningún punto (verificado). Son **dos escrituras separadas**.
- La **necesidad (padre) se encola primero** y el **privado después**. Firestore mantiene una cola FIFO de mutaciones y las confirma una a una → el padre se commitea antes y la regla del privado ya lo ve.
- **No se hace `await` entre ambas**: estando offline ese `await` no resolvería hasta reconectar (resuelve con el ack del servidor) y el contacto **nunca** llegaría a la cola local (rompería offline-first §6.1). Ambos `setDoc` se invocan de forma síncrona —encolan en orden— y solo se espera su confirmación con `Promise.all` en `listo`.
- `/reportar` consume `{ id, listo }`: online hace `await listo`; offline marca "guardado sin conexión" sin esperar (las escrituras ya están encoladas). El comentario en el código explica el porqué. **Lo valida el paso 3 de TESTING.md.**

### Decisión — `creador` en el doc público (D8)

Se evaluó la nota menor del jurado (al verificar, `creador` queda público y permite correlación). **Decisión: se mantiene en el doc público**, porque la regla F1 valida la autoría del privado leyendo `parent.creador` y la dedup de Fase 1b lo necesita. Es un uid anónimo (no PII). Riesgo residual y mitigación futura quedan en **§9-1**; decisión registrada como **D8** (§13).

### Kit de testeo para Lean

Checklist reproducible del DoD §8 en **[TESTING.md](TESTING.md)**: carga 3G + TTI, reporte <60s, reporte con contacto que persiste offline y sincroniza (valida esta corrección), lecturas offline, banner/verificación, modo demo. Incluye cómo activar el throttling en Chrome DevTools y qué evidencia capturar.

### Estado del gate de Fase 1 (qué falta)

| Estado | Ítem | Responsable |
|---|---|---|
| ✅ | B1, B2 (rules tests + App Check) | Aceptado por el jurado |
| ✅ | F1, F2, F3 (seguridad de rules, 24/24 tests) | Aceptado por el jurado |
| ✅ | Repo público asegurado; corrección offline (§19); decisión `creador` (D8); TESTING.md | Agente — **cerrado** |
| ⏳ | **Testeo móvil 3G** (DoD: carga 3G, <60s, offline+sync) — usar TESTING.md y `/panel?demo=1` | **Lean** |
| ⛔ | **Handoff §9-4** — operador para la semana 2 | **Lean** (bloquea lanzamiento) |
| ⛔ | **Reclutar 5–10 coordinadores** (anti cold-start §11) | **Lean** (bloquea lanzamiento) |

**Fase 1b NO arranca** hasta cerrar el gate de Fase 1 con esos tres pendientes de Lean. **El gate NO se da por cerrado por el agente.** Staging sin usuarios reales ni datos de víctimas.

---

## 20. Bug offline `geo_exacta` corregido + andamiaje de repo (25 jun 2026)

> Jurado: corrección del orden offline (§19), decisión D8 y TESTING.md verificados en código y aprobados. Aparece un bug nuevo, corregido antes de seguir. Fase 1b sigue sin arrancar.

### Bug — `geo_exacta` se guardaba siempre (incluso sin GPS)

**Síntoma:** el subdocumento privado incluía siempre `geo_exacta: { lat, lng }`. Como ambas UIs aplicaban un *fallback* de coordenadas (centro de Morón) **antes** de la capa de datos, se guardaba una **coordenada exacta falsa** para todo reporte, y el privado se creaba aun sin contacto ni GPS real. Con coords inválidas/ausentes (`null`/`undefined`) la regla `validPrivado` habría rechazado el privado y el **contacto se perdería en silencio** al sincronizar offline.

**Corrección:**
- Nuevo módulo **puro** `src/lib/payload.js` (sin Firebase, unit-testeable):
  - `geoPublicoSeguro(lat,lng)` — el geo **público** siempre válido: coords reales aproximadas si hay GPS, o el **centro de zona** si no (el `sector` textual aporta el detalle). Nunca `NaN`/`undefined`.
  - `construirPrivado(uid,contacto,lat,lng)` — incluye `geo_exacta` **solo si hay GPS real**; devuelve `null` si no hay nada sensible que guardar (sin contacto y sin GPS) → no se crea privado.
- `src/lib/db.js` usa estos helpers; las UIs (`Reportar`, `Recursos`) pasan las **coords reales** (`null` sin GPS), no el fallback. **El flujo sin GPS funciona completo** (doc público con geo de zona + privado con contacto sin `geo_exacta`).

**Caso "sin GPS" verificado de punta a punta:** UI pasa `lat/lng = null` → `geoPublicoSeguro` da un geo público válido (centro de zona + geohash) que cumple las rules del doc público → `construirPrivado` arma el privado con contacto y **sin** `geo_exacta` → `validPrivado` lo acepta. Sin `NaN`, sin pérdida de contacto.

### Tests — ejecutados ✅ (9 unit + 26 rules)

```
UNIT (tests/payload.test.js, sin emulador):  9 passed (9)
  ✓ (a) CON contacto y SIN GPS → privado válido sin geo_exacta
  ✓ (b) SIN contacto y SIN GPS → no se crea privado (null)
  ✓ (c) CON GPS → geo_exacta presente y válida
  ✓ CON GPS y SIN contacto → privado con geo_exacta y contacto vacío
  ✓ coords no numéricas (NaN/strings) se tratan como SIN GPS
  ✓ geoPublicoSeguro: sin GPS usa centro de zona (finito + geohash)
  ✓ geoPublicoSeguro: con GPS coords aproximadas (~1km) + geohash
  ✓ geoPublicoSeguro: coords inválidas → centro de zona, nunca NaN
  ✓ tieneCoords: solo números finitos cuentan

RULES (tests/rules.test.js, emulador): 26 passed (26)   [antes 24]
  + §20: privado SIN geo_exacta (reporte con contacto sin GPS) es válido
  + §20: privado con geo_exacta de tipo inválido sigue rechazado
```

### Andamiaje de repo público — cerrado

- **`CONTRIBUTING.md`** — setup, cómo correr tests (unit + rules), estilo, flujo de PR, principios no negociables.
- **`CODE_OF_CONDUCT.md`** — tono de respuesta a emergencia, personas afectadas primero.
- **`.github/ISSUE_TEMPLATE/`** — `bug_report.yml`, `feature_proposal.yml`, `config.yml` (sin issues en blanco; vulnerabilidades → `SECURITY.md`).
- **`.github/pull_request_template.md`** — checklist con sección de impacto sensible (privacidad / rules / costo / alcance).

### Estado del gate de Fase 1 (sin cambios en lo pendiente)

| Estado | Ítem | Responsable |
|---|---|---|
| ✅ | B1, B2, F1, F2, F3 | Aceptado por el jurado |
| ✅ | Corrección offline (§19), D8, TESTING.md | Aceptado por el jurado |
| ✅ | **Bug `geo_exacta` (§20) corregido + tests (9 unit + 26 rules)**; andamiaje de repo cerrado | Agente — **cerrado** |
| ⏳ | **Testeo móvil 3G** (TESTING.md, `/panel?demo=1`) | **Lean** |
| ⛔ | **Handoff §9-4** — operador semana 2 | **Lean** (bloquea lanzamiento) |
| ⛔ | **Reclutar 5–10 coordinadores** | **Lean** (bloquea lanzamiento) |

**Fase 1b NO arranca** hasta cerrar esos tres pendientes de Lean. **El gate NO se da por cerrado por el agente.** Staging sin usuarios reales ni datos de víctimas.

---

## 21. Relevo de equipo — Juez 2 + Claude Code 2 (25 jun 2026)

> Doble relevo del equipo original. El "2" es por handover, no por jerarquía:
> los cuatro agentes trabajan en igualdad, pero por turnos. Esta sección la
> redacta Claude Code 2 para que Juez 1 y Claude Code 1, al retomar, encuentren
> el contexto completo del relevo sin tener que reconstruirlo.

### 21.1 Quién es quién

| Rol | Agente | Estado |
|---|---|---|
| Juez 1 (estratega/juez original) | — | Sin tokens; no continúa por ahora. |
| **Juez 2** | — | Activo. Evalúa leyendo los archivos reales, no los reportes. |
| Claude Code 1 (builder original) | — | Cerró B1, B2, F1/F2/F3, §17–§20. |
| **Claude Code 2** (builder en relevo) | — | Activo. Continúa el trabajo desde §20. |

### 21.2 Estado heredado — verificado por Juez 2

Juez 2 validó por inspección directa, no por confianza en los reportes:

- **§20 (bug offline `geo_exacta`):** corregido en `src/lib/payload.js` (módulo
  puro). `geo_exacta` solo se escribe con GPS real; el centro de zona alimenta
  solo el geo público. **Aprobado.**
- **F1** (autoría/esquema del subdoc privado): reglas correctas. **Aprobado.**
- **F2** (descripción libre, pública al verificar): aviso al usuario + revisión
  humana en verificación. **Aprobado.**
- **F3** (`updateGestionValido` valida enums): correcto. **Aprobado.**
- `tests/payload.test.js` (9) y `tests/rules.test.js` (26): existen y cubren los
  casos. **Aprobado por inspección.**
- Andamiaje del repo (LICENSE, SECURITY/PRIVACY/README/CONTRIBUTING/
  CODE_OF_CONDUCT, ISSUE_TEMPLATE, PR template, `.gitleaks.toml`): **presente.**
- Git: 8 commits en `origin/main`, sin secretos.

### 21.3 Único pendiente del lado builder — CERRADO

**Hueco de CI:** `.github/workflows/rules-tests.yml` corría **solo** los rules
tests. El fix de §20 (módulo puro `payload.js`) quedaba sin protección de CI:
una regresión en `construirPrivado` / `geoPublicoSeguro` podía pasar a `main`
sin que los 9 tests unitarios lo capturaran.

**Corrección (Claude Code 2):** se añadió un paso `Unit tests (payload §20)`
**antes** del paso del emulador (y después de `npm ci`):

```yaml
      - run: npm ci
      - name: Unit tests (payload §20)
        run: npm run test:unit
      - name: Rules tests (emulador)
        run: npx firebase-tools emulators:exec --only firestore "npm run test:rules"
```

Razonamiento: los unitarios son baratos (sin emulador, sin Java) y rápidos;
fallan primero si la capa de datos rompe. Los rules tests siguen siendo el gate
duro de privacidad.

### 21.4 Evidencia fresca — regenerada antes del push

Corrida en local por Claude Code 2 (Windows + Node 24, npm 11, Java 21 vía JBR
de Android Studio). Ambas suites se ejecutaron contra el código actual del
repo, no contra una versión cacheada.

**Unitarios — `npm run test:unit` (9/9):**

```
 ✓ tests/payload.test.js (9 tests) 20ms
   construirPrivado — geo_exacta solo con GPS real (§20)
     ✓ (a) CON contacto y SIN GPS → privado válido sin geo_exacta
     ✓ (b) SIN contacto y SIN GPS → no se crea privado (null)
     ✓ (c) CON GPS → geo_exacta presente y válida
     ✓ CON GPS y SIN contacto → privado con geo_exacta y contacto vacío
     ✓ coords no numéricas (NaN/strings) se tratan como SIN GPS
   geoPublicoSeguro — geo público siempre válido
     ✓ SIN GPS → usa el centro de zona, con números finitos + geohash
     ✓ CON GPS → coords reales aproximadas (~1km) + geohash
     ✓ coords inválidas → cae al centro de zona, nunca NaN
   tieneCoords
     ✓ solo números finitos cuentan como coords

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**Rules tests — `firebase emulators:exec --only firestore "npm run test:rules"` (26/26):**

```
 ✓ tests/rules.test.js (26 tests) 10.14s
   necesidades — create:
     ✓ reportante anónimo puede crear necesidad válida
     ✓ rechaza enum de categoría inválido (§14-2)
     ✓ rechaza nacer verificada (anti-rumor §9-3)
     ✓ rechaza descripción demasiado larga
     ✓ rechaza creador suplantado (creador != uid del que escribe)
   necesidades — read / verificación:
     ✓ no-verificada NO es legible por usuario normal
     ✓ verificada SÍ es legible (preparado vista pública Fase 2)
     ✓ coordinador lee las no-verificadas
   necesidades — update (gestión solo coordinador) [F3]:
     ✓ coordinador puede verificar
     ✓ reportante anónimo NO puede verificar
     ✓ coordinador NO puede reescribir contenido reportado (categoría)
     ✓ F3: rechaza valor de estado fuera del enum
     ✓ F3: rechaza valor de verificacion fuera del enum
     ✓ F3: acepta transición de estado válida
   privado — contacto/coords exactas (frontera §6.2-r2):
     ✓ coordinador SÍ lee el contacto privado
     ✓ usuario normal NO lee el contacto privado
     ✓ reportante anónimo NO lee el contacto privado
   privado — escritura abusiva [F1]:
     ✓ el autor (anon1) SÍ puede crear el privado de su propia necesidad
     ✓ §20: privado SIN geo_exacta (reporte con contacto sin GPS) es válido
     ✓ §20: privado con geo_exacta de tipo inválido sigue rechazado
     ✓ otro anónimo NO puede inyectar el privado de una necesidad ajena
     ✓ no se puede suplantar al autor (creador del privado != uid escritor)
     ✓ NO se puede sobrescribir un contacto ya existente (update solo coord)
     ✓ rechaza contacto demasiado largo
     ✓ rechaza campos desconocidos en el privado
     ✓ rechaza geo_exacta con tipo inválido

 Test Files  1 passed (1)
      Tests  26 passed (26)
```

Los `PERMISSION_DENIED` que aparecen en stderr durante esta corrida son los
tests negativos (`assertFails`) confirmando la denegación esperada — mismo
patrón ya documentado en §16.

### 21.5 Estado del gate de Fase 1 — tabla vigente

Sucesora de la tabla de §20 (que queda como histórico). Ahora con CI completo
en cada PR y push:

| Estado | Ítem | Responsable |
|---|---|---|
| ✅ | B1, B2, F1, F2, F3 | Aceptado por el jurado |
| ✅ | Corrección offline (§19), D8, TESTING.md, bug `geo_exacta` (§20) | Aceptado por el jurado |
| ✅ | **CI completo: unit (9) + rules (26) en cada PR/push** (§21.3); evidencia fresca regenerada (§21.4) | Claude Code 2 — pendiente de visto bueno de Juez 2 |
| ⏳ | **Testeo móvil 3G** (TESTING.md, `/panel?demo=1`) | **Lean** |
| ⛔ | **Handoff §9-4** — operador semana 2 | **Lean** (bloquea lanzamiento) |
| ⛔ | **Reclutar 5–10 coordinadores** (anti cold-start §11) | **Lean** (bloquea lanzamiento) |

### 21.6 Guardarraíles respetados

Claude Code 2 confirma, para el registro:
- **No se inició la Fase 1b** (SMS/WhatsApp + dedup). El gate de Fase 1 sigue
  abierto en los tres pendientes de Lean.
- **No se habilitó uso real** ni se cargaron datos de víctimas; staging sigue
  siendo el único entorno y sigue con `_demo_*` como única fuente de datos.
- **El gate NO se da por cerrado por el agente.** El visto bueno del cierre del
  hueco de CI (§21.3–§21.4) lo otorga Juez 2 al leer este documento y revisar
  el commit; el cierre del gate completo de Fase 1 depende, además, de los tres
  pendientes de Lean.
- **§15–§20 no fueron editadas** — son históricas del equipo anterior.

---

## 22. PIVOTE de modelo — "Mapa público + ayuda mutua + validación por multitud" (Fase 2a, 25 jun 2026)

> Aprobado por el estratega. **§1–§21 son históricas y no se editan.** Este pivote redefine el modelo operativo SIN relajar ninguna guarda de seguridad/privacidad ya validada (§6.2, §9-1, §9-2, App Check, rules). Construcción: **Fase 2a (pre-lanzamiento)**. **Fase 2b NO arranca.**

### 22.1 Qué cambia

El modelo deja de ser **"despacho por coordinadores"** (un cuello de botella que ve y reclama casos) y pasa a **"mapa público + ayuda mutua ciudadana + validación por multitud"**: cualquiera ve el mapa de necesidades, los vecinos cercanos confirman que son reales, y la ayuda se organiza entre ciudadanos. Un operador modera y atiende los casos que la multitud no alcanza a validar.

### 22.2 Usuarios (revisado, reemplaza la tabla §2 a efectos operativos)

| Prioridad | Usuario | Rol en el modelo nuevo |
|---|---|---|
| **Primario** | **Ciudadano** (afectado, testigo o vecino que quiere ayudar) | Ve el mapa público, reporta, **confirma** necesidades cercanas, se organiza para ayudar |
| **Operador** | **Lean** (cumple §9-4) | Modera, atiende la **cola de casos aislados** (`pendiente_revision`), valida coordinadores |
| Secundario | Coordinador / ONG | Se postula vía formulario; rol verificado para gestión y para leer datos privados |

La decisión clave de §2 ("anclar en el coordinador porque es el cuello de botella") queda **superada**: en emergencia la multitud distribuye la validación y la ayuda; el coordinador deja de ser el único actor.

### 22.3 §9-4 (handoff) — CUMPLIDO

El bloqueante §9-4 ("sin operador definido, no se lanza") queda **satisfecho**: **Lean es el operador** que modera y atiende la cola de aislados. El handoff deja de ser un pendiente abstracto.

### 22.4 §11 (cold-start) reemplazado

La mitigación original del panel vacío (reclutar 5–10 coordinadores antes de lanzar) se reemplaza por **validación por multitud + moderación del operador**: el valor no depende de reclutar coordinadores primero, sino de que los ciudadanos vean y confirmen. El formulario de coordinadores alimenta el rol verificado de forma continua, no como precondición.

### 22.5 Validación por multitud (cambia §5)

- Toda necesidad nace `no_verificada` y es **públicamente visible y marcada** como tal (no se oculta: la multitud necesita verla para confirmarla).
- Botón **"confirmar que esto es real"** para usuarios cercanos. **Cada uid anónimo confirma una sola vez** (anti-duplicado *en las rules*, no en el cliente).
- Estados de `verificacion`: `no_verificada` → (**N** confirmaciones) → `confirmada`. **N es bajo y sensible a densidad** (no un 10 fijo): se calcula server-side según cuántos reportes/confirmaciones hay alrededor; acotado a un rango pequeño.
- **SALVAGUARDA INNEGOCIABLE:** un caso aislado que no alcanza N **nunca se descarta ni se oculta**. Pasa a `pendiente_revision` y se **prioriza** en la cola del operador. El diseño lo hace **MÁS** visible, no menos (badge destacado, orden prioritario en el panel y en el mapa).
- La validación manual de un coordinador verificado sigue valiendo (equivale a `confirmada`).

### 22.6 Control de costo (§6.2-r1) — obligatorio en la vista pública

La vista pública **no** usa un `onSnapshot` abierto para todos los documentos. Patrón elegido (documentado en §22.8): **lectura puntual paginada con caché-primero** (`getDocs` con `limit`, servida desde IndexedDB cuando hay caché, refresco manual con *cooldown*), no un listener en tiempo real. *Bundles* servidos por CDN quedan como vía de escalada si el tráfico lo exige (Fase 2b).

### 22.7 Alcance de Fase 2a (esta entrega)

1. Reencuadre de mensaje (§9-2): ayuda mutua, **no** rescate; nadie garantiza que alguien acuda; líneas oficiales visibles.
2. **Vista pública "Mapa"**: lista + mapa interactivo, sin login (con App Check), ubicación **solo a nivel sector**, estado de verificación marcado, detalle con acciones (confirmar / cómo ayudar).
3. **Validación por multitud** en rules + tests (§22.5).
4. **Formulario de coordinadores** → email a `hey@leanaraque.com` vía **Resend desde Cloud Function** (key en Secret Manager, nunca en cliente/repo).
5. **Botón al repo público** (transparencia), discreto.
6. **Microcopy** por segmento (Reportar/Panel/Recursos/Mapa) sin sacrificar peso (§6.3).

**Fuera de alcance (Fase 2b, NO construir):** centros de ayuda, listas de edificios, deduplicación, SMS/WhatsApp.

### 22.8 Implementación — modelo de datos, control de costo, bundle y tests

**Modelo de datos (cambios sobre §4):**
```
Necesidad (doc PÚBLICO, legible por cualquiera con App Check)
  … (campos previos) …
  verificacion     # no_verificada | confirmada | pendiente_revision | verificada(legacy)
  confirmaciones   # number — contador denormalizado (lo mantiene la Cloud Function)
  creador          # uid anónimo (D8) — ahora público en todos los estados (ver nota)

Necesidad/{id}/confirmaciones/{uid}   # validación por multitud
  creador          # == uid del autor; el id del doc ES el uid → una por uid
  creada_en
```
*Nota de privacidad:* con la lectura pública (pivote), `creador` (uid anónimo) queda visible para necesidades en cualquier estado, no solo verificadas. Sigue siendo un uid anónimo, no PII; la mitigación de **D8/§9-1** se mantiene y se revisará en Fase 2b si la correlación resulta dañina.

**Patrón de control de costo (§6.2-r1) elegido — vista pública:**
- **Lectura puntual paginada con caché-primero**, NO `onSnapshot`. `leerNecesidadesPublicas()` intenta `getDocsFromCache` (0 lecturas facturables); solo va al servidor en frío o en **refresco manual** (botón con *cooldown* de 15 s). `limit(25)`.
- El **contador de confirmaciones** se denormaliza en el doc padre (lo mantiene la función) → la vista pública nunca lee la subcolección entera (evita N lecturas por ítem).
- *Escalada* documentada para Fase 2b: *bundles* de Firestore servidos por CDN si el tráfico lo exige.

**Validación por multitud — dónde vive cada parte:**
- *Anti-duplicado (una confirmación por uid)* → **rules** (`confirmaciones/{id==uid}`, create-once, inmutable) + **tests**.
- *Contador + transición no_verificada→confirmada con N sensible a densidad* → **Cloud Function** `onConfirmacion` (Admin SDK, no manipulable por cliente). N ∈ [2,4] según densidad por prefijo de geohash (sector).
- *Salvaguarda del aislado* → **Cloud Function programada** `marcarAislados` (no_verificada vieja → `pendiente_revision`) + **UI** que lo ordena primero con badge. Nunca se oculta ni descarta.

**Formulario de coordinadores → Resend:**
- `solicitarCoordinador` (callable, `enforceAppCheck`) envía email a `hey@leanaraque.com`. La **key vive en Secret Manager** (`RESEND_API_KEY`), nunca en cliente/repo. Rate-limit server-side (1/min por uid) + en cliente.

**Medición de bundle (gzip, inicial = no-lazy):**

| Chunk | Antes | Después | Nota |
|---|---|---|---|
| app (`index`) | 18.99 KB | **24.77 KB** | +5.8 KB: vista Mapa + form + confirmar |
| css | 1.79 KB | 2.15 KB | +0.36 KB |
| firebase | 140.49 KB | 140.87 KB | ~igual |
| **firebase/functions** | — | (3.82 KB) | **diferido** (solo al postularse) |
| leaflet | (43.60 KB) | (43.60 KB) | **diferido** (solo al abrir mapa) |

Sin librerías nuevas pesadas; lazy-load del mapa y del SDK de functions preservado (§6.3).

**Tests ejecutados:** `9 unit` (payload) + `34 rules` (incluye 8 de validación por multitud: confirmar una vez por uid, no duplicar, no suplantar, contador no editable por cliente, y **aislado visible**). Salida en el commit y reproducible con `npm run test:unit` y el emulador.

**Cloud Functions — desplegadas y ACTIVE (GEN_2, us-central1, node22):** `solicitarCoordinador`, `onConfirmacion`, `marcarAislados`. Primer despliegue de 2ª gen requirió conceder roles a los service agents (build SA `cloudbuild.builds.builder`/`artifactregistry.writer`/`logging.logWriter`, **runtime SA `datastore.user`** — sin él `onConfirmacion` daba `PERMISSION_DENIED`—, eventarc service agent, pubsub `serviceAccountTokenCreator`, run.invoker/eventReceiver) — documentado en `functions/README.md` por si se replica.

El correo de `solicitarCoordinador` queda inactivo hasta que Lean ponga la key rotada (§22.9).

> **CORRECCIÓN (falso positivo retirado):** una versión anterior de esta sección afirmó que la sensibilidad a densidad estaba "verificada" porque con datos de prueba el umbral subió a 3. **Era un falso positivo**: esos geohashes de test eran cortos e idénticos (5 chars), y `calcularUmbral` usaba un rango sobre `geo.geohash` con límite superior no-op (F6) que con geohashes **reales** (~10 chars) daba densidad ~0 y umbral fijo en 2. Corregido en §22.10.

### 22.9 Condiciones de lanzamiento (heredadas + nuevas)

- ⛔ **Rotar la API key de Resend** antes de producción. La key compartida en texto plano queda **comprometida y NO se usa**. En Secret Manager se puso un **placeholder** (`PLACEHOLDER_rotar_antes_de_prod`), por lo que el envío de correo de postulación **no funcionará hasta que Lean ponga la key rotada**:
  ```
  firebase functions:secrets:set RESEND_API_KEY   # pega la NUEVA key
  firebase deploy --only functions:solicitarCoordinador
  ```
  Además, verificar un dominio en Resend y ajustar `REMITENTE` en `functions/index.js`.
- ⏳ **Test 3G de Lean** (DoD §8) sobre la vista pública nueva (`/mapa`, y `/mapa?demo=1`).
- ⏳ **Auditoría del juez** sobre §22 y las rules/tests nuevos.

**El gate de Fase 2a lo cierran el juez + el test 3G de Lean, no el agente.** No se habilita producción ni se cargan datos reales.

---

## 22.10 Bloqueantes de la auditoría de código — corregidos (25 jun 2026)

> El juez auditó el **código** de Fase 2a y aprobó: Resend en Secret Manager, App Check en el callable, contador solo-función, anti-duplicado, salvaguarda del aislado, bundle. Encontró tres bloqueantes (F10/F6/F7), corregidos aquí con **verificación honesta usando geohashes reales** (no falsos positivos).

### F10 (GRAVE) — autoconfirmación de casos falsos — CERRADO

**Riesgo:** `validNuevaNecesidad` no restringía claves ni forzaba el contador. Un reportante podía crear `{ confirmaciones: 9999 }`; `onConfirmacion` hacía `(n.confirmaciones||0)+1 ≥ umbral` → marcaba `confirmada` con **una sola** confirmación propia → autoconfirmar un caso falso (lo más peligroso de publicar).

**Corrección (defensa en dos capas):**
1. **Rules:** `validNuevaNecesidad` ahora exige `keys().hasOnly([lista explícita])` (bloquea claves desconocidas, incl. dentro de `geo`) y `(!('confirmaciones' in d) || d.confirmaciones == 0)`. `validNuevoRecurso` también con `hasOnly`.
2. **Función:** `onConfirmacion` **ya no confía** en el campo denormalizado; deriva el conteo **real** de la subcolección con agregación `COUNT` (1 por uid, deduplicada por rules).

**Evidencia (tests de rules, emulador):**
```
✓ F10: rechaza nacer con confirmaciones>0 (anti-autoconfirmación)
✓ F10: acepta confirmaciones==0 explícito
✓ F10: rechaza clave desconocida (hasOnly)
✓ F10: rechaza clave desconocida dentro de geo
✓ F6/F10: rechaza sectorGeo que NO coincide con el prefijo del geohash
✓ F6/F10: rechaza necesidad SIN sectorGeo
  Tests  6 passed | (de 40 rules totales)
```

### F6 — sensibilidad a densidad — CERRADO (con geohashes reales)

**Causa:** el límite superior del rango (`pref + ''`) era no-op; con geohashes reales (~10 chars) la densidad daba ~0 y el umbral quedaba fijo en 2.

**Corrección:** cada necesidad estampa `sectorGeo` = prefijo de geohash (5 chars), **validado en rules** (`sectorGeo == geo.geohash[0:5]`); la densidad usa `where('sectorGeo','==',pref)` (igualdad, no rango) con `COUNT`.

**Verificación HONESTA end-to-end (geohashes REALES de geofire-common, ~10 chars, visibles):**
```
ESCENARIO A — zona VACÍA
  geohash real: d3t2ug9wws  | sectorGeo: d3t2u
  2 confirmaciones → verificacion=confirmada     ✅ umbral 2

ESCENARIO B — sector DENSO (6 vecinos reales + target, mismo sector d3ze8)
  vecinos: d3ze8jdk8v, d3ze8jdqrv, d3ze8jf8nv, d3ze8jfcvv, d3ze8jg5sv, d3ze8jgm7v
  target:  d3ze8jdkej  | sectorGeo: d3ze8
  2 confirmaciones → verificacion=no_verificada  ✅ umbral subió (>2): 2 no basta
  3 confirmaciones → verificacion=confirmada     ✅ alcanzó umbral 3
```
La sensibilidad a densidad **ahora funciona con datos reales**. Datos de prueba ficticios (`TEST_*`), en la colección real pero **eliminados tras la prueba**.

### F7 — costo de la query de densidad — CERRADO

La query de densidad salió de `runTransaction` y usa **agregación `COUNT`** (≈1 lectura por confirmación, en vez de ~20). El conteo de confirmaciones también es `COUNT`.

### Salvaguarda del aislado — verificada end-to-end

```
necesidad no_verificada con creada_en de hace 7h → (ejecutar marcarAislados) →
  t+10s → verificacion: pendiente_revision   ✅ a la cola del operador, NO oculta
```
(Requirió un índice compuesto `verificacion + creada_en`, ya `READY`.)

### Verificación de rechazo en producción — nota honesta

Las escrituras que hice para sembrar/probar usan el token OAuth de gcloud (Admin), que **bypassa rules y App Check** por diseño; por eso el rechazo de un `create` con `confirmaciones>0` **no** se puede demostrar "en vivo" con ese token. La prueba canónica del rechazo son los **tests de rules en el emulador** (arriba, 6 verdes con `assertFails`). Lo digo explícitamente para no dar un falso positivo.

### Tests — salida COMPLETA

```
UNIT (tests/payload.test.js, sin emulador):
  Test Files  1 passed (1)
  Tests  9 passed (9)

RULES (tests/rules.test.js, emulador Firestore):
  Test Files  1 passed (1)
  Tests  40 passed (40)
```
(34 → 40: +6 de F10/F6. Reproducible: `npm run test:unit` y `firebase emulators:exec --only firestore "npm run test:rules"`.)

### Estado del gate de Fase 2a tras §22.10

- ✅ F10, F6, F7 corregidos; verificación honesta con geohashes reales; 9 unit + 40 rules.
- ✅ Funciones redeployadas (`onConfirmacion`, `marcarAislados`); índice compuesto READY.
- ⏳ **Auditoría del juez** sobre §22.10.
- ⏳ **Test 3G de Lean** sobre la vista pública.
- ⛔ **Rotar la key de Resend** (placeholder en staging; el correo no funciona hasta entonces).

**Fase 2b NO arrancada.** No se habilita producción ni se cargan datos reales. **El gate lo cierran el juez + el test 3G de Lean, no el agente.**

---

## 22.11 Autocompletado de ubicación (OSM) + regresión corregida + Resend (25 jun 2026)

### Regresión "Ocurrió un error" en reportar/recursos/panel — CORREGIDO

**Síntoma reportado por Lean:** todos los botones de guardar (reporte, recurso, formulario del panel) daban *"Ocurrió un error"*.

**Diagnóstico (en vivo con Chrome DevTools MCP):** App Check devolvía 200 y la sesión anónima OK; el fallo era `permission-denied` de Firestore. Causa raíz: en §22.10 las rules pasaron a **exigir `sectorGeo`**, pero el **service worker (PWA) seguía sirviendo el bundle viejo** (sin `sectorGeo`) → toda escritura era rechazada. Reproducido y confirmado: una escritura con el shape nuevo (con `sectorGeo`) y App Check **sí** pasa las rules.

**Corrección:** rebuild + redeploy del frontend (alinea cliente↔rules) y actualización del SW. Verificado en vivo: *"Reporte recibido. Gracias."* **Lección de proceso:** un cambio de rules que añade un campo obligatorio debe desplegarse **junto** con el frontend; los usuarios con SW cacheado ven el error hasta actualizar.

### Resend — key de producción configurada + formulario VERIFICADO en vivo

Lean entregó la key real; se puso en **Secret Manager** (`RESEND_API_KEY`) y se redeployó `solicitarCoordinador`. (La key vive solo en Secret Manager, nunca en el repo.)

**Bug del formulario del Panel — CORREGIDO:** la primera prueba en vivo dio *"No se pudo enviar"*. Los logs mostraron que **no era Resend** sino Cloud Run: *"The request was not authenticated. Empty Authorization header value."* Una **callable** (`onCall`) valida App Check/Auth en su propio código, así que el servicio de Cloud Run debe **permitir invocación pública**; ese binding **no se aplicó** en el primer despliegue 2ª gen (cuando falló el bootstrap de IAM). Fix: `gcloud run services add-iam-policy-binding solicitarcoordinador --member=allUsers --role=roles/run.invoker` (documentado en `functions/README.md`).

**Verificado en vivo (Chrome DevTools MCP):** postulación enviada → *"¡Gracias! Recibimos tu postulación y te contactaremos."* y **sin errores en los logs de la función → Resend aceptó el envío** del correo a `hey@leanaraque.com`. **Recomendación:** verificar un dominio propio en Resend y ajustar `REMITENTE` (hoy `onboarding@resend.dev`) para entregabilidad amplia en producción.

### Autocompletado de ubicación — fuente OSM, sin APIs de pago, offline

**Datos (costo runtime cero):** `scripts/extract-lugares.mjs` extrae lugares de **OpenStreetMap vía Overpass API** (gratis, solo en build; mirrors + reintentos + User-Agent) para los municipios afectados (La Guaira/Vargas: Catia La Mar, Maiquetía, La Guaira, Macuto, Caraballeda, Naiguatá, Carayaca; costa de Carabobo: Puerto Cabello, Morón). Genera **`src/lib/lugares.json`** curado: **500 entradas** `{ nombre, tipo, municipio, lat, lng, geohash, sectorGeo }` (geohash y sectorGeo calculados en prep, consistentes con las rules F6/F10), deduplicado y normalizado. **No** incluye la lista privada de edificios del operador (decisión del juez) — solo OSM/oficiales.

**UX (intuitivo, sin confusión):** `LugarAutocomplete.svelte` filtra en el **cliente** (insensible a acentos y mayúsculas), muestra top 6 con etiqueta de 2 líneas (nombre en negrita + *"tipo · municipio"*), navegable con teclado y táctil. Al **seleccionar**: rellena el nombre canónico, guarda lat/lng/sectorGeo y muestra un **chip borrable** (*"📍 Caraballeda · Caraballeda, La Guaira ✕"*) para que la persona vea y pueda cambiar lo elegido. Permite **texto libre** si no hay coincidencia. El botón **GPS** sigue como vía precisa. Microcopy: *"Elegir un lugar lo ubica en el mapa; GPS = ubicación precisa y privada."*

**Integración / privacidad:** la lat/lng de la **referencia elegida** alimenta `geoPublicoSeguro` → el punto del mapa cae en la **zona correcta aun sin GPS** (arregla que todo cayera en un centro genérico). `sectorGeo` se toma de esa referencia. La ubicación pública sigue a **nivel sector** (~1km); las coords **exactas** solo entran al **subdoc privado** vía GPS (la referencia de lugar **nunca** es privada). 

**Peso (§6.3) — medición:** `lugares.json` se carga por **import dinámico** solo al usar el campo → chunk **diferido `lugares` = 12.95 KB gzip** (NO en bundle inicial). App inicial: **24.77 → 26.96 KB gzip** (+2.2 KB del componente). Leaflet sigue diferido. **Cero llamadas de red por tecla** (todo local) → costo runtime cero; offline tras la primera carga (cacheado por el SW).

### Verificación e2e (Chrome DevTools MCP, en vivo)

| Prueba | Resultado |
|---|---|
| Filtro insensible a acentos (`carab` → Caraballeda/Carabobo) | ✅ 6 sugerencias |
| Seleccionar fija coords+sectorGeo | ✅ chip mostrado |
| Reporte SIN GPS con lugar elegido cae en la zona correcta | ✅ geo=10.61,-66.85 (Caraballeda), **no** el centro Morón; `sectorGeo=d9bkq` |
| La referencia NO crea subdoc privado | ✅ `/privado/datos` → 404 |
| Chip borrable y re-elegible | ✅ quitar → vuelve el input |
| Reportar tras el fix de la regresión | ✅ "Reporte recibido. Gracias." |

(Datos de prueba ficticios creados en vivo y **eliminados** tras verificar.)

### Estado del gate de Fase 2a (sin cambios en lo pendiente de otros)

- ✅ Regresión corregida; autocompletado OSM integrado y verificado e2e; Resend con key real.
- ⏳ **Auditoría del juez**.
- ⏳ **Test 3G de Lean** (incluye el nuevo autocompletado en `/reportar`).
- ✅ La condición previa de "rotar key Resend" queda **cumplida** (key de producción puesta por Lean); se mantiene la recomendación de dominio verificado.

**Fase 2b NO arrancada.** No se habilita producción ni se cargan datos reales. **El gate lo cierran el juez + el test 3G de Lean, no el agente.**


---

## 23. Dominio custom focovenezuela.org + ubicación exacta por pin (26 jun 2026)

> El producto ya recibe uso real bajo `https://focovenezuela.org` (CNAME a Firebase Hosting, proxy Cloudflare).

### focovenezuela.org no mostraba datos — CORREGIDO

**Síntoma:** el dominio custom mostraba "No hay necesidades" / datos viejos pese a limpiar el cache de Cloudflare. Diagnóstico en vivo (Chrome DevTools): errores `AppCheck: ReCAPTCHA error (403)` y `signUp 403`. **Causa:** el dominio `focovenezuela.org` no estaba autorizado en **tres** allowlists de Google (todas restringidas a `foco-vzla.web.app`):
1. **reCAPTCHA Enterprise** (dominios de la key) → App Check no podía emitir token.
2. **Firebase Auth authorizedDomains** → login anónimo 403.
3. **Referrers HTTP de la API key** → todas las llamadas 403.

**Fix:** agregado `focovenezuela.org` y `www.focovenezuela.org` a las tres. Verificado: `signUp` y lecturas → 200. **Nota operativa:** App Check throttlea al cliente 24 h tras un 403; los navegadores que ya fallaron deben **borrar datos del sitio** (o usar incógnito) para recuperarse antes. Documentado para el futuro: **al agregar un dominio nuevo, actualizar las tres allowlists**.

> ⚠️ **Privacidad (recordatorio §9-1):** se observó un reporte real con nombre y edificio de una víctima en la **descripción pública**. El operador debe revisar/editar las descripciones; la app ya advierte no escribir datos personales, pero la moderación humana es la última línea.

### Ubicación exacta por pin en mapa (calle/edificio)

**Problema:** el autocompletado es a nivel de lugar; una calle puntual (p.ej. "San Bernardino", Caracas) no se encuentra. **Solución (costo $0):** `MapaPin.svelte` — mapa Leaflet (diferido, tiles OSM gratis) con **pin arrastrable** (y click para colocar) en `/reportar`. Botón progresivo "Marcar el punto exacto en el mapa" que centra en el lugar elegido o el GPS; la persona afina el pin a su calle/edificio.

**Privacidad:** el pin exacto va **solo al subdoc privado** (`geo_exacta`, lo ve el coordinador que toma el caso); el documento público sigue a **nivel sector** (~1km). Verificado e2e: público `10.34,-67.04` vs privado exacto `10.34315,-67.04303` (el público no revela el punto). Peso: app +1.5 KB gzip; Leaflet permanece en chunk diferido.

### Cobertura del autocompletado — Photon siempre + re-ranking (26 jun)

**Síntoma:** zonas muy conocidas (p.ej. "La Guaira") no sugerían el lugar en sí: el dataset local devolvía varios sub-lugares dentro de la zona (match por municipio) y, al haber ≥4 resultados locales, el fallback Photon **nunca se activaba**. **Fix:** Photon (geocoder gratis con TODO OpenStreetMap) se consulta **siempre** (debounced 280ms + cache, sesgado a Venezuela), y la mezcla local+remoto se **re-rankea por relevancia** (`rankear()` en `autocomplete.js`): un match exacto de nombre va primero venga de donde venga. Resultado (verificado en vivo): "la guaira" → **La Guaira** primero; "san bernardino" → iglesia/colegio/sector San Bernardino (Caracas); "chacao" → Chacao. Cobertura efectivamente ilimitada, costo $0.

---

## 24. Registro de actualizaciones — producción (Fase 2a, 25–26 jun 2026)

> La app ya recibe uso real en `https://focovenezuela.org` (CNAME a Firebase Hosting + Cloudflare). Esta sección consolida los cambios desde el pivote (§22) hasta hoy. Todo verificado en vivo con **Chrome DevTools MCP** y desplegado.

### 24.1 Acceso y dominio
- **focovenezuela.org no cargaba datos** → faltaba autorizar el dominio en TRES allowlists de Google: reCAPTCHA Enterprise (key), Firebase Auth (authorizedDomains) y referrers de la API key. Corregido los tres. *Lección: al agregar un dominio nuevo, actualizar las tres.* App Check throttlea al cliente 24 h tras un 403 (borrar datos del sitio para recuperar antes).

### 24.2 Ubicación (precisión)
- **Selector de pin en mapa** (`MapaPin.svelte`, Leaflet diferido) en `/reportar` y `/recursos`, como **camino sugerido** (visible por defecto). Pin SVG propio (evita el icono roto del marcador por defecto de Leaflet). El pin exacto → subdoc **privado** (`geo_exacta`); el mapa público sigue a **nivel sector**. Para **edificios** (sitios públicos de desastre) se usa coord **exacta pública** (decisión del operador).
- **Autocompletado de ubicación**: dataset OSM (`src/lib/lugares.json`) + **fallback Photon** (geocoder gratis) consultado SIEMPRE y re-rankeado por relevancia. Se añadieron **municipios (admin_level 6) y parroquias (admin_level 7)** de Venezuela por bbox, procesadas con prioridad (zonas conocidas como "San Bernardino" salen primero). Se quitaron `geohash`/`sectorGeo` del JSON (la app los recomputa) → chunk lazy de 143→91 KB gzip con más cobertura.

### 24.3 Marca, mensaje y navegación
- Marca **"Foco Venezuela"** + eslogan **"La ayuda se organiza entre todos"**.
- **Banner** reorientado a "plataforma abierta de datos para salvar vidas" (se quitó la sugerencia de líneas oficiales —probablemente saturadas—; se mantiene la guarda §9-2: no es rescate, nadie garantiza acudir).
- **Footer** con 3 acciones claras: **Sugerencias** (→ Tally `tally.so/r/A70rVk`), **Descargar datos (CSV)** y **Código abierto** (icono GitHub real; antes era un críptico `</>`).
- **Fix de layout móvil**: el footer pasó a flujo normal (antes `fixed` y los mapas se superponían al footer y al menú). Verificado en 390×844: sin solape.

### 24.4 Datos (export / import / buscador)
- **Export CSV** (cliente) de necesidades **públicas** (sin contacto ni coords exactas).
- **Importador reutilizable** `scripts/import-csv.mjs`: carga en bloque CSV → necesidades, con validación de coords, `--dry-run`, `--exacto` vs aproximado-a-sector, y `--tag`/`--clear` para revertir. Columnas flexibles.
- **Buscador** en la lista del mapa (filtro cliente, insensible a acentos, sobre sector/descripción/categoría/urgencia). El mapa público sube el límite de lectura a 250 para mostrar todas las necesidades.

### 24.5 Carga de datos reales
- **38 edificios de La Guaira** (CSV del operador) cargados como necesidades `rescate · crítica · Sin verificar`, coord exacta pública, marcadas `creador=IMPORT_LAGUAIRA` (reversible). Validación rigurosa previa: 38/38 coherentes (coords dentro de su parroquia), 0 omitidas. Son **datos NO confirmados** y de ubicación **aproximada** (estimación de escritorio) — la multitud/operador los confirma.

### 24.6 Pendientes / notas del operador
- **Moderación de datos personales** en descripciones públicas (se observó nombre de víctima en un reporte ciudadano) — control humano del operador antes de verificar (§9-1).
- El aviso del mapa "ubicación aproximada a nivel de sector" no distingue aún los edificios (exactos) de los reportes ciudadanos (sector); ajuste de copy pendiente.
- **Gate de Fase 2a** (juez + test 3G de Lean) y **Fase 2b** siguen sin cerrarse/arrancar; el producto opera en producción bajo decisión del operador.

### 24.7 Mapa unificado (26 jun)
Un único componente `MapaUnificado.svelte` reemplaza a `MapView` y `MapaPin`: el **mismo mapa** en `/mapa`, `/reportar`, `/recursos` y `/panel`. Muestra **necesidades** (color por urgencia) y **recursos** (verde) como marcadores, con leyenda; en modo reporte añade el **pin arrastrable** sobre el mismo mapa con los datos existentes como contexto. El footer pasó a links discretos (antes pills que se veían pesadas sobre el mapa). Los CSVs fuente del operador no se versionan (repo público).

---

## 25. Modelo de datos como FUENTE DE VERDAD — núcleo del producto (26 jun 2026)

> Decisión estratégica del operador (Lean): el aporte central de FOCO es **organizar los datos para que sean ÚTILES y confiables como fuente de verdad** — para quien necesita ayuda y para quien la presta. Una limpieza de una sola vez no basta: la reconciliación debe ser **recurrente**. Esta sección es el **contrato**: todo lo que se construya (formulario, rules, ingesta, curador) se ajusta a esto.

### 25.1 Seis propiedades de "fuente de verdad"
Procedencia · Verificación · **Frescura** · **Resolución** · Unicidad · **Estructura**. El `/reportar` previo cubría procedencia y verificación; este rediseño añade las otras cuatro.

### 25.2 Decisiones de diseño (gate, 26 jun)
1. Taxonomía: clasificar por **severidad** + flag `rescate_activo` + detalle (NO recategorizar todo como rescate).
2. Precisión geográfica pública: **exacta + flag** para edificios; personas siempre a nivel sector.
3. Construcción canónica: **re-ingesta limpia a staging** (no curar in-place a ciegas).
4. `/reportar`: **mínimo de 5 campos a toques**; resto condicional/opcional (revelación progresiva).
5. **Tipar** los datos: sacar lo estructurado de la descripción libre (menos PII, máquina-usable).
6. Prioridad **derivada por el sistema** (la urgencia auto-declarada deja de ser el eje).

### 25.3 Esquema canónico `necesidades` (campos ASCII)
```
PROCEDENCIA:  creador · fuentes[]={sistema,id_externo,capturado_en,url}
CLASIFICACIÓN: categoria ∈ rescate|medico|agua|alimento|refugio|servicios|otro
QUIÉN/CUÁNTOS: para_quien ∈ yo|familiar|vecino|desconocido · personas={rango:'1'|'2-5'|'6-20'|'+20'}
              vulnerables[] ⊆ ninos|mayores|discapacidad|embarazadas|heridos|cronicos
RESCATE (cond): rescate={atrapados:bool,cantidad?,con_vida?:bool,desde?:'<6h'|'6-24h'|'+24h'} · rescate_activo:bool(derivado)
MÉDICO (cond):  medico={tipo?:herido|medicamento_critico|atencion, medicamento?:insulina|oxigeno|dialisis|otro}
CANTIDAD (cond): cantidad={personas?,dias?}   (agua/alimento/refugio)
RIESGOS (opc):  riesgos[] ⊆ gas|fuego|colapso|electricidad|agua
SEVERIDAD/PRIO: severidad ∈ total|severo|parcial|desconocida · prioridad:0-100(derivada) · urgencia_reportada(insumo)
UBICACIÓN:      estado·municipio·parroquia·sector · geo{lat,lng,geohash} · sectorGeo · precision ∈ exacta|sector
ESTADO OP:      estado ∈ sin_atender|asignada|en_camino|en_sitio|resuelta|cerrada_invalida · asignada_a={grupo?,uid?}
CONFIANZA:      verificacion ∈ no_verificada|confirmada|pendiente_revision|verificada · confianza:0-100 · confirmaciones
FRESCURA:       vigencia={ultima_confirmacion_en, confirmaciones_vigencia}  (decaimiento del curador)
RESOLUCIÓN:     desenlace?={resultado:persona_a_salvo|recurso_entregado|no_ubicado|falso|otro, nota?, cerrado_por, cerrado_en}
CONTENIDO:      descripcion (breve, opcional, SIN PII) · creada_en · actualizada_en · last_seen_en
PRIVADO/datos (solo coordinador): contacto · contacto_alterno? · geo_exacta · como_llegar?
```

### 25.4 Esquema canónico `recursos`
```
fuentes[] · categoria ∈ medico|refugio|agua|alimento|transporte|acopio|otro · nombre(saneado)
estado·municipio·parroquia·sector · geo · precision · disponible:bool · capacidad? · necesita[]?
confianza · creada_en · last_seen_en   |  privado/datos: { contacto }
```

### 25.5 Motor de prioridad (derivada) → `src/lib/prioridad.js`
Función pura, testeable. `prioridad ∈ [0,100]` = f(atrapados+con_vida, médico crítico, severidad, vulnerables, nº personas, frescura/decaimiento, insumo del usuario como desempate menor). Bandas: critica≥60 · alta≥35 · media≥15 · baja. **Calibrable por el operador.** Reemplaza la urgencia auto-declarada como eje del mapa (color/orden por prioridad).

### 25.6 Frescura + ciclo de vida + cierre
- **Estados**: sin_atender → asignada → en_camino → en_sitio → resuelta | cerrada_invalida.
- **Frescura**: acción "¿sigue vigente?" (reportante/multitud) actualiza `vigencia`; el curador **decae** la prioridad de lo viejo no reconfirmado y manda a `pendiente_revision` (no borra; `marcarAislados` evoluciona a esto).
- **Cierre de ciclo**: al resolver se captura `desenlace` (¿persona a salvo? ¿recurso entregado?) — libera recursos y audita la verdad.

### 25.7 `/reportar` — campos (revelación progresiva)
- **Requerido (≈30s, a toques):** categoria · ubicacion · para_quien · personas.rango · contacto(privado).
- **Condicional por categoría:** rescate→{atrapados,cantidad,con_vida,desde} · medico→{tipo,medicamento} · agua/alimento/refugio→cantidad.
- **Opcional valioso (chips):** vulnerables · riesgos · como_llegar(privado) · contacto_alterno(privado).
- **Derivado (no lo pide el usuario):** prioridad · severidad · rescate_activo · confianza · geohash · provenance.
- `descripcion` pasa a **contexto breve opcional**.

### 25.8 Pipeline recurrente (curador) — la reconciliación viva
- **`/reportar` NO cambia su camino** (offline-first y reporte <60s intactos): escribe a `necesidades`.
- **Ingesta masiva** (APIs) → `_ingesta_*` (staging) → curador.
- **Curador agendado** (Cloud Function timer, como `marcarAislados`), **idempotente**: deduplica (auto **solo alta confianza**; lo dudoso → **cola de revisión del coordinador**), normaliza vocabularios, recalcula prioridad/confianza/vigencia. **Línea roja:** nunca fusiona de más un reporte humano ni lo sepulta bajo un lote masivo (ciudadano > confirmado-multitud > lote masivo). Reversible (provenance + backup).

### 25.9 Privacidad con el nuevo set
- **Público:** categoria, severidad, prioridad, personas.rango, vulnerables (agregado sí/no), sector, precision.
- **Privado (solo coordinador):** contacto, contacto_alterno, geo_exacta, como_llegar.
- Descripción pública = contexto, sin PII (los datos sensibles ahora tienen su campo tipado y privado).

### 25.10 Secuencia de construcción
1. **Motor de prioridad** (puro + tests) ← primer ladrillo. 2. `/reportar` nuevo + `payload`/`crearNecesidad`. 3. **rules** nuevas (`validNuevaNecesidad` del esquema nuevo). 4. Lecturas de la app (color/orden por prioridad; badges severidad/rescate_activo/precision). 5. **Curador** (Cloud Function) + **re-ingesta** (backfill Opción 1, recupera severidad faltante y contactos de recursos). 6. Migración del histórico al esquema nuevo + mantener limpio con el curador agendado.

---

## 26. Home / data storytelling — la cara pública como fuente de verdad (26 jun 2026)

> La ruta `/` deja de redirigir al mapa y pasa a ser una **home narrativa** que cuenta la emergencia con datos. Basada en *"Storytelling with Data"* (Knaflic): explica arriba, deja explorar abajo; se diseña para una audiencia y una acción concretas. Es **solo capa de presentación**: consume las lecturas de `db.js` (read-only) y computa los agregados en cliente; **no toca el modelo de datos** (eso es §25, otro frente de trabajo).

### 26.1 Dos audiencias (define la estructura)
- **Quien colabora** (rescatista/brigada/donante/voluntario): pregunta *"¿dónde y qué se necesita más?"* → acción: dirigir el recurso al punto de mayor **brecha**.
- **Quien reporta / afectado** (estrés, poca señal/batería): *"¿cómo pido ayuda y qué hay cerca?"* → acción: **reportar en <60s** y/o encontrar recurso cercano.
Por eso la home **se bifurca temprano** en dos puertas; la narrativa siguiente sirve sobre todo a quien colabora.

### 26.2 Arco narrativo (mobile-first; el scroll vertical es la narrativa)
1. **Hero** — idea grande en una frase. 2. **Dos puertas** ("Necesito ayuda" / "Quiero ayudar") sobre el pliegue. 3. **Sello de verdad** — procedencia + frescura. 4. **Pulso** — 4 cifras (rescates activos, sin atender, recursos, refugios). 5. **Brecha por zona** — barras necesidades vs recursos (la pieza accionable). 6. **Composición por categoría** — qué se pide vs qué hay. 7. **Procedencia** — lista de fuentes con conteos.

### 26.3 Componentes (todos presentación pura)
- `routes/Inicio.svelte` — orquesta; lee `leerNecesidadesPublicas`/`leerRecursosPublicos` una vez y pasa los arrays a las secciones.
- `components/BrechaZona.svelte` + `lib/regiones.js` — agrupación geográfica para la narrativa (cajas bbox; **prefiere `estado`/`municipio` del §25 si existen** → forward-compatible).
- `components/Composicion.svelte` — conteo por categoría.
- `components/Fuentes.svelte` — procedencia por `creador` (forward-compatible con `fuentes[].sistema`).

### 26.4 Principios SWD aplicados
Color con propósito (rojo=necesidad, verde=recurso; el resto gris), una idea por gráfico con título-frase, barras horizontales sobre tortas, cifras grandes para números únicos, mucho aire, todo a un pulgar. Sin emojis.

### 26.5 Frontera y despliegue
- **No cruza con §25:** archivos nuevos de presentación; `App.svelte`/`i18n.js` solo aditivos. Si un agregado no existe en `db.js`, se computa en cliente (no se pide cambio de datos).
- **Deploy:** `npm run deploy:hosting` (solo hosting; NO sube rules/functions). Requiere `.env.local` con `VITE_RECAPTCHA_SITE_KEY` (site key pública) en build, o App Check queda deshabilitado y Firestore (con enforcement) rechaza las lecturas → la home muestra ceros.
- **Resiliente al curador:** la home refleja lo que digan los datos; hoy expone el sesgo conocido (casi todo `categoria=rescate`; acopio como `otro`) — se corrige solo cuando el curador del §25 tipifica.

---

## 27. Panel operativo de mapa `/mapa` — para quien aporta ayuda (26 jun 2026)

> `/mapa` deja de ser un toggle lista↔mapa y pasa a ser un **panel de coordinación** con principios de mapas de organismos de respuesta (policía/rescate/comando de incidentes). Capa de presentación: consume `db.js` (read-only) + una callable de correo. Reutiliza `MapaUnificado` (no lo bifurca).

### 27.1 Principios aplicados
Conciencia situacional (franja de **KPIs**: críticas/rescate · sin atender · recursos) · **semántica de color consistente** mapa↔lista (rojo crítica → naranja alta → amarillo media · verde recurso · pulso SOS en rescate activo) · **triaje** (prioritario/aislado + rescate activo + urgencia arriba) · **control de capas/filtros** (tipo, categoría, urgencia, estado) + búsqueda · **estado por incidente** · **vigencia** del dato · **densidad** (clustering).

### 27.2 Layout (mobile-first)
- **Desktop (≥900px):** lista al costado + mapa pegajoso a la derecha (patrón refugiosvenezuela.com), ambos visibles.
- **Móvil:** toggle Lista/Mapa; **abre por defecto en el MAPA**. El mapa se monta fresco al togglear (sin bug de tamaño de Leaflet).
- Muestra TODAS las necesidades y recursos.

### 27.3 Interacción con un punto
- **Clic en un ítem de la lista → el mapa vuela al punto** y abre su popup. Se abre un popup INDEPENDIENTE en la coordenada (robusto: no depende de des-clusterizar el marker). Enlace profundo `?focus=<id>` (del correo) hace lo mismo al cargar.
- **Acciones en el popup (comunidad):**
  - **Confirmar que es real** → confirmación ciudadana existente (1 voto/uid; Cloud Function cuenta y transiciona a `confirmada`, §22.5).
  - **Marcar como resuelto** → NO cambia el estado (solo un coordinador resuelve desde el Panel). Abre un formulario de validación (¿por qué? ¿cómo lo sabe? contacto) y **avisa por correo** a un coordinador.
  - **Corregir o añadir detalles** → formulario de aporte; mismo canal de correo.

### 27.4 Notificación por correo sin tocar datos (§27)
Callable `solicitarResolucion` (en `functions/`, autorizada): Resend + App Check + rate-limit, con campo `tipo` ('resuelto' | 'correccion'). Anti-spam en cliente: **honeypot + límite local** (1/min) además del rate-limit server-side. El coordinador revisa y cierra/ajusta desde el Panel. Destino actual `hey@leanaraque.com` (remitente de prueba `onboarding@resend.dev`).

### 27.5 Notas técnicas (aprendidas)
- El `?focus=` fallaba porque el `fitBounds` ANIMADO pisaba el `setView` del vuelo. Fix: `fitBounds` instantáneo (`animate:false`), marcar el foco ANTES de cargar (suprime el auto-encuadre) y popup independiente.
- Namespace i18n `pmapa.*` (NO `panel.*`, que es del Panel del coordinador).
- Deploy: `firebase deploy --only hosting` + `--only functions:solicitarResolucion` (no toca el curador ni el resto). `leaflet.markercluster` debe estar instalado (`npm i` raíz) o el build falla.

---

## 28. Pipeline de ingesta recurrente — fuentes externas sin duplicar (27 jun 2026)

> Construido contra el plan aprobado por el operador. Implementa el **pipeline recurrente del §25.8**: mantiene `necesidades`/`recursos` actualizados desde varias fuentes externas, **idempotente** (re-ingerir no duplica), **staging-first** con **compuerta de operador** para PII/dudoso, preservando toda guarda de privacidad/costo y la **línea roja** (ciudadano > confirmado-multitud > lote masivo). **El gate NO lo cierra el agente.**

### 28.1 Arquitectura (Cloud Functions)
`ingesta` (`onSchedule` cada 180 min) corre cada **adapter** aislado → escribe a **`_ingesta_staging`** (una colección, doc id determinista **`sistema__id_externo`** → upsert) → el **promotor** concilia staging → canónico por **identidad (`fuentes[]`)** y luego **dedup** (proximidad/nombre, reusa `clusters`/`rankCanon` del curador) → auto-promueve lo estructurado/sin PII, y manda lo dudoso o con **PII** a `_revision_ingesta` (compuerta del operador). Watermark por fuente en `_ingesta_estado` (ingesta incremental; solo avanza tras escribir → resumible).

### 28.2 Núcleo anti-duplicados
- **Identidad estable** → `stagingId(sistema,id_externo)`; fuentes sin id (comentarios) usan `idExternoDeEntidad` (hash de nombre+sector). Re-ingesta = upsert, nunca doc nuevo.
- **`fuentes[]` (§25.3)** acumula procedencia `{sistema,id_externo,capturado_en,url}` sin repetir; sustituye al `creador=<TAG>` y habilita reversión.
- **Promotor** no toca la gestión del operador (`estado`/`verificacion`/`reclamada_por`) ni sobrescribe el contenido de un **ciudadano** (solo le adjunta la fuente). El dedup cross-source exhaustivo lo sigue haciendo el **curador** agendado.

### 28.3 Refactor compartido (sin duplicar lógica)
El motor de prioridad y el dedup salieron de `curador.js` a `functions/lib/{prioridad,dedup}.js`, compartidos con el promotor. Nuevos módulos puros: `functions/lib/{identidad,scrubPII,geo,geocode,staging,recolector,promocion}.js`. `firestore.rules`: `_ingesta_staging/_ingesta_estado/_ingesta_fuentes/_revision_ingesta` → **lectura solo coordinador, escritura solo Admin SDK** (el staging puede traer `privado.contacto`).

### 28.4 Calificación de fuentes (investigadas en vivo)
Califican: **terremotovenezuela.com** (ya), **rescate-ve.vercel.app** (ALTA: `/api/external-points`, centros→recursos + puntos→necesidades, IDs UUID + `updated_at`), **ayudavenezuela.app**, **ayudaparavenezuela.com** y **refugiosvenezuela.com** (Supabase, pendiente capturar anon key por panel de red — ver `functions/adapters/PENDIENTES.md`). Descartadas por **alcance/PII §3/§9-1**: desaparecidos (venezuelareporta/venezuelatebusca/desaparecidos/tiltely), **pacientes** (pacientesterremotovzla), **mascotas** (huellascan). Descartadas por **términos** (revisatuedificio prohíbe scraping) o por ser **servicio privado** (tilin/habitable) o **proxy OSM** ya cubierto (zonasegura).

### 28.5 Evidencia
- **Tests: 111 unit + 63 rules** (incluye 6 nuevos de las colecciones de ingesta) — verdes.
- **Idempotencia (emulador, `functions/test-idempotencia.mjs`):** RUN1 crea; **RUN2 sin cambios → creados=0, saltados=4 (cero duplicados)**; RUN3 con cambio → actualiza el canónico vinculado (no duplica) y conserva `fuentes[]`.
- **Reconciliación dry-run contra producción** (`scripts/migrar-fuentes.mjs`, read-only): 772 canónicos recibirían `fuentes[]`; el primer run crearía ~340 nuevos (rescate-ve aporta 242). Valida el emparejamiento con datos reales.

### 28.6 Estado del gate (pendiente)
| Estado | Ítem |
|---|---|
| ✅ | Código + tests (unit/rules/idempotencia) + reconciliación dry-run |
| ⏳ | **Auditoría del jurado** (rules de ingesta, honestidad del dedup, costo, línea roja/PII) |
| ⏳ | **Verificación en vivo** sobre focovenezuela.org con chrome-devtools (estaba ocupado por otro Chrome) |
| ⏳ | **Test de Lean** + decisión de **alcance** (rescate-ve trae acopio nacional, no solo zona del sismo) |
| ⛔ | **No desplegado:** el scheduler no se activa ni se corre `--apply`/ingesta real contra producción hasta el visto bueno del jurado + Lean |
| ⛔ | Capturar anon key de las 2 fuentes Supabase (panel de red) antes de activarlas |

**El gate NO se da por cerrado por el agente.** Nada desplegado ni datos reales modificados; todo en código + emulador + dry-run read-only.

### 28.7 DESPLEGADO A PRODUCCIÓN — primer run (27 jun 2026)

> Por **decisión del operador (Lean)**, el pipeline se desplegó a producción (supersede el "No desplegado" de §28.6). Despliegue metódico, probando en cada paso y reversible.

**Desplegado:** `firestore.rules` (añade `_ingesta_*`, aditivo) + Cloud Functions `curador` (refactor) e `ingesta` (nueva, agendada cada 180 min). Las demás funciones, intactas.

**Bug de rendimiento corregido en caliente:** el promotor hacía escrituras **secuenciales** (~2400 round-trips) → excedía el timeout de 540s y Pub/Sub re-entregaba (progreso a tirones, sin corromper por idempotencia). Se **batcheó** (≤400 escrituras/commit, como el curador) → el run completa en un solo invoke.

**Primer run (ingesta, promotor batcheado):** `staging 1210 | creados 182 | actualizados 644 | en revisión 1 | saltados 383`. Neto: **necesidades 759→880, recursos 280→538** (+379, rescate-ve aporta ~229 recursos). `fuentes[]` estampada en **666 necesidades + 488 recursos** (identidad para runs futuros).

**Guardas verificadas en vivo:**
- **Compuerta PII:** 1 reporte TVAPP con teléfono → `_revision_ingesta` (NO publicado). El pipeline atrapa PII que el import manual viejo dejaba pasar.
- **Curador en prod:** corrió e **idempotente** (run 1: 666 enriquecidos + 10 dup marcados; run 2: 0 cambios). El dedup colapsó 10 near-duplicados del ingest (sin explosión).
- **Línea roja / propiedad:** una fuente solo refresca el contenido de sus propios docs; a los demás solo les adjunta `fuentes[]`.

**Hallazgo de moderación (preexistente, NO del pipeline):** un doc `creador=TVAPP_NEC` (import manual viejo, **sin `fuentes[]` → intacto**) tiene en su descripción pública un teléfono + nombre de familiar ("…04120921730 soy Beatriz su familiar…"). Es backlog de moderación §9-1/§24.6 del operador; el pipeline nuevo ya lo gatearía. **Recomendado: barrido único de PII sobre descripciones públicas legacy.**

**Activo:** `firebase-schedule-ingesta-us-central1` ENABLED (cada 180 min) → frescura automática.

**Pendiente del gate:** auditoría del jurado; verificación en vivo con chrome-devtools (estaba ocupado); decisión de **alcance** (rescate-ve trae acopio nacional); capturar anon key de las 2 fuentes Supabase. **Reversible:** los docs nuevos llevan `creador` por fuente (`RESCATE_VE`, etc.) → borrables; `fuentes[]` es aditivo.

---

## 29. Frescura de `/mapa` sin romper el costo — stale-while-revalidate (28 jun 2026)

> Reporte del operador: usuarios veían **datos viejos** porque el botón "Actualizar" era la ÚNICA vía de refresco. Corregido sin sacrificar el control de costo (§6.2-r1) ni offline-first. Cambio **solo frontend**, desplegado y verificado en vivo. Commit `0adeb2d`.

### 29.1 Causa
La vista pública (§22.6) servía **caché-primero**: `leerNecesidadesPublicas` hacía `getDocsFromCache` y, si había caché, devolvía esos datos y **nunca** consultaba el servidor. `getDocsFromCache` es lectura puramente local → con la caché poblada, cada revisita mostraba datos viejos **indefinidamente** hasta pulsar "Actualizar". Diseño que priorizó el costo a costa de la frescura.

### 29.2 Corrección — stale-while-revalidate con ventana de frescura (TTL)
- `src/lib/db.js`: `TTL_FRESCURA_MS = 5 min`; marca de tiempo de la última lectura de servidor en localStorage (`foco_mapa_sync`, vía `marcarSync`) y helpers `msDesdeUltimaSync()` / `cacheVieja(ttl)`. La lógica caché-primero queda **intacta**.
- `src/routes/Mapa.svelte`: pinta desde caché al instante (offline-first, 0 lecturas) y, **solo si la caché superó el TTL**, revalida en segundo plano contra el servidor (`revalidando`, sin spinner de bloqueo) y actualiza sin botón. Un listener de `visibilitychange` revalida también al **volver a la pestaña** (caso típico "entré y vi datos viejos"). El botón "Actualizar" se conserva como **override manual** instantáneo (cooldown 15s).

### 29.3 Por qué NO rompe la virtud de costo (§6.2-r1)
El TTL acota las lecturas a **≤1 página por ventana y por usuario**, no por navegación: un usuario que entra/sale 50 veces en 5 min sigue costando 1 sola página; el pico viral no se dispara. Para escala muy grande, el siguiente escalón sigue siendo *bundles* por CDN (§22.6, Fase 2b).

### 29.4 Verificación en vivo (Chrome DevTools)
| Escenario | Evidencia | Resultado |
|---|---|---|
| Revisita **dentro** del TTL | red: solo auth, **0 peticiones a Firestore**; aviso "datos guardados" | caché, costo intacto |
| Revisita **tras** el TTL | red: lecturas de Firestore; `foco_mapa_sync` reseteado; aviso de caché desaparece | **refresco automático sin botón** |
| Botón "Actualizar" | con caché fresca, fuerza servidor ignorando el TTL | override manual intacto |
| Consola | sin errores en todo el flujo | ✅ |

Desplegado (`npm run deploy:hosting`) y confirmado en `focovenezuela.org` (la marca `foco_mapa_sync` se estampa con el bundle nuevo). **Nota de propagación (§22.11):** el service worker sirve el bundle viejo en la primera carga y activa el nuevo en la siguiente; como `index.html` es `no-cache`, se recoge rápido y desde entonces la frescura se mantiene sola → el fix es auto-propagante.

---

## 30. API pública de datos abiertos — endpoint para terceros (28 jun 2026)

> Pregunta del operador: ¿hay un endpoint para que usuarios externos extraigan los datos? **No lo había.** Construido. Encaja con el posicionamiento "fuente de verdad / datos abiertos" (§24.3, §25).

### 30.1 Estado previo (verificado)
No existía vía programática de extracción: todas las Cloud Functions eran `onCall` con `enforceAppCheck: true` (solo navegador atestiguado); Firestore con App Check **ENFORCED** rechaza clientes no-navegador; el CSV del footer corre en el cliente. Sin `onRequest`/REST/JSON.

### 30.2 Lo construido — `api` (`onRequest`, `functions/api.js`)
Endpoint HTTP de **solo lectura** servido en `focovenezuela.org/api/**` (rewrite de Hosting → Cloud Run `api`):
- `GET /api/necesidades.json` · `/api/necesidades.csv` · `/api/recursos.json` · `/api/recursos.csv` · `/api/` (índice).
- **Solo proyección PÚBLICA** (misma que ya muestra la web): categoría, urgencia, severidad, prioridad, estado, verificación, `precision`, sector, geo a **nivel sector**, `fuentes[]` (sistemas). Se prefiere el `resumen` saneado sobre la `descripcion` cruda. **NUNCA** contacto ni `geo_exacta` (§6.2-r2 intacto: ni se leen). Oculta `duplicado_de`.

### 30.3 Costo y seguridad
- **Costo acotado (§6.2-r1):** `Cache-Control: s-maxage=300` → el CDN de Hosting cachea la respuesta; el origen (y Firestore) se toca a lo sumo ~1 vez cada 5 min por más consumidores que haya. Mismo principio que §29.
- **Sin App Check** (es para clientes externos) y CORS `*`: la defensa es que es solo-lectura de datos ya públicos. `onRequest` queda público por defecto (a diferencia de los `onCall`, que requirieron binding manual, §22.11).

### 30.4 Verificación en vivo
| Prueba | Resultado |
|---|---|
| `/api/necesidades.json` directo y vía dominio | 200, 840 necesidades (943 − duplicados) |
| `/api/recursos.json` | 200, 544 recursos |
| Headers | `Access-Control-Allow-Origin: *`, `Cache-Control: …s-maxage=300` |
| CDN | request 1 `X-Cache: MISS`, requests 2–3 `X-Cache: HIT` (origen no tocado) |
| PII | sin contacto ni coords exactas; `descripcion` usa el `resumen` saneado |

### 30.5 Descubribilidad — página de documentación + link en el footer
Para que la API sea encontrable sin ser intrusiva: una **página estática** `public/api.html` (autocontenida, sin emojis, peso ~0 sobre el bundle) documenta endpoints, campos, ejemplo `fetch`, privacidad y el aviso de "no es servicio de emergencia". Se enlaza desde el footer con un **link discreto** "API de datos" (junto a Sugerencias / Descargar CSV / Código abierto), `href="/api.html"`. Como `api.html` es un archivo real en `dist`, Hosting lo sirve directo (no lo pisa el rewrite SPA). Verificado en vivo: la página carga y el link aparece en el footer.

Desplegado (`functions:api` + `hosting`). **Consideración de privacidad (backlog §28.7):** el barrido único de PII sobre descripciones públicas legacy sigue recomendado — la API amplifica el alcance de cualquier PII que aún quede en una `descripcion` sin `resumen`.

> **Pendiente acordado (siguiente pieza):** exactitud de coordenadas — surfacing de la cola `_procesar_revision` (conflictos de geo que el `procesador` ya detecta pero nadie revisa) en el Panel, + endurecer la geocodificación. Es el mayor arreglo real de precisión con menos esfuerzo.

---

## 31. Exactitud de coordenadas — revisión de ubicación en el Panel (28 jun 2026)

> Objetivo del operador: que los puntos del mapa estén lo más exactos posibles, dada la incertidumbre de las herramientas de geocodificación. Construido tras una **auditoría con evidencia** del estado real.

### 31.1 Auditoría (qué encontramos, no supusimos)
- **`_procesar_revision` está VACÍA** (el `procesador` casi no marca conflictos): surfacing esa cola hoy = pestaña vacía. Descartado como primer paso.
- La geocodificación **no está rota en masa**: 835 coords distintas de 840 puntos, **0 apilamientos en centroides**, 0 sin coords.
- **Reverse-geocode de muestra:** la mayoría cae bien (Los Corales→Caraballeda, La Trinidad→Baruta, Carayaca→Carayaca), **pero hay errores reales**: `"El Limón"`→Margarita, `"Puente de Morón"`→costa oriental (~500 km). El `limit=1` de Nominatim empareja nombres ambiguos con otro lugar del país.
- **Cuantificado:** **13 de 840 puntos (~1,5%) caen FUERA de la zona del sismo** (costa centro-norte). Ese es el síntoma detectable y accionable.

### 31.2 Lo construido — pestaña "Ubicación" en el Panel
- **Detección** (`src/lib/zona.js`, módulo PURO + tests): bounding box generoso de la zona afectada (`ZONA_AFECTADA`); `fueraDeZona(geo)` marca los puntos con coords fuera. 5 unit tests (incluye los errores reales y que Maracay/Valencia tierra adentro NO son falsos positivos).
- **Surfacing** (`Panel.svelte`, pestaña "Ubicación", badge ámbar): carga TODAS las necesidades **una vez, cache-first** (costo acotado §29) y lista las fuera de zona.
- **Corrección** (`UbicacionCard.svelte`): editor con **pin arrastrable** (reusa `MapaUnificado conPin`) + botón "Centrar en zona afectada" para mover un punto que cayó lejísimos. Guarda vía `aplicarEdicionNecesidad`→`editarNecesidad` (Admin SDK + rol, ya probado en prod). **Respeta la precisión:** edificio (`exacta`) → pública exacta; persona (`sector`) → pública a ~1 km + exacta solo al privado (§9-1). El doc queda `editado_por_operador` → la ingesta no lo vuelve a pisar.

### 31.3 Estado
- ✅ `zona.js` + 5 tests; suite unit completa **155/155**; build limpio. Detección confirmada contra producción (los 13 puntos vía la API §30).
- ⏳ **Verificación en vivo del render** la hace el operador (la pestaña está detrás del login de coordinador).
- **Limitación conocida (follow-up):** detección en cliente, sin flag persistente → un punto legítimamente de otra ciudad sigue listado hasta corregirlo. Si molesta, se persiste un `geo_revisada` o se automatiza la detección en el curador.

---

## 32. Limpieza estética: sin emojis + footer + frescura en la home (28 jun 2026)

> Ajustes pedidos por el operador. Capa de presentación.

- **Sin emojis en toda la web** (cumple la guarda de estilo): se quitaron de Recursos, Reportar, footer, NeedCard, LugarAutocomplete, indicador offline y cierres de KPI. Reemplazos limpios: estados de GPS por texto (`· ubicación lista` / `· no disponible`), cierres por `×` tipográfico, indicador offline por un punto CSS. Barrido final por rangos Unicode: 0 emojis en `src/public/index.html`.
- **Footer mejorado:** banda sutil (`--gris-claro`) separada del contenido, links centrados con separadores "·" y una línea de marca debajo (`Foco Venezuela · La ayuda se organiza entre todos`). Se siente intencional, no flotando sobre los mapas.
- **Frescura también en la home (`/`):** la home tenía el mismo problema que `/mapa` antes de §29 (cargaba cache-first una vez, sin revalidar). Ahora aplica el mismo *stale-while-revalidate* y **comparte la misma ventana `foco_mapa_sync`** que el mapa → el costo sigue acotado (§6.2-r1) y los datos se actualizan solos al entrar/volver a la pestaña, sin botón. Verificado: home carga sin errores, `foco_mapa_sync` activo.
- **Orden de capas del mapa (rojo sobre verde):** los marcadores/clústers de **recursos** (verdes, pocos) tapaban a los de **necesidades** (rojos, mayoría y el dato crítico) al alejar, porque Leaflet apila por orden de inserción y por latitud del marcador. Fix con **panes de z-index fijo** en `MapaUnificado`: `rec-pane` (610) < `nec-pane` (620) < `pin-pane` (650). Verificado en vivo: los rojos quedan solo en el pane 620 y los verdes en el 610 → las necesidades siempre por encima; el pin del reporte por encima de todo.

---

## 33. "Sin atender" → "Sin actualizar" — honestidad del estado (28 jun 2026)

> El operador señaló que "Sin atender" induce a error: hay equipos (nacionales, internacionales, voluntarios) trabajando en terreno que **no usan la plataforma**, así que FOCO no puede saber qué punto está siendo atendido. El dato `sin_atender` solo significa *ningún coordinador en la plataforma ha marcado un cambio de estado* — no afirma nada del mundo real.

**Decisión (solo texto mostrado; el valor `sin_atender` no se migra):** pasar de un lenguaje de "atendido/no atendido" a uno de **"sin novedad de estado en la plataforma"**.
- Chip de estado y KPIs (`/mapa` y home): "Sin atender" → **"Sin actualizar"** / "Sin actualización de estado".
- Subtítulo home: "nadie las ha tomado aún" → "sin novedad en la plataforma aún"; definición reescrita para aclararlo.
- **Aviso bajo los KPIs de `/mapa`:** *«Sin actualizar» = sin novedad de estado en la plataforma, no que nadie ayude: hay equipos en el sitio que no la usan.*

Verificado en vivo (mapa + home + chip de tarjeta): sin "Sin atender" residual; aviso visible.
