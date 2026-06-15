import nodemailer from 'nodemailer'
import { renderShell, infoBox, C, FONT_SERIF } from './_lib/emailTemplate.js'

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

  const cardInner =
    `<div style="text-align:center;">
       <div style="font-family:${FONT_SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:0.01em;margin-bottom:${contact.email || waUrl ? '12px' : '0'};">
         ${fullName || '—'}
       </div>` +
    (contact.email
      ? `<a href="mailto:${contact.email}" style="color:${C.navy};font-size:14px;text-decoration:underline;display:block;margin-bottom:${waUrl ? '18px' : '0'};">${contact.email}</a>`
      : '') +
    (waUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
           <td align="center" bgcolor="#128C4B" style="border-radius:8px;background-color:#128C4B;">
             <a href="${waUrl}" target="_blank" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:700;color:#ffffff;border-radius:8px;letter-spacing:0.02em;">Escribir por WhatsApp</a>
           </td>
         </tr></table>`
      : '') +
    `</div>`

  const inner =
    `<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">
       Estos son los datos de contacto de tu ${otraParte}:
     </p>
     ${infoBox(cardInner)}` +
    (codigoReferencia
      ? `<p style="margin:18px 0 0;text-align:center;font-size:12px;color:${C.muted};">Ref. consulta: ${codigoReferencia}</p>`
      : '')

  return renderShell({
    subjectLine: 'Ficha de contacto',
    preheader: `Datos de contacto de tu ${otraParte}.`,
    innerHtml: inner,
  })
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

  const subject = 'Ficha de contacto'
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
