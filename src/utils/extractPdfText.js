/* ────────────────────────────────────────────────────────────────────────
   Extrae el TEXTO de un PDF en el navegador con pdf.js.

   ¿Por qué en el cliente y no mandar el PDF al servidor?
   · El PDF binario en base64 infla ~33% y choca con el límite de cuerpo de la
     función serverless de Vercel (~4.5 MB).
   · Como `document` de Claude, el PDF tiene tope de 100 páginas — inservible
     para sentencias/expedientes de 300-500 páginas.
   El texto plano pesa muchísimo menos y no tiene tope de páginas: el único
   límite pasa a ser la cantidad de texto (que el backend trocea si hace falta).

   pdf.js (~1 MB) se carga LAZY desde CDN solo cuando el profesional adjunta un
   PDF — no afecta el bundle inicial, igual que ffmpeg.wasm.
──────────────────────────────────────────────────────────────────────── */

const PDFJS_VERSION = '4.7.76'
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`

let _pdfjsPromise = null
async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      // El worker corre el parseo en un hilo aparte (no congela la UI).
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`
      return lib
    })
  }
  return _pdfjsPromise
}

/**
 * @param {File} file  PDF a leer.
 * @param {Object} [opts]
 * @param {number} [opts.maxChars=1800000]  Tope de caracteres (corta y marca truncated).
 * @param {(p:number)=>void} [opts.onProgress]  Progreso de extracción en [0..1].
 * @returns {Promise<{ text:string, pages:number, truncated:boolean }>}
 */
export async function extractPdfText(file, { maxChars = 1_800_000, onProgress } = {}) {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages = pdf.numPages
  let text = ''
  let truncated = false

  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // Une los fragmentos de la página; el doble salto separa páginas.
    text += content.items.map((it) => it.str || '').join(' ') + '\n\n'
    if (onProgress) onProgress(i / pages)
    if (text.length >= maxChars) { text = text.slice(0, maxChars); truncated = true; break }
    // Liberar recursos de la página procesada.
    page.cleanup()
  }

  return { text: text.trim(), pages, truncated }
}
