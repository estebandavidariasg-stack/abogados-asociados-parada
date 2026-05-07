import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

const SITE_BASE = 'https://paradayasociados.co'

// CTA URL builder ──────────────────────────────────────────────────────────
function buildCtaUrl(recipientRole, codigoReferencia) {
  switch (recipientRole) {
    case 'lawyer':
      return `${SITE_BASE}/?loginModal=true`
    case 'client':
      return codigoReferencia
        ? `${SITE_BASE}/chat?ref=${encodeURIComponent(codigoReferencia)}`
        : `${SITE_BASE}/chat`
    case 'superadmin':
      return `${SITE_BASE}/admin`
    default:
      return SITE_BASE
  }
}

// Email HTML template ──────────────────────────────────────────────────────
function renderEmailHtml({ subjectLine, greetingHtml, bodyHtml, ctaLabel, ctaUrl }) {
  return `
    <div style="margin:0;padding:40px 16px;background:#0a0a0a;font-family:Georgia,'Times New Roman',serif;">
      <div style="max-width:600px;margin:0 auto;background:#111111;border-top:3px solid #c9a84c;padding:40px;">
        <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;font-size:22px;text-align:center;font-weight:normal;">
          Abogados y Asociados Parada
        </h1>
        <p style="margin:0 0 24px 0;color:#ffffff;font-size:18px;text-align:center;">
          ${subjectLine}
        </p>
        <hr style="border:none;border-top:1px solid rgba(201,168,76,0.3);margin:0 0 24px 0;" />
        <p style="margin:0 0 16px 0;color:#cccccc;font-size:15px;line-height:1.7;">
          ${greetingHtml}
        </p>
        <div style="margin:0 0 28px 0;color:#cccccc;font-size:15px;line-height:1.7;">
          ${bodyHtml}
        </div>
        <div style="text-align:center;margin:0 0 32px 0;">
          <a href="${ctaUrl}" style="display:inline-block;background:#c9a84c;color:#0a0a0a;font-weight:bold;padding:14px 32px;border-radius:4px;text-transform:uppercase;letter-spacing:1px;text-decoration:none;font-size:14px;">
            ${ctaLabel}
          </a>
        </div>
        <hr style="border:none;border-top:1px solid rgba(201,168,76,0.3);margin:0 0 20px 0;" />
        <p style="margin:0;color:#555555;font-size:12px;text-align:center;line-height:1.5;">
          Este correo fue generado automáticamente por el sistema de Abogados y Asociados Parada. No responda a este mensaje.
        </p>
      </div>
    </div>
  `
}

function emailAbogado({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  const subjectLine = `Nueva consulta pendiente — ${area}`
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#c9a84c;">${nombreAbogado}</strong>,`,
      bodyHtml: `Tienes una nueva consulta pendiente por parte de <strong style="color:#ffffff;">${nombreCliente}</strong> en el área de <strong style="color:#ffffff;">${area}</strong>. Ingresa a la plataforma para atenderla a la brevedad posible.`,
      ctaLabel: 'Ver consulta',
      ctaUrl,
    }),
  }
}

function emailCliente({ nombreCliente, nombreAbogado, area, ctaUrl }) {
  const subjectLine = `Tu consulta fue recibida — ${area}`
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#c9a84c;">${nombreCliente}</strong>,`,
      bodyHtml: `Tu consulta en el área de <strong style="color:#ffffff;">${area}</strong> ha sido recibida. El abogado/a <strong style="color:#ffffff;">${nombreAbogado}</strong> se ha unido y está listo para atenderte. Ingresa a la plataforma para continuar con tu consulta.`,
      ctaLabel: 'Ir al chat',
      ctaUrl,
    }),
  }
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { type, data, recipientRole, codigoReferencia } = req.body
    const ctaUrl = buildCtaUrl(recipientRole, codigoReferencia)

    // ── Notificación al abogado cuando llega consulta nueva ──
    if (type === 'new_consultation') {
      const { lawyerEmail, nombreAbogado, nombreCliente, area } = data

      const { subject, html } = emailAbogado({ nombreAbogado, nombreCliente, area, ctaUrl })

      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: lawyerEmail,
        subject,
        html,
      })

      return res.status(200).json({ ok: true, sent: 'lawyer' })
    }

    // ── Notificación al cliente cuando el abogado se une ──
    if (type === 'lawyer_joined') {
      const { clientEmail, nombreCliente, nombreAbogado, area } = data

      const { subject, html } = emailCliente({ nombreCliente, nombreAbogado, area, ctaUrl })

      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: clientEmail,
        subject,
        html,
      })

      return res.status(200).json({ ok: true, sent: 'client' })
    }

    return res.status(400).json({ error: 'Tipo de notificación no reconocido' })

  } catch (err) {
    console.error('Error enviando email:', err)
    return res.status(500).json({ error: err.message })
  }
}
