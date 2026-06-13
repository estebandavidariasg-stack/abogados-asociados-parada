/* ────────────────────────────────────────────────────────────────────────
   POST /api/verify-request
   El abogado/contador pulsa "Verificar" → registra la solicitud de revisión.
   Seguridad: valida que el que llama sea un profesional ASIGNADO a esa sala.

   Hace 3 cosas (service-role):
     1. Inserta una notificación `verificacion` (la ve el admin en la campanita)
     2. Postea el mensaje en `mensajes_internos` (sigue visible en el chat interno)
     3. Envía correo al admin (ADMIN_NOTIFY_EMAIL)
   Body: { roomId, clientNombre?, area? }
──────────────────────────────────────────────────────────────────────── */

import {
  SUPABASE_URL, serviceHeaders, getCallerProfile,
  lawyerAssignedToRoom, getAdminId,
} from './_lib/adminAuth.js'
import { sendVerificationEmail } from './_lib/mailer.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { roomId, clientNombre, area } = req.body || {}
  if (!roomId) return res.status(400).json({ error: 'Falta roomId.' })

  // 1) Autorización: profesional asignado a la sala.
  const caller = await getCallerProfile(req)
  if (!caller || !['abogado', 'contador'].includes(caller.rol)) {
    return res.status(401).json({ error: 'No autorizado.' })
  }
  if (!(await lawyerAssignedToRoom(caller.id, roomId))) {
    return res.status(403).json({ error: 'No estás asignado a esta sala.' })
  }

  // Nombre del profesional para los mensajes/correo.
  let nombreAbogado = 'profesional'
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=nombre,apellido`,
      { headers: serviceHeaders() }
    )
    const [p] = await r.json()
    if (p) nombreAbogado = `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'profesional'
  } catch { /* nombre por defecto */ }

  const cliente = clientNombre || 'Anónimo'
  const areaTxt = area || 'Consulta'

  // 2) Notificación para la campanita.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        tipo: 'verificacion', room_id: roomId, lawyer_id: caller.id,
        client_nombre: cliente, area: areaTxt,
        mensaje: `${nombreAbogado} solicita revisión del proceso.`,
      }),
    })
    if (!r.ok) throw new Error('insert notificacion')
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo registrar la solicitud.' })
  }

  // 3) Mensaje en el chat interno (como hoy).
  const adminId = await getAdminId()
  if (adminId) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
        method: 'POST',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          from_id: caller.id, to_id: adminId,
          mensaje:
            `🔔 Solicitud de revisión de proceso\n` +
            `Consulta: ${areaTxt}\nCliente: ${cliente}\n` +
            `${nombreAbogado} solicita que revises este proceso.`,
        }),
      })
    } catch { /* no bloquea */ }
  }

  // 4) Correo al admin (best-effort: si falla, la solicitud ya quedó registrada).
  try {
    const base = process.env.VITE_APP_URL || 'https://abogadosyasociadosparada.com'
    await sendVerificationEmail({
      nombreAbogado, nombreCliente: cliente, area: areaTxt,
      ctaUrl: `${base}/admin?tab=chats&room=${roomId}`,
    })
  } catch (e) {
    console.error('[verify-request] correo falló:', e?.message || e)
  }

  return res.status(200).json({ ok: true })
}
