# Plan 3 — Solicitudes abiertas (modelo "claim" tipo Uber/DiDi)

> Estado: **diseño aprobado en decisiones clave, pendiente de revisión del plan antes de ejecutar.**
> Convención de commits: terminar con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Objetivo

Cuando el triage del cliente **no encuentra un profesional del área** del caso, en lugar de dejarlo sin salida:
1. La IA recomienda los profesionales **más cercanos** (de áreas relacionadas) si los hay.
2. El cliente puede **publicar una "solicitud abierta"**: la consulta queda disponible para que **cualquier profesional disponible la "tome"** (primero en tomarla se la queda), estilo Uber/DiDi.

## Decisiones (confirmadas con el usuario, 2026-06-11)

- **Activación:** solo como **respaldo** (cuando no hay profesional del área). El flujo normal (cliente elige profesional) no cambia.
- **Destinatarios:** profesionales aprobados cuya **especialidad coincide** con el área; **si no hay ninguno, se amplía a todos** los aprobados del mismo tipo (abogado/contador).

## Modelo de datos

Reusar `chat_rooms` con un estado nuevo:
- `chat_rooms.status` admite `'open'` (publicada, sin profesional asignado, esperando que alguien la tome). Estados existentes: `waiting | active | closed`.
- Una sala `'open'` tiene los datos del cliente + `area_derecho` + `tipo_profesional` + el resumen de la IA (primer mensaje), pero **sin fila en `chat_room_lawyers`** todavía.
- **Claim atómico (primero gana):** el profesional toma la sala con un PATCH condicional:
  `PATCH /chat_rooms?id=eq.<id>&status=eq.open  { status: 'active' }` con `Prefer: return=representation`.
  Si devuelve 1 fila → la tomó él; si devuelve 0 → otro la tomó antes (409). Esto evita doble asignación sin locks.

Tabla de notificación (opcional, para auditoría/bell): reusar `notificaciones` con `tipo='solicitud_abierta'`, escrita con service-role al publicar. No imprescindible para v1 (los pros la ven por realtime).

## Endpoints (api/)

1. **`api/publicar-solicitud.js`** (o extender el flujo de creación): crea la sala con `status='open'` a partir de los datos del cliente + resumen IA + área. Anon key (como `ChatSection.startChat` hoy). Inserta el primer `chat_messages` (intro + resumen IA). No inserta `chat_room_lawyers`.
2. **`api/tomar-solicitud.js`**: el profesional toma una solicitud.
   - Valida con `_lib/adminAuth.getCallerProfile` (rol abogado/contador, aprobado).
   - Verifica que el pro es elegible (su `area_derecho` incluye el área de la sala, **o** no hay ningún pro del área —fallback abierto—).
   - PATCH condicional `status=eq.open → 'active'` (atómico).
   - Si éxito: inserta `chat_room_lawyers` (lawyer_id=pro, status='active'), postea `chat_messages` de sistema ("Un profesional tomó tu consulta"), y notifica al cliente (`api/notify.js` tipo `lawyer_joined`). Marca cualquier `notificaciones` relacionada como atendida.
   - Si 0 filas: responde `409 { error: 'tomada' }`.

## Frontend

### Triage del cliente (TriagePanel / ChatSection)
- Cuando `fetchLawyers(area)` devuelve **vacío** (no hay profesional del área) o la IA marca `listo_para_recomendar` sin `recomendados` válidos:
  - Mostrar tarjeta: *"No hay un profesional de esta área disponible ahora. Publica tu consulta y te atenderá el primer profesional disponible."* + botón **"Publicar solicitud"**.
  - Al publicar → crea la sala `'open'` (reusa `startChat` con un flag, o el endpoint nuevo) y muestra estado "Esperando a que un profesional tome tu caso…" (realtime: cuando `status` pasa a `active`, entra al chat).
- Si la IA sí recomienda pros de áreas cercanas, se muestran como hoy (tarjetas) y además se ofrece "Publicar solicitud" como alternativa.

### Dashboards del profesional (LawyerChatDashboard / ContadorChatDashboard)
- Nuevo panel/sección **"Solicitudes disponibles"** (arriba de la lista de salas o como pestaña):
  - Lista salas `status='open'` cuyo `tipo_profesional` coincide y (`area_derecho` incluye su especialidad **o** no hay pros del área).
  - Cada item: área + ciudad + resumen breve + antigüedad + botón **"Tomar"**.
  - **Realtime** (Phoenix WS `postgres_changes` sobre `chat_rooms`): aparecen nuevas solicitudes y **desaparecen** cuando otro las toma (status deja de ser 'open').
  - "Tomar" → `api/tomar-solicitud.js`. Éxito → la sala entra a su lista normal y abre el chat. 409 → toast "Esa consulta ya fue tomada por otro profesional".

## SQL a aplicar a mano
- Si `chat_rooms.status` es un enum, añadir `'open'` al enum; si es text, no requiere cambio.
- (Opcional) índice: `create index on chat_rooms (status, tipo_profesional) where status = 'open';`
- RLS: el cliente anónimo ya inserta salas (anon). Para que los pros LEAN salas `'open'` por realtime con su token, revisar políticas SELECT de `chat_rooms` (hoy leen sus salas asignadas vía `chat_room_lawyers`; las `'open'` no tienen asignación). Habrá que permitir a profesionales aprobados SELECT de salas `status='open'` de su tipo. Definir política en Supabase (documentar SQL).

## Prompt de la IA (api/_lib/aiPrompts.js)
- Ajustar `SYSTEM_CLIENTE`: si en la lista de profesionales no hay del área, debe (a) recomendar el más cercano si aplica y (b) sugerir publicar la solicitud abierta, en vez de inventar profesionales.

## Orden de implementación sugerido
1. SQL (`status='open'`, índice, política RLS) — aplicar a mano.
2. `api/tomar-solicitud.js` (claim atómico) + verificación de auth.
3. Publicación de solicitud (endpoint o flag en startChat) + ajuste de `ChatSection`/`TriagePanel` (estado "esperando").
4. Panel "Solicitudes disponibles" + realtime + botón Tomar en ambos dashboards.
5. Ajuste de `SYSTEM_CLIENTE`.
6. QA: publicar como cliente sin pros del área → ver en dashboard de pro → Tomar → cliente entra al chat; segundo pro recibe 409.

## Notas
- Notificación v1 = **realtime in-app** (panel que se actualiza solo). Email a los pros queda como mejora futura (reusaría `api/notify.js`).
- Mantener el flujo actual intacto cuando sí hay profesionales del área.
