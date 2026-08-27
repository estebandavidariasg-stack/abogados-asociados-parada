import nodemailer from 'nodemailer'
import crypto from 'node:crypto'
import { renderShell, emailButton, infoBox, codeBox, em, C } from './_lib/emailTemplate.js'

/* ────────────────────────────────────────────────────────────────────────
   Endpoint de "olvidé mi contraseña" con correo customizado estilo AAP.

   Por qué NO usamos `supabase.auth.resetPasswordForEmail` directamente:
   ese flujo dispara el correo desde el template de Supabase Dashboard, que
   no tiene la misma estética que los demás correos del proyecto. Aquí
   usamos `auth/v1/admin/generate_link` (requiere SERVICE_ROLE_KEY) para
   obtener el action_link con el token de recovery, y mandamos el correo
   con nodemailer + HTML inline-styled idéntico a /api/send-contact-card.

   Variables de entorno requeridas:
     · GMAIL_USER, GMAIL_PASS              (ya existían)
     · SUPABASE_URL, SUPABASE_ANON_KEY     (ya existían)
     · SUPABASE_SERVICE_ROLE_KEY           (NUEVA — añadir en Vercel)
──────────────────────────────────────────────────────────────────────── */

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
})

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const DEFAULT_REDIRECT = 'https://paradabridge.com/nueva-contrasena'

// Solo se acepta redirect_to hacia orígenes conocidos y a la ruta de reset.
// Evita que un correo (p.ej. pedido desde localhost) apunte a un sitio que el
// destinatario no puede abrir, y cierra un posible open-redirect. Si no calza,
// se usa el destino de producción por defecto.
const REDIRECT_ORIGINS = new Set([
  'https://paradabridge.com',
  'https://www.paradabridge.com',
  'http://localhost:5173',
])
function safeRedirect(redirectTo) {
  if (typeof redirectTo === 'string' && redirectTo) {
    try {
      const u = new URL(redirectTo)
      if (REDIRECT_ORIGINS.has(u.origin) && u.pathname === '/nueva-contrasena') {
        return redirectTo
      }
    } catch { /* URL inválida → default */ }
  }
  return DEFAULT_REDIRECT
}

/* ── Verificación de reCAPTCHA contra Google ──────────────────────────────
   Sin esto, un atacante hace flooding de correos de recuperación a víctimas
   arbitrarias (DoS de bandeja + costo de Gmail). RECAPTCHA_SECRET_KEY debe
   estar configurado en Vercel. */
async function verifyRecaptcha(token) {
  if (!token) return { ok: false, reason: 'missing-token' }
  const secret = process.env.RECAPTCHA_SECRET_KEY
  if (!secret) {
    console.error('[recaptcha] RECAPTCHA_SECRET_KEY no configurado')
    return { ok: false, reason: 'config' }
  }
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    })
    const data = await r.json()
    return { ok: !!data.success, reason: data['error-codes']?.join(',') || null }
  } catch (err) {
    console.error('[recaptcha] verify failed:', err)
    return { ok: false, reason: 'network' }
  }
}

/* ── Rate-limit por email ─────────────────────────────────────────────────
   El captcha bloquea bots tontos, pero un atacante humano (o uno con farm
   de captchas) podría disparar repetidos correos de recuperación contra
   una víctima. Limitamos a 3 intentos cada 15 min por email.

   Para no romper el modelo anti-enumeración: si se excede el límite,
   silenciosamente NO enviamos el correo, pero seguimos respondiendo 200.
   Si devolviéramos 429, un atacante sabría que ese email está siendo
   atacado (señal de que existe / es interesante). */
const RL_WINDOW_MS = 15 * 60 * 1000
const RL_MAX       = 3
// Límite por IP (además del de email): evita que un atacante rote entre muchos
// correos desde una sola IP sin tocar el límite por correo. Más holgado porque
// una IP compartida (oficina/NAT) puede tener varios usuarios legítimos.
const RL_IP_MAX    = 20

const adminHeaders = () => ({
  apikey:        SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type':'application/json',
})

// Hash de la IP del cliente (no guardamos IP en claro). Reutiliza AI_IP_SALT
// si está configurado, como el resto del proyecto.
function clientIpHash(req) {
  const xff = req.headers['x-forwarded-for']
  const ip  = (Array.isArray(xff) ? xff[0] : String(xff || '')).split(',')[0].trim()
              || req.headers['x-real-ip'] || ''
  if (!ip) return null
  return crypto.createHash('sha256').update((process.env.AI_IP_SALT || '') + ip).digest('hex')
}

async function isRateLimited(email) {
  const since = new Date(Date.now() - RL_WINDOW_MS).toISOString()
  const url   =
    `${SUPABASE_URL}/rest/v1/forgot_password_attempts` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&created_at=gt.${encodeURIComponent(since)}` +
    `&select=id&limit=${RL_MAX + 1}`
  try {
    const res = await fetch(url, { headers: adminHeaders() })
    if (!res.ok) {
      // Fail-open: si no podemos contar (BD caída, etc.), no bloqueamos al
      // usuario legítimo. Es preferible ese caso que dejarlos sin correo.
      console.error('[forgot-password] rate-limit count failed:', res.status)
      return false
    }
    const rows = await res.json()
    return Array.isArray(rows) && rows.length >= RL_MAX
  } catch (err) {
    console.error('[forgot-password] rate-limit count error:', err)
    return false
  }
}

// Igual que isRateLimited pero por IP. Fail-open: si no hay IP o no se puede
// contar, no bloqueamos.
async function isRateLimitedByIp(ipHash) {
  if (!ipHash) return false
  const since = new Date(Date.now() - RL_WINDOW_MS).toISOString()
  const url   =
    `${SUPABASE_URL}/rest/v1/forgot_password_attempts` +
    `?ip_hash=eq.${encodeURIComponent(ipHash)}` +
    `&created_at=gt.${encodeURIComponent(since)}` +
    `&select=id&limit=${RL_IP_MAX + 1}`
  try {
    const res = await fetch(url, { headers: adminHeaders() })
    if (!res.ok) {
      console.error('[forgot-password] rate-limit-by-ip count failed:', res.status)
      return false
    }
    const rows = await res.json()
    return Array.isArray(rows) && rows.length >= RL_IP_MAX
  } catch (err) {
    console.error('[forgot-password] rate-limit-by-ip count error:', err)
    return false
  }
}

async function recordAttempt(email, ipHash) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/forgot_password_attempts`, {
      method: 'POST',
      headers: { ...adminHeaders(), Prefer: 'return=minimal' },
      body:    JSON.stringify({ email, ip_hash: ipHash }),
    })
  } catch (err) {
    // No-fatal — si esto falla, simplemente perdemos un punto del conteo.
    console.error('[forgot-password] recordAttempt failed:', err)
  }
}

// Correo de recuperación por CÓDIGO (no por enlace). Un magic-link es de un
// solo uso y los escáneres de correo (Gmail) lo "pre-abren" y lo consumen antes
// de que el usuario haga clic → llegaba siempre "expirado". Un código tecleado
// no se puede consumir así. El botón lleva a la PÁGINA (sin token, inofensivo).
function renderResetEmailHtml({ otp, pageLink }) {
  const inner =
    `<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">
       Recibimos una solicitud para restablecer tu contraseña. Ingresa este código en la página de nueva contraseña:
     </p>
     ${codeBox(otp)}
     <p style="margin:0 0 22px;font-size:13px;color:${C.body};text-align:center;">
       El código expira en ${em('1 hora')}.
     </p>
     <div style="text-align:center;margin:0 0 22px;">${emailButton('Abrir página de nueva contraseña', pageLink)}</div>
     ${infoBox(
       `<p style="margin:0;color:${C.muted};font-size:12px;line-height:1.6;">Si no solicitaste este cambio, ignora este correo; tu contraseña actual seguirá funcionando.</p>`
     )}`
  return renderShell({
    subjectLine: 'Restablecer contraseña',
    preheader: `Tu código para restablecer la contraseña: ${otp}`,
    innerHtml: inner,
  })
}

/* ── Plan B: recuperación 100% bajo nuestro control ────────────────────────
   No dependemos del OTP de Supabase (se "vencía"/pisaba). Generamos NUESTRO
   código de 6 dígitos, lo guardamos en verification_codes (tipo 'recovery') y,
   al verificarlo, cambiamos la contraseña con el service-role (admin API).
   ⚠️ Requiere permitir tipo_registro='recovery' en el CHECK de la tabla — ver
   docs/sql/recovery-code-2026-08-17.sql. */
const CODE_TTL_MS = 60 * 60 * 1000 // 1 hora

async function getUserIdByEmail(email) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/admin/users`)
  url.searchParams.set('filter', email)
  url.searchParams.set('per_page', '10')
  const res = await fetch(url.toString(), { headers: adminHeaders() })
  if (!res.ok) return null
  const data = await res.json().catch(() => ({}))
  const list = Array.isArray(data) ? data : (data?.users || [])
  const target = email.toLowerCase()
  const u = list.find(x => (x?.email || '').toLowerCase() === target)
  return u?.id || null
}

async function invalidateRecoveryCodes(email) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/verification_codes?email=eq.${encodeURIComponent(email)}&tipo_registro=eq.recovery&used=eq.false`,
    { method: 'PATCH', headers: { ...adminHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ used: true }) }
  ).catch(() => {})
}

async function insertRecoveryCode(email, code) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes`, {
    method: 'POST',
    headers: { ...adminHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      email, code, tipo_registro: 'recovery',
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`insert recovery code failed (${res.status}): ${detail}`)
  }
}

// Backstop en memoria contra fuerza-bruta del código en el paso de reset.
const memReset = new Map()
function resetTooMany(email) {
  if (!email) return false
  const now = Date.now()
  const e = memReset.get(email)
  if (!e || e.resetAt <= now) { memReset.set(email, { n: 1, resetAt: now + 15 * 60 * 1000 }); return false }
  e.n += 1
  return e.n > 8
}

// Verifica el código y cambia la contraseña (service-role). No hay token de
// Supabase de por medio, así que no puede "expirar" por prefetch ni pisarse.
async function handleReset(req, res) {
  const b = req.body || {}
  const email = String(b.email || '').trim().toLowerCase()
  const code  = String(b.code || '').trim()
  const newPassword = typeof b.newPassword === 'string' ? b.newPassword : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Correo inválido.' })
  if (!/^\d{4,10}$/.test(code))                  return res.status(400).json({ error: 'Código inválido.' })
  if (newPassword.length < 8)                    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  if (resetTooMany(email)) return res.status(429).json({ error: 'Demasiados intentos. Solicita un código nuevo.' })

  // Validación ATÓMICA (un único UPDATE con filtros → sin ventana TOCTOU).
  const now = new Date().toISOString()
  const url =
    `${SUPABASE_URL}/rest/v1/verification_codes` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&code=eq.${encodeURIComponent(code)}` +
    `&tipo_registro=eq.recovery&used=eq.false` +
    `&expires_at=gt.${encodeURIComponent(now)}&select=id`
  const patch = await fetch(url, {
    method: 'PATCH',
    headers: { ...adminHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ used: true }),
  })
  const rows = await patch.json().catch(() => [])
  if (!patch.ok || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Código inválido o expirado.' })
  }

  const userId = await getUserIdByEmail(email)
  if (!userId) return res.status(400).json({ error: 'No se pudo procesar la solicitud.' })
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { ...adminHeaders() },
    body: JSON.stringify({ password: newPassword }),
  })
  if (!upd.ok) {
    const detail = await upd.text().catch(() => '')
    console.error('[forgot-password] update password failed:', upd.status, detail.slice(0, 200))
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña.' })
  }
  return res.status(200).json({ success: true })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Dos modos: (1) verificar código + cambiar contraseña, (2) enviar código.
  if (req.body && typeof req.body.code === 'string' && typeof req.body.newPassword === 'string') {
    return handleReset(req, res)
  }

  const { email, redirectTo, recaptchaToken } = req.body || {}
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Falta el correo.' })
  }

  // Validación estructural rápida (no exhaustiva — Supabase rechaza el resto).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Correo inválido.' })
  }

  // Verificación de captcha — antes de tocar admin API o SMTP. Reduce el
  // costo de un ataque de spam de correos a casi cero para nosotros.
  const captchaCheck = await verifyRecaptcha(recaptchaToken)
  if (!captchaCheck.ok) {
    return res.status(403).json({
      error: 'No se pudo verificar el captcha. Recarga la página e intenta de nuevo.'
    })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Faltan variables de entorno — es un problema de configuración del
    // servidor, no del usuario. No revelar detalles.
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  // Normalizar a lowercase — Supabase Auth almacena emails en lowercase
  // y el rate-limit debe ser case-insensitive (que un atacante no rote
  // entre Foo@ y foo@ para multiplicar el límite).
  const normalizedEmail = email.toLowerCase().trim()

  // Por seguridad, NO revelamos si el email existe o no en la base.
  // SIEMPRE respondemos 200 al cliente, independientemente del resultado
  // (esto previene enumeración de usuarios).
  const target = safeRedirect(redirectTo)

  // ── Rate-limit ────────────────────────────────────────────────────────
  // Registramos el intento ANTES de chequear el límite — así el conteo
  // incluye intentos rate-limited (no solo los que pasaron). Esto evita
  // que un atacante mande 1000 requests y solo cuenten los primeros 3.
  const ipHash = clientIpHash(req)
  await recordAttempt(normalizedEmail, ipHash)
  if (await isRateLimited(normalizedEmail) || await isRateLimitedByIp(ipHash)) {
    // Silencio — no enviamos correo, pero respondemos 200 para no enumerar
    // (no revelamos que este email está bajo ataque).
    console.warn('[forgot-password] rate-limit hit for', normalizedEmail)
    return res.status(200).json({ success: true })
  }

  try {
    // Solo enviamos código si el usuario EXISTE (pero respondemos 200 igual,
    // anti-enumeración). Generamos NUESTRO código, invalidamos los previos y lo
    // guardamos. La contraseña se cambia luego en handleReset.
    const userId = await getUserIdByEmail(normalizedEmail)
    if (!userId) {
      return res.status(200).json({ success: true }) // no revelar que no existe
    }
    const code = String(crypto.randomInt(100000, 1000000)) // 6 dígitos CSPRNG
    await invalidateRecoveryCodes(normalizedEmail)
    await insertRecoveryCode(normalizedEmail, code)

    let pageLink = DEFAULT_REDIRECT
    try {
      pageLink = `${new URL(target).origin}/nueva-contrasena?email=${encodeURIComponent(normalizedEmail)}`
    } catch { /* target inválido → default */ }

    await transporter.sendMail({
      from:    `"Parada Bridge" <${process.env.GMAIL_USER}>`,
      to:      normalizedEmail,
      subject: 'Restablece tu contraseña',
      html:    renderResetEmailHtml({ otp: code, pageLink }),
    })

    return res.status(200).json({ success: true })
  } catch (_err) {
    // Tampoco loggeamos el email — pero el cliente recibe error genérico
    // sólo cuando Gmail mismo falla, no por usuario inexistente.
    return res.status(500).json({ error: 'No se pudo enviar el correo.' })
  }
}
