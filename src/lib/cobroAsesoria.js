// ─────────────────────────────────────────────────────────────────────────
//  Cobro de asesoría manual (cliente → profesional) — lógica compartida.
//  La usa el dashboard del profesional (LawyerChatDashboard / ContadorChatDashboard)
//  y el chat del cliente (ChatSection). No renderiza UI.
//
//  · El profesional (autenticado) fija/confirma el cobro con getAuthHeaders().
//  · El cliente (anónimo) consulta/marca su pago con la anon key + p_client_token
//    (hash de cédula = chat_rooms.client_cedula), igual que mis_salas/estado_sala.
//  · El recibo PDF se genera con pdf-lib mediante import dinámico, para no
//    arrastrar la librería al bundle público.
// ─────────────────────────────────────────────────────────────────────────
import { getAuthHeaders, ensureChatToken } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Pesos colombianos, sin decimales.
export const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
})

// Formatea dígitos con separador de miles es-CO ("80000" → "80.000").
export function formatMiles(v) {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''
}
// Convierte un texto con separadores de vuelta a número ("80.000" → 80000).
export function parseMiles(v) {
  return Number(String(v ?? '').replace(/\D/g, '')) || 0
}

// Rango del cobro de una consulta, de ABOGADO o de CONTADOR. NO es una
// sugerencia: es lo que el profesional acepta al registrarse y lo que valida su
// formulario de cobro (piso y techo). Vive aquí, en un solo sitio, para que
// cambiarlo sea cambiar un número: lo leen los avisos al cliente, la
// validación del cobro, las condiciones del registro y el mensaje de
// bienvenida que manda el administrador al aprobar.
// (El correo de bienvenida sale de api/notify.js, que no puede importar este
// módulo: allá están los mismos dos números, hay que cambiarlos a la par.)
//
// De $50.000 a $150.000 por consulta (2026-09-30; antes "desde $200.000").
// Hasta 2026-10-01 el contador cobraba sin rango; desde entonces tiene el
// mismo que el abogado.
export const COBRO_MINIMO = 50000
export const COBRO_MAXIMO = 150000
const RANGO_COBRO = `entre ${COP.format(COBRO_MINIMO)} y ${COP.format(COBRO_MAXIMO)}`

/* Devuelve '' si el valor se puede cobrar, o el motivo para mostrarlo en el
   formulario de cobro. Lo usan los paneles del abogado y del contador. */
export function validarMontoCobro(monto) {
  if (!monto || monto <= 0) return 'Ingresa el valor de la consulta.'
  if (monto < COBRO_MINIMO) return `El valor mínimo por consulta es ${COP.format(COBRO_MINIMO)}.`
  if (monto > COBRO_MAXIMO) return `El valor máximo por consulta es ${COP.format(COBRO_MAXIMO)}.`
  return ''
}

/* Aviso de apertura de la consulta: toda consulta tiene cobro. Se pinta como
   banner destacado en el chat del cliente. No se guarda como mensaje: el
   cliente no puede escribir mensajes de sistema (RLS) y así se ve siempre,
   aunque entre días después. */
export const AVISO_COBRO_CLIENTE = {
  titulo: 'Esta consulta tiene cobro',
  // El rango SÍ se dice: el cliente merece saber de qué orden de precio habla
  // antes de contar su caso. El valor exacto sigue siendo del profesional.
  // Mismo texto que AVISO_COSTO_ANTES (aprobado por la firma 2026-09-30).
  texto:
    `Entre ${COP.format(COBRO_MINIMO)} y ${COP.format(COBRO_MAXIMO)} por la consulta. ` +
    'El profesional informa el valor exacto antes de empezar. ' +
    'El pago se realiza directamente al profesional.',
}

/* Una línea para los botones que CREAN la consulta (formulario y modal de
   nueva consulta). Va ahí, y no solo dentro del chat, porque es el único
   momento en el que saber el precio todavía sirve para decidir: dentro del
   chat el cliente ya escribió su caso y ya eligió con quién hablar. */
/* La cifra va separada del resto a propósito: es el dato que decide, y en un
   párrafo corrido pesaba lo mismo que la palabra "directamente".

   Una idea por frase. La versión anterior metía cuatro en una sola oración
   (quién pone el precio, cuándo, a quién se le paga y de qué forma) y con
   tres actores enredados: "El profesional confirma el valor exacto antes de
   asesorarte y le pagas directamente a él". Además decía "confirma", que
   suena a que el precio ya se sabía; no se sabe, lo pone él. */
export const AVISO_COSTO_ANTES = {
  cifra: `Entre ${COP.format(COBRO_MINIMO)} y ${COP.format(COBRO_MAXIMO)}`,
  // Sin esto la cifra no dice de qué es: el lector tenía que deducirlo.
  sufijo: 'por la consulta',
  texto: 'El profesional informa el valor exacto antes de empezar. El pago se realiza directamente al profesional.',
}

// Este aviso lo ven SOLO los profesionales (abogado y contador). Al cliente se
// le dice el rango, no el valor: el exacto lo pone el profesional en cada caso.
export const AVISO_COBRO_PROFESIONAL = {
  titulo: 'Define el cobro antes de asesorar.',
  texto:
    `Según nuestras políticas internas, la consulta se encuentra ${RANGO_COBRO}. ` +
    'El cliente realiza el pago directamente al profesional.',
}

/* El acuerdo de cobro del mensaje de bienvenida (chat interno, AdminPage). */
export const ACUERDO_COBRO_BIENVENIDA =
  `Cobra la consulta. El valor va de ${COP.format(COBRO_MINIMO)} a ${COP.format(COBRO_MAXIMO)}: ` +
  'tú lo defines dentro de ese rango y lo confirmas con el cliente antes de empezar.'

/* Una comisión de gestor por consulta.

   La base llegó a guardar DOS para la misma consulta: una al definirse el
   cobro y otra al pagarse (pagar_pago / confirmar_pago_profesional no miraban
   si ya existía). docs/sql/cobros-2026-10-01.sql borra las repetidas y lo
   impide por índice; mientras ese SQL no esté aplicado, las pantallas que
   listan o pagan comisiones pasan por aquí para no mostrar ni pagar dos
   veces la misma. De cada consulta queda la pagada si la hay, si no la
   solicitada, si no la más antigua. Lo ya pagado nunca se oculta. */
export function unaComisionPorConsulta(cobros) {
  const lista = Array.isArray(cobros) ? cobros : []
  const peso = (c) => (c.estado === 'pagado' ? 0 : c.estado === 'solicitado' ? 1 : 2)
  const mejor = new Map()
  for (const c of lista) {
    if (!c.room_id) continue
    const m = mejor.get(c.room_id)
    if (!m || peso(c) < peso(m) || (peso(c) === peso(m) && new Date(c.created_at) < new Date(m.created_at))) {
      mejor.set(c.room_id, c)
    }
  }
  return lista.filter(c => !c.room_id || c.estado === 'pagado' || mejor.get(c.room_id) === c)
}

// Etiquetas legibles de estado (para chips).
export const ESTADO_COBRO_LABEL = {
  gratuita:  'Sin valor',   // estado heredado: ya no se crean consultas sin cobro
  pendiente: 'Pendiente de pago',
  pagado:    'Pagado',
}

// ── Profesional (autenticado) ──────────────────────────────────────────────

// Lee el cobro de asesoría de una sala (RLS: solo el profesional dueño o admin).
export async function fetchCobroProfesional(roomId) {
  const headers = await getAuthHeaders()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pagos_asesoria?room_id=eq.${roomId}&select=*&limit=1`,
    { headers }
  )
  if (!res.ok) throw new Error('No se pudo cargar el cobro')
  const data = await res.json()
  return Array.isArray(data) && data.length ? data[0] : null
}

// Fija/edita el cobro (el valor es obligatorio y mayor a 0). La cuenta para
// consignar es el certificado bancario del profesional, así que ya no se envía
// `p_datos_pago` (el RPC lo acepta opcional por compatibilidad).
// Devuelve la fila del cobro.
export async function fijarCobro({ roomId, monto, nota }) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fijar_cobro_asesoria`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_room_id: roomId,
      p_monto: Number(monto) || 0,
      p_nota: nota || null,
      p_datos_pago: null,
    }),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'No se pudo fijar el cobro'))
  const data = await res.json()
  // Las funciones que devuelven un tipo compuesto llegan como objeto o [objeto].
  return Array.isArray(data) ? data[0] : data
}

// Confirma que el cliente pagó → marca 'pagado', genera la comisión de plataforma
// y devuelve el número de recibo.
export async function confirmarPagoAsesoria(pagoId) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmar_pago_asesoria`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_pago_id: pagoId }),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'No se pudo confirmar el pago'))
  return await res.json()   // recibo_num (text)
}

// ── Cliente (anónimo, vía p_client_token) ──────────────────────────────────

function anonHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
}

// Devuelve el cobro de la sala del cliente (o null). clientToken = hash de cédula.
export async function fetchCobroCliente(roomId, clientToken) {
  if (!roomId || !clientToken) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cobro_de_sala`, {
      method: 'POST',
      headers: anonHeaders(),
      body: JSON.stringify({ p_client_token: clientToken, p_room_id: roomId }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) && data.length ? data[0] : null
  } catch { return null }
}

// El cliente marca "Ya pagué" adjuntando su comprobante (path en chat-files).
// Devuelve true si quedó registrado. El comprobante es obligatorio en la UI
// (transparencia cliente ↔ profesional); la RPC lo persiste en la fila.
export async function clienteMarcoPago(roomId, clientToken, comprobantePath = null) {
  const body = { p_client_token: clientToken, p_room_id: roomId }
  if (comprobantePath) body.p_comprobante_path = comprobantePath
  let res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cliente_marco_pago`, {
    method: 'POST',
    headers: anonHeaders(),
    body: JSON.stringify(body),
  })
  // Compat: si la RPC de 3 args aún no está aplicada, reintenta con la de 2.
  if (!res.ok && comprobantePath) {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cliente_marco_pago`, {
      method: 'POST',
      headers: anonHeaders(),
      body: JSON.stringify({ p_client_token: clientToken, p_room_id: roomId }),
    })
  }
  if (!res.ok) throw new Error('No se pudo registrar tu pago')
  return await res.json() === true
}

// Sube el comprobante de pago del cliente al bucket chat-files (misma ruta y
// permisos que los adjuntos del chat). Devuelve el path o null.
// CAUSA del "No se pudo subir el comprobante": esta función subía con la ANON
// KEY, y desde el hardening del bucket chat-files (2026-09-04) la política solo
// acepta subidas a `chats/…` con sesión o con el JWT del cliente — la anon key
// recibe 403 "violates row-level security policy". Igual que los adjuntos del
// chat: se renueva el JWT del cliente y se usa getAuthHeaders()
// (sesión → JWT del cliente → anon key).
export async function subirComprobanteCliente(roomId, file, clientToken) {
  try {
    const hash = clientToken || localStorage.getItem('chat_cedula_hash')
    await ensureChatToken(hash)
    const headers = await getAuthHeaders()
    const safe = (file.name || 'comprobante').replace(/[^\w.\-]+/g, '_').slice(0, 60)
    const path = `chats/${roomId}/comprobante_${Date.now()}_${safe}`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true',
      },
      body: file,
    })
    if (!res.ok) {
      console.error('[cobro] subida del comprobante rechazada:', res.status, await res.text().catch(() => ''))
      return null
    }
    return path
  } catch { return null }
}

// ── Recibo PDF (pdf-lib, import dinámico) ───────────────────────────────────
//  Comprobante interno — NO es factura electrónica.
export async function descargarReciboPDF({ reciboNum, monto, nota, profesionalNombre, profesionalCedula, fecha }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 560])
  const font  = await doc.embedFont(StandardFonts.Helvetica)
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold)

  const ink  = rgb(0.28, 0.18, 0.15)   // #472F29 aprox
  const gold = rgb(0.79, 0.66, 0.30)   // dorado
  const grey = rgb(0.42, 0.38, 0.34)

  const { width } = page.getSize()
  let y = 500

  const center = (text, f, size, color) => {
    const w = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (width - w) / 2, y, size, font: f, color })
  }
  const line = (label, value) => {
    page.drawText(label, { x: 40, y, size: 10, font, color: grey })
    page.drawText(value, { x: 190, y, size: 11, font: bold, color: ink })
    y -= 26
  }

  center('PARADA BRIDGE', bold, 18, ink); y -= 24
  center('Comprobante de pago de asesoría', font, 11, grey); y -= 34

  // Regla dorada
  page.drawRectangle({ x: 40, y: y + 6, width: width - 80, height: 2, color: gold }); y -= 24

  line('Recibo N°', reciboNum || '—')
  line('Fecha', fecha || new Date().toLocaleString('es-CO'))
  line('Profesional', profesionalNombre || '—')
  if (profesionalCedula) line('Cédula', String(profesionalCedula))
  if (nota) line('Concepto', String(nota).slice(0, 40))
  y -= 4
  page.drawRectangle({ x: 40, y: y + 6, width: width - 80, height: 1, color: rgb(0.85, 0.82, 0.75) }); y -= 24

  page.drawText('Valor pagado', { x: 40, y, size: 12, font: bold, color: ink })
  const montoStr = COP.format(Number(monto) || 0)
  const mw = bold.widthOfTextAtSize(montoStr, 16)
  page.drawText(montoStr, { x: width - 40 - mw, y: y - 2, size: 16, font: bold, color: ink })
  y -= 60

  const disclaimer = [
    'Comprobante interno — NO es factura electrónica.',
    'El servicio fue prestado y cobrado directamente por el',
    'profesional. Parada Bridge no intermedia el pago.',
  ]
  for (const t of disclaimer) {
    page.drawText(t, { x: 40, y, size: 8.5, font, color: grey }); y -= 14
  }

  const bytes = await doc.save()
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recibo-${reciboNum || 'asesoria'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
