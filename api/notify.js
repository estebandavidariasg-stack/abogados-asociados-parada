import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

const SITE_BASE = 'https://abogadosyasociadosparada.com'

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

// Email HTML template — alineado visualmente con send-verification-code.js
// (tarjeta navy + acentos dorados, sin fondo full-bleed). El navy del header
// (#0a1628) y el del cuerpo (#132237) son los mismos del correo del código
// de verificación; mantener este pareo asegura branding consistente.
function renderEmailHtml({ subjectLine, greetingHtml, bodyHtml, ctaLabel, ctaUrl }) {
  return `
<div style="margin:0;padding:24px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;background-color:#132237;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(13,27,42,0.18);">

    <div style="background-color:#0a1628;padding:28px 24px;text-align:center;">
      <div style="color:#c9a84c;font-size:18px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">
        Abogados y Asociados Parada
      </div>
      <div style="color:#ffffff;font-size:13px;margin-top:6px;">
        ${subjectLine}
      </div>
    </div>

    <div style="padding:32px 24px;">
      <p style="margin:0 0 16px;color:#ffffff;font-size:15px;line-height:1.7;">
        ${greetingHtml}
      </p>
      <div style="margin:0 0 28px;color:#ffffff;font-size:15px;line-height:1.7;">
        ${bodyHtml}
      </div>
      <div style="text-align:center;">
        <a href="${ctaUrl}" style="display:inline-block;background-color:#c9a84c;color:#0a1628;font-weight:bold;padding:14px 32px;border-radius:8px;text-transform:uppercase;letter-spacing:1px;text-decoration:none;font-size:14px;font-family:Georgia,'Times New Roman',serif;">
          ${ctaLabel}
        </a>
      </div>
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

function emailAbogado({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  const subjectLine = `Nueva consulta pendiente — ${area}`
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#c9a84c;">${nombreAbogado}</strong>,`,
      bodyHtml: `Tienes una nueva consulta pendiente por parte de <strong style="color:#c9a84c;">${nombreCliente}</strong> en el área de <strong style="color:#c9a84c;">${area}</strong>. Ingresa a la plataforma para atenderla a la brevedad posible.`,
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
      bodyHtml: `Tu consulta en el área de <strong style="color:#c9a84c;">${area}</strong> ha sido recibida. El abogado/a <strong style="color:#c9a84c;">${nombreAbogado}</strong> se ha unido y está listo para atenderte. Ingresa a la plataforma para continuar con tu consulta.`,
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
