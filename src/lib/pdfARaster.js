/* ─────────────────────────────────────────────────────────────────────────
   Rasteriza un PDF a imágenes PNG (una por página) en el navegador con
   pdf.js. Se usa para armar el documento Word con la firma movible: cada
   página va como imagen y la firma como imagen flotante encima.

   Build LEGACY a propósito. El build moderno de pdf.js 6 llama sin polyfill a
   APIs que solo trae el Chrome más reciente (Uint8Array#toHex al calcular la
   huella de CUALQUIER PDF, Map#getOrInsertComputed, Math.sumPrecise…). En
   Samsung Internet y otros navegadores móviles que van unas versiones detrás,
   getDocument lanzaba TypeError y el visor decía "No se pudo mostrar el
   documento aquí" con PDFs perfectamente sanos. El legacy trae esos polyfills
   (core-js) por unos 50 KB más, y solo se descarga al abrir un PDF.
   ───────────────────────────────────────────────────────────────────────── */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* Devuelve [{ dataUrl, width, height }] — una entrada por página.
   Trabaja sobre una COPIA: pdf.js desacopla (detach) el buffer que recibe, y si
   fuera el original el llamador se quedaría sin bytes (p.ej. para estamparFirma).
   `maxPaginas` / `tipo` / `calidad`: la revisión de contacto del chat solo
   necesita las primeras páginas en JPEG liviano.
   `anchoPx`: si se pasa, manda sobre `scale` y cada página sale con ese ancho
   en píxeles (lo que necesita un visor para verse nítido en esa pantalla).
   `onPagina(pagina, indice, numPaginas)`: se llama con cada página apenas
   está lista, para que un visor la pinte sin esperar a las demás (un contrato
   de 14 páginas tardaba varios segundos en blanco). `numPaginas` es el total
   REAL del PDF, aunque `maxPaginas` recorte cuántas se rasterizan. */
export async function rasterizarPdf(pdfBytes, scale = 2, { maxPaginas = Infinity, tipo = 'image/png', calidad, anchoPx, onPagina } = {}) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes)
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const paginas = []
  const total = Math.min(pdf.numPages, maxPaginas)
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i)
    // Tope de 4x: una página diminuta no debe disparar un lienzo gigante.
    const s = anchoPx ? Math.min(4, anchoPx / page.getViewport({ scale: 1 }).width) : scale
    const viewport = page.getViewport({ scale: s })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const pagina = { dataUrl: canvas.toDataURL(tipo, calidad), width: canvas.width, height: canvas.height }
    paginas.push(pagina)
    onPagina?.(pagina, i - 1, pdf.numPages)
  }
  return paginas
}

/* El documento de pdf.js, para quien necesita el texto CON su posición
   (lib/firmaCampos busca dónde va la firma). Trabaja sobre una copia de los
   bytes, igual que el resto. Quien lo abre lo libera con `destroy()`. */
export async function abrirPdf(pdfBytes) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes)
  return pdfjsLib.getDocument({ data: bytes }).promise
}

/* Texto de un PDF, en orden de lectura, con un salto por línea. Lo usa la
   validación del contrato de servicios (lib/contratoServicios). Un PDF
   escaneado (solo imagen) devuelve cadena vacía. */
export async function textoDePdf(pdfBytes) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes)
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  let out = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const { items } = await page.getTextContent()
    let y = null
    for (const it of items) {
      if (typeof it.str !== 'string') continue
      const yy = Math.round(it.transform[5])
      if (y !== null && Math.abs(yy - y) > 2) out += '\n'
      out += it.str
      if (it.hasEOL) out += '\n'
      y = yy
    }
    out += '\n'
  }
  return out
}

/* dataURL PNG → Uint8Array (docx necesita los bytes). */
export function dataUrlABytes(dataUrl) {
  const b64 = dataUrl.split(',')[1]
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
