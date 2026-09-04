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
import { getAuthHeaders } from './supabase'

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

// Etiquetas legibles de estado (para chips).
export const ESTADO_COBRO_LABEL = {
  gratuita:  'Gratuita',
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

// Fija/edita el cobro (monto <= 0 → gratuita). Persiste datos_pago en el perfil
// si se envía uno nuevo. Devuelve la fila del cobro.
export async function fijarCobro({ roomId, monto, nota, datosPago }) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fijar_cobro_asesoria`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_room_id: roomId,
      p_monto: Number(monto) || 0,
      p_nota: nota || null,
      p_datos_pago: datosPago || null,
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
export async function subirComprobanteCliente(roomId, file) {
  try {
    const safe = (file.name || 'comprobante').replace(/[^\w.\-]+/g, '_').slice(0, 60)
    const path = `chats/${roomId}/comprobante_${Date.now()}_${safe}`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true',
      },
      body: file,
    })
    return res.ok ? path : null
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
