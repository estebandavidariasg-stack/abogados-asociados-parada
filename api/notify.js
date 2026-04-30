import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

// ── Plantillas de email ────────────────────────────────────────────────────
function emailAbogado({ nombreAbogado, nombreCliente, area, linkPagina }) {
  return {
    subject: `Nueva consulta pendiente — ${area}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0d0d0d; color: #f0ebe0; padding: 40px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-family: Georgia, serif; color: var(--gold); font-size: 1.8rem; margin: 0;">
            Abogados y Asociados <span style="font-weight: 700;">Parada</span>
          </h1>
          <div style="width: 60px; height: 1px; background: var(--gold); margin: 16px auto;"></div>
        </div>

        <p style="font-size: 1rem; color: rgba(240,235,224,0.85); margin-bottom: 8px;">
          Estimado/a <strong style="color: var(--gold);">${nombreAbogado}</strong>,
        </p>

        <p style="font-size: 0.95rem; color: rgba(240,235,224,0.7); line-height: 1.8; margin-bottom: 24px;">
          Tienes una nueva consulta pendiente por parte de 
          <strong style="color: #f0ebe0;">${nombreCliente}</strong> 
          en el área de <strong style="color: #f0ebe0;">${area}</strong>.
        </p>

        <div style="background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.25); border-radius: 8px; padding: 20px; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 0.85rem; color: rgba(240,235,224,0.6);">
            Ingresa a la plataforma para atender la consulta a la brevedad posible.
          </p>
        </div>

        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${linkPagina}" 
             style="display: inline-block; background: linear-gradient(135deg, var(--gold), #a0822e); color: #0d0d0d; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 700; font-size: 0.9rem; letter-spacing: 1px;">
            Ver consulta
          </a>
        </div>

        <div style="border-top: 1px solid rgba(201,168,76,0.15); padding-top: 20px; text-align: center;">
          <p style="font-size: 0.75rem; color: rgba(240,235,224,0.3); margin: 0;">
            Abogados y Asociados Parada · Colombia<br/>
            Este mensaje es generado automáticamente.
          </p>
        </div>
      </div>
    `,
  }
}

function emailCliente({ nombreCliente, nombreAbogado, area, linkPagina }) {
  return {
    subject: `Tu consulta fue recibida — ${area}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0d0d0d; color: #f0ebe0; padding: 40px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-family: Georgia, serif; color: var(--gold); font-size: 1.8rem; margin: 0;">
            Abogados y Asociados <span style="font-weight: 700;">Parada</span>
          </h1>
          <div style="width: 60px; height: 1px; background: var(--gold); margin: 16px auto;"></div>
        </div>

        <p style="font-size: 1rem; color: rgba(240,235,224,0.85); margin-bottom: 8px;">
          Estimado/a <strong style="color: var(--gold);">${nombreCliente}</strong>,
        </p>

        <p style="font-size: 0.95rem; color: rgba(240,235,224,0.7); line-height: 1.8; margin-bottom: 24px;">
          Tu consulta en el área de <strong style="color: #f0ebe0;">${area}</strong> 
          ha sido recibida. El abogado/a 
          <strong style="color: #f0ebe0;">${nombreAbogado}</strong> 
          se ha unido y está listo para atenderte.
        </p>

        <div style="background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.25); border-radius: 8px; padding: 20px; margin-bottom: 32px;">
          <p style="margin: 0; font-size: 0.85rem; color: rgba(240,235,224,0.6);">
            Ingresa a la plataforma para continuar con tu consulta.
          </p>
        </div>

        <div style="text-align: center; margin-bottom: 32px;">
          <a href="${linkPagina}"
             style="display: inline-block; background: linear-gradient(135deg, var(--gold), #a0822e); color: #0d0d0d; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 700; font-size: 0.9rem; letter-spacing: 1px;">
            Ir al chat
          </a>
        </div>

        <div style="border-top: 1px solid rgba(201,168,76,0.15); padding-top: 20px; text-align: center;">
          <p style="font-size: 0.75rem; color: rgba(240,235,224,0.3); margin: 0;">
            Abogados y Asociados Parada · Colombia<br/>
            Este mensaje es generado automáticamente.
          </p>
        </div>
      </div>
    `,
  }
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { type, data } = req.body

    // ── Notificación al abogado cuando llega consulta nueva ──
    if (type === 'new_consultation') {
      const { lawyerEmail, nombreAbogado, nombreCliente, area } = data
      const linkPagina = `${process.env.VITE_APP_URL || 'https://paradayasociados.co'}/perfil`

      const { subject, html } = emailAbogado({ nombreAbogado, nombreCliente, area, linkPagina })

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
      const linkPagina = `${process.env.VITE_APP_URL || 'https://paradayasociados.co'}/#chat`

      const { subject, html } = emailCliente({ nombreCliente, nombreAbogado, area, linkPagina })

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