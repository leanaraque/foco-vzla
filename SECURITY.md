# Política de seguridad — FOCO

FOCO maneja datos sensibles en contexto de emergencia (contacto de personas
afectadas, ubicaciones). La seguridad es una condición de aprobación del
proyecto, no un extra. Agradecemos la divulgación responsable.

## Reportar una vulnerabilidad

- **Email:** hey@leanaraque.com
- Asunto sugerido: `[SEGURIDAD FOCO] <resumen>`
- Por favor incluye: descripción, pasos de reproducción, impacto y, si es
  posible, una prueba de concepto. **No** publiques el detalle hasta que se
  haya mitigado.
- Tiempo de respuesta objetivo: acuse en 72 h.

## Alcance

En alcance:
- Las **security rules de Firestore** (`firestore.rules`) — frontera de privacidad.
- Fugas del **subdocumento privado** (`/privado/datos`: contacto, coords exactas).
- Bypass de **App Check** o del rol de coordinador (custom claim).
- Validación de esquema en `create`/`update`.
- Exposición de secretos en el repo o el historial de git.

Fuera de alcance:
- Ataques de denegación de servicio volumétricos.
- Ingeniería social a operadores/coordinadores.
- Reportes automáticos sin impacto demostrable.

## Modelo de seguridad (resumen)

La seguridad **no** depende de mantener el código en secreto (el repo es público).
Depende de:
1. **App Check con enforcement** en Firestore (rechaza clientes no atestiguados).
2. **Custom claim `coordinador`** no spoofeable para el acceso a datos privados.
3. **Security rules** con validación estricta de esquema, valores y autoría.
4. **Aislamiento** del contacto y coordenadas exactas en un subdocumento privado.

La **API key web** del cliente es pública por diseño (va en el bundle del
navegador); no es un secreto. Está restringida por referrer HTTP y por servicio.
Lo que protege los datos son las rules + App Check, no la key.
