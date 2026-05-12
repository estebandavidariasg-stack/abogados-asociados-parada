import nodemailer from 'nodemailer'
import { randomInt } from 'node:crypto'

/* ────────────────────────────────────────────────────────────────────────
   Endpoint: envío de código de verificación de 6 dígitos para registro
   de abogados y contadores. Plantilla AAP (navy + dorado).

   Flujo:
     1. Validar email + tipoRegistro
     2. Rate-limit por email: máx 3 solicitudes en ventana móvil de 10 min
     3. Comprobar que el email NO esté ya en auth.users (admin API)
     4. Invalidar códigos previos no usados del mismo email
     5. Generar código CSPRNG de 6 dígitos
     6. Persistir en verification_codes con TTL de 10 min
     7. Enviar correo
     8. Responder 200 — JAMÁS incluir el código en la respuesta HTTP

   IMPORTANTE — desviación deliberada vs. spec literal:
   El spec pedía DELETE de los códigos previos no usados. Si se hace
   DELETE, el COUNT del rate-limit (paso 9 del spec) nunca puede crecer
   por encima de 1 — cada request borra el anterior. Acá se invalidan
   marcando `used=true` en su lugar: mismo efecto de seguridad (un código
   viejo no puede ser verificado), pero las filas siguen en la tabla y el
   COUNT rolling de 10 minutos funciona realmente.

   Variables de entorno requeridas:
     · GMAIL_USER, GMAIL_PASS
     · SUPABASE_URL (o VITE_SUPABASE_URL)
     · SUPABASE_SERVICE_ROLE_KEY
──────────────────────────────────────────────────────────────────────── */

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
})

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX        = 3
const CODE_TTL_MS           = 10 * 60 * 1000

const TIPOS_VALIDOS = new Set(['abogado', 'contador'])

/* ── Verificación de reCAPTCHA contra Google ──────────────────────────────
   Antes el token sólo se recolectaba en el cliente y nunca se validaba.
   Cualquier atacante saltaba el captcha llamando este endpoint a pelo y
   nos spameaba correos con OTPs a víctimas arbitrarias. Ahora exigimos un
   token válido. RECAPTCHA_SECRET_KEY debe estar configurado en Vercel. */
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

const adminHeaders = () => ({
  apikey:        SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
})

// ── Auth admin: ¿existe un usuario con este email? ─────────────────────
async function emailAlreadyRegistered(email) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/admin/users`)
  url.searchParams.set('filter', email)
  url.searchParams.set('per_page', '10')

  const res = await fetch(url.toString(), { headers: adminHeaders() })
  if (!res.ok) {
    // Si el admin API falla, no bloqueamos — el duplicado se atrapará
    // de todos modos en signUp del Paso C. Logueamos para observabilidad.
    console.error('[send-verification-code] admin/users failed:', res.status)
    return false
  }
  const data = await res.json()
  const list = Array.isArray(data) ? data : (data?.users || [])
  const target = email.toLowerCase()
  return list.some(u => (u?.email || '').toLowerCase() === target)
}

// ── Rate-limit: cantidad de filas creadas para este email en 10 min ────
async function countRecentCodes(email) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const url   =
    `${SUPABASE_URL}/rest/v1/verification_codes` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&created_at=gt.${encodeURIComponent(since)}` +
    `&select=id&limit=10`
  const res = await fetch(url, { headers: adminHeaders() })
  if (!res.ok) {
    console.error('[send-verification-code] count failed:', res.status)
    return 0
  }
  const rows = await res.json()
  return Array.isArray(rows) ? rows.length : 0
}

// ── Invalidar códigos previos no usados ────────────────────────────────
async function invalidatePreviousCodes(email) {
  const url =
    `${SUPABASE_URL}/rest/v1/verification_codes` +
    `?email=eq.${encodeURIComponent(email)}` +
    `&used=eq.false`
  await fetch(url, {
    method: 'PATCH',
    headers: {
      ...adminHeaders(),
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ used: true }),
  })
}

// ── Insertar código nuevo ──────────────────────────────────────────────
async function insertCode({ email, code, tipoRegistro, expiresAt }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes`, {
    method: 'POST',
    headers: {
      ...adminHeaders(),
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({
      email,
      code,
      tipo_registro: tipoRegistro,
      expires_at:    expiresAt.toISOString(),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`insert failed (${res.status}): ${detail}`)
  }
}

// ── Plantilla del correo (estilos 100% inline) ─────────────────────────
// Sólo la tarjeta — sin wrapper navy alrededor. La tarjeta va flotando
// sobre el fondo blanco del cliente de correo. Todo el texto del cuerpo
// en blanco para máximo contraste sobre el navy de la card.
function renderVerificationEmailHtml({ code, tipoRegistro }) {
  const rolLabel = tipoRegistro === 'contador' ? 'Contador' : 'Abogado'
  return `
<div style="margin:0;padding:24px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#132237;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(13,27,42,0.18);">

    <div style="background-color:#0a1628;padding:28px 24px;text-align:center;">
      <div style="color:#c9a84c;font-size:18px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">
        Abogados y Asociados Parada
      </div>
      <div style="color:#ffffff;font-size:13px;margin-top:6px;">
        Verificación de cuenta
      </div>
    </div>

    <div style="padding:32px 24px;">
      <p style="margin:0;color:#ffffff;font-size:15px;line-height:1.7;">
        Para completar tu registro como
        <strong style="color:#c9a84c;">${rolLabel}</strong>,
        ingresa el siguiente código:
      </p>

      <div style="background-color:#0a1628;border:2px solid #c9a84c;border-radius:10px;padding:24px;text-align:center;margin:24px 0;">
        <div style="font-size:42px;font-weight:bold;color:#c9a84c;letter-spacing:12px;font-family:Georgia,'Times New Roman',serif;">
          ${code}
        </div>
      </div>

      <p style="margin:0;color:#ffffff;font-size:13px;text-align:center;">
        Este código expira en 10 minutos.
      </p>
      <p style="margin:16px 0 0;color:#ffffff;font-size:12px;text-align:center;opacity:0.8;">
        Si no solicitaste este registro, ignora este correo.
      </p>
    </div>

    <div style="border-top:1px solid rgba(201,168,76,0.3);margin:0 24px;"></div>

    <div style="color:#ffffff;opacity:0.65;font-size:11px;text-align:center;padding:20px 24px;line-height:1.6;">
      Este correo fue generado automáticamente por Abogados y Asociados Parada.
      No responda a este mensaje.
    </div>

  </div>
</div>
  `
}

// ── Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — restringido a los dominios oficiales del proyecto. Sin esto,
  // cualquier sitio web podría disparar envíos de OTP usando el navegador
  // de sus visitantes (spam de correos a víctimas arbitrarias).
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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY ||
      !process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  // ── Validación de input ──────────────────────────────────────────────
  const body            = req.body || {}
  const rawEmail        = typeof body.email === 'string' ? body.email.trim() : ''
  const tipoRegistro    = typeof body.tipoRegistro === 'string' ? body.tipoRegistro : ''
  const recaptchaToken  = typeof body.recaptchaToken === 'string' ? body.recaptchaToken : ''

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'Correo inválido.' })
  }
  if (!TIPOS_VALIDOS.has(tipoRegistro)) {
    return res.status(400).json({ error: 'Tipo de registro inválido.' })
  }

  // ── Verificación de captcha (antes de tocar BD/admin API/SMTP) ───────
  const captchaCheck = await verifyRecaptcha(recaptchaToken)
  if (!captchaCheck.ok) {
    return res.status(403).json({
      error: 'No se pudo verificar el captcha. Recarga la página e intenta de nuevo.'
    })
  }

  // Supabase Auth almacena emails en lowercase — alineamos.
  const email = rawEmail.toLowerCase()

  try {
    // 1. Rate-limit primero (barato, antes de tocar admin API o SMTP)
    if (await countRecentCodes(email) >= RATE_LIMIT_MAX) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' })
    }

    // 2. ¿Ya está registrado?
    if (await emailAlreadyRegistered(email)) {
      return res.status(409).json({ error: 'Este correo ya está registrado' })
    }

    // 3. Invalidar códigos previos no usados (security: códigos viejos
    //    ya no pasarán verify-code aunque no hayan expirado)
    await invalidatePreviousCodes(email)

    // 4. Generar código — randomInt es CSPRNG y uniformemente distribuido
    //    (Math.floor(Math.random() * range) tiene sesgo modular sutil).
    //    randomInt(min, max) → [min, max), por eso 100000–1000000.
    const code = String(randomInt(100000, 1000000))

    // 5. TTL exacto de 10 minutos
    const expiresAt = new Date(Date.now() + CODE_TTL_MS)

    // 6. Persistir
    await insertCode({ email, code, tipoRegistro, expiresAt })

    // 7. Correo
    await transporter.sendMail({
      from:    `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: 'Código de verificación — Abogados y Asociados Parada',
      html:    renderVerificationEmailHtml({ code, tipoRegistro }),
    })

    // 8. JAMÁS exponer `code` aquí
    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('[send-verification-code] error:', err)
    return res.status(500).json({ error: 'No se pudo enviar el código. Intenta nuevamente.' })
  }
}
