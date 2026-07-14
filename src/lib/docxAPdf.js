/* ─────────────────────────────────────────────────────────────────────────
   Conversión Word (.docx) → PDF, 100% en el navegador y gratis.

   docx-preview (ya instalado) renderiza el .docx a HTML fiel en un contenedor
   oculto; html2canvas rasteriza cada página; pdf-lib arma el PDF final.

   ⚠️ La fidelidad no es perfecta (márgenes/fuentes pueden variar). El flujo de
   UI OBLIGA a previsualizar el PDF convertido antes de enviarlo a firmar, y
   ofrece subir un PDF exportado desde Word si no convence. Ver el spec.
   ───────────────────────────────────────────────────────────────────────── */
import { PDFDocument } from 'pdf-lib'

const A4_WIDTH_PX = 794 // A4 a 96dpi — ancho de render para que docx pagine bien

const isPdf = (file) =>
  file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')

const isDocx = (file) =>
  file?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  /\.docx$/i.test(file?.name || '')

/* Devuelve los bytes PDF de un archivo, convirtiendo si es Word.
   `onProgress(stage)` opcional: 'render' | 'rasterizar' | 'componer'. */
export async function archivoAPdfBytes(file, onProgress) {
  if (isPdf(file)) {
    return new Uint8Array(await file.arrayBuffer())
  }
  if (isDocx(file)) {
    return await docxABytes(file, onProgress)
  }
  throw new Error('Solo se admite PDF o Word (.docx). Para .doc antiguo, guárdalo como .docx o PDF.')
}

/* Convierte un Blob/File .docx a bytes PDF. */
export async function docxABytes(blob, onProgress) {
  onProgress?.('render')
  const { renderAsync } = await import('docx-preview')

  // Contenedor oculto pero REALMENTE renderizado (no display:none: html2canvas
  // necesita layout). Lo sacamos del viewport.
  const host = document.createElement('div')
  host.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;background:#fff;` +
    'z-index:-1;pointer-events:none;'
  document.body.appendChild(host)

  // Estilo global (en <head>, docx-preview NO lo borra) que neutraliza el fondo
  // gris del "visor", la sombra de página y cualquier banda de encabezado/pie.
  const estilo = document.createElement('style')
  estilo.textContent =
    '.docx-wrapper{background:#fff !important;padding:0 !important;}' +
    '.docx-wrapper>section.docx{box-shadow:none !important;margin:0 auto !important;background:#fff !important;}' +
    '.docx-wrapper header,.docx-wrapper footer,.docx-header,.docx-footer{display:none !important;}'
  document.head.appendChild(estilo)

  try {
    await renderAsync(await blob.arrayBuffer(), host, undefined, {
      className: 'docxrender',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: false,
      renderFooters: false,
    })

    // Cada página de docx-preview es un <section> dentro de .docx-wrapper.
    let pages = Array.from(host.querySelectorAll('.docx-wrapper > section'))
    if (pages.length === 0) pages = Array.from(host.querySelectorAll('section.docx, .docx'))
    if (pages.length === 0) pages = [host] // fallback: todo el contenedor

    // Elimina encabezados/pies que docx-preview haya dibujado (las franjas grises).
    host.querySelectorAll('header, footer, .docx-header, .docx-footer').forEach(e => e.remove())

    onProgress?.('rasterizar')
    const html2canvas = (await import('html2canvas')).default
    const pdf = await PDFDocument.create()

    for (const el of pages) {
      // Belt-and-suspenders: sin sombra/margen en la sección que capturamos.
      el.style.boxShadow = 'none'
      el.style.margin = '0'
      el.style.background = '#fff'
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      const pngUrl = canvas.toDataURL('image/png')
      const png = await pdf.embedPng(pngUrl)

      // Página PDF con el mismo aspecto que la página renderizada, a ancho A4.
      const pageW = 595.28
      const pageH = (canvas.height / canvas.width) * pageW
      const page = pdf.addPage([pageW, pageH])
      page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH })
    }

    onProgress?.('componer')
    return await pdf.save()
  } finally {
    host.remove()
    estilo.remove()
  }
}

export { isPdf, isDocx }
