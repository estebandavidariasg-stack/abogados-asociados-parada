import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
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

// displayUrl  — pre-signed URL (profile pages sign eagerly in their useEffect)
// rawPath     — raw tarjeta_archivo_url value; URL signed lazily on first click (admin cards)
// storagePath — path used for type detection when displayUrl is already provided
// compact     — smaller inline variant for card lists; no centering wrapper
export default function TarjetaPreview({ displayUrl, rawPath, storagePath, compact = false }) {
  const [open, setOpen] = useState(false)
  const [resolvedUrl, setResolvedUrl] = useState(displayUrl || null)
  const [resolving, setResolving] = useState(false)

  const pathForType = storagePath || rawPath || ''
  const ext = pathForType.split('.').pop()?.toLowerCase() || ''
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)

  if (!displayUrl && !rawPath) return null

  async function handleOpen(e) {
    e.stopPropagation()
    if (resolvedUrl) { setOpen(true); return }

    setResolving(true)
    try {
      // Legacy full URL: use directly; otherwise sign the path
      if (/^https?:\/\//.test(rawPath)) {
        setResolvedUrl(rawPath)
      } else {
        const { data } = await supabase.storage
          .from('tarjetas-profesionales')
          .createSignedUrl(rawPath, 3600)
        if (data?.signedUrl) setResolvedUrl(data.signedUrl)
      }
      setOpen(true)
    } finally {
      setResolving(false)
    }
  }

  const viewUrl = resolvedUrl
    ? (isImage ? resolvedUrl : `${resolvedUrl}#toolbar=0&navpanes=0&scrollbar=0`)
    : ''

  function close() { setOpen(false) }

  const thumbContent = compact ? (
    // Compact: small pill-button that fits inline in admin card rows
    <button
      type="button"
      className={styles.compactBtn}
      onClick={handleOpen}
      disabled={resolving}
      aria-label="Ver tarjeta profesional"
    >
      <PdfIcon size={14} />
      <span>{resolving ? 'Cargando…' : 'Ver tarjeta profesional'}</span>
    </button>
  ) : (
    // Full: centered thumbnail card
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.thumb}
        onClick={handleOpen}
        disabled={resolving}
        aria-label="Ver tarjeta profesional"
      >
        {isImage && resolvedUrl
          ? <img src={resolvedUrl} alt="Tarjeta profesional" className={styles.thumbImg} draggable={false} />
          : (
            <div className={styles.thumbPdf}>
              <PdfIcon size={36} />
              <span className={styles.thumbPdfLabel}>{isImage ? 'Imagen' : 'PDF'}</span>
            </div>
          )
        }
        <span className={styles.thumbOverlay} aria-hidden="true">
          {resolving ? 'Cargando…' : 'Ver tarjeta'}
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
          aria-label="Tarjeta profesional"
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
                <img
                  src={resolvedUrl}
                  alt="Tarjeta profesional"
                  className={styles.viewerImg}
                  draggable={false}
                  onContextMenu={e => e.preventDefault()}
                />
              )
              : (
                <iframe
                  src={viewUrl}
                  title="Tarjeta profesional"
                  className={styles.viewerIframe}
                  sandbox="allow-same-origin allow-scripts"
                />
              )
            }
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
