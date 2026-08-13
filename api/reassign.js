/* ────────────────────────────────────────────────────────────────────────
   POST /api/reassign
   El admin confirma reasignar una sala inactiva a otro abogado disponible.
   Seguridad: solo superadmin. Valida que el abogado elegido esté aprobado.

   Acciones (service-role):
     1. Quita al abogado inactivo de la sala (si vino oldLawyerId)
     2. Asigna el nuevo abogado (status 'invited') y pone la sala en 'waiting'
        → el nuevo la retoma con el flujo de aceptación normal de su dashboard
     3. Postea un mensaje de sistema en la sala (el cliente lo ve por Realtime)
     4. Marca la notificación como atendida
   Body: { roomId, oldLawyerId?, newLawyerId, notifId? }
──────────────────────────────────────────────────────────────────────── */

import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js'
import { sendReassignEmail } from './_lib/mailer.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { roomId, oldLawyerId, newLawyerId, notifId } = req.body || {}
  if (!roomId || !newLawyerId) {
    return res.status(400).json({ error: 'Faltan datos (roomId, newLawyerId).' })
  }

  // 1) Solo superadmin.
  const caller = await getCallerProfile(req)
  if (caller?.rol !== 'superadmin') {
    // Autenticado pero sin permiso → 403 (no 401).
    return res.status(403).json({ error: 'No autorizado.' })
  }

  // 2) Validar el nuevo abogado: existe, está aprobado y trae su rol (para el
  //    guard de profesión más abajo).
  let nuevo = null
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${newLawyerId}&select=id,nombre,apellido,aprobado,email,rol&limit=1`,
      { headers: serviceHeaders() }
    )
    const [p] = await r.json()
    nuevo = p || null
  } catch { /* nuevo queda null */ }
  if (!nuevo || !nuevo.aprobado) {
    return res.status(400).json({ error: 'El abogado elegido no es válido.' })
  }

  // 2b) Guard de profesión: el rol del nuevo profesional debe coincidir con el
  //     tipo_profesional de la sala (una sala de abogado solo puede reasignarse
  //     a un abogado; una de contador, a un contador). El filtrado de la lista
  //     de candidatos vive en el frontend; acá se refuerza en el servidor.
  let roomTipo = null
  try {
    const rr = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${roomId}&select=tipo_profesional&limit=1`,
      { headers: serviceHeaders() }
    )
    const [rw] = await rr.json()
    roomTipo = rw?.tipo_profesional || null
  } catch { /* roomTipo queda null */ }
  // Solo bloqueamos cuando ambos valores existen y difieren. Si la sala no
  // declara tipo_profesional (dato legacy nulo), no inventamos un rechazo.
  if (roomTipo && nuevo.rol && roomTipo !== nuevo.rol) {
    const etiqueta = roomTipo === 'contador' ? 'contador' : 'abogado'
    return res.status(400).json({
      error: `Esta consulta es de ${etiqueta}. Debes reasignarla a un ${etiqueta}.`,
    })
  }

  try {
    // 3) Quitar al abogado inactivo.
    if (oldLawyerId) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=eq.${roomId}&lawyer_id=eq.${oldLawyerId}`,
        { method: 'DELETE', headers: serviceHeaders({ Prefer: 'return=minimal' }) }
      )
    }
    // 4) Asignar el nuevo (limpia un posible duplicado previo y reinserta).
    await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=eq.${roomId}&lawyer_id=eq.${newLawyerId}`,
      { method: 'DELETE', headers: serviceHeaders({ Prefer: 'return=minimal' }) }
    )
    await fetch(`${SUPABASE_URL}/rest/v1/chat_room_lawyers`, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ room_id: roomId, lawyer_id: newLawyerId, status: 'invited' }),
    })
    // 5) Sala → waiting (se reusa el flujo de aceptación). Además se registra
    //    la resolución de la barrera: `reasignado_at=now()` y se limpia
    //    `reasignacion_forzada` (la escalada de 4h queda resuelta).
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${roomId}`, {
      method: 'PATCH',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status: 'waiting',
        reasignado_at: new Date().toISOString(),
        reasignacion_forzada: false,
      }),
    })
    // 6) Mensaje de sistema en la sala (no hay sender_type 'system' en el
    //    esquema → usamos 'lawyer' con prefijo claro; el cliente lo ve al
    //    instante por Realtime).
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        room_id: roomId, sender_type: 'lawyer', lawyer_id: null,
        content: 'ℹ️ El administrador te está reasignando a otro profesional disponible. En breve te atenderá.',
        message_type: 'text',
      }),
    })
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo completar la reasignación.' })
  }

  // 7) Avisar por correo al abogado nuevo (best-effort: no bloquea la reasignación).
  if (nuevo.email) {
    try {
      const base = process.env.VITE_APP_URL || 'https://paradabridge.com'
      await sendReassignEmail({
        email: nuevo.email,
        nombreAbogado: `${nuevo.nombre || ''} ${nuevo.apellido || ''}`.trim() || 'profesional',
        ctaUrl: `${base}/?loginModal=true`,
      })
    } catch (e) {
      console.error('[reassign] correo al abogado nuevo falló:', e?.message || e)
    }
  }

  // 8) Marcar la notificación puntual como atendida (best-effort).
  if (notifId) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${notifId}`, {
        method: 'PATCH',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ atendida: true, leido: true }),
      })
    } catch { /* no bloquea */ }
  }

  // 9) Resolver TODAS las notificaciones de la barrera para esta sala:
  //    inactividad + reasignacion_obligatoria (sin atender) → atendida (la
  //    reasignación resuelve la escalada). Best-effort.
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificaciones` +
      `?room_id=eq.${roomId}&atendida=eq.false&tipo=in.(inactividad,reasignacion_obligatoria)`,
      {
        method: 'PATCH',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ atendida: true, leido: true }),
      }
    )
  } catch { /* no bloquea */ }

  return res.status(200).json({
    ok: true,
    nuevoAbogado: `${nuevo.nombre || ''} ${nuevo.apellido || ''}`.trim(),
  })
}
