import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'

/* ─────────────────────────────────────────────────────────────────────────
   Helpers de media de chat (bucket `chat-files`)

   PROBLEMA: los mensajes guardan en `file_url` la URL FIRMADA del archivo,
   que expira a los 7 días. Pasado ese plazo la URL muere (HTTP 400) aunque
   el archivo siga en el bucket → imágenes rotas y descargas fallidas.

   SOLUCIÓN: firmamos una URL FRESCA al momento de usar el archivo (renderizar
   imagen / abrir archivo / reproducir audio). Funciona tanto si `file_url` es
   un path nuevo ("<carpeta>/archivo.ext") como una URL firmada antigua (viva o
   expirada): de la URL extraemos el path interno y re-firmamos.

   Aquí vive todo lo compartido por los chats: la resolución de URLs, la
   apertura de archivos y los dos componentes de imagen (miniatura + visor),
   para no dispersar archivos pequeños.
───────────────────────────────────────────────────────────────────────── */

export function extractChatFilesPath(url) {
  if (!url) return null
  // URL firmada:  /storage/v1/object/sign/chat-files/<path>?token=...
  const signed = url.match(/\/storage\/v1\/object\/sign\/chat-files\/([^?]+)/)
  if (signed) return decodeURIComponent(signed[1])
  // URL pública/directa:  /storage/v1/object/(public/)?chat-files/<path>
  const direct = url.match(/\/storage\/v1\/object\/(?:public\/)?chat-files\/([^?]+)/)
  if (direct) return decodeURIComponent(direct[1])
  return null
}

/* Devuelve una URL firmada fresca para `src` (path o URL firmada antigua).
   `null` si no se pudo resolver (y el original no era una URL utilizable). */
export async function resolveSignedUrl(src, expiresIn = 3600) {
  if (!src) return null
  const path = /^https?:\/\//.test(src) ? extractChatFilesPath(src) : src
  if (!path) return src // formato no reconocido — último intento con el original
  const { data, error } = await supabase.storage
    .from('chat-files')
    .createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) {
    console.warn('[chatFiles] createSignedUrl falló para:', path, error)
    // Si el original era una URL, devolverla (por si aún sirviera); si era
    // un path puro, no hay nada que abrir → null.
    return /^https?:\/\//.test(src) ? src : null
  }
  return data.signedUrl
}

/* Abre un archivo de chat en una pestaña nueva con una URL firmada fresca.
   Abre la pestaña SINCRÓNICAMENTE (dentro del gesto del usuario) para evitar
   el bloqueo de popups, y luego la redirige cuando la URL está lista.
   Devuelve true si se abrió, false si no se pudo resolver. */
export async function openChatFile(src) {
  const win = typeof window !== 'undefined'
    ? window.open('about:blank', '_blank')
    : null
  const url = await resolveSignedUrl(src, 3600)
  if (!url) {
    if (win) win.close()
    return false
  }
  if (win) {
    try { win.opener = null } catch {}
    win.location.href = url
  } else {
    // Popup bloqueado o sin window — navegar en la misma pestaña como fallback.
    if (typeof window !== 'undefined') window.location.href = url
  }
  return true
}

/* Previsualización de imagen del chat. Firma una URL FRESCA al renderizar
   para que las imágenes nunca expiren — funcionan tanto las nuevas (path)
   como las antiguas (URL firmada vencida). `btnClassName`/`imgClassName`
   los aporta cada chat (estilos de su propio módulo). */
export function ChatImage({ src, alt, btnClassName, imgClassName, onOpen, onBlocked }) {
  const [url, setUrl]       = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUrl(null); setFailed(false)
    resolveSignedUrl(src, 60 * 60)
      .then(u => { if (!cancelled) { if (u) setUrl(u); else setFailed(true) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [src])

  if (failed) {
    return (
      <div
        className={imgClassName}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 160, minHeight: 90, padding: '18px 14px',
          background: 'rgba(13,45,94,0.05)', color: '#8a9ab5',
          fontSize: '0.78rem', textAlign: 'center', borderRadius: 12,
        }}
      >
        Imagen no disponible
      </div>
    )
  }

  return (
    <button
      type="button"
      className={btnClassName}
      onClick={() => url && onOpen?.(url)}
      onContextMenu={onBlocked}
      title="Click para ampliar"
      disabled={!url}
      aria-busy={!url}
    >
      {url ? (
        <img
          src={url}
          alt={alt || 'imagen'}
          className={imgClassName}
          draggable="false"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        /* Placeholder mientras se firma la URL — reserva espacio (evita saltos) */
        <div
          className={imgClassName}
          aria-hidden="true"
          style={{ minWidth: 160, minHeight: 120, background: 'rgba(13,45,94,0.06)', borderRadius: 12 }}
        />
      )}
    </button>
  )
}

/* Estilos del visor a pantalla completa. Mismos valores que el lightbox del
   chat de abogado/contador (fundido al abrir + hover del botón cerrar), vía un
   <style> con clases propias para no arrastrar un .module.css. */
const LIGHTBOX_CSS = `
.aapLb { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.92); display: flex; align-items: center; justify-content: center; cursor: zoom-out; animation: aapLbIn 0.25s ease-out; }
.aapLbImg { max-width: 92vw; max-height: 92vh; object-fit: contain; border-radius: 4px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); cursor: default; user-select: none; -webkit-user-drag: none; }
.aapLbClose { position: absolute; top: 20px; right: 24px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.28); color: #fff; font-size: 1.6rem; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .2s, transform .2s, border-color .2s; font-family: inherit; padding: 0; }
.aapLbClose:hover { background: rgba(255,255,255,0.22); border-color: rgba(255,255,255,0.5); transform: scale(1.06); }
@keyframes aapLbIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .aapLb { animation: none; } }
`

/* Visor de imagen a pantalla completa. `src` ya debe ser una URL firmada
   fresca (la entrega ChatImage vía onOpen). Abre igual que en el chat de
   abogado/contador. */
export function ChatLightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [src, onClose])

  if (!src) return null

  // Portal a <body>: si el chat está dentro de un contenedor con
  // backdrop-filter/transform (ej. el panel del admin), `position: fixed` se
  // ancla a ESE contenedor y el visor queda encajonado en vez de fullscreen.
  // Renderizando en <body> escapa de ese contexto y siempre cubre la ventana.
  const overlay = (
    <>
      <style>{LIGHTBOX_CSS}</style>
      <div className="aapLb" onClick={onClose} role="dialog" aria-label="Vista de imagen">
        <img
          src={src}
          alt=""
          className="aapLbImg"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          draggable="false"
        />
        <button className="aapLbClose" onClick={onClose} aria-label="Cerrar" type="button">×</button>
      </div>
    </>
  )

  return typeof document !== 'undefined'
    ? createPortal(overlay, document.body)
    : overlay
}
