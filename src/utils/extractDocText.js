/* ────────────────────────────────────────────────────────────────────────
   Extrae el TEXTO de un documento en el navegador: PDF, Word (.docx) o TXT.

   ¿Por qué en el cliente? El binario en base64 infla ~33% y choca con el límite
   de cuerpo de la función serverless de Vercel (~4.5 MB); además el PDF como
   `document` de Claude tiene tope de 100 páginas. El texto plano pesa poco y no
   tiene tope de páginas: el backend lo trocea si hace falta.

   Librerías pesadas (pdf.js, mammoth) se cargan LAZY desde CDN solo cuando el
   profesional adjunta el archivo — no afectan el bundle inicial.

   Devuelven todas: { text, pages, truncated }.
   (En Word/TXT no hay número real de páginas: se estima por longitud.)
──────────────────────────────────────────────────────────────────────── */

const CHARS_POR_PAGINA = 2500 // estimación para Word/TXT (texto denso)

// ── PDF (pdf.js) ───────────────────────────────────────────────────────────
const PDFJS_VERSION = '4.7.76'
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`

let _pdfjsPromise = null
async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`
      return lib
    })
  }
  return _pdfjsPromise
}

async function extractPdfText(file, { maxChars = 1_800_000, onProgress } = {}) {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages = pdf.numPages
  let text = ''
  let truncated = false
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it) => it.str || '').join(' ') + '\n\n'
    if (onProgress) onProgress(i / pages)
    if (text.length >= maxChars) { text = text.slice(0, maxChars); truncated = true; break }
    page.cleanup()
  }
  return { text: text.trim(), pages, truncated }
}

// ── Word .docx (mammoth) ───────────────────────────────────────────────────
// Build de navegador (UMD): expone window.mammoth tras cargar el <script>.
let _mammothPromise = null
function getMammoth() {
  if (typeof window !== 'undefined' && window.mammoth) return Promise.resolve(window.mammoth)
  if (!_mammothPromise) {
    _mammothPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
      s.onload = () => resolve(window.mammoth)
      s.onerror = () => reject(new Error('No se pudo cargar el lector de Word.'))
      document.head.appendChild(s)
    })
  }
  return _mammothPromise
}

async function extractDocxText(file, { maxChars = 1_800_000 } = {}) {
  const mammoth = await getMammoth()
  const arrayBuffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  let text = (value || '').trim()
  let truncated = false
  if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true }
  return { text, pages: Math.max(1, Math.round(text.length / CHARS_POR_PAGINA)), truncated }
}

// ── TXT (sin librería) ─────────────────────────────────────────────────────
async function extractTxt(file, { maxChars = 1_800_000 } = {}) {
  let text = (await file.text()).trim()
  let truncated = false
  if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true }
  return { text, pages: Math.max(1, Math.round(text.length / CHARS_POR_PAGINA)), truncated }
}

// ── Dispatcher por tipo/extensión ──────────────────────────────────────────
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function extractDocText(file, opts) {
  const type = file?.type || ''
  const name = (file?.name || '').toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return extractPdfText(file, opts)
  if (type === DOCX_MIME || name.endsWith('.docx'))        return extractDocxText(file, opts)
  if (type === 'text/plain' || name.endsWith('.txt'))      return extractTxt(file, opts)
  if (name.endsWith('.doc')) {
    throw new Error('El formato Word antiguo (.doc) no es compatible. Guárdalo como .docx o PDF.')
  }
  throw new Error('Formato no soportado. Adjunta PDF, Word (.docx), TXT o una imagen.')
}
