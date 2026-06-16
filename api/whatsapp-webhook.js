// ───────────────────────────────────────────────────────────────────────────
// /api/whatsapp-webhook.js
//
// Webhook de WhatsApp Cloud API (Meta) para AAP (Abogados y Asociados Parada).
//
// Qué hace:
//   • GET  → handshake de verificación con Meta (hub.challenge).
//   • POST → recibe mensajes entrantes, corre una MÁQUINA DE ESTADOS con
//            ACUMULACIÓN y responde por WhatsApp.
//
// Diseño:
//   • Sin dependencias externas: usa `fetch` nativo (Node 18+).
//   • Persistencia en Supabase vía REST directo (mismo patrón que
//     api/notify.js -> resolveProfessionalEmail), con la SERVICE_ROLE_KEY.
//   • SIEMPRE responde 200 a Meta en el POST, aunque algo falle internamente,
//     para no entrar en bucles de reintento.
// ───────────────────────────────────────────────────────────────────────────

// ── Variables de entorno (ya configuradas en Vercel) ───────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const WHATSAPP_TOKEN           = process.env.WHATSAPP_TOKEN
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const WHATSAPP_VERIFY_TOKEN    = process.env.WHATSAPP_VERIFY_TOKEN

// Versión de la Graph API usada para enviar mensajes.
const GRAPH_API_VERSION = 'v21.0'

// ── Textos exactos de las respuestas ───────────────────────────────────────
const MENU_PRINCIPAL =
`👋 Bienvenido/a a Abogados y Asociados Parada.
Horario de atención: lunes a viernes, 8:00 a.m. a 6:00 p.m.

Responde con el número de la opción que necesitas:

1️⃣ Hablar con un abogado o contador
2️⃣ Radicar una PQRSD (Petición, Queja, Reclamo, Sugerencia o Denuncia)

Este es un canal informativo y no constituye asesoría legal. Tus datos serán tratados conforme a la Ley 1581 de 2012 (habeas data).`

const RESPUESTA_OPCION_1 =
`✅ Has elegido *Hablar con un abogado o contador*.

Cuéntanos tu caso. Puedes escribir varios mensajes con todos los detalles que necesites; los iremos recibiendo. Un miembro de nuestro equipo lo revisará y te contactará dentro del horario de atención (L-V, 8:00 a.m. a 6:00 p.m.).

Este canal no constituye asesoría legal hasta que un profesional asuma tu caso.`

const RESPUESTA_OPCION_2 =
`✅ Has elegido *Radicar una PQRSD*.

Describe tu Petición, Queja, Reclamo, Sugerencia o Denuncia. Puedes escribir varios mensajes; recuerda incluir tu nombre completo.

Tu solicitud será radicada y respondida en un plazo máximo de 15 días hábiles, conforme a la ley.

Tus datos serán tratados conforme a la Ley 1581 de 2012 (habeas data).`

const RESPUESTA_ACUMULANDO =
`✅ Recibido. Puedes seguir agregando detalles si lo necesitas. Nuestro equipo revisará tu caso y te contactará dentro del horario de atención.`

const RESPUESTA_ACUMULANDO_PQRSD =
`✅ Recibido. Puedes seguir agregando detalles si lo necesitas. Tu solicitud será radicada y respondida en un plazo máximo de 15 días hábiles.`

// ── Helpers de Supabase (REST directo) ─────────────────────────────────────
// Cabeceras comunes: la SERVICE_ROLE_KEY va tanto en apikey como en el Bearer.
function supabaseHeaders(extra = {}) {
  return {
    apikey:        SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

// Lee el estado de conversación de un número. Devuelve { estado, caso_actual_id }
// o null si no existe / si algo falla.
async function getConversation(wa_id) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/wa_conversations` +
      `?wa_id=eq.${encodeURIComponent(wa_id)}` +
      `&select=estado,caso_actual_id&limit=1`
    const res = await fetch(url, { headers: supabaseHeaders() })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  } catch (err) {
    console.error('[wa-webhook] getConversation falló:', err)
    return null
  }
}

// Upsert del estado de conversación (merge por wa_id, que es la PK).
async function setEstado(wa_id, estado, caso_actual_id) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const url = `${SUPABASE_URL}/rest/v1/wa_conversations?on_conflict=wa_id`
    await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        wa_id,
        estado,
        caso_actual_id: caso_actual_id ?? null,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch (err) {
    console.error('[wa-webhook] setEstado falló:', err)
  }
}

// Crea un caso nuevo (asesoria | pqrsd) y devuelve su id (o null si falla).
async function crearCaso(wa_id, tipo) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const url = `${SUPABASE_URL}/rest/v1/wa_casos`
    const res = await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ wa_id, tipo, mensaje: '' }),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows[0] ? rows[0].id : null
  } catch (err) {
    console.error('[wa-webhook] crearCaso falló:', err)
    return null
  }
}

// Acumula texto en un caso existente: lee el mensaje actual, concatena con
// salto de línea y hace PATCH. Mantiene un historial creciente del caso.
async function appendCaso(caso_id, textoNuevo) {
  if (!caso_id || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return
  try {
    // 1) Leer el mensaje actual.
    const getUrl =
      `${SUPABASE_URL}/rest/v1/wa_casos` +
      `?id=eq.${encodeURIComponent(caso_id)}` +
      `&select=mensaje&limit=1`
    const getRes = await fetch(getUrl, { headers: supabaseHeaders() })
    let mensajeActual = ''
    if (getRes.ok) {
      const rows = await getRes.json()
      if (Array.isArray(rows) && rows[0] && rows[0].mensaje) {
        mensajeActual = rows[0].mensaje
      }
    }

    // 2) Concatenar y guardar.
    const nuevoMensaje = (mensajeActual ? mensajeActual + '\n' : '') + textoNuevo
    const patchUrl =
      `${SUPABASE_URL}/rest/v1/wa_casos?id=eq.${encodeURIComponent(caso_id)}`
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        mensaje: nuevoMensaje,
        updated_at: new Date().toISOString(),
      }),
    })
  } catch (err) {
    console.error('[wa-webhook] appendCaso falló:', err)
  }
}

// ── Envío de mensajes de WhatsApp (texto plano) ────────────────────────────
async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error('[wa-webhook] Faltan credenciales de WhatsApp; no se envía.')
    return
  }
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
      `${WHATSAPP_PHONE_NUMBER_ID}/messages`
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    })
  } catch (err) {
    // Logueamos pero NO relanzamos: un fallo de envío no debe romper el 200.
    console.error('[wa-webhook] sendWhatsAppText falló:', err)
  }
}

// ── Extrae el texto del mensaje entrante según su tipo ──────────────────────
function extraerTexto(msg) {
  if (!msg) return ''
  if (msg.type === 'text') {
    return (msg.text?.body || '').trim()
  }
  if (msg.type === 'interactive') {
    return (
      msg.interactive?.button_reply?.id ||
      msg.interactive?.list_reply?.id ||
      ''
    ).trim()
  }
  return ''
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── 1) GET: verificación del webhook (handshake con Meta) ──
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      // Meta espera el challenge en texto plano con 200.
      return res.status(200).send(String(challenge ?? ''))
    }
    return res.status(403).end()
  }

  // ── 2) POST: mensajes entrantes ──
  if (req.method === 'POST') {
    try {
      // Extracción defensiva del payload de Meta.
      const value = req.body?.entry?.[0]?.changes?.[0]?.value
      const msg   = value?.messages?.[0]

      // Sin mensaje (eventos de status/delivery, etc.) → 200 y fin.
      if (!msg) {
        return res.status(200).json({ ok: true })
      }

      const from  = msg.from
      const texto = extraerTexto(msg)

      // Estado actual del número (o valores por defecto si no existe).
      const conv     = await getConversation(from)
      const estado   = conv?.estado || 'inicio'
      const casoId   = conv?.caso_actual_id || null

      // ── Máquina de estados con acumulación (Opción 3) ──

      // a) Opción 1: hablar con abogado/contador → nuevo caso 'asesoria'.
      if (texto === '1') {
        const nuevoId = await crearCaso(from, 'asesoria')
        await setEstado(from, 'esperando_caso', nuevoId)
        await sendWhatsAppText(from, RESPUESTA_OPCION_1)
        return res.status(200).json({ ok: true })
      }

      // b) Opción 2: radicar PQRSD → nuevo caso 'pqrsd'.
      if (texto === '2') {
        const nuevoId = await crearCaso(from, 'pqrsd')
        await setEstado(from, 'esperando_pqrsd', nuevoId)
        await sendWhatsAppText(from, RESPUESTA_OPCION_2)
        return res.status(200).json({ ok: true })
      }

      // c) Acumulando un caso de asesoría (texto no vacío y con caso abierto).
      if (estado === 'esperando_caso' && texto !== '' && casoId) {
        await appendCaso(casoId, texto)
        // Mantiene el estado: el cliente puede seguir escribiendo.
        await setEstado(from, 'esperando_caso', casoId)
        await sendWhatsAppText(from, RESPUESTA_ACUMULANDO)
        return res.status(200).json({ ok: true })
      }

      // d) Acumulando una PQRSD (texto no vacío y con caso abierto).
      if (estado === 'esperando_pqrsd' && texto !== '' && casoId) {
        await appendCaso(casoId, texto)
        await setEstado(from, 'esperando_pqrsd', casoId)
        await sendWhatsAppText(from, RESPUESTA_ACUMULANDO_PQRSD)
        return res.status(200).json({ ok: true })
      }

      // e) Cualquier otro caso (estado 'inicio', texto vacío, saludo no
      //    reconocido, o un estado 'esperando_*' sin caso_actual_id válido):
      //    mostramos el menú y reseteamos a 'inicio'.
      await sendWhatsAppText(from, MENU_PRINCIPAL)
      await setEstado(from, 'inicio', null)
      return res.status(200).json({ ok: true })
    } catch (err) {
      // SIEMPRE 200: evita que Meta reintente en bucle.
      console.error('[wa-webhook] error en POST:', err)
      return res.status(200).json({ ok: true })
    }
  }

  // ── Otros métodos ──
  return res.status(405).end()
}
