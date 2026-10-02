import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { PdfVisor, ImagenZoom, precalentarPdf, precargarArchivo } from '../../lib/chatFiles'
import styles from './TarjetaPreview.module.css'

function PdfIcon({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  )
}

function ImgIcon({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>
  )
}

// displayUrl  — pre-signed URL (profile pages sign eagerly in their useEffect)
// rawPath     — raw tarjeta_archivo_url value; URL signed lazily on first click (admin cards)
// storagePath — path used for type detection when displayUrl is already provided
// compact     — smaller inline variant for card lists; no centering wrapper
// variant     — 'row' renderiza una fila de documento (tipo + nombre + chevron)
//               para listas; gana sobre `compact` cuando se pasa
// label       — nombre del documento (aria-label, overlay y visor). Por defecto
//               "Tarjeta profesional"; DocumentosConfianza lo reutiliza para
//               certificados y modelo contractual.
export default function TarjetaPreview({ displayUrl, rawPath, storagePath, compact = false, variant, label = 'Tarjeta profesional' }) {
  const [open, setOpen] = useState(false)
  const [resolvedUrl, setResolvedUrl] = useState(displayUrl || null)
  const [resolving, setResolving] = useState(false)

  const pathForType = storagePath || rawPath || ''
  const ext = pathForType.split('.').pop()?.toLowerCase() || ''
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)

  /* La espera al abrir un documento era casi toda de preparación: bajar y
     arrancar pdf.js, firmar la URL y bajar el archivo. Se adelanta por pasos,
     de menos a más compromiso:
       · al pintarse (hay un PDF a la vista) → pdf.js queda listo
       · al apuntar o enfocar el botón        → se firma la URL y se baja el archivo
     Así el clic solo tiene que pintar. */
  const firmaRef = useRef(null)   // la firma en curso, para no pedirla dos veces
  useEffect(() => {
    if (!isImage && (displayUrl || rawPath)) precalentarPdf()
    // En la lista de documentos de un perfil (dos archivos, y quien abrió el
    // perfil vino a verlos) el archivo se baja de una vez: en el celular no
    // hay "apuntar" que avise antes del toque.
    if (variant === 'row' && displayUrl) precargarArchivo(displayUrl, isImage)
  }, [isImage, displayUrl, rawPath, variant])

  if (!displayUrl && !rawPath) return null

  // URL lista para abrir: la que ya vino firmada o una firmada ahora.
  function resolver() {
    if (resolvedUrl) return Promise.resolve(resolvedUrl)
    if (!firmaRef.current) {
      firmaRef.current = (async () => {
        // Legacy full URL: use directly; otherwise sign the path
        if (/^https?:\/\//.test(rawPath)) return rawPath
        const { data } = await supabase.storage
          .from('tarjetas-profesionales')
          .createSignedUrl(rawPath, 3600)
        return data?.signedUrl || null
      })().then(url => {
        if (url) setResolvedUrl(url)
        else firmaRef.current = null       // falló: el próximo intento vuelve a firmar
        return url
      }, () => { firmaRef.current = null; return null })
    }
    return firmaRef.current
  }

  function adelantar() {
    resolver().then(url => { if (url) precargarArchivo(url, isImage) })
  }

  async function handleOpen(e) {
    e.stopPropagation()
    if (resolvedUrl) { setOpen(true); return }
    setResolving(true)
    try {
      if (await resolver()) setOpen(true)
    } finally {
      setResolving(false)
    }
  }

  const viewUrl = resolvedUrl
    ? (isImage ? resolvedUrl : `${resolvedUrl}#toolbar=0&navpanes=0&scrollbar=0`)
    : ''

  function close() { setOpen(false) }

  const thumbContent = variant === 'row' ? (
    // Fila de documento: mosaico con el tipo de archivo + nombre + chevron.
    // Pensada para listas de documentos (modal del profesional en el home),
    // donde un enlace suelto no comunica que hay un archivo detrás.
    <button
      type="button"
      className={styles.docRow}
      onClick={handleOpen}
      onPointerEnter={adelantar}
      onFocus={adelantar}
      onTouchStart={adelantar}
      disabled={resolving}
      aria-label={`Ver ${label.toLowerCase()}`}
    >
      <span className={styles.docTipo} aria-hidden="true">
        {isImage ? <ImgIcon size={16} /> : <PdfIcon size={16} />}
        <span className={styles.docExt}>{isImage ? 'IMG' : 'PDF'}</span>
      </span>
      <span className={styles.docTexto}>
        <span className={styles.docNombre}>{label}</span>
        <span className={styles.docPista}>{resolving ? 'Abriendo…' : 'Verificado por Parada Bridge'}</span>
      </span>
      <svg className={styles.docChevron} viewBox="0 0 24 24" width="16" height="16" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  ) : compact ? (
    // Compact: small pill-button that fits inline in admin card rows
    <button
      type="button"
      className={styles.compactBtn}
      onClick={handleOpen}
      onPointerEnter={adelantar}
      onFocus={adelantar}
      onTouchStart={adelantar}
      disabled={resolving}
      aria-label={`Ver ${label.toLowerCase()}`}
    >
      <PdfIcon size={14} />
      <span>{resolving ? 'Cargando…' : `Ver ${label.toLowerCase()}`}</span>
    </button>
  ) : (
    // Full: centered thumbnail card
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.thumb}
        onClick={handleOpen}
        onPointerEnter={adelantar}
        onFocus={adelantar}
        onTouchStart={adelantar}
        disabled={resolving}
        aria-label={`Ver ${label.toLowerCase()}`}
      >
        {isImage && resolvedUrl
          ? <img src={resolvedUrl} alt={label} className={styles.thumbImg} draggable={false} />
          : (
            <div className={styles.thumbPdf}>
              <PdfIcon size={36} />
              <span className={styles.thumbPdfLabel}>{isImage ? 'Imagen' : 'PDF'}</span>
            </div>
          )
        }
        {/* El nombre del documento ya está en la etiqueta de arriba: repetirlo
            dentro de la miniatura era ruido, y en tarjetas estrechas se partía
            en dos líneas. Una sola palabra. */}
        <span className={styles.thumbOverlay} aria-hidden="true">
          {resolving ? 'Abriendo…' : 'Ver'}
        </span>
      </button>
    </div>
  )

  return (
    <>
      {thumbContent}

      {open && resolvedUrl && createPortal(
        <div
          className={styles.overlay}
          onClick={e => { e.stopPropagation(); close(); }}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <button
            type="button"
            className={styles.closeBtn}
            onClick={e => { e.stopPropagation(); close(); }}
            aria-label="Cerrar"
          >✕</button>
          <div className={styles.viewer} onClick={e => e.stopPropagation()}>
            {isImage
              ? (
                <div className={styles.viewerLienzo}>
                  <ImagenZoom src={resolvedUrl} alt={label} onFondo={close} imgClassName={styles.viewerImg} />
                </div>
              )
              : (
                // El <iframe> no muestra PDFs en móvil: se rasterizan a imagen.
                <div className={styles.viewerIframe}>
                  <PdfVisor url={resolvedUrl} titulo={label} />
                </div>
              )
            }
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
