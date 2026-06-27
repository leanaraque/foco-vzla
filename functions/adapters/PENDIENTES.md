# Adapters pendientes — fuentes Supabase (captura de anon key)

Estas dos fuentes pasaron la rúbrica de calificación (Plan, Fase 1) pero su backend es
**Supabase con la anon key en un chunk lazy** del bundle, que no se pudo extraer por
`curl` (durante la investigación el Chrome del MCP estaba ocupado). La captura es
trivial en el **panel de Red de chrome-devtools** con el navegador libre:

1. Abrir el sitio, filtrar las peticiones por `supabase.co`.
2. Tomar de una petición `/rest/v1/<tabla>?...` el header **`apikey`** (la anon key, pública
   por diseño) y el **nombre de la tabla** + columnas (id estable, lat/lng, updated_at).
3. Crear el adapter como `ayudavenezuela.js` (mismo patrón Supabase REST) y agregarlo al
   registro `ADAPTERS` en `functions/ingesta.js`.

| Fuente | Proyecto Supabase | Destino esperado |
|---|---|---|
| ayudaparavenezuela.com | `yqcwttcbweqicdyfwseb.supabase.co` | recursos (acopio) + insumos por zona |
| refugiosvenezuela.com  | `jewiqrfjotzbwsmiomjx.supabase.co` | recursos (refugio / alimentación) |

**veneconnect.com** (calificada "media") quedó fuera: su `/api/ayuda` devuelve 404 y la
lista de acopio vive **inline en `ayuda.js`** (JS estático, frágil). Si se quiere, se
parsea ese array en build, pero no es una API estable.

**zonasegura.up.railway.app**: descartada (su `/api/places` es un proxy de OpenStreetMap;
datos de referencia ya cubiertos por nuestra ingesta Overpass `lugares.json`).
