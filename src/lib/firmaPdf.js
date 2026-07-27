/* ─────────────────────────────────────────────────────────────────────────
   Motor de firma electrónica — corre 100% en el navegador (sin servidor).

   Usa pdf-lib para:
     · estamparFirma()      — incrusta la firma manuscrita (PNG) sobre el PDF y
                              dibuja debajo el PIE DE FIRMA (los 7 campos).
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

/* ── Bloque de firma: imagen + pie de firma (7 campos) ────────────────────
   Dibuja en `page` anclado en (x, y) donde y es la base del bloque de texto.
   Devuelve la altura total consumida para poder apilar varias firmas. */
function dibujarBloqueFirma(page, { img, pie, font, fontBold, x, y, anchoFirma = 150 }) {
  // Pie de firma en Times New Roman 12, todo en negro.
  const line = 15
  const lines = [
    { t: safe(pie.nombre), bold: true, size: 12 },
    { t: `C.C. ${fmtCedula(pie.cedula)}`, size: 12 },
    { t: `Tel. ${safe(pie.telefono)}`, size: 12 },
    { t: safe(pie.correo), size: 12 },
    { t: `${safe(pie.ciudad)}, ${fmtFechaLarga(pie.fecha)}`, size: 12 },
    { t: `En calidad de: ${ROL_LABEL[pie.rol] || safe(pie.rol) || 'Firmante'}`, size: 12, bold: true },
  ]

  // La firma (imagen) va ENCIMA de la línea; el texto DEBAJO.
  if (img) {
    const scale = Math.min(anchoFirma / img.width, 60 / img.height)
    const w = img.width * scale
    const h = img.height * scale
    page.drawImage(img, { x, y: y + 8, width: w, height: h })
  }
  // Línea divisoria estilo "firma manuscrita" (negra).
  const lineY = y + 4
  page.drawLine({
    start: { x, y: lineY },
    end: { x: x + anchoFirma, y: lineY },
    thickness: 0.8,
    color: BLACK,
  })

  let cy = y - 8
  for (const l of lines) {
    page.drawText(l.t, {
      x, y: cy, size: l.size,
      font: l.bold ? fontBold : font,
      color: BLACK,
    })
    cy -= line
  }
  return y + 8 + 60 - cy // altura aproximada consumida
}

/* ── estamparFirma ────────────────────────────────────────────────────────
   Incrusta la firma PNG + pie de firma en el PDF.
   `firmaPng`  : Uint8Array | ArrayBuffer | dataURL string del PNG del lienzo.
   `pie`       : { nombre, cedula, telefono, correo, ciudad, fecha, rol }
   `posicion`  : { pagina (1-based, 0 = última), x, y } en puntos. Opcional:
                 por defecto abajo-izquierda de la última página.
   `soloFirma` : si es true, estampa ÚNICAMENTE el dibujo de la firma (sin línea
                 ni pie de firma) con ancho `anchoFirma` (puntos). (x, y) es la
                 esquina inferior-izquierda de la imagen.
   Devuelve Uint8Array del PDF con la firma estampada. */
export async function estamparFirma(pdfBytes, { firmaPng, pie, posicion = {}, soloFirma = false, anchoFirma }) {
  const pdf = await PDFDocument.load(pdfBytes)

  let img = null
  if (firmaPng) {
    const bytes = await toBytes(firmaPng)
    img = await pdf.embedPng(bytes)
  }

  const pages = pdf.getPages()
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
