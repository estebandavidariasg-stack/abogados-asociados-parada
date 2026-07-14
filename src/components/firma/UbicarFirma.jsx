import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { bytesDeDoc, urlFirmada } from '../../lib/firmaService'
import styles from './UbicarFirma.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   UbicarFirma — el profesional ARRASTRA la firma sobre el documento, AJUSTA su
   tamaño y descarga el PDF con la firma estampada donde la ubicó. Se estampa
   ÚNICAMENTE el dibujo (sin línea ni pie de firma). Reutiliza pdf.js (render) y
   pdf-lib (estampar). Se carga lazy: pdf.js/pdf-lib no pesan en otros bundles.

   Props:
     origPath   ruta del documento original (bucket documentos-firma)
     firmaPath  ruta del PNG de la firma manuscrita
     filename   nombre sugerido de descarga
     onClose()
   ───────────────────────────────────────────────────────────────────────── */

const DISP_W = 540            // ancho de render de cada página (px)
const RASTER_SCALE = 3        // render de alta resolución (nítido) — divide para volver a puntos
const SIG_W_DEFAULT = 150     // ancho inicial de la firma (puntos PDF)
const SIG_W_MIN = 60
const SIG_W_MAX = 320

export default function UbicarFirma({ origPath, firmaPath, filename = 'documento-firmado.pdf', onClose }) {
  const [bytes, setBytes] = useState(null)     // Uint8Array del PDF original
  const [firmaUrl, setFirmaUrl] = useState('') // dataURL/URL de la firma para preview + estampado
  const [aspecto, setAspecto] = useState(0.4)  // alto/ancho del PNG de la firma
  const [paginas, setPaginas] = useState([])   // [{ dataUrl, dispW, dispH, pageW_pt, pageH_pt, top }]
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)
  const [sigW, setSigW] = useState(SIG_W_DEFAULT) // ancho de la firma en puntos
  const colRef = useRef(null)

  // Posición del bloque de firma en coords de la columna de páginas (px).
  const [pos, setPos] = useState({ left: 40, top: 40 })
  const drag = useRef(null)

  // puntos → px de pantalla (según la primera página; las páginas comparten ancho).
  const ptToPx = paginas[0] ? paginas[0].dispW / paginas[0].pageW_pt : 1
  const blockW = sigW * ptToPx
  const blockH = blockW * aspecto

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const [docBytes, fUrl] = await Promise.all([
          bytesDeDoc(origPath, headers),
          urlFirmada(firmaPath, headers),
        ])
        if (cancel) return
        setBytes(docBytes)
        setFirmaUrl(fUrl)
        if (!fUrl) {
          setError('No se encontró la firma guardada de este documento. Si se firmó antes de esta función, pídele al cliente que lo firme de nuevo.')
        } else {
          // Proporción real de la firma para no deformarla.
          const im = new Image()
          im.onload = () => { if (!cancel && im.width) setAspecto(im.height / im.width) }
          im.src = fUrl
        }
        const { rasterizarPdf } = await import('../../lib/pdfARaster')
        const raw = await rasterizarPdf(docBytes, RASTER_SCALE)
        let top = 0
        const pgs = raw.map((p) => {
          const dispScale = DISP_W / p.width
          const dispH = p.height * dispScale
          const entry = {
            dataUrl: p.dataUrl, dispW: DISP_W, dispH,
            pageW_pt: p.width / RASTER_SCALE, pageH_pt: p.height / RASTER_SCALE, top,
          }
          top += dispH + 14 // gap
          return entry
        })
        if (cancel) return
        setPaginas(pgs)
        // Posición inicial: abajo-izquierda de la última página.
        const last = pgs[pgs.length - 1]
        const bH = SIG_W_DEFAULT * (DISP_W / pgs[0].pageW_pt) * 0.4
        if (last) setPos({ left: 40, top: last.top + last.dispH - bH - 60 })
      } catch (e) {
        if (!cancel) setError('No se pudo cargar el documento. ' + (e?.message || ''))
      }
    })()
    return () => { cancel = true }
  }, [origPath, firmaPath])

  // ── Arrastre del bloque ──
  const onDown = (e) => {
    e.preventDefault()
    const rect = colRef.current.getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left - pos.left, dy: e.clientY - rect.top - pos.top }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onMove = (e) => {
    if (!drag.current) return
    const rect = colRef.current.getBoundingClientRect()
    let left = e.clientX - rect.left - drag.current.dx
    let top = e.clientY - rect.top - drag.current.dy
    const maxL = DISP_W - blockW
    const maxT = (paginas.at(-1)?.top || 0) + (paginas.at(-1)?.dispH || 0) - blockH
    left = Math.max(0, Math.min(left, maxL))
    top = Math.max(0, Math.min(top, maxT))
    setPos({ left, top })
  }
  const onUp = () => {
    drag.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  // Convierte la posición del bloque a { pagina, x, y } del PDF y estampa (solo firma).
  async function firmarYDescargar() {
    if (!bytes || paginas.length === 0) return
    setGenerando(true); setError('')
    try {
      // Página donde cae el borde superior del bloque.
      let idx = 0
      for (let i = 0; i < paginas.length; i++) {
        if (pos.top >= paginas[i].top) idx = i
      }
      const pg = paginas[idx]
      const relTop = pos.top - pg.top
      const scalePt = pg.pageW_pt / pg.dispW // puntos por px de pantalla
      const x_pt = pos.left * scalePt
      const topFromTop_pt = relTop * scalePt
      const sigH_pt = sigW * aspecto
      const y_pt = pg.pageH_pt - topFromTop_pt - sigH_pt // esquina inferior-izq.

      const { estamparFirma } = await import('../../lib/firmaPdf')
      const signed = await estamparFirma(bytes, {
        firmaPng: firmaUrl,
        soloFirma: true,
        anchoFirma: sigW,
        posicion: { pagina: idx + 1, x: x_pt, y: y_pt },
      })
      const url = URL.createObjectURL(new Blob([signed], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      onClose?.()
    } catch (e) {
      setError('No se pudo generar el PDF. ' + (e?.message || ''))
    } finally { setGenerando(false) }
  }

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>Ubicar la firma</h2>
            <p className={styles.sub}>Arrastra la firma, ajusta su tamaño y descarga el PDF</p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        {error && <div className={styles.errBar} role="alert">{error}</div>}

        <div className={styles.viewer}>
          {paginas.length === 0 && !error ? (
            <div className={styles.loading}><span className={styles.spinner} /> Cargando documento…</div>
          ) : (
            <div className={styles.col} ref={colRef} style={{ width: DISP_W }}>
              {paginas.map((p, i) => (
                <img key={i} src={p.dataUrl} alt={`Página ${i + 1}`} className={styles.page}
                  style={{ width: p.dispW, height: p.dispH }} draggable={false} />
              ))}
              {firmaUrl && (
                <div
                  className={styles.firmaBlock}
                  style={{ left: pos.left, top: pos.top, width: blockW, height: blockH }}
                  onPointerDown={onDown}
                >
                  <img src={firmaUrl} alt="firma" className={styles.firmaImg} draggable={false} />
                </div>
              )}
            </div>
          )}
        </div>

        {firmaUrl && paginas.length > 0 && (
          <div className={styles.sizeRow}>
            <span className={styles.sizeLabel}>Tamaño</span>
            <input
              type="range" className={styles.slider}
              min={SIG_W_MIN} max={SIG_W_MAX} step={2} value={sigW}
              onChange={(e) => setSigW(+e.target.value)}
              aria-label="Tamaño de la firma"
            />
            <span className={styles.sizeHint}>Arrástrala sobre el documento</span>
          </div>
        )}

        <footer className={styles.foot}>
          <button className={styles.btnGhost} onClick={onClose} disabled={generando}>Cancelar</button>
          <button className={styles.btnSolid} onClick={firmarYDescargar} disabled={generando || paginas.length === 0}>
            {generando ? 'Generando…' : 'Firmar y descargar PDF'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
