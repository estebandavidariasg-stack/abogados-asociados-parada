import nodemailer from 'nodemailer'
import crypto from 'node:crypto'
import { renderEmailHtml, renderShell, infoBox, emailButton, em, C, FONT_SERIF } from './_lib/emailTemplate.js'
import { getCallerProfile, lawyerAssignedToRoom } from './_lib/adminAuth.js'

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

const SITE_BASE = 'https://paradabridge.com'

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

// Lee nombre del cliente y área desde la sala (service role). Se usa para que
// las notificaciones al profesional muestren datos REALES de la BD y no lo que
// venga en el body (que en el flujo anónimo no es de confianza).
async function resolveRoomInfo(roomId) {
  if (!roomId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/chat_rooms` +
      `?id=eq.${encodeURIComponent(roomId)}` +
      `&select=client_nombre,area_derecho&limit=1`
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
    console.error('[notify] resolveRoomInfo failed:', err)
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
      greetingHtml: `Estimado/a <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreAbogado)}</strong>,`,
      bodyHtml: `Tienes una nueva consulta pendiente por parte de <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreCliente)}</strong> en el área de <strong style="color:#6d3c1b;font-weight:700;">${esc(area)}</strong>. Ingresa a la plataforma para atenderla a la brevedad posible.`,
      ctaLabel: 'Ver consulta',
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
      greetingHtml: `Estimado/a <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreAbogado)}</strong>,`,
      bodyHtml:
        `Tienes una consulta de <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreCliente)}</strong>` +
        (area ? ` en el área de <strong style="color:#6d3c1b;font-weight:700;">${esc(area)}</strong>` : '') +
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
      greetingHtml: `Estimado/a <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreAbogado)}</strong>,`,
      bodyHtml:
        `Tu cuenta como <strong style="color:#6d3c1b;font-weight:700;">${rolLabel}</strong> en Parada Bridge ya fue aprobada. ` +
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
      greetingHtml: `Estimado/a <strong style="color:#6d3c1b;font-weight:700;">${esc(nombreAbogado)}</strong>,`,
      bodyHtml:
        `Revisamos tu solicitud de registro como <strong style="color:#6d3c1b;font-weight:700;">${rolLabel}</strong> en Parada Bridge y, por ahora, no fue aprobada. ` +
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
       Un cliente envió una <strong style="color:#6d3c1b;font-weight:700;">${tipoLabel.toLowerCase()}</strong> desde la plataforma.
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

// ── Integración Alegra (Sub-proyecto B) ─────────────────────────────────────
// Emite la factura de la COMISIÓN que el profesional le paga a la empresa.
// Cuenta DEMO: se crea la factura de venta en Alegra (sin forzar timbre DIAN);
// cuando se habilite facturación electrónica, la misma factura se emite FE.
// Todo best-effort: si Alegra falla, el pago YA quedó registrado en Supabase.
const ALEGRA_EMAIL = process.env.ALEGRA_EMAIL
const ALEGRA_TOKEN = process.env.ALEGRA_TOKEN
const ALEGRA_BASE  = 'https://api.alegra.com/api/v1'
const ALEGRA_ITEM_NAME = 'Comisión de plataforma'

function svcHeaders(extra = {}) {
  return {
    apikey:        SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function alegraHeaders() {
  const auth = Buffer.from(`${ALEGRA_EMAIL}:${ALEGRA_TOKEN}`).toString('base64')
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' }
}

// Llamada genérica a Alegra. Lanza Error con el mensaje de la API si falla.
async function alegra(path, opts = {}) {
  const res  = await fetch(`${ALEGRA_BASE}${path}`, { ...opts, headers: { ...alegraHeaders(), ...(opts.headers || {}) } })
  const text = await res.text()
  let body; try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = body?.message || body?.error || `Alegra HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return body
}

// Asegura el contacto (profesional) en Alegra: lo busca por cédula, o lo crea.
async function alegraEnsureContact({ nombre, apellido, cedula, email }) {
  const name = `${nombre || ''} ${apellido || ''}`.trim() || 'Profesional'
  if (cedula) {
    const found = await alegra(`/contacts?identification=${encodeURIComponent(cedula)}&limit=1`)
    if (Array.isArray(found) && found.length) return found[0].id
  }
  const created = await alegra('/contacts', {
    method: 'POST',
    body: JSON.stringify({ name, identification: cedula || undefined, email: email || undefined, type: 'client' }),
  })
  return created.id
}

// Asegura el ítem/servicio de la comisión (sin IVA). Lo busca por nombre o lo crea.
async function alegraEnsureItem() {
  const found = await alegra(`/items?query=${encodeURIComponent(ALEGRA_ITEM_NAME)}&limit=30`)
  if (Array.isArray(found)) {
    const exact = found.find(i => (i.name || '').toLowerCase() === ALEGRA_ITEM_NAME.toLowerCase())
    if (exact) return exact.id
  }
  const created = await alegra('/items', {
    method: 'POST',
    body: JSON.stringify({ name: ALEGRA_ITEM_NAME, price: 0, type: 'service' }),
  })
  return created.id
}

// Crea la factura de venta (comisión) SIN IVA (tax: []).
async function alegraCreateInvoice({ contactId, itemId, monto }) {
  const today = new Date().toISOString().slice(0, 10)
  return alegra('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      date: today,
      dueDate: today,
      client: { id: contactId },
      items: [{
        id: itemId,
        price: Number(monto) || 0,
        quantity: 1,
        tax: [],
        description: 'Comisión de plataforma por asesoría',
      }],
    }),
  })
}

// Lee el pago (service role) para validar dueño + estado antes de facturar.
async function getPagoProfesional(id) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pagos_profesional?id=eq.${encodeURIComponent(id)}` +
      `&select=id,profesional_id,monto,estado,alegra_factura_id,alegra_factura_numero&limit=1`,
      { headers: svcHeaders() }
    )
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  } catch { return null }
}

// Perfil del profesional para facturar (nombre, cédula, correo).
async function getProfileForAlegra(id) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=nombre,apellido,cedula,email&limit=1`,
      { headers: svcHeaders() }
    )
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  } catch { return null }
}

// Emite la factura de la comisión en Alegra para un pago dado (reutilizable por
// la rama autenticada y por el webhook de Wompi). Best-effort.
async function emitirFacturaAlegra(pagoId) {
  if (!ALEGRA_EMAIL || !ALEGRA_TOKEN) return { ok: false, skipped: 'not_configured' }
  const pago = await getPagoProfesional(pagoId)
  if (!pago) return { ok: false, error: 'pago_no_encontrado' }
  if (pago.alegra_factura_id) return { ok: true, already: true, numero: pago.alegra_factura_numero }
  const prof = await getProfileForAlegra(pago.profesional_id)
  const contactId = await alegraEnsureContact({
    nombre: prof?.nombre, apellido: prof?.apellido, cedula: prof?.cedula, email: prof?.email,
  })
  const itemId  = await alegraEnsureItem()
  const invoice = await alegraCreateInvoice({ contactId, itemId, monto: pago.monto })
  const numero  = invoice?.numberTemplate?.fullNumber || invoice?.number || `#${invoice?.id}`
  if (invoice?.id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/pagos_profesional?id=eq.${encodeURIComponent(pagoId)}`, {
      method: 'PATCH',
      headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ alegra_factura_id: String(invoice.id), alegra_factura_numero: numero }),
    })
  }
  return { ok: true, id: invoice?.id, numero }
}

// ── Pasarela Wompi (Fase 2) ─────────────────────────────────────────────────
const WOMPI_PUBLIC_KEY       = process.env.WOMPI_PUBLIC_KEY
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET
const WOMPI_EVENTS_SECRET    = process.env.WOMPI_EVENTS_SECRET

// Webhook de Wompi: valida el checksum firmado y, si la transacción fue
// APROBADA, confirma el pago (service-role) y emite la factura en Alegra.
// El cuerpo trae { event, data.transaction, signature:{checksum,properties}, timestamp }.
async function handleWompiWebhook(req, res) {
  if (!WOMPI_EVENTS_SECRET) return res.status(200).json({ ok: false, skipped: 'not_configured' })
  const body = req.body || {}
  const props = body.signature?.properties || []
  // Concatena los valores de las rutas indicadas (dentro de `data`) + timestamp + secret.
  let concat = ''
  for (const p of props) {
    const val = String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), body.data)
    concat += (val == null ? '' : String(val))
  }
  concat += String(body.timestamp)
  concat += WOMPI_EVENTS_SECRET
  const digest = crypto.createHash('sha256').update(concat).digest('hex').toLowerCase()
  const given  = String(body.signature?.checksum || '').toLowerCase()
  // Comparación en TIEMPO CONSTANTE: con `!==` (corto-circuito byte a byte) un
  // atacante podría recuperar el checksum correcto por diferencias de tiempo y
  // forjar un pago APPROVED. timingSafeEqual exige misma longitud.
  const firmaOk =
    digest.length === given.length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(given))
  if (!firmaOk) {
    return res.status(401).json({ error: 'firma inválida' })
  }

  const tx = body.data?.transaction || {}
  if (body.event === 'transaction.updated' && tx.status === 'APPROVED') {
    const ref = String(tx.reference || '')
    // Prefijo de marca: solo procesamos referencias de ESTA plataforma
    // (Parada Bridge). Si la cuenta Wompi es compartida con otra marca, sus
    // eventos (otro prefijo) se ignoran aquí sin tocarlos.
    const m = ref.match(/^pb_pp_([0-9a-fA-F-]{36})$/)
    if (m && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const pagoId = m[1]
      const pago = await getPagoProfesional(pagoId)
      // Cross-check del monto firmado por Wompi contra el pago (defensa extra).
      if (pago && Math.round(Number(pago.monto) * 100) === Number(tx.amount_in_cents)) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmar_pago_wompi`, {
            method: 'POST',
            headers: svcHeaders(),
            body: JSON.stringify({ p_pago_id: pagoId, p_tx_id: String(tx.id) }),
          })
          try { await emitirFacturaAlegra(pagoId) } catch (e) { console.error('[notify] alegra tras wompi:', e?.message || e) }
        } catch (e) {
          console.error('[notify] confirmar_pago_wompi failed:', e?.message || e)
        }
      }
    }
  }
  // Siempre 200 en eventos con firma válida (evita reintentos infinitos de Wompi).
  return res.status(200).json({ ok: true })
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Webhook de Wompi: su cuerpo trae `event` + `signature`, no `type`.
    // Se detecta y procesa antes del dispatch por `type` (no lleva auth).
    if (req.body?.event && req.body?.signature?.checksum) {
      return await handleWompiWebhook(req, res)
    }

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
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
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
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
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
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
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
      const from = `"Parada Bridge" <${process.env.GMAIL_USER}>`
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

    // ── Resultado de un proyecto de ley → correo a quienes votaron ──
    // Acción sensible: envía correo de marca a direcciones arbitrarias del body
    // + adjunta un PDF. Exige superadmin (igual que contact_card).
    if (type === 'proyecto_resultado') {
      const caller = await getCallerProfile(req)
      if (caller?.rol !== 'superadmin') {
        return res.status(401).json({ error: 'No autorizado.' })
      }

      const { proyecto, pdf, recipients } = req.body || {}

      // Validación del payload.
      const estado = proyecto?.estado
      if (!proyecto?.nombre || (estado !== 'aprobado' && estado !== 'rechazado')) {
        return res.status(400).json({ error: 'Datos del proyecto inválidos (nombre y estado aprobado|rechazado requeridos).' })
      }
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Falta la lista de destinatarios.' })
      }
      // El cliente debe batchear (≤ ~30). Defensa dura del servidor.
      if (recipients.length > 60) {
        return res.status(400).json({ error: 'Demasiados destinatarios en un solo lote (máx. 60).' })
      }
      // Procesamos como mucho 40 por llamada (el cliente controla el batching).
      const lote = recipients.slice(0, 40)

      const estadoLabel = estado === 'aprobado'
        ? 'Proyecto de ley APROBADO'
        : 'Proyecto de ley NO aprobado'
      const pillColor = estado === 'aprobado' ? '#2e7d5b' : '#b4442f'
      const subject = `${estadoLabel} · ${esc(proyecto.numero || proyecto.nombre)}`.slice(0, 180)

      // Adjunto construido UNA sola vez (si viene PDF).
      const attachments = pdf?.base64
        ? [{
            filename: pdf.filename || 'resultados-proyecto.pdf',
            content: Buffer.from(pdf.base64, 'base64'),
            contentType: 'application/pdf',
          }]
        : []

      // Ficha etiqueta/valor (mismo patrón que emailPqr).
      const campo = (label, value) =>
        `<p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${label}</p>
         <p style="margin:0 0 12px;font-size:14px;color:${C.navy};font-weight:600;">${esc(value) || '—'}</p>`

      // Formatea una fecha ISO a es-CO si parece ISO; si no, la deja tal cual.
      const fmtFecha = (raw) => {
        if (!raw) return ''
        const s = String(raw)
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          const d = new Date(s)
          if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
          }
        }
        return s
      }

      const fechaResultado = proyecto.fecha ? fmtFecha(proyecto.fecha) : ''
      const from = `"Parada Bridge" <${process.env.GMAIL_USER}>`

      // Arma el HTML para un destinatario concreto.
      const buildHtml = (r) => {
        const votoLabel   = esc(r.voto)
        const fechaVoto   = esc(fmtFecha(r.fecha))
        const proyectoStr = esc(proyecto.nombre) + (proyecto.numero ? ` (${esc(proyecto.numero)})` : '')

        const pill =
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 22px;">
             <tr>
               <td align="center" bgcolor="${pillColor}" style="border-radius:8px;background-color:${pillColor};padding:11px 26px;font-family:${FONT_SERIF};font-size:15px;font-weight:700;letter-spacing:0.04em;color:#ffffff;">
                 ${esc(estadoLabel)}
               </td>
             </tr>
           </table>`

        const enlace = proyecto.enlace
          ? emailButton('Ver el proyecto de ley', esc(proyecto.enlace))
          : emailButton('Ver el debate', `${SITE_BASE}/proyectos-ley`)

        const inner =
          `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${C.navy};text-align:center;">
             Estimado/a <strong style="color:#6d3c1b;font-weight:700;">${esc(r.nombre) || 'ciudadano/a'}</strong>,
           </p>
           ${pill}
           <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">
             El proyecto de ley en el que participaste ya tiene un resultado. A continuación encuentras el detalle de tu participación.
           </p>
           ${infoBox(
             campo('Proyecto', proyectoStr) +
             campo('Tu voto', votoLabel) +
             campo('Fecha de tu participación', fechaVoto) +
             campo('Nombre', r.nombre) +
             campo('Cédula', r.cedula) +
             (fechaResultado ? campo('Fecha del resultado', fechaResultado) : '')
           )}` +
          (proyecto.notas
            ? `<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:${C.body};white-space:pre-wrap;text-align:center;">${esc(proyecto.notas)}</p>`
            : '') +
          `<div style="text-align:center;margin:26px 0 0;">${enlace}</div>` +
          (attachments.length
            ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">Adjuntamos el documento completo con los resultados del proyecto en formato PDF.</p>`
            : '')

        return renderShell({
          subjectLine: estadoLabel,
          preheader: `${estadoLabel}: ${esc(proyecto.nombre)}`,
          innerHtml: inner,
        })
      }

      // Un correo por destinatario con email válido. allSettled: un correo malo
      // no aborta el resto.
      const results = await Promise.allSettled(
        lote
          .filter((r) => r?.correo && String(r.correo).includes('@'))
          .map((r) =>
            transporter.sendMail({
              from,
              to: r.correo,
              subject,
              html: buildHtml(r),
              attachments,
            })
          )
      )

      const sent   = results.filter((x) => x.status === 'fulfilled').length
      const failed = results.filter((x) => x.status === 'rejected').length

      return res.status(200).json({ ok: true, sent, failed })
    }

    // ── Notificación al abogado cuando llega consulta nueva ──
    // Solo `lawyerId`: el correo se resuelve server-side con service role.
    // (El fallback legacy `lawyerEmail` se eliminó — permitía usar este
    // endpoint sin auth como relay de correo hacia direcciones arbitrarias,
    // arriesgando la suspensión de la cuenta Gmail de la firma.)
    if (type === 'new_consultation') {
      const { lawyerId, roomId } = data || {}

      if (!lawyerId || !roomId) {
        return res.status(400).json({ error: 'Faltan lawyerId o roomId.' })
      }
      // Este aviso lo dispara el flujo ANÓNIMO del cliente, así que no hay
      // sesión que validar. En su lugar exigimos que el profesional esté
      // REALMENTE asignado a esa sala; si no, no enviamos nada. Así el endpoint
      // no puede usarse como relay para spamear a cualquier profesional: solo
      // avisa a alguien que en efecto tiene asignada la consulta indicada.
      if (!(await lawyerAssignedToRoom(lawyerId, roomId))) {
        return res.status(403).json({ error: 'El profesional no está asignado a esa sala.' })
      }
      const pro = await resolveProfessionalEmail(lawyerId)
      if (!pro?.email) {
        return res.status(400).json({ error: 'No se pudo resolver el correo del profesional.' })
      }
      // Nombre del cliente y área desde la BD (no del body): el contenido del
      // correo refleja la sala real, no texto arbitrario del que llama.
      const room = await resolveRoomInfo(roomId)

      const { subject, html } = emailAbogado({
        nombreAbogado: `${pro.nombre || ''} ${pro.apellido || ''}`.trim() || 'profesional',
        nombreCliente: room?.client_nombre || 'un cliente',
        area:          room?.area_derecho || '',
        ctaUrl,
      })

      await transporter.sendMail({
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
        to: pro.email,
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
      // Acción de admin (tab Alertas): envía correo al profesional Y sella
      // notificado_at (ancla la barrera de 4h). Debe exigir superadmin — antes
      // era invocable sin auth, permitiendo manipular el reloj de reasignación.
      const caller = await getCallerProfile(req)
      if (caller?.rol !== 'superadmin') {
        return res.status(401).json({ error: 'No autorizado.' })
      }
      const { lawyerId, roomId, clientNombre, area, createdAt } = data || {}
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
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
        to: pro.email,
        subject,
        html,
      })

      // Ancla la barrera de 4h: sella `notificado_at` en la(s) notificación(es)
      // de inactividad sin atender de esta sala, SOLO si aún no tienen sello
      // (`notificado_at=is.null`) — así un reenvío no reinicia el reloj de la
      // barrera. Best-effort: si el PATCH falla no rompemos el correo (que ya
      // se envió). Requiere `data.roomId`; con solo `lawyerId` se omite.
      let stamped = false
      if (roomId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const nowIso = new Date().toISOString()
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/notificaciones` +
            `?room_id=eq.${encodeURIComponent(roomId)}` +
            `&tipo=eq.inactividad&atendida=eq.false&notificado_at=is.null`,
            {
              method: 'PATCH',
              headers: {
                apikey:          SUPABASE_SERVICE_ROLE_KEY,
                Authorization:   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type':  'application/json',
                Prefer:          'return=minimal',
              },
              body: JSON.stringify({ notificado_at: nowIso }),
            }
          )
          stamped = patchRes.ok
        } catch (err) {
          console.error('[notify] stamp notificado_at failed:', err?.message || err)
        }
      }

      return res.status(200).json({ ok: true, sent: 'lawyer_inactivity', stamped })
    }

    // ── Emitir factura de la comisión en Alegra (Sub-proyecto B) ──
    // La dispara MisPagos tras un pago exitoso (pagar_pago). Autenticada: solo
    // el profesional dueño del pago. Best-effort: si Alegra falla, responde 200
    // con ok:false para NO romper el flujo de pago (que ya quedó registrado).
    if (type === 'alegra_factura') {
      const caller = await getCallerProfile(req)
      if (!caller || !['abogado', 'contador'].includes(caller.rol)) {
        return res.status(401).json({ error: 'No autorizado.' })
      }
      if (!ALEGRA_EMAIL || !ALEGRA_TOKEN) {
        // Aún no configurada: no es un error para el usuario.
        return res.status(200).json({ ok: false, skipped: 'not_configured' })
      }
      const { pagoId } = data || {}
      if (!pagoId) return res.status(400).json({ error: 'Falta pagoId.' })

      const pago = await getPagoProfesional(pagoId)
      if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' })
      if (pago.profesional_id !== caller.id) return res.status(403).json({ error: 'No autorizado.' })
      if (pago.estado !== 'pagado') return res.status(400).json({ error: 'El pago no está confirmado.' })
      if (pago.alegra_factura_id) {
        return res.status(200).json({ ok: true, already: true, numero: pago.alegra_factura_numero })
      }

      try {
        const result = await emitirFacturaAlegra(pagoId)
        return res.status(200).json(result)
      } catch (err) {
        console.error('[notify] alegra_factura failed:', err?.message || err)
        // 200 + ok:false: el pago ya está hecho; la factura se puede reintentar.
        return res.status(200).json({ ok: false, error: 'No se pudo emitir la factura en Alegra.' })
      }
    }

    // ── Firma de integridad para abrir el Widget de Wompi (Fase 2) ──
    // Autenticada: solo el profesional dueño del pago pendiente. Devuelve la
    // referencia + monto + firma para que MisPagos abra el widget. La firma se
    // calcula server-side (el integrity secret NUNCA va al navegador).
    if (type === 'wompi_firma') {
      const caller = await getCallerProfile(req)
      if (!caller || !['abogado', 'contador'].includes(caller.rol)) {
        return res.status(401).json({ error: 'No autorizado.' })
      }
      if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
        return res.status(200).json({ ok: false, skipped: 'not_configured' })
      }
      const { pagoId } = data || {}
      if (!pagoId) return res.status(400).json({ error: 'Falta pagoId.' })

      const pago = await getPagoProfesional(pagoId)
      if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' })
      if (pago.profesional_id !== caller.id) return res.status(403).json({ error: 'No autorizado.' })
      if (pago.estado !== 'pendiente') return res.status(400).json({ error: 'El pago no está pendiente.' })

      // Prefijo de marca (pb_ = Parada Bridge) para diferenciar en una cuenta
      // Wompi compartida con otra marca (misma empresa/NIT).
      const reference     = `pb_pp_${pagoId}`
      const amountInCents = Math.round(Number(pago.monto) * 100)
      const currency      = 'COP'
      const integrity = crypto
        .createHash('sha256')
        .update(`${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`)
        .digest('hex')

      // Guarda la referencia (best-effort) para conciliar en el webhook.
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/pagos_profesional?id=eq.${encodeURIComponent(pagoId)}`, {
            method: 'PATCH',
            headers: svcHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ wompi_reference: reference }),
          })
        } catch { /* noop */ }
      }

      return res.status(200).json({ ok: true, publicKey: WOMPI_PUBLIC_KEY, reference, amountInCents, currency, integrity })
    }

    // (La rama 'lawyer_joined' se eliminó: era código muerto — ningún flujo
    // del frontend la llamaba — y aceptaba un correo de destino arbitrario
    // del body sin auth, es decir, un relay de spam con la marca de la firma.)

    return res.status(400).json({ error: 'Tipo de notificación no reconocido' })

  } catch (err) {
    console.error('Error enviando email:', err)
    // Sin filtrar detalles internos (SMTP/credenciales) al cliente.
    return res.status(500).json({ error: 'No se pudo enviar la notificación.' })
  }
}
