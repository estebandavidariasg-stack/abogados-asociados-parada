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

    // 1) Salas abiertas (no cerradas).
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms?status=in.(waiting,active)&select=id,client_nombre,area_derecho,created_at`,
      { headers: serviceHeaders() }
    )
    const rooms = await rRes.json()
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }
    const roomIds = rooms.map(r => r.id).join(',')

    // 2) Salas con actividad reciente (mensaje en las últimas 24h).
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?room_id=in.(${roomIds})&created_at=gte.${hace24h}&select=room_id`,
      { headers: serviceHeaders() }
    )
    const msgs = await mRes.json()
    const conActividad = new Set((Array.isArray(msgs) ? msgs : []).map(m => m.room_id))

    // Inactivas = sin actividad en 24h Y creadas hace más de 24h.
    const inactivas = rooms.filter(
      r => !conActividad.has(r.id) && new Date(r.created_at).getTime() < Date.now() - DIA_MS
    )
    if (inactivas.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }
    const inactivasIds = inactivas.map(r => r.id).join(',')

    // 3) Notificaciones de inactividad YA existentes y sin atender (dedup).
    const eRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notificaciones?tipo=eq.inactividad&atendida=eq.false&room_id=in.(${inactivasIds})&select=room_id`,
      { headers: serviceHeaders() }
    )
    const existentes = await eRes.json()
    const yaNotificadas = new Set((Array.isArray(existentes) ? existentes : []).map(n => n.room_id))

    const nuevas = inactivas.filter(r => !yaNotificadas.has(r.id))
    if (nuevas.length === 0) {
      return res.status(200).json({ ok: true, creadas: 0 })
    }

    // 4) Abogado asignado a cada sala nueva (para mostrar / reasignar).
    const nuevasIds = nuevas.map(r => r.id).join(',')
    const lRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=in.(${nuevasIds})&select=room_id,lawyer_id,status`,
      { headers: serviceHeaders() }
    )
    const asignaciones = await lRes.json()
    const lawyerByRoom = {}
    for (const a of (Array.isArray(asignaciones) ? asignaciones : [])) {
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
