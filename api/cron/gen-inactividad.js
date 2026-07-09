/* ────────────────────────────────────────────────────────────────────────
   GET /api/cron/gen-inactividad   (Vercel Cron)
   Escanea salas waiting/active sin actividad en 24h y crea las notificaciones
   `inactividad` que falten (dedup por sala con atendida=false). Sin correo.

   Protección: Vercel envía «Authorization: Bearer <CRON_SECRET>» a los crons
   cuando CRON_SECRET está configurado en el proyecto. Validamos ese header.

   Programación en vercel.json:
     { "crons": [{ "path": "/api/cron/gen-inactividad", "schedule": "0 * * * *" }] }
   (cada hora en Pro; en Hobby Vercel lo corre 1×/día — suficiente para 24h.)
──────────────────────────────────────────────────────────────────────── */

import { SUPABASE_URL, serviceHeaders } from '../_lib/adminAuth.js'

const DIA_MS = 24 * 60 * 60 * 1000

/* Ejecuta una query con `campo=in.(...)` troceada en lotes de ~150 ids y
   concatena los resultados. Un in.() con cientos de UUIDs supera el límite de
   longitud de URL del gateway → la request entera falla (o PostgREST trunca
   en max-rows en silencio) justo cuando la plataforma más salas tiene. */
async function fetchInBatches(baseUrl, campo, ids, resto, tam = 150) {
  const out = []
  for (let i = 0; i < ids.length; i += tam) {
    const lote = ids.slice(i, i + tam)
    const r = await fetch(
      `${baseUrl}?${campo}=in.(${lote.join(',')})${resto}&limit=1000`,
      { headers: serviceHeaders() }
    )
    const rows = await r.json().catch(() => null)
    if (Array.isArray(rows)) out.push(...rows)
  }
  return out
}

export default async function handler(req, res) {
  // Auth del cron.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || req.headers.Authorization || ''
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'No autorizado.' })
    }
  }

  try {
    const hace24h = new Date(Date.now() - DIA_MS).toISOString()

    // 1) Salas abiertas (no cerradas). Limit explícito: sin él PostgREST
    //    trunca en max-rows en silencio; 1000 salas abiertas cubren de sobra
    //    un ciclo del cron (las más antiguas entran al siguiente).
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms?status=in.(waiting,active)&select=id,client_nombre,area_derecho,created_at&order=created_at.asc&limit=1000`,
      { headers: serviceHeaders() }
    )
    const rooms = await rRes.json()
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }

    // 2) Salas con actividad reciente (mensaje en las últimas 24h) — lotes de
    //    50 salas: con limit=1000 por lote hay margen holgado y una sala CON
    //    actividad no puede quedar fuera del corte (falsa notificación).
    const msgs = await fetchInBatches(
      `${SUPABASE_URL}/rest/v1/chat_messages`, 'room_id', rooms.map(r => r.id),
      `&created_at=gte.${hace24h}&select=room_id`, 50
    )
    const conActividad = new Set(msgs.map(m => m.room_id))

    // Inactivas = sin actividad en 24h Y creadas hace más de 24h.
    const inactivas = rooms.filter(
      r => !conActividad.has(r.id) && new Date(r.created_at).getTime() < Date.now() - DIA_MS
    )
    if (inactivas.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }
    // 3) Notificaciones de inactividad YA existentes y sin atender (dedup) — por lotes.
    const existentes = await fetchInBatches(
      `${SUPABASE_URL}/rest/v1/notificaciones`, 'room_id', inactivas.map(r => r.id),
      `&tipo=eq.inactividad&atendida=eq.false&select=room_id`
    )
    const yaNotificadas = new Set(existentes.map(n => n.room_id))

    const nuevas = inactivas.filter(r => !yaNotificadas.has(r.id))
    if (nuevas.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }

    // 4) Abogado asignado a cada sala nueva (para mostrar / reasignar) — por lotes.
    const asignaciones = await fetchInBatches(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers`, 'room_id', nuevas.map(r => r.id),
      `&select=room_id,lawyer_id,status`
    )
    const lawyerByRoom = {}
    for (const a of asignaciones) {
      // Preferimos el 'active'; si no, el primero.
      if (!lawyerByRoom[a.room_id] || a.status === 'active') lawyerByRoom[a.room_id] = a.lawyer_id
    }

    // 5) Insertar (batch).
    const filas = nuevas.map(r => ({
      tipo: 'inactividad', room_id: r.id,
      lawyer_id: lawyerByRoom[r.id] || null,
      client_nombre: r.client_nombre || 'Anónimo',
      area: r.area_derecho || 'Consulta',
      mensaje: lawyerByRoom[r.id]
        ? 'El abogado asignado no ha respondido en 24h.'
        : 'Nadie ha tomado esta consulta en 24h.',
    }))
    await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(filas),
    })

    return res.status(200).json({ ok: true, creadas: filas.length })
  } catch (e) {
    console.error('[cron gen-inactividad] error:', e?.message || e)
    return res.status(500).json({ error: 'Error generando notificaciones.' })
  }
}
