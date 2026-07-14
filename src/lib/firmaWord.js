/* ─────────────────────────────────────────────────────────────────────────
   Genera el documento firmado en Word (.docx) con la FIRMA MOVIBLE:
     · cada página del documento va como imagen (texto NO editable)
     · la firma + su pie de firma van juntos como UNA imagen FLOTANTE que se
       arrastra/reposiciona en Word (movible), pero NO editable
   NO incluye el certificado (ese va como PDF aparte).

   Nota: no hay texto editable. Lo único que el profesional puede hacer es
   MOVER el bloque de firma; ni el documento ni el pie se pueden alterar.
   ───────────────────────────────────────────────────────────────────────── */
import { Document, Packer, Paragraph, ImageRun, TextWrappingType, TextWrappingSide } from 'docx'
import { ROL_LABEL } from './firmaPdf'
import { dataUrlABytes } from './pdfARaster'

const EMU_IN = 914400 // EMU por pulgada
const CONTENT_W = 720 // px de ancho útil (Letter 8.5" - 0.5" márgenes @96dpi)
const CONTENT_H = 960

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
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/* Dibuja firma + pie de firma en un canvas y devuelve un PNG (dataURL).
   Todo el bloque queda como imagen: movible pero NO editable. Pie en negro,
   tipografía serif (Times New Roman). */
async function bloqueFirmaPng(firmaPngDataUrl, pie) {
  const S = 3 // supersampling para nitidez
  const W = 300 * S, H = 168 * S
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // Firma manuscrita arriba.
  if (firmaPngDataUrl) {
    try {
      const img = await cargarImg(firmaPngDataUrl)
      const sw = Math.min(160 * S, img.width * ((58 * S) / img.height))
      ctx.drawImage(img, 0, 2 * S, sw, 58 * S)
    } catch { /* sin firma dibujada */ }
  }
  // Línea de firma.
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1 * S
  ctx.beginPath(); ctx.moveTo(0, 64 * S); ctx.lineTo(250 * S, 64 * S); ctx.stroke()

  // Pie de firma (Times New Roman, negro, ~12pt).
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  const lineas = [
    [pie.nombre || '', true],
    [`C.C. ${fmtCedula(pie.cedula)}`, false],
    [`Tel. ${pie.telefono || ''}`, false],
    [pie.correo || '', false],
    [`${pie.ciudad || ''}, ${fmtFecha(pie.fecha)}`, false],
    [`En calidad de: ${ROL_LABEL[pie.rol] || pie.rol || 'Firmante'}`, true],
  ]
  let y = 80 * S
  for (const [t, bold] of lineas) {
    ctx.font = `${bold ? 'bold ' : ''}${12 * S}px "Times New Roman", Georgia, serif`
    ctx.fillText(t, 0, y)
    y += 14 * S
  }
  return { dataUrl: canvas.toDataURL('image/png'), w: 300, h: 168 }
}

export async function generarWordFirma({ paginas, firmaPngDataUrl, pie }) {
  const bloque = await bloqueFirmaPng(firmaPngDataUrl, pie)
  const children = []

  paginas.forEach((pg, i) => {
    const scale = Math.min(CONTENT_W / pg.width, CONTENT_H / pg.height)
    const w = Math.round(pg.width * scale)
    const h = Math.round(pg.height * scale)
    const runs = [
      new ImageRun({ type: 'png', data: dataUrlABytes(pg.dataUrl), transformation: { width: w, height: h } }),
    ]
    // El bloque de firma (firma + pie, ya como imagen) va FLOTANTE en la última
    // página: el profesional lo mueve donde quiera; nada es editable.
    if (i === paginas.length - 1) {
      runs.push(new ImageRun({
        type: 'png',
        data: dataUrlABytes(bloque.dataUrl),
        transformation: { width: bloque.w, height: bloque.h },
        floating: {
          horizontalPosition: { offset: Math.round(EMU_IN * 0.9) },
          verticalPosition: { offset: Math.round(EMU_IN * 7.8) },
          allowOverlap: true,
          behindDocument: false,
          wrap: { type: TextWrappingType.NONE, side: TextWrappingSide.BOTH_SIDES },
        },
      }))
    }
    children.push(new Paragraph({ children: runs }))
    if (i < paginas.length - 1) children.push(new Paragraph({ children: [] }))
  })

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, // 0.5"
      children,
    }],
  })
  return await Packer.toBlob(doc)
}
