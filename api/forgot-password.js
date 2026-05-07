import nodemailer from 'nodemailer'

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

const DEFAULT_REDIRECT = 'https://paradayasociados.co/nueva-contrasena'

function renderResetEmailHtml({ actionLink }) {
  return `
<div style="margin:0;background-color:#0d1b2a;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#132237;border-radius:12px;overflow:hidden;">

    <div style="background-color:#0a1628;padding:28px 24px;text-align:center;">
      <div style="color:#c9a84c;font-size:20px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">
        Abogados y Asociados Parada
      </div>
      <div style="color:#ffffff;font-size:13px;letter-spacing:1px;margin-top:6px;">
        Restablecer contraseña
      </div>
    </div>

    <div style="padding:28px 24px;">
      <p style="margin:0 0 18px 0;color:#cccccc;font-size:15px;line-height:1.7;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta.
        Si fuiste tú, haz clic en el botón a continuación para crear una nueva contraseña:
      </p>

      <div style="text-align:center;margin:28px 0 22px;">
        <a href="${actionLink}"
           style="display:inline-block;background-color:#c9a84c;color:#0d1b2a;font-size:15px;font-weight:bold;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-family:Georgia,'Times New Roman',serif;">
          Restablecer mi contraseña
        </a>
      </div>

      <div style="border:1px solid #1e3a5f;border-radius:8px;background-color:#0d1b2a;padding:14px 16px;margin-top:8px;">
        <p style="margin:0;color:#888888;font-size:12px;line-height:1.6;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:
        </p>
        <p style="margin:8px 0 0;word-break:break-all;">
          <a href="${actionLink}" style="color:#c9a84c;font-size:12px;text-decoration:none;">
            ${actionLink}
          </a>
        </p>
      </div>

      <p style="margin:22px 0 0;color:#999999;font-size:13px;line-height:1.6;">
        El enlace expira en <strong style="color:#c9a84c;">1 hora</strong>.
        Si no solicitaste este cambio, puedes ignorar este correo — tu contraseña actual seguirá funcionando.
      </p>
    </div>

    <div style="border-top:1px solid #c9a84c;opacity:0.3;margin:0 24px;"></div>

    <div style="color:#555555;font-size:11px;text-align:center;padding:20px 24px;line-height:1.6;">
      Este correo fue generado automáticamente por el sistema de Abogados y Asociados Parada.
      No responda a este mensaje.
    </div>

  </div>
</div>
  `
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, redirectTo } = req.body || {}
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Falta el correo.' })
  }

  // Validación estructural rápida (no exhaustiva — Supabase rechaza el resto).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Correo inválido.' })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Faltan variables de entorno — es un problema de configuración del
    // servidor, no del usuario. No revelar detalles.
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  // Por seguridad, NO revelamos si el email existe o no en la base.
  // SIEMPRE respondemos 200 al cliente, independientemente del resultado
  // (esto previene enumeración de usuarios).
  const target = (typeof redirectTo === 'string' && redirectTo) ? redirectTo : DEFAULT_REDIRECT

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
        email,
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
      to:      email,
      subject: 'Restablece tu contraseña — Abogados y Asociados Parada',
      html:    renderResetEmailHtml({ actionLink }),
    })

    return res.status(200).json({ success: true })
  } catch (_err) {
    // Tampoco loggeamos el email — pero el cliente recibe error genérico
    // sólo cuando Gmail mismo falla, no por usuario inexistente.
    return res.status(500).json({ error: 'No se pudo enviar el correo.' })
  }
}
