/* ────────────────────────────────────────────────────────────────────────
   Helpers compartidos por los endpoints del centro de notificaciones.
   Archivos en api/ que empiezan por «_» NO se publican como rutas en Vercel.

   Seguridad: validamos el access token del que llama contra Supabase Auth
   (`/auth/v1/user`) — robusto sin depender del algoritmo de firma del JWT — y
   resolvemos su rol con la service-role key. Las escrituras a tablas se hacen
   con service-role (bypassa RLS) desde los endpoints, nunca desde el cliente.
──────────────────────────────────────────────────────────────────────── */

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

// Valida el token del que llama → devuelve el user de Supabase Auth, o null.
export async function getCaller(req) {
  const token = bearer(req)
  if (!token || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// Perfil { id, rol, email } del que llama, o null.
export async function getCallerProfile(req) {
  const user = await getCaller(req)
  if (!user?.id) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,rol`,
      { headers: serviceHeaders() }
    )
    const rows = await res.json()
    const row = Array.isArray(rows) ? rows[0] : null
    return row ? { id: row.id, rol: row.rol, email: user.email } : null
  } catch { return null }
}

// ¿El profesional `lawyerId` está asignado a la sala `roomId`?
export async function lawyerAssignedToRoom(lawyerId, roomId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers` +
      `?room_id=eq.${roomId}&lawyer_id=eq.${lawyerId}&select=lawyer_id&limit=1`,
      { headers: serviceHeaders() }
    )
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0
  } catch { return false }
}

// Id del superadmin (destinatario del chat interno), o null.
export async function getAdminId() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?rol=eq.superadmin&select=id&limit=1`,
      { headers: serviceHeaders() }
    )
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0].id : null
  } catch { return null }
}
