/* ────────────────────────────────────────────────────────────────────────
   Endpoint: validación del código de verificación.

   Verifica (email, code) contra `verification_codes`:
   - Sólo matchea si la fila tiene used=false Y expires_at > now()
   - Si encuentra: marca used=true atómicamente y devuelve tipoRegistro
   - Si no encuentra: 400 con mensaje genérico

   ¿Por qué un PATCH con filtros en vez de SELECT + UPDATE?
   PostgREST traduce el PATCH con WHERE-clause en una única instrucción
   UPDATE en el servidor — atómica. No hay ventana TOCTOU entre lectura
   y escritura. Si dos requests llegan simultáneamente con el mismo
   código, solo uno encontrará la fila con used=false y la actualizará;
   el segundo recibirá array vacío y verá "Código inválido o expirado".

   Mensaje genérico unificado: no diferenciamos entre "no existe",
   "expirado" o "ya usado" para no dar señales que ayuden a un atacante
   a inferir el estado del código.

   Variables de entorno requeridas:
     · SUPABASE_URL (o VITE_SUPABASE_URL)
     · SUPABASE_SERVICE_ROLE_KEY
──────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const INVALID_MSG = 'Código inválido o expirado'

export default async function handler(req, res) {
  // CORS — restringido a dominios oficiales (ver send-verification-code.js
  // para el rationale: evita que terceros disparen verificaciones desde
  // los navegadores de sus visitantes).
  const ALLOWED = new Set([
    'https://abogadosyasociadosparada.com',
    'https://www.abogadosyasociadosparada.com',
    'https://paradayasociados.co',
    'http://localhost:5173',
  ])
  const origin = req.headers.origin
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Vary',                         'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  // ── Validación de input ──────────────────────────────────────────────
  const body     = req.body || {}
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : ''
  const rawCode  = typeof body.code  === 'string' ? body.code.trim()  : ''

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)
  const codeOk  = /^\d{6}$/.test(rawCode)

  if (!emailOk || !codeOk) {
    // Devolvemos el mismo mensaje de error que para "no encontrado",
    // así un atacante no puede distinguir input mal formado de código
    // inexistente por el mensaje (aunque sí por el path de timing).
    return res.status(400).json({ error: INVALID_MSG })
  }

  const email = rawEmail.toLowerCase()
  const now   = new Date().toISOString()

  // ── PATCH atómico: filtros (email, code, used=false, expires_at>now)
  //    en la URL. PostgREST lo ejecuta como un único UPDATE...WHERE en
  //    el servidor, así que no hay race condition entre SELECT y UPDATE.
  //    `select=tipo_registro` limita la columna devuelta — el id, code
  //    y demás nunca cruzan al cliente.
  const url =
    `${SUPABASE_URL}/rest/v1/verification_codes` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&code=eq.${encodeURIComponent(rawCode)}` +
    `&used=eq.false` +
    `&expires_at=gt.${encodeURIComponent(now)}` +
    `&select=tipo_registro`

  try {
    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:        'return=representation',
      },
      body: JSON.stringify({ used: true }),
    })

    if (!patchRes.ok) {
      const detail = await patchRes.text().catch(() => '')
      console.error('[verify-code] PATCH failed:', patchRes.status, detail)
      return res.status(500).json({ error: 'No se pudo verificar el código.' })
    }

    const rows = await patchRes.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: INVALID_MSG })
    }

    // Sólo exponemos tipo_registro — id, code y demás quedan en el server.
    return res.status(200).json({
      success:      true,
      tipoRegistro: rows[0].tipo_registro,
    })

  } catch (err) {
    console.error('[verify-code] error:', err)
    return res.status(500).json({ error: 'No se pudo verificar el código.' })
  }
}
