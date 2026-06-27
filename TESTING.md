# Kit de testeo en condiciones reales — FOCO Fase 1

Checklist reproducible para el **testeo de Lean** (paso 3 del gate, §12). Valida el
*Definition of Done* (§8) en móvil y red lenta. **Es el testeo humano que falta
para cerrar el gate de Fase 1**, junto con el handoff §9-4 y reclutar coordinadores.

- **App (staging):** https://foco-vzla.web.app
- **Panel demo (datos ficticios):** https://foco-vzla.web.app/panel?demo=1
- **Recomendado:** un teléfono de gama baja real + Chrome de escritorio con
  throttling para las mediciones precisas. Idealmente ambos.

> ⚠️ Probar **solo** con datos ficticios. No cargar datos de personas reales: el
> gate no está cerrado y la app no está habilitada para uso real.

---

## 0. Preparar el entorno de medición

### A) Throttling 3G en Chrome DevTools (escritorio)
1. Abre https://foco-vzla.web.app en Chrome.
2. `F12` → pestaña **Network**.
3. En el desplegable de throttling (dice "No throttling") elige **"Slow 3G"**.
   - Para emular gama baja añade CPU throttling: pestaña **Performance** → ⚙️ →
     **CPU: 4x slowdown** (o 6x).
4. Marca **Disable cache** (en Network) para medir carga en frío.
5. Para medir tiempos: pestaña **Performance** → grabar (●) → recargar → parar.
   Anota **DOMContentLoaded**, **Load** y, sobre todo, **Time to Interactive**.
   - Alternativa rápida: pestaña **Lighthouse** → modo *Mobile* → *Performance* →
     *Analyze*. Anota TTI, FCP y el peso transferido.

### B) Simular offline
- DevTools → **Network** → throttling → **Offline**.
- O en el móvil: activa **modo avión** tras la carga inicial.

### C) Capturas/evidencia a guardar
- Screenshot del panel de **Network** mostrando perfil "Slow 3G" + peso total.
- Screenshot de **Lighthouse** (TTI/Performance) o de la grabación Performance.
- Cronómetro (puede ser del teléfono) para el reporte <60s.
- Screenshots de cada paso marcado con 📸 abajo.

---

## 1. (DoD) Carga en red lenta 3G + tiempo a interactivo

| Paso | Acción | Criterio |
|---|---|---|
| 1.1 | Con "Slow 3G" + Disable cache, recarga la home en frío. | La app pinta el *shell* (cabecera + banner) sin pantalla en blanco prolongada. |
| 1.2 | Mide **Time to Interactive** (Lighthouse o Performance). | 📸 Anota el valor. Referencia: el *app-shell* gzip ≈ 20 KB; el grueso es Firebase (~140 KB gzip). |
| 1.3 | Recarga una 2ª vez (sin Disable cache). | Debe cargar casi instantánea (service worker sirve el shell cacheado). |

**Evidencia:** TTI 1ª carga, TTI 2ª carga, peso transferido. 📸

---

## 2. (DoD) Reporte completo en <60s en gama baja

| Paso | Acción | Criterio |
|---|---|---|
| 2.1 | Con CPU 4–6x slowdown (o teléfono real de gama baja), ve a **Reportar**. | — |
| 2.2 | Cronometra desde que abres `/reportar` hasta el mensaje de confirmación. | **< 60 s.** |
| 2.3 | Completa el mínimo: **categoría**, **¿para quién?**, **¿cuántas personas?** y una **ubicación** (autocompletado de lugar, GPS o pin en el mapa). | Los chips responden; el formulario no se traba. La urgencia NO se pide: se deriva de las señales (§25.5). |
| 2.4 | Según la categoría, completa los condicionales (rescate: ¿atrapados?/severidad; médico: tipo; agua/alimento/refugio: cantidad). | Los bloques condicionales aparecen/ocultan según la categoría elegida. |
| 2.5 | Pulsa "Usar mi ubicación" (opcional) o marca un pin en el mapa. | Permiso de GPS no bloquea el envío si lo rechazas; el pin fija la ubicación exacta (privada). |

**Evidencia:** tiempo total cronometrado. 📸 del mensaje de confirmación.

---

## 3. (DoD) Reporte CON contacto que persiste offline y sincroniza

> Valida la corrección del **orden de escritura** (§19): necesidad primero, contacto
> (subdoc privado) después, sin perderse offline.

| Paso | Acción | Criterio |
|---|---|---|
| 3.1 | Carga la app **online** una vez (para que cargue el SW y la sesión anónima). | — |
| 3.2 | Pon DevTools/móvil en **Offline**. | Aparece el indicador "Sin conexión" en la cabecera. |
| 3.3 | En **Reportar**, crea una necesidad **rellenando el campo de contacto**. | Mensaje *"Guardado sin conexión. Se enviará al recuperar señal."* 📸 |
| 3.4 | **Sin recargar**, vuelve a **Online**. Espera unos segundos. | El reporte sincroniza sin error visible. |
| 3.5 | Verifica que se guardaron **ambos** (necesidad + contacto). Como coordinador, o por consola Firebase: revisa que existe `necesidades/{id}` **y** `necesidades/{id}/privado/datos` con el contacto. | Ambos documentos presentes; el contacto NO se perdió. ✅ esto confirma §19. |
| 3.6 | (Opcional, negativo) Repite 3.2–3.4 pero cierra y reabre la pestaña estando offline antes de reconectar. | El reporte sigue en cola local y sincroniza igual al reconectar. |

**Evidencia:** 📸 del mensaje offline + confirmación de que el subdoc privado existe tras sincronizar.

---

## 4. (DoD) Persistencia offline + sync de lecturas

| Paso | Acción | Criterio |
|---|---|---|
| 4.1 | Abre `/panel?demo=1` **online** (carga los datos demo). | Se ven 5 necesidades demo en lista. |
| 4.2 | Pon **Offline** y recarga la pestaña. | La lista demo **sigue visible** (servida desde IndexedDB). 📸 |
| 4.3 | Cambia a vista **Mapa** estando offline (si ya la abriste antes online). | Los marcadores cacheados se muestran; los tiles ya vistos cargan del caché. |

**Evidencia:** 📸 del panel con datos estando en Offline.

---

## 5. (DoD) Banner + verificación visibles en todas las vistas

| Paso | Acción | Criterio |
|---|---|---|
| 5.1 | Recorre **Reportar**, **Panel** (`?demo=1`) y **Recursos**. | El banner *"no es un servicio de emergencia"* aparece en **todas**. |
| 5.2 | Despliega "Líneas oficiales" en el banner. | Muestra los contactos oficiales. |
| 5.3 | En el panel demo, observa cada tarjeta. | Cada necesidad muestra su etiqueta de **verificación** (verificada / sin verificar) y su **estado**. |
| 5.4 | En Reportar, revisa el aviso bajo la descripción. | Aparece *"No escribas datos personales… la descripción se hace pública"* (F2). |

**Evidencia:** 📸 del banner en al menos dos vistas + tarjeta con etiquetas.

---

## 6. Modo demo (panel sin login)

| Paso | Acción | Criterio |
|---|---|---|
| 6.1 | Abre `/panel?demo=1`. | Entra sin pedir login; muestra banner "Modo DEMO — datos ficticios". |
| 6.2 | Prueba filtros (categoría/urgencia) y el toggle Lista/Mapa. | Responden; el mapa carga al abrir la pestaña Mapa (no antes). |

---

## 7. Home como historia de datos (`/`)

| Paso | Acción | Criterio |
|---|---|---|
| 7.1 | Abre la home `/`. | Carga el relato: hero → puertas (reportar / ver mapa) → pulso (cifras) → brecha por zona → composición → procedencia (fuentes). |
| 7.2 | Pulsa una de las cifras del **pulso**. | Abre un modal con el mapa filtrado SOLO a esos puntos + su definición en lenguaje claro. |
| 7.3 | Con red lenta, observa el primer pintado. | El shell aparece sin pantalla en blanco prolongada; los agregados se computan en cliente sobre lo cacheado. |

---

## 8. Mapa operativo público (`/mapa`)

| Paso | Acción | Criterio |
|---|---|---|
| 8.1 | Abre `/mapa` (en móvil abre por defecto en el MAPA; en escritorio, lista + mapa). | Se ven los puntos clusterizados; la leyenda es legible. |
| 8.2 | Prueba los filtros (tipo / categoría / urgencia / estado) y la búsqueda. | La lista y el mapa se filtran en conjunto. |
| 8.3 | Clic en un punto de la lista. | El mapa **vuela** al punto y abre su popup. |
| 8.4 | En el popup, prueba **Confirmar**. | Registra tu confirmación ciudadana (una vez por persona). |
| 8.5 | En el popup, prueba **Resuelto** o **Corregir** (rellena el formulario). | Envía un aviso por correo al coordinador; NO cambia el dato en el mapa. |
| 8.6 | Abre un enlace profundo `?focus=<id>`. | El mapa vuela a ese punto y abre su popup directamente. |

---

## Plantilla de resultados (rellena y adjunta al gate)

```
Dispositivo / red: __________________________  Fecha: __________

1. Carga 3G — TTI 1ª: ____ s | TTI 2ª: ____ s | Peso: ____ KB     [ ] OK
2. Reporte <60s — tiempo: ____ s                                  [ ] OK
3. Reporte+contacto offline→sync — privado presente: [ ] sí       [ ] OK
4. Lecturas offline (panel demo visible offline)                  [ ] OK
5. Banner + verificación en todas las vistas                      [ ] OK
6. Modo demo /panel?demo=1                                        [ ] OK
7. Home `/` — relato + cifras del pulso clicables                 [ ] OK
8. Mapa `/mapa` — filtros, vuelo al punto, Confirmar/Resuelto     [ ] OK

Observaciones / fallos:
__________________________________________________________________
Veredicto de Lean:  [ ] Aprueba el testeo   [ ] Devuelve con observaciones
```

> Si algún criterio falla, repórtalo con la evidencia y el agente lo corrige antes
> de re-validar (regla de avance §12). Recuerda que, aun aprobando el testeo, el
> **lanzamiento** sigue bloqueado hasta el **handoff §9-4** y reclutar 5–10
> coordinadores.
