import nodemailer from 'nodemailer'

// Reutiliza el mismo patrón de transporte que /api/notify.js (Gmail SMTP).
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

// ── Sanitizado de números colombianos ─────────────────────────────────────
// Quita espacios/guiones/paréntesis/+, prefijo 57 duplicado, y deja solo
// los 10 dígitos del celular para construir https://wa.me/57{numero}.
function sanitizeColPhone(raw = '') {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('57') && digits.length > 10) digits = digits.slice(2)
  return digits
}

// ── Verificación de rol superadmin ────────────────────────────────────────
// 1) Toma el JWT del header Authorization
// 2) Resuelve el user.id contra /auth/v1/user
// 3) Consulta profiles.rol por ese id (la RLS de profiles permite leer la
//    propia fila — sin necesidad de service-role key).
async function requireSuperadmin(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!userRes.ok) return false
    const user = await userRes.json()
    if (!user?.id) return false

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=rol`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
    )
    if (!profileRes.ok) return false
    const rows = await profileRes.json()
    return Array.isArray(rows) && rows[0]?.rol === 'superadmin'
  } catch {
    return false
  }
}

// ── Template HTML del correo (todo inline, sin <style>) ───────────────────
// Se reutiliza para los dos correos: lo que cambia es a quién va dirigido y
// qué datos van adentro de la "card de contacto".
function renderContactCardHtml({ recipient, contact, codigoReferencia }) {
  // recipient = 'cliente' | 'abogado'  → rol del DESTINATARIO
  // contact   = los datos de la OTRA parte (el contenido de la ficha)
  const otraParte = recipient === 'cliente' ? 'abogado' : 'cliente'
  const fullName  = `${contact.nombre || ''}${contact.apellido ? ' ' + contact.apellido : ''}`.trim()
  const waPhone   = sanitizeColPhone(contact.celular)
  const waUrl     = waPhone ? `https://wa.me/57${waPhone}` : ''

  return `
<div style="margin:0;background-color:#0d1b2a;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#132237;border-radius:12px;overflow:hidden;">

    <div style="background-color:#0a1628;padding:28px 24px;text-align:center;">
      <div style="color:#c9a84c;font-size:20px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">
        Abogados y Asociados Parada
      </div>
      <div style="color:#ffffff;font-size:13px;letter-spacing:1px;margin-top:6px;">
        Ficha de Contacto
      </div>
    </div>

    <div style="padding:28px 24px;">
      <p style="margin:0 0 24px 0;color:#cccccc;font-size:15px;line-height:1.7;">
        Aquí están los datos de contacto de tu ${otraParte}:
      </p>

      <div style="border:2px solid #c9a84c;border-radius:10px;background-color:#0d1b2a;padding:24px;">
        <div style="color:#ffffff;font-size:20px;font-family:Georgia,'Times New Roman',serif;font-weight:bold;margin-bottom:10px;">
          ${fullName || '—'}
        </div>
        ${contact.email ? `
        <a href="mailto:${contact.email}" style="color:#c9a84c;font-size:14px;text-decoration:none;display:block;margin-bottom:16px;">
          ${contact.email}
        </a>` : ''}
        ${waUrl ? `
        <a href="${waUrl}" style="display:inline-block;background-color:#25D366;color:#ffffff;font-size:14px;font-weight:bold;padding:12px 28px;border-radius:6px;text-decoration:none;">
          💬 Escribir por WhatsApp
        </a>` : ''}
      </div>
    </div>

    ${codigoReferencia ? `
    <div style="color:#888888;font-size:12px;text-align:center;padding:16px 24px;border-top:1px solid #1e3a5f;">
      Ref. consulta: ${codigoReferencia}
    </div>` : ''}

    <div style="border-top:1px solid #c9a84c;opacity:0.3;margin:0 24px;"></div>

    <div style="color:#555555;font-size:11px;text-align:center;padding:20px 24px;line-height:1.6;">
      Este correo fue generado automáticamente por el sistema de Abogados y Asociados Parada. No responda a este mensaje.
    </div>

  </div>
</div>
  `
}

// ── Handler principal ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Solo superadmin puede disparar este flujo
  const isAdmin = await requireSuperadmin(req)
  if (!isAdmin) {
    return res.status(403).json({ error: 'No autorizado' })
  }

  const { lawyerData, clientData, codigoReferencia } = req.body || {}

  if (!lawyerData?.email || !clientData?.email) {
    return res.status(400).json({ error: 'Faltan correos de destino.' })
  }

  const subject = 'Ficha de contacto — Abogados y Asociados Parada'
  const from    = `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`

  try {
    // Cliente recibe la ficha del ABOGADO
    const mailToClient = transporter.sendMail({
      from,
      to: clientData.email,
      subject,
      html: renderContactCardHtml({
        recipient: 'cliente',
        contact:   lawyerData,
        codigoReferencia,
      }),
    })

    // Abogado recibe la ficha del CLIENTE
    const mailToLawyer = transporter.sendMail({
      from,
      to: lawyerData.email,
      subject,
      html: renderContactCardHtml({
        recipient: 'abogado',
        contact:   clientData,
        codigoReferencia,
      }),
    })

    await Promise.all([mailToClient, mailToLawyer])
    return res.status(200).json({ success: true })
  } catch (_err) {
    // Sin loggear emails/teléfonos: solo respondemos error genérico.
    return res.status(500).json({ error: 'No se pudieron enviar los correos.' })
  }
}
