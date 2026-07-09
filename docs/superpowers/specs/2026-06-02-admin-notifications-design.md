# Diseño — Centro de notificaciones del administrador

**Fecha:** 2026-06-02
**Estado:** Aprobado (secciones 1-5) — listo para implementación

## Objetivo

Un centro de notificaciones (campanita) **solo para el superadmin**, dentro del
**panel de administrador** (`/admin`), que unifica dos tipos de alerta:

1. **Inactividad** — una sala de consulta lleva 24h sin actividad (ya sea
   porque el abogado asignado no responde, o porque nadie aceptó la consulta).
   El admin puede **reasignar** al cliente a otro abogado disponible.
2. **Verificación** — un abogado pulsó "Verificar" para que el admin **revise
   la conversación**. Además se envía **correo** al admin.

## Decisiones tomadas (resumen del brainstorming)

- Disparador de inactividad: **ambos** casos (abogado no responde / nadie
  aceptó), con umbral de **24h** (reutiliza la lógica existente de "Alertas").
- Reasignación: **híbrida** — el sistema sugiere un abogado del área; el admin
  puede cambiarlo antes de confirmar.
- Verificación: aparece en **campanita + chat interno** (`mensajes_internos`) +
  **correo**.
- Ubicación de la campanita: **solo en `/admin`** (no en el Navbar/home).
- Arquitectura: **máxima seguridad + rendimiento** → tabla cerrada por RLS,
  escrituras/lógica server-side con service-role, lectura barata por RLS.

## Sección 1 — Modelo de datos y acceso

### Tabla `notificaciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK (`gen_random_uuid()`) | |
| `tipo` | text | `'inactividad'` \| `'verificacion'` |
| `room_id` | uuid | sala involucrada |
| `lawyer_id` | uuid NULL | inactividad: abogado inactivo (null si nadie aceptó); verificación: abogado solicitante |
| `client_nombre` | text | snapshot para mostrar |
| `area` | text | snapshot del área |
| `mensaje` | text NULL | nota opcional |
| `leido` | bool DEFAULT false | maneja el badge |
| `atendida` | bool DEFAULT false | inactividad: true al reasignar; verificación: true al revisar |
| `created_at` | timestamptz DEFAULT now() | |

Índices:
- `CREATE INDEX ... ON notificaciones (leido) WHERE leido = false;` (badge)
- `CREATE INDEX ... ON notificaciones (tipo, room_id);` (dedup)
- `CREATE INDEX ... ON notificaciones (created_at DESC);`

### RLS (estricto)
- **SELECT / UPDATE(`leido`, `atendida`)**: solo superadmin
  (`EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'superadmin')`).
- **INSERT / DELETE**: ninguna policy para anon/authenticated → solo service-role
  (bypassa RLS) escribe. Abogados y clientes **no tocan la tabla**.

### Acceso
- **Lectura (campanita):** navegador del admin → REST directo
  `notificaciones?leido=eq.false&order=created_at.desc` (RLS superadmin, índice
  parcial). Marcar leído = UPDATE por REST. Ruta de alta frecuencia = barata.
- **Escrituras y lógica:** 3 endpoints serverless service-role (abajo) + cron.

## Sección 2 — Campanita (UI)

Componente nuevo `src/components/admin/NotificationBell.jsx` (autocontenido:
polling + badge + dropdown + modal de reasignación + marcar-leído). **Montado
solo en el header de `AdminPage`.**

- Poll a `notificaciones?leido=eq.false` cada **30s**, **pausado con
  `document.hidden`** (patrón de rendimiento del proyecto). Badge = nº no leídas.
- Estilo navy + gold, coherente con el panel.
- Dropdown con tarjetas (más recientes primero):
  - **Inactividad:** cliente, área, "sin respuesta 24h" + botón **"Reasignar"**.
  - **Verificación:** abogado solicitante, cliente, área + botón **"Ver
    conversación"**.
- Abrir el dropdown / actuar una tarjeta → `leido=true`. Acción "marcar todas".
- Vacío: "Sin notificaciones".

UI guiada por las skills `/impeccable` y `/ui-ux-pro-max` (calidad visual).

## Sección 3 — Inactividad → reasignación

1. **Cron `/api/cron/gen-inactividad`** (horario en Pro / diario en Hobby —
   diario alcanza para 24h): escanea salas `waiting`/`active` sin mensajes en
   24h (lógica de `fetchAlertas`), inserta las notif. `inactividad` que falten
   (dedup por `room_id` con `atendida=false`). Protegido por `CRON_SECRET`.
2. Admin → campanita → "Reasignar" → modal.
3. **Modal (híbrido):** muestra cliente/área/abogado inactivo; **sugiere** un
   abogado disponible (mismo área/tipo, aprobado, ≠ actual) desde
   `/api/professionals` (CDN), preseleccionado; admin puede cambiarlo. Confirmar
   → `POST /api/reassign`.
4. **`/api/reassign`** (service-role; valida superadmin + abogado elegido válido
   [aprobado + del área]):
   - Quita al abogado inactivo de `chat_room_lawyers`; asigna el nuevo
     (`status='invited'`); sala → `waiting` (se reusa el flujo de aceptación).
   - Postea mensaje de sistema en la sala: *"El administrador te está
     reasignando a otro profesional disponible."* (cliente lo ve por Realtime).
   - Marca la notificación `atendida=true`; dispara `notify` (`new_consultation`)
     al nuevo abogado.

## Sección 4 — Verificación

1. Abogado pulsa **"Verificar"** → `POST /api/verify-request` (reemplaza el
   insert directo a `mensajes_internos`).
2. **`/api/verify-request`** (valida que el JWT sea el abogado **asignado a esa
   sala**):
   - Inserta notif. `verificacion`.
   - Postea en `mensajes_internos` (se mantiene).
   - Envía correo al admin vía `notify` (tipo nuevo `verification_request`).
3. Admin → campanita → **"Ver conversación"** → navega a
   `/admin?tab=chats&room=<id>`; `AdminPage` lee el query param, abre la pestaña
   "Historial chats" y `SuperAdminChatViewer` abre esa sala (deep-link via prop
   `initialRoomId`).

## Sección 5 — Correo

- Tipo nuevo `verification_request` en `api/notify.js` (mismo card AAP
  navy+gold).
- Destinatario: env **`ADMIN_NOTIFY_EMAIL`**, default
  `abogadosyasociados.parada@gmail.com` (no hardcodeado).

## Validación de JWT en endpoints (seguridad)

- Verificación local de firma del JWT con `SUPABASE_JWT_SECRET` (sin hop de red).
- Chequeo de rol: 1 query con service-role a `profiles` (baja frecuencia, solo
  en `verify-request` y `reassign`).
- `/api/cron/*` protegido por `CRON_SECRET` (header `Authorization: Bearer`).

## Variables de entorno nuevas

| Var | Uso |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | ya existe — escrituras service-role |
| `SUPABASE_JWT_SECRET` | validar firma de JWT en endpoints |
| `CRON_SECRET` | proteger el cron de inactividad |
| `ADMIN_NOTIFY_EMAIL` | destinatario del correo (default gmail del despacho) |

## Fuera de alcance (YAGNI)

- Notificaciones para abogados/contadores (solo admin).
- Push del navegador / web-push.
- Realtime para la campanita (polling 30s alcanza con un solo admin).
- Histórico/auditoría de reasignaciones más allá del mensaje de sistema.
