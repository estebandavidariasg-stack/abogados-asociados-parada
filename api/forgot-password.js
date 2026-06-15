import nodemailer from 'nodemailer'
import { renderShell, emailButton, infoBox, em, C } from './_lib/emailTemplate.js'

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

const DEFAULT_REDIRECT = 'https://abogadosparada.com/nueva-contrasena'

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

const adminHeaders = () => ({
  apikey:        SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type':'application/json',
})

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

async function recordAttempt(email) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/forgot_password_attempts`, {
      method: 'POST',
      headers: { ...adminHeaders(), Prefer: 'return=minimal' },
      body:    JSON.stringify({ email }),
    })
  } catch (err) {
    // No-fatal — si esto falla, simplemente perdemos un punto del conteo.
    console.error('[forgot-password] recordAttempt failed:', err)
  }
}

function renderResetEmailHtml({ actionLink }) {
  const inner =
    `<p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">
       Recibimos una solicitud para restablecer la contraseña de tu cuenta. Si fuiste tú, usa el botón para crear una nueva contraseña.
     </p>
     <div style="text-align:center;margin:0 0 26px;">${emailButton('Restablecer contraseña', actionLink)}</div>
     ${infoBox(
       `<p style="margin:0;color:${C.muted};font-size:12px;line-height:1.6;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
        <p style="margin:8px 0 0;word-break:break-all;"><a href="${actionLink}" target="_blank" style="color:${C.navy};font-size:12px;text-decoration:underline;">${actionLink}</a></p>`
     )}
     <p style="margin:22px 0 0;font-size:13px;line-height:1.65;color:${C.body};">
       El enlace expira en ${em('1 hora')}. Si no solicitaste este cambio, puedes ignorar este correo; tu contraseña actual seguirá funcionando.
     </p>`
  return renderShell({
    subjectLine: 'Restablecer contraseña',
    preheader: 'Crea una nueva contraseña para tu cuenta.',
    innerHtml: inner,
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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
  const target = (typeof redirectTo === 'string' && redirectTo) ? redirectTo : DEFAULT_REDIRECT

  // ── Rate-limit ────────────────────────────────────────────────────────
  // Registramos el intento ANTES de chequear el límite — así el conteo
  // incluye intentos rate-limited (no solo los que pasaron). Esto evita
  // que un atacante mande 1000 requests y solo cuenten los primeros 3.
  await recordAttempt(normalizedEmail)
  if (await isRateLimited(normalizedEmail)) {
    // Silencio — no enviamos correo, pero respondemos 200 para no enumerar
    // (no revelamos que este email está bajo ataque).
    console.warn('[forgot-password] rate-limit hit for', normalizedEmail)
    return res.status(200).json({ success: true })
  }

  try {
    // Generar el link de recovery con la SERVICE_ROLE key
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'recovery',
        email: normalizedEmail,
        options: { redirect_to: target },
      }),
    })

    if (!linkRes.ok) {
      // Usuario no encontrado u otro error de Supabase. Respondemos OK
      // genérico para no enumerar.
      return res.status(200).json({ success: true })
    }

    const linkData = await linkRes.json()
    const actionLink = linkData?.properties?.action_link || linkData?.action_link
    if (!actionLink) {
      return res.status(200).json({ success: true })
    }

    await transporter.sendMail({
      from:    `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
      to:      normalizedEmail,
      subject: 'Restablece tu contraseña',
      html:    renderResetEmailHtml({ actionLink }),
    })

    return res.status(200).json({ success: true })
  } catch (_err) {
    // Tampoco loggeamos el email — pero el cliente recibe error genérico
    // sólo cuando Gmail mismo falla, no por usuario inexistente.
    return res.status(500).json({ error: 'No se pudo enviar el correo.' })
  }
}
