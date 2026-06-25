# Nota de privacidad y manejo de datos — FOCO

FOCO coordina ayuda ciudadana tras una emergencia. Recoge el mínimo de datos
necesarios para esa coordinación. **No es un servicio de emergencia.**

## Qué se guarda

**De un reporte de necesidad (público al verificarse):**
- Categoría, urgencia, sector/referencia textual, descripción corta.
- Ubicación **aproximada** (coordenadas redondeadas a ~1 km) para el mapa.
- Estado, verificación, marca de tiempo y un identificador anónimo del autor.

**Datos sensibles (privados — NUNCA públicos):**
- Contacto (teléfono/WhatsApp) — **opcional**.
- Coordenadas **exactas**, si el dispositivo las aporta.
- Se almacenan en un subdocumento aparte (`/privado/datos`), legible **solo**
  por un coordinador verificado que gestiona el caso.

## Qué NO se hace

- No se pide nombre, cédula ni datos de identidad.
- El contacto **no** se muestra públicamente ni a otros reportantes.
- No hay analítica ni rastreadores de terceros. No se vende ni cede data.
- No se publican coordenadas exactas de personas vulnerables.

## Advertencia al reportar

La **descripción** de una necesidad se vuelve pública cuando un coordinador la
verifica. **No escribas datos personales** (nombres completos, cédula, dirección
exacta) en la descripción. Para ser contactado, usa el campo de contacto, que es
privado.

## Identidad

- Quien reporta usa una sesión **anónima** (sin registro). El identificador
  anónimo sirve para deduplicar y limitar abuso, no para identificar a la persona.
- Los coordinadores usan cuenta con correo y se habilitan de forma controlada.

## Retención y operación

La plataforma se opera durante la emergencia. El plan de handoff (quién la opera
y por cuánto tiempo) es una condición de lanzamiento. Para solicitudes sobre tus
datos: hey@leanaraque.com.

> Este documento describe el comportamiento del software de referencia. Cada
> instancia desplegada por terceros es responsable de su propio cumplimiento.
