# Informe: Rendimiento, Escalabilidad y Estabilidad — 2026-07-06

Sesión de trabajo autónomo con agentes (auditoría paralela de 6 áreas + 25 verificadores + agente de bundle + revisión adversarial del diff). **Objetivo**: plataforma estable y sin fallos con muchos clientes y profesionales conectados a los chats.

## Resumen ejecutivo

- **37 agentes** auditaron el código en paralelo (chat en vivo, cliente Supabase/WebSocket, polling interno, home/bundle, serverless, SQL/índices) y produjeron ~47 hallazgos accionables; se implementaron los confirmados de impacto alto/medio con fixes quirúrgicos de bajo riesgo.
- **El fix más importante**: el WebSocket de Realtime **no se reconectaba nunca** — cualquier corte de red (WiFi móvil, suspender el portátil, ~1h de token) dejaba el chat congelado en silencio hasta recargar. Ahora se reconecta solo, con backoff, re-sincroniza mensajes perdidos y renueva el token.
- **JS de la home: −51% en primera visita** (565 kB monolito + 453 kB de mapa siempre → 198 kB de app + vendors cacheables; el mapa solo se descarga si el visitante llega a esa sección).
- Todos los caminos calientes quedaron **acotados** (límites + troceo de `in.()`): ya no hay queries que crezcan sin cota con el histórico ni URLs que revienten el gateway a escala.
- `npm run build` pasa ✅ (sin el warning de chunk >500 kB que había antes).

## Baseline (antes de cambios)

`npm run build` — exit 0, 14.81s, 1870 módulos.

| Chunk | Tamaño | Gzip | Nota |
|---|---|---|---|
| `index` (entrada — home pública) | 564.99 kB | 182.65 kB | ⚠️ >500 kB, monolito |
| `MapSection` (d3+topojson, lazy) | 453.55 kB | 136.01 kB | se descargaba en **cada** visita |
| `AsistenteIA` (lazy) | 198.78 kB | 62.67 kB | OK |
| `index.css` | 128.20 kB | 23.95 kB | |

## Después de cambios

`npm run build` — exit 0, 10.02s. Sin warnings.

| Chunk | Tamaño | Gzip | Cambio |
|---|---|---|---|
| `index` (app) | 198.33 kB | 63.92 kB | −65% vs entry anterior |
| `vendor` (react+router) | 159.83 kB | 52.20 kB | **estable entre deploys** (cache hit) |
| `motion` (framer-motion) | 140.15 kB | 46.53 kB | **estable entre deploys** |
| `AuthModal` + `VerificationStep` | 32.5 kB | 11.1 kB | ahora lazy (solo al hacer clic) |
| `RegisterContadorModal` | 14.65 kB | 5.11 kB | lazy |
| `UbicacionSelector` (datos Colombia) | 21.16 kB | 8.47 kB | lazy (solo en el paso del formulario) |
| `MapSection` | 453.62 kB | 136.04 kB | **solo se descarga al acercarse a la sección** |
| `index.css` | 113.82 kB | 21.91 kB | −14 kB (CSS de modales separado) |

**Primera visita (JS descargado)**: ~1.018 kB → ~498 kB (**−51%**). **Visita tras un deploy**: solo cambia el chunk de app (198 kB); vendor+motion (300 kB) vienen del caché del navegador (**−80%**).

---

## Cambios por área

### 1. Núcleo Realtime/red — [src/lib/supabase.js](../../src/lib/supabase.js) ⭐ el más crítico

| Problema | Fix |
|---|---|
| `onclose = () => {}`: un corte de red mataba el canal **para siempre** (cliente congelado en "esperando", dashboard sin mensajes nuevos hasta recargar) | **Reconexión automática** con backoff exponencial + jitter (2s→30s); re-hace todos los `phx_join` y relee el token fresco; `unsubscribe()` la cancela limpiamente |
| Heartbeat encadenado a cada `phx_reply` (N cadenas paralelas por socket; si un reply se perdía, la cadena moría y el servidor cortaba a los ~60s sin que el cliente se enterara) | **Un solo `setInterval`** de 25s con detección de **conexión zombi** (`_hbPending`): si el reply anterior no llegó, cierra el socket → dispara la reconexión |
| El JWT del join no se renovaba nunca: dashboards abiertos >1h perdían realtime en silencio | En cada tick del heartbeat, si el token cambió se reenvía el evento `access_token` a cada topic (mismo mecanismo que el SDK oficial) |
| `refreshSession` sin candado: varios polls simultáneos refrescaban en paralelo con el mismo refresh_token rotativo → sesión muerta aleatoria ("me sacó de la cuenta"); además un fallo de red LANZABA y colgaba AuthContext en loading eterno | **Single-flight**: una sola promesa compartida por pestaña + `catch(() => false)` — jamás lanza |
| Ningún fetch tenía timeout: requests colgados indefinidamente en redes móviles | `AbortSignal.timeout` (15s REST, 10s refresh, 20s remove) con helper compatible con navegadores viejos; **sin timeout en upload** (archivos grandes legítimamente tardan) |
| `storage.upload/remove` rechazaban la promesa en fallo de red → UI colgada en "Subiendo…" | try/catch devolviendo `{data, error}` (mismo contrato del resto del cliente) |

Al reconectar, el canal notifica `SUBSCRIBED` de nuevo → cada superficie de chat **re-sincroniza lo perdido** durante el corte (deduplicado por id).

### 2. Chats en vivo (4 superficies)

- **Envíos a prueba de fallos** en `LawyerChatDashboard`, `ContadorChatDashboard`, `ChatSection` (cliente) y chat interno: `try/finally` + chequeo de `res.ok`. Antes un fallo de red dejaba el botón **bloqueado para siempre** o **perdía el mensaje en silencio** (limpiaba el input sin confirmar el insert). Ahora el texto se conserva y se avisa (toast / banner).
- **`closeRoom`** con el mismo patrón (el botón no se queda en "Cerrando…"); la calificación es best-effort.
- **Carrera al cambiar de sala**: la respuesta tardía de la sala A ya no pinta mensajes bajo el encabezado de la sala B (ref de sala vigente). Ídem al cambiar de conversación en `AdminInternalChat`.
- **Re-suscripción espuria del WS**: el efecto de la sala activa dependía del **objeto** `activeRoom` — cada UPDATE de la sala destruía y recreaba el socket (ventana sin realtime + churn multiplicado por cientos de profesionales). Ahora depende del **id**.
- **Cliente reconectado**: al volver el WS, recarga mensajes y re-chequea el estado de la sala — un cliente en "esperando" ya se entera si un profesional tomó su caso durante el corte.
- **Sidebar resiliente**: un poll fallido (401 transitorio del refresh, 5xx, red) ya **no vacía la lista de chats** del profesional ni borra la conversación visible del chat interno — conserva el estado y reintenta al siguiente tick.
- **Micrófono**: al desmontar con una grabación activa se libera el mic y el timer (antes el indicador rojo del navegador quedaba encendido — parecía espionaje) en las 5 superficies con voz.

### 3. Escalabilidad de datos (límites y troceo)

| Punto | Antes | Ahora |
|---|---|---|
| Historial de sala (4 superficies) | **TODOS** los mensajes, re-descargados tras cada envío | últimos **300** (desc+limit servido por el índice existente) |
| Chat interno (poll 3s) | conversación **completa** cada 3s (×200 profesionales = decenas de miles de filas/s a escala) | últimos **200** por tick |
| Sidebar profesional (poll 20s) | `in.()` con **todas** las asignaciones históricas (URL rompe a ~450 salas → sidebar vacío determinista) | troceo en lotes de 150 + 200 salas más recientes |
| Visor superadmin | **toda** la historia de salas + `in.()` gigante | 300 más recientes (histórico vía búsqueda avanzada) |
| Alertas admin + cron inactividad | `in.()` sin cota (el cron entero fallaba en silencio a escala) y sin `limit` (truncado silencioso de PostgREST → falsos positivos) | lotes de 150 + límites explícitos |
| URLs firmadas de adjuntos | 1 POST de firma **por archivo por montaje** (abrir sala con 25 adjuntos = 25 firmas; cambiar de sala re-firmaba todo) | **caché por path** con margen de 5 min |
| Notas de voz | `preload="auto"`: abrir una sala descargaba **todos** los audios completos | `preload="metadata"` (descarga al reproducir) |

### 4. Solicitudes abiertas (claim)

- **Bug real de protocolo**: 3 `.on()` sin filtro generaban 3 `phx_join` al mismo topic — Phoenix conserva solo el último, así que los INSERT/UPDATE de solicitudes nuevas **jamás llegaban por realtime** (la feature vivía del poll de 30s). Ahora: **una** suscripción `event:'*'` con filtro `tipo_profesional` (menos fan-out server-side y menos invocaciones serverless).
- **Claim reversible** en [api/solicitudes.js](../../api/solicitudes.js): si el INSERT de asignación falla tras marcar la sala `active`, se revierte a `open` y se responde 502 "reintenta" — antes la sala quedaba **huérfana para siempre** (invisible en todos los dashboards) y el profesional creía que la había tomado.

### 5. Serverless

- **[api/notify.js](../../api/notify.js)**: eliminada la rama muerta `lawyer_joined` y el fallback `lawyerEmail` — permitían usar el Gmail de la firma como **relay de spam sin autenticación** (riesgo: Google suspende la cuenta y mueren TODOS los correos transaccionales: OTPs, resets). `esc()` en todos los datos de usuario interpolados en HTML. El catch ya no filtra `err.message` interno.
- **[api/_lib/adminAuth.js](../../api/_lib/adminAuth.js)**: `getCallerProfile` trae `aprobado,nombre,apellido` de una vez — `solicitudes.js` y `verify-request.js` releían la misma fila de `profiles` en el request más polleado del sistema (~20% menos queries en ese endpoint).
- **[api/ai.js](../../api/ai.js)**: se valida el **historial completo** (forma + tamaño: cliente ≤16 msgs/40k chars; profesional ≤80/400k). Antes solo se validaba el último mensaje: una llamada hostil podía inflar ~MB de contexto directo a Anthropic (costo en dólares por request). `tipo_profesional` normalizado antes de insertarse.
- **[api/whatsapp-webhook.js](../../api/whatsapp-webhook.js)**: acumulado de casos con topes (4k/mensaje, 50k total — antes crecía O(n²) sin límite). Protección del POST lista pero **opt-in** (ver Pendientes).

### 6. Home pública

- **Preload obsoleto eliminado**: `index.html` precargaba el AVIF del hero con `fetchpriority="high"`… pero Hero ya no abre la página (es de las últimas secciones). Ese preload competía con el JS y las fuentes del LCP real (el h1 de Intro). También se quitó el segundo preload runtime y el `loading="eager"`.
- **Fetches diferidos**: `Hero` (tabla `carrusel`) y `ModelosContractualesSection` leían Postgres **al montar la home** en cada visita; ahora esperan a que su sección se acerque al viewport (IntersectionObserver, patrón ya usado por `LawyersSection`).
- **Marquees de testimonios**: el loop de `requestAnimationFrame` (~60 escrituras/s × 2 filas) ahora se pausa cuando la sección no está en pantalla (batería/INP en móviles).
- **manualChunks** (vendor/motion), modales lazy, `UbicacionSelector` lazy, mapa diferido — ver tabla de bundle arriba.

---

## ⚠️ Pendientes que requieren TU acción (no son de código)

1. **Ejecutar los índices SQL** en Supabase → SQL Editor: [docs/sql/indices-perf-2026-07-06.sql](../sql/indices-perf-2026-07-06.sql)
   (cédula del flujo público, OTPs, ratings — con `IF NOT EXISTS`, re-ejecutar es inofensivo).
2. **Webhook de WhatsApp**: hoy el POST acepta cualquier origen (falsificable → spam saliente desde el número de la firma). El check ya está en el código pero **desactivado** para no romper el canal. Para activarlo:
   1. En el panel de Meta, cambia la URL del webhook a `https://<dominio>/api/whatsapp-webhook?token=<WHATSAPP_VERIFY_TOKEN>` (Meta re-verifica con el GET existente).
   2. En Vercel, agrega la variable `WHATSAPP_ENFORCE_TOKEN=1` y redeploya.
3. Los cambios están **sin commitear** (working tree) — revisa y commitea cuando quieras.

## Cómo probarlo (pasos explícitos)

1. `npm run dev` → abre la home. En DevTools → Network verás que **no** se descargan `MapSection`, `AuthModal` ni datos de Colombia hasta interactuar/scrollear.
2. **Prueba de reconexión (la clave)**: abre una consulta como cliente (o un dashboard como profesional) → DevTools → Network → "Offline" durante ~40s → vuelve a "Online". En ~2-30s el WS se reconecta solo y los mensajes enviados desde el otro lado durante el corte **aparecen sin recargar**. Antes: congelado hasta F5.
3. **Prueba de envío sin red**: en un chat, activa "Offline" e intenta enviar → aviso "No se pudo enviar…", el texto **se conserva** y el botón no queda bloqueado.
4. **Prueba de grabación**: inicia una nota de voz y navega a otra página → el indicador de micrófono del navegador se apaga.
5. Como superadmin: Historial de chats carga las 300 salas más recientes (el resto por búsqueda).

## Resultados de la revisión adversarial del diff

9 agentes revisaron el diff completo en 3 dimensiones (bugs/regresiones, concurrencia/estabilidad, consistencia de límites), con verificación escéptica de cada hallazgo grave. **Validaron como correctos** la reconexión WS, el single-flight del refresh, los `reverse()` de historiales, los cleanups, los contratos ampliados y el troceo de `in.()` — y encontraron 5 problemas reales que **se corrigieron en la misma sesión** (build final ✅):

1. **Reconexión con JWT expirado** (el caso "suspender el portátil >1h"): el join era rechazado en silencio y el canal quedaba sordo con el socket "sano". Ahora: se refresca el token **antes** de reconectar, un join rechazado cierra el socket para reintentar, y el backoff solo se resetea cuando un join de datos es aceptado (sin bucles de reconexión rápida).
2. **Poll del chat interno congelable**: el nuevo guard anti-solapamiento podía quedar bloqueado por un fetch colgado sin timeout. Ahora todos los fetch del poll llevan `timeoutSignal(15s)`.
3. **El cap de 200 salas del sidebar podía ocultar salas ABIERTAS antiguas**: ahora se conservan siempre TODAS las waiting/active y solo se recortan las cerradas.
4. **El tope de historial de la IA rompía chats largos del asistente profesional** (>80 mensajes → 400 permanente): ahora el cliente envía solo la cola reciente (40 mensajes) y el servidor **trunca** en vez de rechazar; el rechazo residual devuelve un mensaje claro ("inicia un chat nuevo").
5. **Alertas de inactividad**: lotes de 50 salas para la query de mensajes (sin falsos positivos por truncado) y claim idempotente (un reintento tras respuesta perdida ya no revierte una asignación válida).

Menores aceptados (documentados, no bloqueantes): el resync del cliente tras reconexión no replica el flujo completo de cierre (rating) — se recupera con el siguiente evento o recarga; en escenarios extremos (>1000 mensajes en 24h entre las salas del sidebar) el badge de no-leídos puede omitir una sala poco activa (comportamiento preexistente al diff); los eventos DELETE de `chat_rooms` no llegan con filtro en solicitudes (ningún flujo borra salas; el poll de 30s cubre).
