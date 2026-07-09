# Integración de IA: triage del cliente + asistente del profesional

**Fecha:** 2026-06-10
**Estado:** Diseño aprobado — pendiente plan de implementación
**Autor:** Esteban (con Claude Code)

## Objetivo

Integrar IA generativa (Anthropic Claude) en dos superficies del sitio de Abogados & Asociados Parada:

1. **Cliente — IA de admisión (triage):** un paso conversacional, previo a elegir profesional, que clasifica el caso por área, lo explica en lenguaje sencillo, recomienda el/los mejores profesionales aprobados y da un rango de costo orientativo. Limitado por número de mensajes. Al terminar, entrega un resumen del caso al profesional humano.
2. **Profesional — Asistente IA:** una herramienta dentro del panel del abogado/contador para generar documentos, resumir la consulta real de una sala, hacer análisis de caso y chat libre.

Un mismo proveedor (Claude) con modelo económico para el cliente (Haiku 4.5) y modelo potente para el profesional (Sonnet 4.6).

## Decisiones tomadas (brainstorming)

| Decisión | Resultado |
|----------|-----------|
| Rol de la IA del cliente | Asistente de admisión (triage previo), no asistente persistente |
| Capacidades del cliente (v1) | Clasificar área, explicar simple, recomendar profesional, **rango de costo orientativo**. SIN subir archivos, SIN análisis de vacíos jurídicos (eso lo hace el abogado humano) |
| Capacidades del profesional (v1) | Generar documentos, **resumir la consulta de una sala**, análisis de caso/estrategia, chat libre |
| Proveedor | **Anthropic Claude** — Haiku 4.5 (cliente) / Sonnet 4.6 (profesional) |
| Límite del cliente | Por **número de mensajes** por sesión (default 6, configurable), aplicado en servidor |
| Handoff | **Sí** — la IA entrega un resumen del caso al profesional como primer mensaje de la sala |
| Ubicación cliente | **IA primero**: panel conversacional al entrar; "elegir manualmente" como enlace secundario |
| Ubicación profesional | **Pestaña "Asistente IA"** en el perfil + botón "Resumir con IA" dentro de cada sala |
| Ayuda para comunicarse con la IA | **Input libre siempre** + **plantillas que se completan** (chips que insertan texto editable con campos) + glosario ligero desplegable |
| Arquitectura | **Enfoque A**: un proxy serverless, dos modos, estado/límites en Supabase, sin streaming en v1 |

## Arquitectura

### Endpoint único: `api/ai.js`

Serverless function de Vercel (runtime Node). Recibe `POST { modo, sessionId, mensajes[], plantilla? }`.

| | Modo `cliente` (triage) | Modo `abogado` (asistente) |
|---|---|---|
| Modelo | Claude Haiku 4.5 | Claude Sonnet 4.6 |
| Auth | Anónimo (sin token) | Valida token + `rol ∈ {abogado, contador}` vía `_lib/adminAuth` (`getCallerProfile`) |
| Límite | Tope de mensajes/sesión (server-side, default 6) + rate-limit por IP hasheada | Sin tope duro (opcional: tope diario suave) |
| System prompt | Triage AAP (clasifica, explica simple, recomienda, costo orientativo, barreras legales) | Asistente legal AAP (documentos, resumen, análisis; marca "requiere revisión profesional") |

- **SDK de Anthropic** server-side. La clave `ANTHROPIC_API_KEY` nunca llega al navegador.
- **Prompt caching** del system prompt (largo y fijo) para abaratar cada llamada. La implementación usará la skill `claude-api`, que exige prompt caching.
- **Sin streaming** en v1: respuesta completa con indicador "Pensando…". La estructura permite añadir SSE después sin rehacer.
- Para el modo `cliente`, la lista de profesionales candidatos se obtiene de `api/professionals.js` (ya cacheada en CDN); la IA recibe `{id, nombre, area_derecho, ciudad}` y devuelve los `id` recomendados (no inventa profesionales).

### Modelo de datos

**Tabla nueva `ai_sesiones`** (Supabase), escrita con service-role desde el endpoint; RLS bloquea acceso directo del cliente (patrón de `notificaciones`):

| Columna | Tipo | Nota |
|---------|------|------|
| `id` | uuid (pk) | sessionId del triage |
| `ip_hash` | text | SHA-256 de la IP para rate-limit por IP |
| `mensajes_count` | int | conteo server-authoritative para el tope |
| `area_detectada` | text | área clasificada por la IA |
| `resumen` | text | resumen del caso para el handoff |
| `recomendados` | jsonb | ids de profesionales recomendados |
| `costo_rango` | text | rango orientativo mostrado |
| `tipo_profesional` | text | `abogado` \| `contador` |
| `created_at` | timestamptz | default now() |

RLS: solo service-role INSERT/UPDATE/SELECT. El navegador nunca lee/escribe esta tabla directamente; todo pasa por `api/ai.js`.

### Variables de entorno nuevas

```
ANTHROPIC_API_KEY        # clave de Anthropic (solo server-side)
AI_CLIENTE_MAX_MSGS      # opcional, default 6
```

(Reutiliza `SUPABASE_SERVICE_ROLE_KEY` ya existente para escribir `ai_sesiones`.)

## Flujo del cliente (triage)

Reemplaza la entrada directa al formulario manual dentro de `ChatSection`.

1. El cliente elige tipo (abogado/contador) y entra → **nuevo paso `triage`** (en lugar de saltar a `form`).
2. Panel conversacional:
   - **Input libre siempre visible** + chips de **plantillas que se completan** (ej. *"Tengo un problema de [área]. Pasó [cuándo]. Quiero [objetivo]."*) que se insertan en el input para que el cliente las edite.
   - Indicador visible **"Te quedan N mensajes"**.
   - Glosario ligero desplegable ("💡 ¿Cómo contarlo mejor?").
3. La IA clasifica el área, explica en lenguaje simple y, con suficiente contexto, muestra **1-3 tarjetas de profesionales recomendados** + **rango de costo orientativo** (rotulado "no vinculante").
4. Botón **"Iniciar chat con [profesional]"** → reusa `startChat` con adaptaciones:
   - El triage **pre-llena `form`** (`areas`, `descripcion`, datos capturados).
   - El profesional elegido entra como `picked`.
   - El **resumen estructurado de la IA** se inserta como primer `chat_message` de la sala (en lugar del intro crudo del formulario).
5. Escape hatch: enlace **"Prefiero elegir yo mismo"** → cae al `form` manual actual (nada se pierde).
6. Al agotar mensajes: la IA cierra con su mejor recomendación + botón de iniciar chat (nunca queda sin salida).

## Flujo del profesional (abogado/contador)

Nueva pestaña **"✨ Asistente IA"** en `ProfilePage` y `ProfileContadorPage`, implementada como componente compartido (p. ej. `src/components/chat/AsistenteIA.jsx`), más un botón **"✨ Resumir con IA"** dentro de cada sala del dashboard.

- **Workspace (pestaña):** input libre + **sugerencias de inicio** (chips: *Redactar documento / Análisis de caso / ¿Qué norma aplica?*) + **plantillas con campos** para documentos (tipo, destinatario, hechos → arman el prompt internamente). Glosario "cómo pedirle bien".
- **Contextual (por sala):** el botón "Resumir con IA" / "Analizar caso" lee los `chat_messages` de *esa* sala y devuelve resumen/análisis en contexto. El profesional puede copiar el texto a su respuesta.
- Respuestas en **markdown** renderizado, con botón **Copiar**. Documentos generados se pueden copiar/descargar como `.txt` en v1 (integración con la tabla/bucket `contratos` queda para una fase posterior).
- Sin tope duro de mensajes (uso interno autenticado).

## Salvaguardas legales

- Disclaimer fijo en el chat del cliente: *"Orientación general, no constituye asesoría legal ni genera relación abogado-cliente."*
- Rango de costo siempre rotulado **"orientativo, no vinculante"**.
- System prompt con barreras: la IA **no inventa normas ni artículos**, no promete resultados, ante temas graves (penal, violencia) recomienda contacto humano inmediato, y siempre cierra dirigiendo al profesional.
- Borradores del asistente del profesional marcados **"requiere revisión profesional"**.

## Manejo de errores y abuso

- Si Anthropic falla o hay timeout → mensaje claro + **fallback al formulario manual** (el cliente nunca queda atrapado).
- Límite por **IP hasheada** además del tope por sesión (default máx. 10 sesiones de triage/IP por hora, configurable) para frenar abuso del endpoint público anónimo.
- Tope de longitud por mensaje; respuesta `429` con mensaje amable al superar límites.
- El modo `abogado` rechaza solicitudes sin token válido o con rol no autorizado (`401`/`403`).

## Pruebas

No hay test runner en el repo; las pruebas son manuales con pasos explícitos.

Checklist de QA:
1. Triage feliz: contar caso → clasifica área → recomienda profesional → costo orientativo → iniciar chat.
2. Límite agotado: tras N mensajes, la IA cierra con recomendación y botón (no se bloquea sin salida).
3. Fallback: simular fallo de Anthropic → aparece el formulario manual.
4. Handoff: tras iniciar chat, el abogado ve el resumen de la IA como primer mensaje de la sala.
5. Asistente profesional con rol válido: genera documento, resume una sala, análisis.
6. Seguridad: `api/ai.js` modo `abogado` sin token / con rol cliente → rechazado.

Script de consola (no DevTools Network) para probar `api/ai.js` en local, acorde al flujo de trabajo del usuario.

## Fuera de alcance (v1)

- Subida y lectura de archivos por la IA del cliente (lo hace el abogado humano).
- Análisis de vacíos jurídicos para el cliente.
- Streaming SSE (se puede añadir después sobre la misma estructura).
- Integración directa de documentos generados con la tabla/bucket `contratos` (v1 = copiar/descargar `.txt`).
- Cifras de costo vinculantes.

## Costo

Haiku 4.5 para el cliente + prompt caching del system prompt mantiene el costo por consulta muy bajo. El caching del system prompt es la palanca principal de ahorro.
