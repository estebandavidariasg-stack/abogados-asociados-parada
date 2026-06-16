import nodemailer from 'nodemailer'
import { renderEmailHtml, renderShell, infoBox, emailButton, em, C, FONT_SERIF } from './_lib/emailTemplate.js'
import { getCallerProfile } from './_lib/adminAuth.js'

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'abogadosyasociados.parada@gmail.com'

// Escapa texto del usuario antes de meterlo en el HTML del correo (evita que
// un mensaje con < > rompa el layout o inyecte marcado).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

const SITE_BASE = 'https://abogadosparada.com'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/* ── Resuelve email de profesional por su ID, usando service role ─────────
   El frontend ya NO descarga `email` en sus consultas de `profiles` (era un
   leak: cualquier visitante anónimo veía la lista completa de correos al
   abrir la home). Acá lo resolvemos server-side, sin tocar al cliente. */
async function resolveProfessionalEmail(lawyerId) {
  if (!lawyerId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(lawyerId)}` +
      `&select=email,nombre,apellido,rol&limit=1`
    const res = await fetch(url, {
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  } catch (err) {
    console.error('[notify] resolveProfessionalEmail failed:', err)
    return null
  }
}

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

function emailAbogado({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  const subjectLine = `Nueva consulta pendiente: ${area}`
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#0d2d5e;font-weight:700;">${nombreAbogado}</strong>,`,
      bodyHtml: `Tienes una nueva consulta pendiente por parte de <strong style="color:#0d2d5e;font-weight:700;">${nombreCliente}</strong> en el área de <strong style="color:#0d2d5e;font-weight:700;">${area}</strong>. Ingresa a la plataforma para atenderla a la brevedad posible.`,
      ctaLabel: 'Ver consulta',
      ctaUrl,
    }),
  }
}

function emailCliente({ nombreCliente, nombreAbogado, area, ctaUrl }) {
  const subjectLine = `Tu consulta fue recibida: ${area}`
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#0d2d5e;font-weight:700;">${nombreCliente}</strong>,`,
      bodyHtml: `Tu consulta en el área de <strong style="color:#0d2d5e;font-weight:700;">${area}</strong> ha sido recibida. El abogado/a <strong style="color:#0d2d5e;font-weight:700;">${nombreAbogado}</strong> se ha unido y está listo para atenderte. Ingresa a la plataforma para continuar con tu consulta.`,
      ctaLabel: 'Ir al chat',
      ctaUrl,
    }),
  }
}

function emailInactividad({ nombreAbogado, nombreCliente, area, createdAt, ctaUrl }) {
  const subjectLine = 'Consulta sin atender: acción requerida'
  const fechaCreacion = createdAt
    ? new Date(createdAt).toLocaleDateString('es-CO', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      greetingHtml: `Estimado/a <strong style="color:#0d2d5e;font-weight:700;">${nombreAbogado}</strong>,`,
      bodyHtml:
        `Tienes una consulta de <strong style="color:#0d2d5e;font-weight:700;">${nombreCliente}</strong>` +
        (area ? ` en el área de <strong style="color:#0d2d5e;font-weight:700;">${area}</strong>` : '') +
        (fechaCreacion ? ` (abierta el ${fechaCreacion})` : '') +
        ` sin actividad por más de 24 horas. ` +
        `El equipo administrativo te solicita ingresar a la plataforma y dar respuesta lo antes posible. ` +
        `Si la consulta ya no requiere tu atención, márcala como cerrada.`,
      ctaLabel: 'Atender consulta',
      ctaUrl,
    }),
  }
}

function emailAprobado({ nombreAbogado, rol, ctaUrl }) {
  const rolLabel = rol === 'contador' ? 'contador' : 'abogado'
  const subjectLine = 'Tu cuenta fue aprobada'
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      preheader: 'Ya apareces en la plataforma. Ingresa para empezar.',
      greetingHtml: `Estimado/a <strong style="color:#0d2d5e;font-weight:700;">${nombreAbogado}</strong>,`,
      bodyHtml:
        `Tu cuenta como <strong style="color:#0d2d5e;font-weight:700;">${rolLabel}</strong> en Abogados y Asociados Parada ya fue aprobada. ` +
        `Desde ahora apareces en la plataforma y los clientes pueden encontrarte y escribirte. ` +
        `Ingresa para completar tu perfil y empezar a atender consultas.`,
      ctaLabel: 'Ingresar a mi cuenta',
      ctaUrl,
    }),
  }
}

function emailRechazado({ nombreAbogado, rol, ctaUrl }) {
  const rolLabel = rol === 'contador' ? 'contador' : 'abogado'
  const subjectLine = 'Sobre tu solicitud de registro'
  return {
    subject: subjectLine,
    html: renderEmailHtml({
      subjectLine,
      preheader: 'Información sobre tu solicitud de registro.',
      greetingHtml: `Estimado/a <strong style="color:#0d2d5e;font-weight:700;">${esc(nombreAbogado)}</strong>,`,
      bodyHtml:
        `Revisamos tu solicitud de registro como <strong style="color:#0d2d5e;font-weight:700;">${rolLabel}</strong> en Abogados y Asociados Parada y, por ahora, no fue aprobada. ` +
        `Si consideras que se trata de un error o deseas enviar información adicional, puedes escribirnos por los canales oficiales que encuentras en nuestro sitio.`,
      ctaLabel: 'Visitar el sitio',
      ctaUrl,
    }),
  }
}

// PQR del cliente al equipo administrativo. Ficha con los datos + el mensaje.
function emailPqr({ tipo, clientNombre, clientEmail, codigoReferencia, mensaje, ctaUrl }) {
  const tipoLabel = tipo === 'queja' ? 'Queja' : tipo === 'reclamo' ? 'Reclamo' : 'Petición'
  const subjectLine = `Nueva PQR: ${tipoLabel}`
  const campo = (label, value) =>
    `<p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${label}</p>
     <p style="margin:0 0 12px;font-size:14px;color:${C.navy};font-weight:600;">${esc(value) || '—'}</p>`
  const inner =
    `<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">
       Un cliente envió una <strong style="color:#0d2d5e;font-weight:700;">${tipoLabel.toLowerCase()}</strong> desde la plataforma.
     </p>
     ${infoBox(
       campo('Cliente', clientNombre) +
       campo('Correo', clientEmail) +
       (codigoReferencia ? campo('Referencia', codigoReferencia) : '') +
       `<p style="margin:6px 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">Mensaje</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:${C.body};white-space:pre-wrap;">${esc(mensaje)}</p>`
     )}
     <div style="text-align:center;margin:26px 0 0;">${emailButton('Ver en el panel', ctaUrl)}</div>`
  return {
    subject: subjectLine,
    html: renderShell({ subjectLine, preheader: `${tipoLabel} de ${clientNombre || 'un cliente'}.`, innerHtml: inner }),
  }
}

// ── Ficha de contacto (antes en api/send-contact-card.js) ──────────────────
// Se consolidó aquí para no superar el límite de 12 Serverless Functions del
// plan Hobby de Vercel. Mismo comportamiento: dos correos cruzados con los
// datos de la otra parte (cliente ↔ abogado).

// Sanitiza un celular colombiano a sus 10 dígitos para armar https://wa.me/57…
function sanitizeColPhone(raw = '') {
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('57') && digits.length > 10) digits = digits.slice(2)
  return digits
}

// HTML de la ficha de contacto. `recipient` es el rol del DESTINATARIO y
// `contact` son los datos de la OTRA parte (el contenido de la ficha).
function renderContactCardHtml({ recipient, contact, codigoReferencia }) {
  const otraParte = recipient === 'cliente' ? 'abogado' : 'cliente'
  const fullName  = `${contact.nombre || ''}${contact.apellido ? ' ' + contact.apellido : ''}`.trim()
  const waPhone   = sanitizeColPhone(contact.celular)
  const waUrl     = waPhone ? `https://wa.me/57${waPhone}` : ''

  const cardInner =
    `<div style="text-align:center;">
       <div style="font-family:${FONT_SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:0.01em;margin-bottom:${contact.email || waUrl ? '12px' : '0'};">
         ${esc(fullName) || '—'}
       </div>` +
    (contact.email
      ? `<a href="mailto:${esc(contact.email)}" style="color:${C.navy};font-size:14px;text-decoration:underline;display:block;margin-bottom:${waUrl ? '18px' : '0'};">${esc(contact.email)}</a>`
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
      ? `<p style="margin:18px 0 0;text-align:center;font-size:12px;color:${C.muted};">Ref. consulta: ${esc(codigoReferencia)}</p>`
      : '')

  return renderShell({
    subjectLine: 'Ficha de contacto',
    preheader: `Datos de contacto de tu ${otraParte}.`,
    innerHtml: inner,
  })
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { type, data, recipientRole, codigoReferencia } = req.body
    const ctaUrl = buildCtaUrl(recipientRole, codigoReferencia)

    // ── Aviso al profesional cuando el admin aprueba su cuenta ──
    // Acción sensible (suplantable para phishing): exige superadmin.
    if (type === 'account_approved') {
      const caller = await getCallerProfile(req)
      if (caller?.rol !== 'superadmin') {
        return res.status(401).json({ error: 'No autorizado.' })
      }
      const { lawyerId } = data || {}
      if (!lawyerId) {
        return res.status(400).json({ error: 'Falta lawyerId.' })
      }
      const pro = await resolveProfessionalEmail(lawyerId)
      if (!pro?.email) {
        return res.status(400).json({ error: 'No se pudo resolver el correo del profesional.' })
      }
      const { subject, html } = emailAprobado({
        nombreAbogado: `${pro.nombre || ''} ${pro.apellido || ''}`.trim() || 'profesional',
        rol: pro.rol,
        ctaUrl: `${SITE_BASE}/?loginModal=true`,
      })
      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: pro.email,
        subject,
        html,
      })
      return res.status(200).json({ ok: true, sent: 'account_approved' })
    }

    // ── Aviso al profesional cuando el admin rechaza su solicitud ──
    // También sensible → exige superadmin.
    if (type === 'account_rejected') {
      const caller = await getCallerProfile(req)
      if (caller?.rol !== 'superadmin') {
        return res.status(401).json({ error: 'No autorizado.' })
      }
      const { lawyerId } = data || {}
      if (!lawyerId) {
        return res.status(400).json({ error: 'Falta lawyerId.' })
      }
      const pro = await resolveProfessionalEmail(lawyerId)
      if (!pro?.email) {
        return res.status(400).json({ error: 'No se pudo resolver el correo del profesional.' })
      }
      const { subject, html } = emailRechazado({
        nombreAbogado: `${pro.nombre || ''} ${pro.apellido || ''}`.trim() || 'profesional',
        rol: pro.rol,
        ctaUrl: SITE_BASE,
      })
      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: pro.email,
        subject,
        html,
      })
      return res.status(200).json({ ok: true, sent: 'account_rejected' })
    }

    // ── PQR del cliente → correo al equipo administrativo ──
    // Disparado tras el insert anónimo del PQR. Solo notifica al correo fijo
    // del admin (no a destinatarios arbitrarios), así que el peor abuso es
    // ruido en una sola bandeja.
    if (type === 'pqr_received') {
      const { tipo, clientNombre, clientEmail, codigoReferencia, mensaje } = data || {}
      if (!tipo || !mensaje) {
        return res.status(400).json({ error: 'Faltan datos de la PQR.' })
      }
      const { subject, html } = emailPqr({
        tipo,
        clientNombre,
        clientEmail,
        codigoReferencia,
        mensaje: String(mensaje).slice(0, 2000),
        ctaUrl: `${SITE_BASE}/admin`,
      })
      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: ADMIN_NOTIFY_EMAIL,
        subject,
        html,
      })
      return res.status(200).json({ ok: true, sent: 'pqr_received' })
    }

    // ── Ficha de contacto cruzada (cliente ↔ abogado) ──
    // Acción sensible (envía datos personales) → exige superadmin.
    if (type === 'contact_card') {
      const caller = await getCallerProfile(req)
      if (caller?.rol !== 'superadmin') {
        return res.status(403).json({ error: 'No autorizado.' })
      }
      const { lawyerData, clientData } = req.body || {}
      if (!lawyerData?.email || !clientData?.email) {
        return res.status(400).json({ error: 'Faltan correos de destino.' })
      }
      const from = `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`
      try {
        await Promise.all([
          // El cliente recibe la ficha del ABOGADO.
          transporter.sendMail({
            from,
            to: clientData.email,
            subject: 'Ficha de contacto',
            html: renderContactCardHtml({ recipient: 'cliente', contact: lawyerData, codigoReferencia }),
          }),
          // El abogado recibe la ficha del CLIENTE.
          transporter.sendMail({
            from,
            to: lawyerData.email,
            subject: 'Ficha de contacto',
            html: renderContactCardHtml({ recipient: 'abogado', contact: clientData, codigoReferencia }),
          }),
        ])
        return res.status(200).json({ ok: true, success: true, sent: 'contact_card' })
      } catch (_err) {
        // Sin loggear emails/teléfonos: solo error genérico.
        return res.status(500).json({ error: 'No se pudieron enviar los correos.' })
      }
    }

    // ── Notificación al abogado cuando llega consulta nueva ──
    // Acepta `lawyerId` (preferido) o `lawyerEmail` (legacy, compat hacia
    // atrás). Con lawyerId resolvemos el correo con service role en lugar
    // de confiar en datos que vengan del cliente — el frontend ya no expone
    // emails de profesionales por motivos de privacidad.
    if (type === 'new_consultation') {
      const { lawyerId, lawyerEmail: legacyEmail, nombreAbogado, nombreCliente, area } = data

      let toEmail   = legacyEmail || null
      let toNombre  = nombreAbogado || null
      if (lawyerId) {
        const pro = await resolveProfessionalEmail(lawyerId)
        if (pro?.email) {
          toEmail  = pro.email
          if (!toNombre && pro.nombre) toNombre = `${pro.nombre} ${pro.apellido || ''}`.trim()
        }
      }
      if (!toEmail) {
        return res.status(400).json({ error: 'No se pudo resolver el correo del profesional.' })
      }

      const { subject, html } = emailAbogado({
        nombreAbogado: toNombre || 'profesional',
        nombreCliente,
        area,
        ctaUrl,
      })

      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject,
        html,
      })

      return res.status(200).json({ ok: true, sent: 'lawyer' })
    }

    // ── Notificación al profesional sobre chat inactivo ──
    // Disparado manualmente por el superadmin desde AdminPage > tab Alertas
    // cuando un chat lleva +24h sin actividad. Resuelve el correo del
    // profesional con service role (no se expone en el cliente).
    if (type === 'chat_inactivity') {
      const { lawyerId, clientNombre, area, createdAt } = data || {}
      if (!lawyerId) {
        return res.status(400).json({ error: 'Falta lawyerId.' })
      }
      const pro = await resolveProfessionalEmail(lawyerId)
      if (!pro?.email) {
        return res.status(400).json({ error: 'No se pudo resolver el correo del profesional.' })
      }
      const nombreAbogado = `${pro.nombre || ''} ${pro.apellido || ''}`.trim() || 'profesional'

      const { subject, html } = emailInactividad({
        nombreAbogado,
        nombreCliente: clientNombre || 'un cliente',
        area:          area || '',
        createdAt,
        ctaUrl,
      })

      await transporter.sendMail({
        from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
        to: pro.email,
        subject,
        html,
      })

      return res.status(200).json({ ok: true, sent: 'lawyer_inactivity' })
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
