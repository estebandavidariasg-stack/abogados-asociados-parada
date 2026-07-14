/* ─────────────────────────────────────────────────────────────────────────
   Rasteriza un PDF a imágenes PNG (una por página) en el navegador con
   pdf.js. Se usa para armar el documento Word con la firma movible: cada
   página va como imagen y la firma como imagen flotante encima.
   ───────────────────────────────────────────────────────────────────────── */
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* Devuelve [{ dataUrl, width, height }] — una entrada por página. */
export async function rasterizarPdf(pdfBytes, scale = 2) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const paginas = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    paginas.push({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
  }
  return paginas
}

/* dataURL PNG → Uint8Array (docx necesita los bytes). */
export function dataUrlABytes(dataUrl) {
  const b64 = dataUrl.split(',')[1]
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
