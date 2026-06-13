/* ────────────────────────────────────────────────────────────────────────
   Correo al administrador para solicitudes de verificación.
   Reusa el estilo navy + gold de los demás correos del proyecto.
   Destinatario configurable por env ADMIN_NOTIFY_EMAIL (no hardcodeado).
──────────────────────────────────────────────────────────────────────── */

import nodemailer from 'nodemailer'

export const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL || 'abogadosyasociados.parada@gmail.com'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
})

function renderHtml({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  return `
<div style="margin:0;background-color:#0d1b2a;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#132237;border-radius:12px;overflow:hidden;">
    <div style="background-color:#0a1628;padding:28px 24px;text-align:center;">
      <div style="color:#c9a84c;font-size:20px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">
        Abogados y Asociados Parada
      </div>
      <div style="color:#ffffff;font-size:13px;letter-spacing:1px;margin-top:6px;">
        Solicitud de revisión de proceso
      </div>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 18px 0;color:#cccccc;font-size:15px;line-height:1.7;">
        El profesional <strong style="color:#c9a84c;">${nombreAbogado}</strong>
        solicita que revises una conversación con un cliente.
      </p>
      <div style="border:1px solid #1e3a5f;border-radius:8px;background-color:#0d1b2a;padding:14px 16px;margin:0 0 22px;">
        <p style="margin:0 0 6px;color:#888;font-size:12px;">Cliente</p>
        <p style="margin:0 0 12px;color:#fff;font-size:15px;">${nombreCliente}</p>
        <p style="margin:0 0 6px;color:#888;font-size:12px;">Consulta</p>
        <p style="margin:0;color:#fff;font-size:15px;">${area}</p>
      </div>
      <div style="text-align:center;margin:22px 0 6px;">
        <a href="${ctaUrl}"
           style="display:inline-block;background-color:#c9a84c;color:#0d1b2a;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-family:Georgia,'Times New Roman',serif;">
          Ver conversación
        </a>
      </div>
    </div>
    <div style="color:#555;font-size:11px;text-align:center;padding:18px 24px;line-height:1.6;">
      Notificación automática del sistema de Abogados y Asociados Parada.
    </div>
  </div>
</div>`
}

export async function sendVerificationEmail({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  await transporter.sendMail({
    from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
    to: ADMIN_NOTIFY_EMAIL,
    subject: `Solicitud de revisión — ${nombreCliente}`,
    html: renderHtml({ nombreAbogado, nombreCliente, area, ctaUrl }),
  })
}
