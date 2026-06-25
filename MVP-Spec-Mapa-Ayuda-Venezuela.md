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
