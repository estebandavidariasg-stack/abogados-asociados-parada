/* ─────────────────────────────────────────────────────────────────────────
   Documento firmado en Word (.docx) idéntico al PDF, con la FIRMA MOVIBLE:
     · cada página va como imagen (texto y espaciado exactamente como el PDF)
     · el bloque de firma (firma + pie) va como UNA imagen FLOTANTE colocada en
       la MISMA posición y tamaño que tiene en el PDF, y se puede mover en Word.
   Nada es editable salvo mover ese bloque. No incluye el certificado (va aparte).
   ───────────────────────────────────────────────────────────────────────── */
import { Document, Packer, Paragraph, ImageRun, TextWrappingType, TextWrappingSide } from 'docx'
import { ROL_LABEL } from './firmaPdf'
import { dataUrlABytes } from './pdfARaster'

const EMU_IN = 914400            // EMU por pulgada
const RASTER_SCALE = 2           // debe coincidir con rasterizarPdf(bytes, 2)
// Página Letter (docx por defecto) con márgenes de 0.5".
const MARGIN_IN = 0.5
const CONTENT_W_PX = 720         // 7.5" @ 96dpi
const CONTENT_H_PX = 960         // 10"  @ 96dpi
// Geometría del bloque de firma tal como lo dibuja estamparFirma() (en puntos):
//  firma encima del ancla (y) y pie de firma debajo. Ver dibujarBloqueFirma().
const SIG_TOP_ABOVE_Y = 66       // borde superior de la firma por encima de `y`
const BLOCK_H_PT = 168           // alto total del bloque (firma + 6 líneas de pie)
const BLOCK_W_PT = 240           // ancho del bloque

function fmtCedula(c) {
  const d = String(c || '').replace(/\D/g, '')
  return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : String(c || '')
}
function fmtFecha(iso) {
  try { return new Date(iso || Date.now()).toLocaleString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}
function cargarImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img); img.onerror = reject; img.src = src
  })
}

/* Firma + pie de firma en un canvas con la proporción del bloque del PDF
   (BLOCK_W_PT x BLOCK_H_PT). Todo imagen: movible pero NO editable. */
async function bloqueFirmaPng(firmaPngDataUrl, pie) {
  const S = 3
  const W = BLOCK_W_PT * S, H = BLOCK_H_PT * S
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  if (firmaPngDataUrl) {
    try {
      const img = await cargarImg(firmaPngDataUrl)
      const sw = Math.min(150 * S, img.width * ((56 * S) / img.height))
      ctx.drawImage(img, 0, 4 * S, sw, 56 * S)
    } catch { /* sin firma */ }
  }
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1 * S
  ctx.beginPath(); ctx.moveTo(0, 62 * S); ctx.lineTo(200 * S, 62 * S); ctx.stroke()

  ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic'
  const lineas = [
    [pie.nombre || '', true],
    [`C.C. ${fmtCedula(pie.cedula)}`, false],
    [`Tel. ${pie.telefono || ''}`, false],
    [pie.correo || '', false],
    [`${pie.ciudad || ''}, ${fmtFecha(pie.fecha)}`, false],
    [`En calidad de: ${ROL_LABEL[pie.rol] || pie.rol || 'Firmante'}`, true],
  ]
  let y = 78 * S
  for (const [t, bold] of lineas) {
    ctx.font = `${bold ? 'bold ' : ''}${11 * S}px "Times New Roman", Georgia, serif`
    ctx.fillText(t, 0, y)
    y += 14 * S
  }
  return canvas.toDataURL('image/png')
}

/* `posicion`: { x, y } donde se estampó la firma en el PDF (puntos, origen
   abajo-izquierda de la ÚLTIMA página). Por defecto igual que estamparFirma. */
export async function generarWordFirma({ paginas, firmaPngDataUrl, pie, posicion = {} }) {
  const bloqueUrl = await bloqueFirmaPng(firmaPngDataUrl, pie)
  const bloqueBytes = dataUrlABytes(bloqueUrl)

  const x = posicion.x != null ? posicion.x : 56
  const yAncla = posicion.y != null ? posicion.y : 140

  const children = []
  const ultima = paginas.length - 1

  paginas.forEach((pg, i) => {
    // Ajuste de la imagen de página al área de contenido (px @96dpi).
    const dispScale = Math.min(CONTENT_W_PX / pg.width, CONTENT_H_PX / pg.height)
    const dispW = pg.width * dispScale
    const dispH = pg.height * dispScale
    const runs = [
      new ImageRun({ type: 'png', data: dataUrlABytes(pg.dataUrl), transformation: { width: Math.round(dispW), height: Math.round(dispH) } }),
    ]

    if (i === ultima) {
      // Página del PDF en puntos (pdf.js rasterizó a RASTER_SCALE).
      const pageW_pt = pg.width / RASTER_SCALE
      const pageH_pt = pg.height / RASTER_SCALE
      // Esquina superior-izquierda del bloque en el PDF (y-arriba → desde arriba).
      const blockLeft_pt = x
      const blockTopFromTop_pt = pageH_pt - (yAncla + SIG_TOP_ABOVE_Y)
      // Fracciones dentro de la página → posición sobre la imagen mostrada (in).
      const fx = blockLeft_pt / pageW_pt
      const fyTop = blockTopFromTop_pt / pageH_pt
      const xIn = MARGIN_IN + fx * (dispW / 96)
      const yIn = MARGIN_IN + fyTop * (dispH / 96)
      const bwIn = (BLOCK_W_PT / pageW_pt) * (dispW / 96)
      const bhIn = (BLOCK_H_PT / pageH_pt) * (dispH / 96)

      runs.push(new ImageRun({
        type: 'png',
        data: bloqueBytes,
        transformation: { width: Math.round(bwIn * 96), height: Math.round(bhIn * 96) },
        floating: {
          horizontalPosition: { offset: Math.round(xIn * EMU_IN) },
          verticalPosition: { offset: Math.round(yIn * EMU_IN) },
          allowOverlap: true,
          behindDocument: false,
          wrap: { type: TextWrappingType.NONE, side: TextWrappingSide.BOTH_SIDES },
        },
      }))
    }

    children.push(new Paragraph({ children: runs }))
    if (i < ultima) children.push(new Paragraph({ children: [] }))
  })

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // Letter (twips)
          margin: { top: 720, bottom: 720, left: 720, right: 720 }, // 0.5"
        },
      },
      children,
    }],
  })
  return await Packer.toBlob(doc)
}
