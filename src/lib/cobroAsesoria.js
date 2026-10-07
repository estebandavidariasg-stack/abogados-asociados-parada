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

// "Ochenta mil pesos m/cte": la cifra en letras, como en cualquier recibo
// colombiano. `un` y `veintiún` van apocopados porque siempre les sigue un
// sustantivo (mil, millones, pesos).
const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']
function hastaMil(n) {
  if (n === 100) return 'cien'
  const resto = n % 100
  const bajo = resto < 30 ? UNIDADES[resto] : DECENAS[Math.floor(resto / 10)] + (resto % 10 ? ` y ${UNIDADES[resto % 10]}` : '')
  return [CENTENAS[Math.floor(n / 100)], bajo].filter(Boolean).join(' ')
}
export function montoEnLetras(valor) {
  const n = Math.round(Number(valor) || 0)
  if (n <= 0 || n >= 1e9) return ''
  const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000
  const partes = []
  if (millones) partes.push(millones === 1 ? 'un millón' : `${hastaMil(millones)} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${hastaMil(miles)} mil`)
  if (resto) partes.push(hastaMil(resto))
  const texto = partes.join(' ')
  const unidad = n === 1 ? 'peso' : n % 1e6 === 0 ? 'de pesos' : 'pesos'
  return `${texto[0].toUpperCase()}${texto.slice(1)} ${unidad} m/cte`
}

/* El recibo, en una hoja de 396 × 560 pt: el ancho de media carta (el de un
   comprobante de pago de verdad) y el alto justo para lo que lleva, que es
   también la proporción que mejor se lee en la pantalla de un celular.

   Antes eran seis renglones centrados bajo el nombre de la marca: sin logo,
   sin quién pagó y —el fallo que lo delataba— con "Profesional —" cuando la
   sala no estaba en 'active'. Ahora tiene partes: quién paga y quién recibe,
   el valor en cifras y en letras, el concepto y el sello de pago confirmado.

   Devuelve los BYTES; quien lo llama decide si lo muestra, lo baja o lo
   comparte. `logoBytes` deja probarlo fuera del navegador. */
export async function generarReciboPDF({
  reciboNum, monto, fecha, nota,
  cliente = {},        // { nombre, cedula }
  profesional = {},    // { nombre, cedula, dirigidaA, cargo }
  area,
  logoBytes,
} = {}) {
  const { PDFDocument, StandardFonts, rgb, setCharacterSpacing, LineCapStyle } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const ANCHO = 396, ALTO = 560, M = 34
  const page = doc.addPage([ANCHO, ALTO])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
  const INK = hex('#472F29'), CAFE = hex('#6D3C1B'), MUTED = hex('#8A7563')
  const GOLD = hex('#C9A84C'), GOLD_DK = hex('#8A6A28'), CREMA = hex('#FBF6E7'), LINEA = hex('#E9DCC3')

  // Helvetica estándar solo trae WinAnsi: un nombre con un carácter raro (o el
  // espacio fino que algunos navegadores ponen en "1:14 p. m." y "$ 80.000")
  // haría fallar drawText y el recibo entero no saldría.
  const juego = new Set(font.getCharacterSet())
  const limpio = (t) => Array.from(String(t ?? '').replace(/[    ]/g, ' '))
    .map(ch => (juego.has(ch.codePointAt(0)) ? ch : ' ')).join('').replace(/\s+/g, ' ').trim()

  const ancho = (t, f, size, track = 0) => f.widthOfTextAtSize(t, size) + track * Math.max(0, t.length - 1)
  // `top` = distancia desde el borde superior a la línea base (así se piensa
  // una hoja: de arriba abajo). `der` alinea a la derecha de ese x.
  const escribir = (t, { x, top, size, f = font, color = INK, track = 0, der = false }) => {
    const s = limpio(t)
    if (!s) return
    if (track) page.pushOperators(setCharacterSpacing(track))
    page.drawText(s, { x: der ? x - ancho(s, f, size, track) : x, y: ALTO - top, size, font: f, color })
    if (track) page.pushOperators(setCharacterSpacing(0))
  }
  const partir = (t, f, size, max, maxLineas = 3) => {
    const lineas = []
    let actual = ''
    for (const w of limpio(t).split(' ')) {
      const prueba = actual ? `${actual} ${w}` : w
      if (ancho(prueba, f, size) > max && actual) { lineas.push(actual); actual = w } else actual = prueba
    }
    if (actual) lineas.push(actual)
    if (lineas.length > maxLineas) {
      lineas.length = maxLineas
      let ult = lineas[maxLineas - 1]
      while (ult && ancho(`${ult}...`, f, size) > max) ult = ult.slice(0, -1)
      lineas[maxLineas - 1] = `${ult.trim()}...`
    }
    return lineas
  }
  const regla = (top, color, grosor = 0.6, x0 = M, x1 = ANCHO - M) =>
    page.drawLine({ start: { x: x0, y: ALTO - top }, end: { x: x1, y: ALTO - top }, thickness: grosor, color })

  // ── Cabecera: el logo a un lado, el número y la fecha al otro ──
  let logo = null
  try {
    const bytes = logoBytes || await fetch('/logo.png').then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
    logo = await doc.embedPng(bytes)
  } catch { /* sin logo: la marca va escrita */ }
  if (logo) {
    const h = 50, w = h * (logo.width / logo.height)
    page.drawImage(logo, { x: M, y: ALTO - 34 - h, width: w, height: h })
  } else {
    escribir('PARADA BRIDGE', { x: M, top: 62, size: 13, f: bold, track: 1.6 })
  }
  const D = ANCHO - M
  escribir('COMPROBANTE DE PAGO', { x: D, top: 44, size: 7.4, f: bold, color: GOLD_DK, track: 1.3, der: true })
  escribir(reciboNum ? `N.° ${reciboNum}` : 'Asesoría', { x: D, top: 63, size: 15, f: bold, der: true })
  const cuando = fecha ? new Date(fecha) : new Date()
  const fechaTxt = Number.isNaN(cuando.getTime()) ? '' :
    `${cuando.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} · ` +
    cuando.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  escribir(fechaTxt, { x: D, top: 78, size: 8.6, color: MUTED, der: true })
  regla(100, GOLD, 1)

  // ── El valor: en cifras, en letras, y el sello de pago confirmado ──
  escribir('Valor pagado', { x: M, top: 126, size: 9, color: MUTED })
  escribir(COP.format(Number(monto) || 0), { x: M, top: 164, size: 36, f: bold })
  let top = 181
  for (const l of partir(montoEnLetras(monto), font, 9.2, 214, 2)) { escribir(l, { x: M, top, size: 9.2, color: CAFE }); top += 12 }

  const cx = D - 15, cTop = 143
  page.drawCircle({ x: cx, y: ALTO - cTop, size: 15, color: INK })
  const trazo = { thickness: 2.2, color: GOLD, lineCap: LineCapStyle.Round }
  page.drawLine({ start: { x: cx - 6.2, y: ALTO - cTop - 0.4 }, end: { x: cx - 2, y: ALTO - cTop - 4.6 }, ...trazo })
  page.drawLine({ start: { x: cx - 2, y: ALTO - cTop - 4.6 }, end: { x: cx + 6.4, y: ALTO - cTop + 4.4 }, ...trazo })
  escribir('Pago confirmado', { x: D, top: 173, size: 8.8, f: bold, der: true })
  escribir('por el profesional', { x: D, top: 184, size: 8.2, color: MUTED, der: true })

  // ── Las partes: quién pagó y quién recibió ──
  // Dos columnas dentro del panel: 16 de aire a cada lado y 16 entre ellas.
  const COL = (ANCHO - 2 * M - 48) / 2
  const X1 = M + 16, X2 = X1 + COL + 16
  const bloque = (titulo, nombre, lineas) => ({
    titulo,
    // Hasta tres líneas: el nombre de una persona no se corta en su recibo.
    nombre: partir(nombre || 'Sin registrar', bold, 11.2, COL, 3),
    lineas: lineas.filter(Boolean).flatMap(l => partir(l, font, 8.8, COL, 2)),
  })
  const cedula = (c) => (String(c ?? '').replace(/\D/g, '') ? `C.C. ${String(c).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '')
  const paga = bloque('PAGADO POR', cliente.nombre || 'Cliente', [cedula(cliente.cedula)])
  const recibe = bloque('RECIBIDO POR', profesional.nombre, [
    cedula(profesional.cedula),
    profesional.dirigidaA ? `Dirigida a ${profesional.dirigidaA}` : '',
    profesional.dirigidaA ? profesional.cargo : '',
  ])
  const altoBloque = (b) => 30 + b.nombre.length * 14 + b.lineas.length * 12
  const pTop = Math.max(206, top + 8)
  const pAlto = Math.max(altoBloque(paga), altoBloque(recibe)) + 10
  const r = 8, w = ANCHO - 2 * M
  page.drawSvgPath(
    `M ${r},0 H ${w - r} Q ${w},0 ${w},${r} V ${pAlto - r} Q ${w},${pAlto} ${w - r},${pAlto} H ${r} Q 0,${pAlto} 0,${pAlto - r} V ${r} Q 0,0 ${r},0 Z`,
    { x: M, y: ALTO - pTop, color: CREMA },
  )
  for (const [b, x] of [[paga, X1], [recibe, X2]]) {
    let t = pTop + 20
    escribir(b.titulo, { x, top: t, size: 7.2, f: bold, color: GOLD_DK, track: 1.1 })
    t += 17
    for (const l of b.nombre) { escribir(l, { x, top: t, size: 11.2, f: bold }); t += 14 }
    t -= 1
    for (const l of b.lineas) { escribir(l, { x, top: t, size: 8.8, color: MUTED }); t += 12 }
  }

  // ── El detalle, en filas con su línea ──
  const filas = [
    ['Concepto', nota ? `Asesoría profesional · ${nota}` : 'Asesoría profesional'],
    area ? ['Área', area] : null,
    ['Forma de pago', 'Directo al profesional'],
  ].filter(Boolean)
  top = pTop + pAlto + 26
  filas.forEach(([rotulo, valor], i) => {
    const lineas = partir(valor, font, 10.2, ANCHO - 2 * M - 96, 3)
    escribir(rotulo, { x: M, top, size: 9, color: MUTED })
    lineas.forEach((l, j) => escribir(l, { x: M + 96, top: top + j * 13.5, size: 10.2 }))
    top += lineas.length * 13.5
    if (i < filas.length - 1) { regla(top - 1, LINEA); top += 17 }
  })

  // ── El pie, anclado abajo ──
  regla(ALTO - 88, LINEA)
  const aviso = partir(
    'Comprobante interno. No es factura electrónica. El servicio fue prestado y cobrado directamente por el profesional. Parada Bridge no intermedia el pago.',
    font, 7.9, ANCHO - 2 * M, 4,
  )
  aviso.forEach((l, i) => escribir(l, { x: M, top: ALTO - 72 + i * 10.8, size: 7.9, color: MUTED }))
  escribir('paradabridge.com', { x: M, top: ALTO - 30, size: 8, f: bold, color: CAFE })

  doc.setTitle(`Comprobante de pago${reciboNum ? ` ${reciboNum}` : ''}`)
  doc.setAuthor('Parada Bridge')
  return await doc.save()
}
