# Diseño — Blindaje de `chat_rooms` para el cliente anónimo (RLS + RPC)

**Fecha:** 2026-07-27
**Autor:** Esteban + Claude
**Estado:** Diseño (pendiente de aprobación → plan de implementación)

> ## ⚠️ ACTUALIZACIÓN 2026-07-27 (tras Fase 0) — se pivotó el enfoque
> La Fase 0 reveló que la BD **ya tenía** las políticas correctas ("Ver salas v2" /
> "Ver mensajes v2") que acotan por un claim `client_token` del JWT — solo faltaba
> emitir/usar ese JWT en el cliente, y borrar 2 políticas viejas `qual=true` que las
> anulaban. Ese enfoque **JWT-claim es superior** al de RPC de este spec: mantiene el
> Realtime (acotado solo) y cierra **también `chat_messages`** (fuga de conversaciones
> ajenas, confirmada) sin reescribir el chat. **Se implementó el enfoque JWT**, no el RPC.
> Ver el runbook actualizado: [`docs/sql/chat-rooms-fase0-y-runbook.md`](../../sql/chat-rooms-fase0-y-runbook.md).
> Lo de abajo (RPC) queda como referencia histórica; los archivos `chat-rooms-rpc-*.sql`
> y la migración a RPC en `ChatSection` quedaron **superados**.

---

## 1. Problema

`chat_rooms` no tiene **RLS de filas** para el rol `anon`; solo tiene *grants de columnas*. El cliente del chat es **anónimo** (no hay sesión de Supabase): se identifica con el hash SHA-256 de su cédula (`chat_cedula_hash` en `localStorage`), que en la BD es a la vez `client_token` **y** `client_cedula`, y lee sus salas filtrando `?client_cedula=eq.<hash>`.

Consecuencias explotables (hallazgo MEDIO de `/security-review`):

1. **Enumeración:** un anónimo con la anon key puede hacer `GET /rest/v1/chat_rooms?select=id&status=eq.active` (sin filtro) y **volcar todas las salas**, incluyendo `id`, `status`, `client_token`, `client_cedula`, `codigo_referencia`, `tipo_profesional`, timestamps y `area_derecho`.
2. **`client_token` legible → forge de reseñas:** el fix de `enviar_resena_directa` exige `p_client_token = chat_rooms.client_token`, pero como esa columna es legible por `anon`, un atacante la lee y **reenvía**, forjando/sobrescribiendo reseñas de cualquier profesional.

No hay fuga de PII directa: `client_email`, `client_celular`, `client_nombre` **ya están revocados** para `anon`. Lo expuesto es metadata + el hash.

**La raíz** es que un cliente sin identidad de sesión filtra por un valor que, para poder filtrarse vía PostgREST, tiene que ser legible — y al ser legible, es enumerable.

## 2. Objetivo

`anon` deja de tener **cualquier acceso directo** a `chat_rooms`. Todo lo que hoy hace el cliente contra esa tabla pasa por **funciones `SECURITY DEFINER`** que reciben el hash de la cédula (`p_client_token`) y solo devuelven/tocan las filas de ese hash.

**Criterio de éxito:**
- `GET /rest/v1/chat_rooms?select=id` con la anon key devuelve **vacío** (o 401), sin importar los filtros.
- `client_token` / `client_cedula` dejan de ser legibles por `anon` → el fix de reseñas queda blindado.
- El cliente sigue pudiendo: crear consulta, reencontrar su consulta en curso (incluido **cross-device** re-ingresando la cédula), chatear en tiempo real y calificar.
- Los dashboards de abogado / contador / superadmin siguen funcionando **sin cambios de código** (mismas queries con el JWT del usuario), gracias a políticas RLS correctas.
- Óptimo en rendimiento y escalabilidad: **sin polling de intervalo fijo**.

## 3. Restricciones descubiertas

- **La identidad del producto es la cédula, no el navegador.** Por eso se descarta la sesión anónima de Supabase (`signInAnonymously`): rompería la continuidad cross-device y **inflaría `auth.users`** con un usuario basura por visitante (malo para escalabilidad).
- **Realtime respeta RLS.** Si se le quita a `anon` el `SELECT` sobre `chat_rooms`, el Realtime de esa tabla deja de entregarle eventos. Por eso la detección del cambio de estado no puede seguir dependiendo del Realtime de `chat_rooms`.
- **La RLS real vigente vive en el panel de Supabase, no en el repo** (como `notificaciones`). No se puede aplicar RLS nueva a ciegas: hay que **confirmar el estado actual primero** (Fase 0) o se arriesga romper dashboards/clientes en producción.

## 4. Enfoques considerados

- **(A) RPC keyed por cédula (elegido).** Denegar acceso directo de `anon`; el cliente usa RPCs `SECURITY DEFINER` con el hash. Preserva cross-device, no infla `auth.users`, y con detección por eventos escala bien. Requiere reemplazar el Realtime de estado del cliente.
- **(B) Sesión anónima de Supabase.** Limpia para RLS por `auth.uid()`, pero rompe cross-device e infla `auth.users`. Descartada por la restricción de identidad.
- **(C) RLS por header (`current_setting('request.headers')`).** Cierra el `SELECT` REST pero **no** el Realtime (no lee headers por suscripción) y es frágil. Descartada.

## 5. Diseño (end-state)

### 5.1 RPCs nuevas (`SECURITY DEFINER`, `set search_path = public`, keyed por `p_client_token`)

| Función | Reemplaza | Comportamiento |
|---------|-----------|----------------|
| `crear_sala(p_client_token, p_area_derecho, p_client_email, p_client_nombre, p_client_celular, p_client_genero, p_tipo_profesional, p_codigo_referencia)` | `supabase.from('chat_rooms').insert(...)` en [ChatSection.jsx:1332](../../src/components/chat/ChatSection.jsx#L1332) | Inserta la sala con `client_token = client_cedula = p_client_token`, `status='waiting'`. Encapsula el fallback de colisión `codigo_referencia` (reintenta con `null`). Devuelve `{ id, status, ... }` (solo columnas que el cliente necesita, sin PII redundante). |
| `mis_salas(p_client_token)` | `.select(ANON_ROOM_COLS).eq('client_cedula', hash)` en [ChatSection.jsx:853](../../src/components/chat/ChatSection.jsx#L853) y [:1315](../../src/components/chat/ChatSection.jsx#L1315) | Devuelve las salas donde `client_cedula = p_client_token`, ordenadas por `created_at desc`. Columnas no-PII necesarias para el flujo (id, area_derecho, status, codigo_referencia, tipo_profesional, timestamps). **No** devuelve `client_token`/`client_cedula`. |
| `estado_sala(p_client_token, p_room_id)` | `.select('status').eq('id', roomId)` en [ChatSection.jsx:1140](../../src/components/chat/ChatSection.jsx#L1140) | Devuelve `status` (y `updated_at`) **solo si** `chat_rooms.client_cedula = p_client_token` para ese `p_room_id`; si no, nada. |
| `enviar_resena_directa(..., p_client_token)` | — (ya actualizada 2026-07-22) | Sin cambios; se **blinda sola** al dejar de ser legible `client_token`. |

Todas: `revoke all ... from public` + `grant execute ... to anon, authenticated`.

### 5.2 RLS en `chat_rooms`

`alter table public.chat_rooms enable row level security;` + revocar los grants de columna a `anon` (el cliente ya no toca la tabla directo). Políticas:

- **`anon`:** ninguna política directa → sin acceso salvo por las RPC `SECURITY DEFINER`.
- **Profesional autenticado** (`SELECT` + `UPDATE`): filas donde existe asignación suya en `chat_room_lawyers` (`lawyer_id = auth.uid()`), **más** las salas `status='open'` cuyo `tipo_profesional` coincide con el `rol` del que llama (para *Solicitudes abiertas*, [SolicitudesAbiertas.jsx:136](../../src/components/chat/SolicitudesAbiertas.jsx#L136)).
- **Superadmin** (`SELECT` + `UPDATE`, todo): filas donde `exists (select 1 from profiles where id = auth.uid() and rol = 'superadmin')`.

> Las políticas deben cubrir **todos** los patrones de query autenticados actuales (id=in, status=in, codigo_referencia, PATCH). Si falta uno, el dashboard correspondiente se rompe. Inventario en §7.

### 5.3 Cliente (`ChatSection.jsx`)

- Reemplazar las 3–4 llamadas directas a `chat_rooms` por las RPC (`crear_sala`, `mis_salas`, `estado_sala`).
- Quitar `client_token`/`client_cedula` de cualquier `select`; el cliente usa el hash de `localStorage`.
- **Detección de estado por eventos (sin polling):** eliminar el listener `postgres_changes` sobre `chat_rooms` ([ChatSection.jsx:1102](../../src/components/chat/ChatSection.jsx#L1102)). En su lugar:
  - El cliente ya escucha `INSERT` en `chat_messages` de su sala. Cuando llega un mensaje **y** el paso es `'esperando'`, llama `estado_sala` una vez para leer el estado autoritativo (detecta `waiting→active`). El flujo de "tomar" ya inserta el mensaje del caso, así que el evento existe.
  - En reconexión del WebSocket, llamar `estado_sala` una vez (ya hay un hook de reconexión en [:1132](../../src/components/chat/ChatSection.jsx#L1132)).
  - Para el cierre (`→closed`): el cierre debe dejar rastro que el cliente detecte (mensaje de sistema al cerrar, o el mismo re-chequeo `estado_sala` al llegar cualquier evento). Se valida en implementación que exista el disparador; si no, se añade un mensaje de sistema al cerrar.
- **No se toca** el Realtime de `chat_messages` ni el flujo de mensajes: el chat sigue en tiempo real.

## 6. Fuera de alcance

- **Lectura de `chat_messages`:** ya tiene RLS en *escritura* ([ChatSection.jsx:1411](../../src/components/chat/ChatSection.jsx#L1411) lo menciona), pero su **lectura** no se puede ver desde el repo. La **Fase 0 la confirma empíricamente**; si un anónimo puede leer conversaciones ajenas, es **más grave** y entra a este trabajo (decisión con datos, no asumida). No se rediseña el flujo de mensajes en este spec.
- Fortaleza intrínseca del hash de cédula (la cédula es de baja entropía; conocerla = acceso). Es un problema preexistente y más profundo; no es el objetivo de este cambio.

## 7. Inventario de accesos a `chat_rooms` (para no romper nada)

**Directo `anon` (a mover a RPC):** [ChatSection.jsx:853](../../src/components/chat/ChatSection.jsx#L853), [:1102](../../src/components/chat/ChatSection.jsx#L1102) (realtime), [:1140](../../src/components/chat/ChatSection.jsx#L1140), [:1315](../../src/components/chat/ChatSection.jsx#L1315), [:1332](../../src/components/chat/ChatSection.jsx#L1332)/[:1344](../../src/components/chat/ChatSection.jsx#L1344).

**Autenticado con JWT de usuario (deben seguir por RLS):**
- Abogado: [LawyerChatDashboard.jsx:332](../../src/components/chat/LawyerChatDashboard.jsx#L332) (id=in), [:479](../../src/components/chat/LawyerChatDashboard.jsx#L479) (realtime), [:550](../../src/components/chat/LawyerChatDashboard.jsx#L550)/[:784](../../src/components/chat/LawyerChatDashboard.jsx#L784) (PATCH).
- Contador: [ContadorChatDashboard.jsx:324](../../src/components/chat/ContadorChatDashboard.jsx#L324) (id=in + tipo=contador), [:467](../../src/components/chat/ContadorChatDashboard.jsx#L467) (realtime), [:531](../../src/components/chat/ContadorChatDashboard.jsx#L531)/[:803](../../src/components/chat/ContadorChatDashboard.jsx#L803) (PATCH).
- Solicitudes abiertas: [SolicitudesAbiertas.jsx:136](../../src/components/chat/SolicitudesAbiertas.jsx#L136) (realtime `open` por tipo).
- Superadmin: [SuperAdminChatViewer.jsx:479](../../src/components/chat/SuperAdminChatViewer.jsx#L479), [:716](../../src/components/chat/SuperAdminChatViewer.jsx#L716), [:842](../../src/components/chat/SuperAdminChatViewer.jsx#L842) (client_cedula), [:929](../../src/components/chat/SuperAdminChatViewer.jsx#L929), [:960](../../src/components/chat/SuperAdminChatViewer.jsx#L960) (force-close).
- Admin: [AdminPage.jsx:215](../../src/pages/AdminPage.jsx#L215), [:298](../../src/pages/AdminPage.jsx#L298), [:311](../../src/pages/AdminPage.jsx#L311), [:345](../../src/pages/AdminPage.jsx#L345) (PATCH reabrir).
- Otros superadmin: [GestoresAdmin.jsx:78](../../src/components/admin/GestoresAdmin.jsx#L78)/[:132](../../src/components/admin/GestoresAdmin.jsx#L132), [NotificationBell.jsx:423](../../src/components/admin/NotificationBell.jsx#L423), `AdminStats.jsx`.

> Nota: `SuperAdminChatViewer.jsx:842` busca por `client_cedula` (búsqueda por cédula del admin). Con RLS de superadmin "todo", sigue funcionando. Confirmar en pruebas.

## 8. Fases (rama aislada, checkpoint en cada una)

- **Fase 0 — Confirmar estado real (obligatoria, sin código).** Scripts de consola (anon key) para verificar qué expone hoy `chat_rooms` y `chat_messages` a `anon`. Esteban pega las políticas actuales de ambas tablas desde Supabase. Define el alcance exacto de `chat_messages`.
- **Fase 1 — RPCs + cliente, con RLS aún permisiva.** Crear las RPC; migrar `ChatSection` a ellas y a la detección por eventos. Probar: crear consulta, reencontrarla (mismo navegador y cross-device), chat en vivo, calificar. Todo idéntico para el usuario.
- **Fase 2 — Activar RLS + políticas.** Habilitar RLS y crear las políticas de §5.2; revocar grants de `anon`. Probar **cada rol**: cliente (solo lo suyo, vía RPC), abogado (asignadas + abiertas), contador, superadmin (todo, incluida la búsqueda por cédula).
- **Fase 3 — Verificación anti-hackeo.** Repetir el ataque original (`GET /rest/v1/chat_rooms?select=id,client_token` con anon key) y confirmar **vacío/401**. Confirmar que `enviar_resena_directa` ya no es forzable (no se puede leer `client_token`).

## 9. Riesgos y mitigación

- **Romper dashboards por políticas incompletas** → inventario §7 + pruebas por rol en Fase 2, en rama aislada, antes de tocar `main`.
- **Romper el chat del cliente** (creación/estado) → Fase 1 valida el flujo completo con RLS aún permisiva, aislando el cambio de cliente del de RLS.
- **`chat_messages` resulta también abierto** → se detecta en Fase 0; si aplica, se planifica aparte (no se mete a las bravas porque su Realtime es esencial).
- **SQL debe aplicarse en Supabase junto con el deploy del frontend** → las RPC y el frontend van acopladas; se despliegan juntas (documentado).

## 10. Preguntas abiertas (resolver en Fase 0)

1. ¿Qué devuelve hoy exactamente `GET /rest/v1/chat_rooms` (sin filtro) con la anon key? (confirma la enumeración)
2. ¿`chat_messages` permite lectura anónima de salas ajenas?
3. ¿Existen ya políticas RLS en `chat_rooms` en Supabase que haya que reemplazar/coexistir?
