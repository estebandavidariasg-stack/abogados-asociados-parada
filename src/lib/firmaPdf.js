/* ─────────────────────────────────────────────────────────────────────────
   Motor de firma electrónica — corre 100% en el navegador (sin servidor).

   Usa pdf-lib para:
     · estamparFirma()      — pone la firma manuscrita (PNG) en el PDF. Si el
                              documento trae su espacio de firma ("EL CLIENTE /
                              Nombre: … / C.C.: …") la firma va AHÍ y el nombre
                              y el número se escriben en sus renglones
                              (lib/firmaCampos lo localiza). Si no lo trae,
                              dibuja el bloque clásico: firma + PIE DE FIRMA.
     · anexarCertificado()  — agrega la página "Certificado de Firma Electrónica"
                              con la traza de cada firmante y el hash del doc.
     · hashDocumento()      — SHA-256 del PDF (prueba de integridad).

   Todo el color/tipografía sigue la marca Parada Bridge (café + dorado). Sin marca de agua.
   Ver docs/superpowers/specs/2026-07-10-firma-electronica-design.md
   ───────────────────────────────────────────────────────────────────────── */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

// ── Paleta de marca (en escala 0–1 que usa pdf-lib) ──────────────────────
const NAVY = rgb(0x0d / 255, 0x2d / 255, 0x5e / 255)
const NAVY_MD = rgb(0x1a / 255, 0x52 / 255, 0x76 / 255)
const GOLD = rgb(0xc9 / 255, 0xa8 / 255, 0x4c / 255)
const GOLD_DK = rgb(0x8a / 255, 0x6a / 255, 0x28 / 255)
const INK = rgb(0.12, 0.14, 0.2)
const MUTED = rgb(0x4a / 255, 0x60 / 255, 0x80 / 255)
const HAIRLINE = rgb(0.82, 0.85, 0.9)
const PAPER = rgb(0.98, 0.97, 0.95)
const BLACK = rgb(0, 0, 0)

const A4 = { w: 595.28, h: 841.89 }

// Etiqueta legible por rol para "En calidad de".
export const ROL_LABEL = {
  cliente: 'Cliente',
  abogado: 'Abogado(a)',
  contador: 'Contador(a)',
  administrador: 'Administrador(a)',
}

/* WinAnsi (Helvetica) no cubre todo Unicode: saneamos para nunca lanzar al
   dibujar. Reemplaza cualquier carácter fuera de Latin-1 y normaliza espacios. */
function safe(text) {
  if (text == null) return ''
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\xFF]/g, '') // fuera de Latin-1 → se descarta
}

/* SHA-256 en hex. Funciona en navegador y en Node ≥18 (globalThis.crypto). */
export async function hashDocumento(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fmtFechaLarga(iso) {
  const d = iso ? new Date(iso) : new Date()
  try {
    return d.toLocaleString('es-CO', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString()
  }
}

/* Formatea la cédula con separadores de miles (1020345678 → 1.020.345.678). */
function fmtCedula(c) {
  const digits = String(c || '').replace(/\D/g, '')
  if (!digits) return String(c || '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/* Un texto que debe caber en `maxW`: primero se achica la letra (hasta
   `minimo`) y, si aun así no cabe, se recorta. Un correo largo en una hoja
   angosta se salía de su columna y pisaba la firma de al lado. */
function ajustar(font, texto, size, maxW, minimo = 6) {
  let t = safe(texto)
  let s = size
  while (s > minimo && font.widthOfTextAtSize(t, s) > maxW) s -= 0.5
  if (font.widthOfTextAtSize(t, s) > maxW) {
    while (t.length > 3 && font.widthOfTextAtSize(`${t}...`, s) > maxW) t = t.slice(0, -1)
    t = `${t.trimEnd()}...`
  }
  return { t, s }
}

// Medidas del bloque clásico para una letra dada (12 en carta/A4).
const altoImagenBloque = (size) => 5 * size
const interlineaBloque = (size) => size * 1.25
// Imagen + raya + hasta 7 renglones (la ciudad y la fecha pueden ir en dos).
const altoBloque = (size) => altoImagenBloque(size) + 16 + 7 * interlineaBloque(size)

/* ── Bloque de firma: imagen + pie de firma (7 campos) ────────────────────
   Dibuja en `page` anclado en (x, y) donde y es la base del bloque de texto:
   la imagen queda encima de la raya y los renglones debajo. `anchoFirma` es
   el ancho de la columna (nada se sale de ahí) y `size` el de la letra. */
function dibujarBloqueFirma(page, { img, pie, font, fontBold, x, y, anchoFirma = 150, size = 12 }) {
  const line = interlineaBloque(size)
  const fecha = fmtFechaLarga(pie.fecha)
  const lugarYFecha = `${safe(pie.ciudad)}, ${fecha}`
  const lines = [
    { t: pie.nombre, bold: true },
    { t: `C.C. ${fmtCedula(pie.cedula)}` },
    { t: `Tel. ${pie.telefono || ''}` },
    { t: pie.correo },
    // Ciudad y fecha en un renglón si caben; si no, uno para cada una.
    ...(font.widthOfTextAtSize(safe(lugarYFecha), size) <= anchoFirma
      ? [{ t: lugarYFecha }]
      : [{ t: pie.ciudad }, { t: fecha }]),
    { t: `En calidad de: ${ROL_LABEL[pie.rol] || safe(pie.rol) || 'Firmante'}`, bold: true },
  ]

  // La firma (imagen) va ENCIMA de la línea; el texto DEBAJO.
  if (img) {
    const scale = Math.min(anchoFirma / img.width, altoImagenBloque(size) / img.height)
    page.drawImage(img, { x, y: y + 8, width: img.width * scale, height: img.height * scale })
  }
  // Línea divisoria estilo "firma manuscrita" (negra).
  page.drawLine({
    start: { x, y: y + 4 },
    end: { x: x + anchoFirma, y: y + 4 },
    thickness: 0.8,
    color: BLACK,
  })

  let cy = y - 8
  for (const l of lines) {
    const f = l.bold ? fontBold : font
    const { t, s } = ajustar(f, l.t, size, anchoFirma)
    page.drawText(t, { x, y: cy, size: s, font: f, color: BLACK })
    cy -= line
  }
}

/* La firma dibujada llega como el lienzo ENTERO (transparente, con el trazo
   en algún punto del medio). Para ponerla en el espacio de firma del
   documento se recorta al trazo: si no, lo que se vería sería un garabato
   diminuto dentro de una caja vacía. Solo en navegador; ante cualquier
   tropiezo devuelve la imagen tal cual. */
async function recortarFirma(src) {
  if (typeof document === 'undefined' || typeof src !== 'string') return src
  try {
    const im = new Image()
    im.src = src
    await im.decode()
    const c = document.createElement('canvas')
    c.width = im.naturalWidth
    c.height = im.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(im, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] <= 12) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 - x0 < 16 || y1 - y0 < 8) return src       // vacío o un punto: no vale la pena
    const m = 3
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m)
    x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m)
    const out = document.createElement('canvas')
    out.width = x1 - x0 + 1
    out.height = y1 - y0 + 1
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  } catch {
    return src
  }
}

const tono = ([r, g, b]) => rgb(r / 255, g / 255, b / 255)

// El dato del pie de firma que va en cada renglón del documento.
function valorDeCampo(tipo, pie) {
  if (tipo === 'nombre') return safe(pie.nombre)
  if (tipo === 'cedula') return fmtCedula(pie.cedula)
  if (tipo === 'telefono') return safe(pie.telefono)
  if (tipo === 'correo') return safe(pie.correo)
  if (tipo === 'ciudad') return safe(pie.ciudad)
  if (tipo === 'fecha') {
    try { return new Date(pie.fecha || Date.now()).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
    catch { return '' }
  }
  return ''
}

/* ── La firma en el espacio que trae el documento ─────────────────────────
   `campo` viene de lib/firmaCampos: la caja para el dibujo y los renglones
   por llenar. El marcador "(NOMBRE COMPLETO)" se tapa con el color del papel
   y encima se escribe el dato, con la tinta y el tamaño del documento. */
async function firmarEnCampo(pdf, campo, { firmaPng, pie }) {
  const page = pdf.getPages()[campo.pagina]
  const { width } = page.getSize()
  const font = await pdf.embedFont(campo.familia === 'sans' ? StandardFonts.Helvetica : StandardFonts.TimesRoman)
  const tinta = tono(campo.tinta)
  const papel = tono(campo.fondo)

  for (const c of campo.campos) {
    const valor = valorDeCampo(c.tipo, pie)
    if (!valor) continue
    let x = c.x
    if (c.parte) {
      // Dónde empieza el valor dentro del trozo del PDF: proporción medida
      // con la letra, aplicada al ancho real del trozo.
      const { str, corte, w } = c.parte
      const entero = font.widthOfTextAtSize(safe(str), c.size) || 1
      x = c.parte.x + w * (font.widthOfTextAtSize(safe(str.slice(0, corte)), c.size) / entero)
    }
    if (c.cubrir) {
      page.drawRectangle({
        x: x - 0.4, y: c.y - 0.27 * c.size,
        width: c.x1 - x + 1.6, height: 1.17 * c.size,
        color: papel,
      })
    }
    const { t, s } = ajustar(font, valor, c.size, width - x - 1.5 * c.size, c.size * 0.7)
    page.drawText(t, { x, y: c.y, size: s, font, color: tinta })
  }

  if (firmaPng) {
    const img = await pdf.embedPng(await toBytes(await recortarFirma(firmaPng)))
    const f = campo.firma
    const ar = img.width / img.height
    let h = f.h
    let w = h * ar
    if (w > f.wMax) { w = f.wMax; h = w / ar }
    // Junto a la etiqueta va centrada en su caja; sobre la raya o debajo de
    // la etiqueta, apoyada abajo.
    page.drawImage(img, { x: f.x, y: f.y + (f.modo === 'derecha' ? (f.h - h) / 2 : 0), width: w, height: h })
  }
}

/* ── Bloque clásico, para documentos sin espacio de firma ─────────────────
   Va debajo del texto de la última página con contenido (nunca sobre una
   contraportada) y, si ahí no cabe, en una hoja nueva. Cada firma ocupa una
   casilla: izquierda, derecha, y luego la fila siguiente. La casilla usada se
   apunta en los metadatos del PDF (palabras clave) para que quien firme
   después quede AL LADO y no encima, que era lo que pasaba. */
const MARCA_FIRMAS = /pbfirma:(\d+):(\d+):(\d+)/
const entre = (v, a, b) => Math.max(a, Math.min(b, v))

async function firmarEnBloque(pdf, hoja, { img, pie }) {
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const claves = pdf.getKeywords() || ''
  const previo = MARCA_FIRMAS.exec(claves)

  let pages = pdf.getPages()
  const medidas = (page) => {
    const { width: W, height: H } = page.getSize()
    const size = entre(Math.round(W / 52), 8, 12)      // 12 en carta, 8 en media carta
    const M = entre(W * 0.09, 28, 56)
    const sep = 16
    return { W, H, size, M, sep, colW: (W - 2 * M - sep) / 2, alto: altoBloque(size), piso: Math.max(36, H * 0.1) }
  }

  let idx, yTop, n
  if (previo && +previo[1] < pages.length) {
    idx = +previo[1]; yTop = +previo[2]; n = +previo[3]
  } else if (hoja) {
    idx = hoja.pagina; n = 0
    yTop = hoja.yMin - 2 * interlineaBloque(medidas(pages[idx]).size)
  } else {
    // PDF sin texto (un escaneo): no se sabe dónde termina el contenido. Abajo
    // a la izquierda de la última página, como siempre.
    idx = pages.length - 1; n = 0
    const m = medidas(pages[idx])
    yTop = 140 + 8 + altoImagenBloque(m.size)
  }

  let m = medidas(pages[idx])
  let top = yTop - Math.floor(n / 2) * (m.alto + 12)
  if ((hoja || previo) && top - m.alto < m.piso) {
    // No cabe: hoja de firmas nueva, justo después (antes de la contraportada).
    pdf.insertPage(idx + 1, [m.W, m.H])
    pages = pdf.getPages()
    idx += 1; n = 0
    m = medidas(pages[idx])
    yTop = m.H - m.M
    top = yTop
  }

  dibujarBloqueFirma(pages[idx], {
    img, pie, font, fontBold, size: m.size, anchoFirma: m.colW,
    x: m.M + (n % 2) * (m.colW + m.sep),
    y: top - 8 - altoImagenBloque(m.size),
  })
  const resto = claves.replace(MARCA_FIRMAS, '').trim()
  pdf.setKeywords([resto, `pbfirma:${idx}:${Math.round(yTop)}:${n + 1}`].filter(Boolean))
}

/* ── estamparFirma ────────────────────────────────────────────────────────
   Pone la firma en el PDF.
   `firmaPng`  : Uint8Array | ArrayBuffer | dataURL string del PNG del lienzo.
   `pie`       : { nombre, cedula, telefono, correo, ciudad, fecha, rol }
   `posicion`  : { pagina (1-based, 0 = última), x, y } en puntos. Opcional.
                 SIN posición (lo normal) la firma se ubica sola:
                   1. en el espacio de firma del documento, según `pie.rol`
                      (el dibujo junto a "EL CLIENTE" y el nombre y el número
                      en sus renglones);
                   2. si el documento no lo trae, el bloque clásico (firma +
                      pie de firma) debajo del texto o en una hoja nueva.
                 CON posición se dibuja el bloque clásico exactamente ahí.
   `soloFirma` : si es true, estampa ÚNICAMENTE el dibujo de la firma (sin línea
                 ni pie de firma) con ancho `anchoFirma` (puntos). (x, y) es la
                 esquina inferior-izquierda de la imagen.
   Devuelve Uint8Array del PDF con la firma estampada. */
export async function estamparFirma(pdfBytes, { firmaPng, pie, posicion = {}, soloFirma = false, anchoFirma }) {
  const pdf = await PDFDocument.load(pdfBytes)
  const pages = pdf.getPages()
  const fija = posicion.x != null && posicion.y != null

  if (!soloFirma && !fija) {
    // Dónde firmar lo dice el propio documento. La lectura usa pdf.js y el
    // lienzo: fuera del navegador (o ante un PDF raro) no hay análisis y se
    // cae al bloque clásico en su sitio de siempre.
    let analisis = null
    try {
      const { analizarParaFirma } = await import('./firmaCampos.js')
      analisis = await analizarParaFirma(pdfBytes, pie?.rol)
    } catch { /* sin análisis */ }
    if (analisis?.campo) {
      await firmarEnCampo(pdf, analisis.campo, { firmaPng, pie })
    } else {
      const img = firmaPng ? await pdf.embedPng(await toBytes(await recortarFirma(firmaPng))) : null
      await firmarEnBloque(pdf, analisis?.hoja || null, { img, pie })
    }
    return pdf.save()
  }

  const img = firmaPng ? await pdf.embedPng(await toBytes(firmaPng)) : null
  const idx = posicion.pagina && posicion.pagina > 0
    ? Math.min(posicion.pagina - 1, pages.length - 1)
    : pages.length - 1
  const page = pages[idx]
  const { width } = page.getSize()

  const x = posicion.x != null ? posicion.x : 56
  const y = posicion.y != null ? posicion.y : 140

  // Modo "solo firma": nada de pie ni línea, solo el dibujo al tamaño elegido.
  if (soloFirma) {
    if (img) {
      const w = anchoFirma || 150
      const h = img.height * (w / img.width)
      page.drawImage(img, { x, y, width: w, height: h })
    }
    return pdf.save()
  }

  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const boxW = Math.min(240, width - x - 40)
  dibujarBloqueFirma(page, { img, pie, font, fontBold, x, y, anchoFirma: boxW })

  return pdf.save()
}

/* ── anexarCertificado ────────────────────────────────────────────────────
   Agrega la última página "Certificado de Firma Electrónica — Ley 527 de 1999"
   con la traza de cada firmante y el hash del documento.
   `firmantes`: [{ nombre, cedula, correo, rol, firmado_at, ip, user_agent }]
   Devuelve Uint8Array. */
export async function anexarCertificado(pdfBytes, { solicitudId, firmantes = [], docHash }) {
  const pdf = await PDFDocument.load(pdfBytes)
  const hash = docHash || (await hashDocumento(await pdf.save()))
  await _dibujarCert(pdf, { solicitudId, firmantes, docHash: hash })
  return pdf.save()
}

/* Certificado como PDF independiente (descarga aparte del documento). */
export async function generarCertificadoPdf({ solicitudId, firmantes = [], docHash = '' }) {
  const pdf = await PDFDocument.create()
  await _dibujarCert(pdf, { solicitudId, firmantes, docHash })
  return pdf.save()
}

async function _dibujarCert(pdf, { solicitudId, firmantes = [], docHash }) {
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const hash = docHash
  const page = pdf.addPage([A4.w, A4.h])
  const { w, h } = A4
  const M = 56

  // Certificado formal en Times New Roman, todo negro sobre blanco.
  page.drawText('Certificado de Firma Electronica', {
    x: M, y: h - 64, size: 16, font: fontBold, color: BLACK,
  })
  page.drawText('Ley 527 de 1999 - Republica de Colombia', {
    x: M, y: h - 82, size: 12, font, color: BLACK,
  })
  page.drawLine({ start: { x: M, y: h - 94 }, end: { x: w - M, y: h - 94 }, thickness: 1, color: BLACK })

  let y = h - 124
  page.drawText('Identificador de la solicitud:', { x: M, y, size: 12, font: fontBold, color: BLACK })
  page.drawText(safe(solicitudId) || '—', { x: M + 175, y, size: 12, font, color: BLACK })
  y -= 30

  page.drawText('FIRMANTES', { x: M, y, size: 12, font: fontBold, color: BLACK })
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 0.8, color: BLACK })
  y -= 22

  for (const f of firmantes) {
    const rows = [
      ['Nombre', safe(f.nombre)],
      ['Cedula', fmtCedula(f.cedula)],
      ['Correo', safe(f.correo)],
      ['En calidad de', ROL_LABEL[f.rol] || safe(f.rol) || 'Firmante'],
      ['Fecha y hora', fmtFechaLarga(f.firmado_at)],
      ['Direccion IP', safe(f.ip) || 'No disponible'],
      ['Dispositivo', safe(f.user_agent) || 'No disponible'],
    ]
    // Bloque del firmante (borde negro fino, texto negro TNR 12).
    const cardH = rows.length * 17 + 34
    page.drawRectangle({
      x: M, y: y - cardH + 16, width: w - M * 2, height: cardH,
      borderColor: BLACK, borderWidth: 0.8,
    })
    page.drawText(safe(f.nombre) || 'Firmante', {
      x: M + 14, y: y - 4, size: 12, font: fontBold, color: BLACK,
    })
    let ry = y - 26
    // El valor se limita para no salirse del recuadro (ancho disponible ~46 car.).
    for (const [k, v] of rows.slice(1)) {
      page.drawText(`${k}:`, { x: M + 14, y: ry, size: 12, font: fontBold, color: BLACK })
      page.drawText(truncar(v, 46), { x: M + 140, y: ry, size: 12, font, color: BLACK })
      ry -= 17
    }
    // Sello de verificación.
    page.drawText('Identidad verificada mediante codigo de un solo uso enviado a su correo.', {
      x: M + 14, y: ry - 2, size: 10, font, color: BLACK,
    })
    y -= cardH + 20
  }

  // Hash de integridad (puede partirse en 2 líneas).
  y = Math.max(y, 150)
  page.drawText('HASH DE INTEGRIDAD (SHA-256)', { x: M, y, size: 12, font: fontBold, color: BLACK })
  y -= 17
  const mid = Math.ceil(hash.length / 2)
  page.drawText(hash.slice(0, mid), { x: M, y, size: 11, font, color: BLACK })
  page.drawText(hash.slice(mid), { x: M, y: y - 14, size: 11, font, color: BLACK })

  // Nota legal al pie.
  const nota =
    'Este documento fue firmado electronicamente. La firma electronica tiene plena ' +
    'validez juridica en Colombia conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012.'
  wrapText(nota, 82).forEach((ln, i) => {
    page.drawText(ln, { x: M, y: 72 - i * 14, size: 12, font, color: BLACK })
  })
}

/* ── util: recorta y envuelve texto ──────────────────────────────────────── */
function truncar(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
function wrapText(text, maxChars) {
  const words = text.split(' ')
  const out = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) { out.push(cur.trim()); cur = w }
    else cur += ' ' + w
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/* ── util: normaliza a Uint8Array desde dataURL / URL / ArrayBuffer / Uint8Array ── */
async function toBytes(src) {
  if (src instanceof Uint8Array) return src
  if (src instanceof ArrayBuffer) return new Uint8Array(src)
  if (typeof src === 'string') {
    if (src.startsWith('data:')) {
      const b64 = src.split(',')[1]
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return arr
    }
    // URL (http/https/blob): descargar los bytes de la imagen.
    const res = await fetch(src)
    if (!res.ok) throw new Error('No se pudo descargar la imagen de la firma')
    return new Uint8Array(await res.arrayBuffer())
  }
  throw new Error('Formato de imagen no soportado')
}

export { degrees }
