import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase, getAuthHeaders } from './supabase'
import { compressImage } from '../utils/compressMedia'
import { contieneContacto } from './validaciones'
import { pedirIA } from './aiClient'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

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

/* Caché de firmas por path: abrir una sala con 25 adjuntos disparaba 25 POST
   de firma, y alternar entre dos salas re-firmaba todo una y otra vez aunque
   las URLs duran 1 hora. Margen de 5 min para no entregar URLs por expirar.
   No se cachean los fallos. */
const signedCache = new Map()

/* Devuelve una URL firmada fresca para `src` (path o URL firmada antigua).
   `null` si no se pudo resolver (y el original no era una URL utilizable). */
export async function resolveSignedUrl(src, expiresIn = 3600) {
  if (!src) return null
  const path = /^https?:\/\//.test(src) ? extractChatFilesPath(src) : src
  // Si `src` es una URL http(s) que NO resuelve a un path del bucket chat-files,
  // NO la devolvemos: el file_url lo controla quien envía el mensaje y abrirlo
  // tal cual sería un open-redirect hacia un sitio arbitrario (phishing). Solo
  // navegamos a objetos de nuestro propio storage. (Un path puro sí se firma.)
  if (!path) return null
  const hit = signedCache.get(path)
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return hit.url
  const { data, error } = await supabase.storage
    .from('chat-files')
    .createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) {
    console.warn('[chatFiles] createSignedUrl falló para:', path, error)
    // Si el original era una URL, devolverla (por si aún sirviera); si era
    // un path puro, no hay nada que abrir → null.
    return /^https?:\/\//.test(src) ? src : null
  }
  signedCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 })
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

/* ─────────────────────────────────────────────────────────────────────────
   Adjuntos de chat: validación, compresión, errores legibles, descarga y
   grabación de voz. Compartido por los tres chats (cliente, abogado,
   contador) para que las reglas sean idénticas en los tres.
───────────────────────────────────────────────────────────────────────── */

export const CHAT_FILE_MAX_MB = 20
const CHAT_FILE_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt']

/* Devuelve '' si el archivo es válido, o el mensaje de error para el usuario. */
export function validarAdjuntoChat(file) {
  if (!file) return 'Selecciona un archivo.'
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  if (!CHAT_FILE_EXT.includes(ext)) {
    return `Tipo de archivo no permitido (.${ext || '?'}). Usa PDF, Word, Excel, PowerPoint, imágenes o TXT.`
  }
  if (file.size === 0) return 'El archivo está vacío.'
  if (file.size > CHAT_FILE_MAX_MB * 1024 * 1024) {
    return `El archivo pesa ${(file.size / 1048576).toFixed(1)} MB y el máximo es ${CHAT_FILE_MAX_MB} MB.`
  }
  return ''
}

/* Nombre apto para la key de Storage: sin tildes, espacios ni símbolos raros
   (Storage rechaza algunos caracteres y otros rompen la URL firmada). El
   nombre original se conserva en chat_messages.file_name. */
export function nombreArchivoSeguro(name) {
  const base = String(name || 'archivo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120)
  return base || 'archivo'
}

/* Imágenes: reducir a 1600 px y JPEG antes de subir (una foto de celular de
   4-8 MB baja a ~300 KB: la subida deja de ser lenta). Otros tipos pasan tal
   cual. Si la compresión falla se sube el original. */
const yaPreparados = new WeakSet()
export async function prepararAdjuntoChat(file) {
  if (!file || yaPreparados.has(file)) return file
  if (!/^image\/(png|jpeg|webp)$/.test(file.type || '')) { yaPreparados.add(file); return file }
  let out = file
  try { out = await compressImage(file, 1600, 0.82, 'image/jpeg') } catch { out = file }
  yaPreparados.add(out)
  return out
}

/* Subida a Storage con PROGRESO real (XHR: fetch no expone el progreso de
   envío). Mismos headers que el REST (sesión → JWT del cliente → anon key).
   Resuelve { error } con la misma forma que supabase.storage.upload. */
export function subirArchivoChat({ path, file, contentType, onProgress, bucket = 'chat-files' }) {
  return new Promise(async (resolve) => {
    let headers = {}
    try { headers = await getAuthHeaders() } catch { /* sin headers → fallará con 401 y se informa */ }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`)
    if (headers.apikey)        xhr.setRequestHeader('apikey', headers.apikey)
    if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization)
    xhr.setRequestHeader('Content-Type', contentType || file?.type || 'application/octet-stream')
    xhr.setRequestHeader('x-upsert', 'true')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve({ error: null }); return }
      let d = {}
      try { d = JSON.parse(xhr.responseText || '{}') } catch { /* texto plano */ }
      resolve({ error: { message: d.message || d.error || `HTTP ${xhr.status}`, status: xhr.status } })
    }
    xhr.onerror   = () => resolve({ error: new TypeError('Failed to fetch') })
    xhr.ontimeout = () => resolve({ error: new TypeError('network timeout') })
    xhr.send(file)
  })
}

/* Traduce un error de subida/inserción a un mensaje concreto. `fase`:
   'upload' (Storage) | 'insert' (chat_messages, ya con el archivo subido). */
export function describirErrorSubida(err, fase = 'upload') {
  const msg    = String(err?.message || err || '').toLowerCase()
  const status = Number(err?.status || err?.statusCode || 0)
  if (fase === 'insert') {
    const detalle = err?.detalle ? ` (${String(err.detalle).slice(0, 140)})` : ''
    return `El archivo se subió pero no se pudo registrar el mensaje; lo descartamos. Intenta de nuevo.${detalle}`
  }
  if (status === 413 || /exceeded|maximum size|too large|payload/.test(msg)) {
    return `El archivo supera el máximo permitido (${CHAT_FILE_MAX_MB} MB).`
  }
  if (status === 415 || /mime|not supported|invalid.*type/.test(msg)) {
    return 'Tipo de archivo no permitido.'
  }
  if (status === 401 || status === 403 || /row-level|security|not allowed|unauthorized|jwt|permission/.test(msg)) {
    return 'No tienes permiso para subir archivos en esta sala. Recarga la página e intenta de nuevo.'
  }
  if (err instanceof TypeError || /failed to fetch|network|load failed|abort/.test(msg)) {
    return 'Sin conexión con el servidor. Revisa tu red e intenta de nuevo.'
  }
  return 'No se pudo subir el archivo. Intenta de nuevo.'
}

/* Descarga un archivo del chat con su nombre original: firma una URL fresca,
   lo trae como blob y dispara <a download>. (El atributo download se ignora
   en URLs de otro origen, por eso pasa por blob.) Si algo falla, abre el
   archivo en una pestaña como último recurso. Devuelve true si descargó. */
export async function downloadChatFile(src, fileName) {
  const url = await resolveSignedUrl(src, 600)
  if (!url) return false
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob   = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = fileName || 'archivo'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    return true
  } catch {
    return openChatFile(src)
  }
}

/* ── Grabación de voz ── */
const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',      // Chrome / Edge / Firefox / Opera
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',  // Safari (macOS 14.1+ / iOS 17+)
  'audio/mp4',
  'audio/ogg;codecs=opus',       // Firefox antiguo
  'audio/ogg',
]

/* Elige el mimeType que el navegador sabe grabar. '' = dejar que el
   navegador use su formato por defecto (Safari sin isTypeSupported).
   null = no hay MediaRecorder (no se puede grabar). */
export function elegirMimeAudio() {
  if (typeof MediaRecorder === 'undefined') return null
  if (typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return AUDIO_MIME_CANDIDATES.find(m => {
    try { return MediaRecorder.isTypeSupported(m) } catch { return false }
  }) || ''
}

/* Crea el MediaRecorder con el mimeType elegido; si el navegador lo rechaza
   igualmente (pasa en Safari), cae al constructor sin opciones. */
export function crearGrabadorAudio(stream) {
  const mime = elegirMimeAudio()
  if (mime === null) throw new Error('MediaRecorder no disponible')
  // 96 kbps: para voz con Opus/AAC es prácticamente transparente (el valor por
  // defecto del navegador suele quedar por debajo) y 1 min ≈ 700 KB.
  const opts = { audioBitsPerSecond: 96_000 }
  if (mime) {
    try { return new MediaRecorder(stream, { ...opts, mimeType: mime }) } catch { /* fallback abajo */ }
  }
  try { return new MediaRecorder(stream, opts) } catch { return new MediaRecorder(stream) }
}

/* Restricciones del micrófono: mono 48 kHz con cancelación de eco, supresión
   de ruido y ganancia automática (lo que más mejora la voz en celulares).
   Si el navegador no admite alguna, la ignora. */
export const AUDIO_CONSTRAINTS = {
  audio: {
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
}

/* Extensión del archivo de voz según el mimeType REAL del grabador. */
export function extAudio(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('ogg'))  return 'ogg'
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  return 'webm'
}

/* Content-Type "limpio" para Storage: sin ";codecs=…" (Firefox se niega a
   reproducir si se guarda con el sufijo) y normalizando el alias de Apple. */
export function mimeAudioLimpio(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase()
  if (!base) return 'audio/webm'
  if (base === 'audio/x-m4a') return 'audio/mp4'
  return base
}

export function describirErrorMicrofono(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Permite el acceso al micrófono en el navegador para grabar la nota de voz.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No se encontró un micrófono en este dispositivo.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'El micrófono está en uso por otra aplicación.'
  if (/MediaRecorder no disponible/.test(err?.message || '')) {
    return 'Tu navegador no permite grabar audio. Usa Chrome, Edge, Firefox o Safari actualizado.'
  }
  return 'No se pudo iniciar la grabación. Intenta de nuevo.'
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
          background: 'rgba(109,60,27,0.05)', color: '#b59e8a',
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
          style={{ minWidth: 160, minHeight: 120, background: 'rgba(109,60,27,0.06)', borderRadius: 12 }}
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

/* ══════════════════════════════════════════════════════════════════════
   FICHAS DE CONTACTO (mensaje de sistema tras confirmarse el pago)

   La RPC `fichas_contacto_chat` (docs/sql/fichas-contacto-2026-09-17.sql)
   inserta en la sala un mensaje con message_type 'system' cuyo contenido es
   un JSON {"t":"fichas", profesional:{…}, cliente:{…}} — mismo patrón que
   los mensajes de firma. Las cuatro superficies del chat (cliente, abogado,
   contador y superadmin) lo pintan con esta misma tarjeta, así que el estilo
   viaja aquí dentro en vez de duplicarse en cuatro módulos CSS.
   ══════════════════════════════════════════════════════════════════════ */

export function parseFichas(content) {
  try {
    const o = JSON.parse(content)
    return o?.t === 'fichas' ? o : null
  } catch { return null }
}

const FICHAS_CSS = `
.aapFichas { width: 100%; max-width: 560px; margin: 10px auto; background: #fff; border: 1px solid rgba(109,60,27,0.16); border-radius: 14px; overflow: hidden; box-shadow: 0 6px 18px rgba(71,47,41,0.07); font-family: inherit; text-align: left; flex-shrink: 0; align-self: center; }
.aapFichasHead { display: flex; align-items: flex-start; gap: 10px; padding: 13px 16px; background: linear-gradient(180deg, rgba(201,168,76,0.16), rgba(201,168,76,0.07)); border-bottom: 1px solid rgba(109,60,27,0.12); }
.aapFichasHead svg { flex-shrink: 0; margin-top: 1px; color: #8a6a28; }
.aapFichasTitle { display: block; font-family: 'Cinzel', 'Cormorant Garamond', serif; font-size: 0.86rem; letter-spacing: 0.03em; color: #472F29; margin: 0 0 2px; }
.aapFichasSub { display: block; font-size: 0.72rem; line-height: 1.45; color: #8a735f; }
.aapFichasGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.aapFicha { padding: 13px 16px; }
.aapFicha + .aapFicha { border-left: 1px solid rgba(109,60,27,0.1); }
.aapFichaRol { display: block; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: #a3856b; margin-bottom: 5px; }
.aapFichaNombre { display: block; font-size: 0.9rem; font-weight: 700; color: #472F29; line-height: 1.3; margin-bottom: 2px; word-break: break-word; }
.aapFichaArea { display: block; font-size: 0.72rem; color: #8a735f; line-height: 1.4; margin-bottom: 7px; word-break: break-word; }
.aapFichaDato { display: flex; align-items: flex-start; gap: 7px; font-size: 0.78rem; line-height: 1.5; color: #4a3726; overflow-wrap: anywhere; }
.aapFichaDato + .aapFichaDato { margin-top: 3px; }
.aapFichaDato svg { flex-shrink: 0; color: #a3856b; margin-top: 4px; }
.aapFichaDato a { color: #6d3c1b; text-decoration: none; border-bottom: 1px solid rgba(109,60,27,0.25); }
.aapFichaDato a:hover { border-bottom-color: #6d3c1b; }
.aapFichaVacio { font-size: 0.75rem; color: #b8a89a; font-style: italic; }
@media (max-width: 560px) {
  .aapFicha + .aapFicha { border-left: none; border-top: 1px solid rgba(109,60,27,0.1); }
}
`

const IconMailMini = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 4.5L8 8.75L13.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)
const IconPhoneMini = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.4 2.5H3.2c-.7 0-1.3.6-1.2 1.3.4 5 4.2 8.8 9.2 9.2.7.1 1.3-.5 1.3-1.2V9.6c0-.6-.4-1.1-1-1.2l-1.6-.3c-.4-.1-.9.1-1.1.5l-.5.8a8.4 8.4 0 0 1-3.3-3.3l.8-.5c.4-.2.6-.7.5-1.1l-.3-1.6c-.1-.6-.6-1-1.2-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)
const IconUnlock = () => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.5" y="8.75" width="13" height="8.25" rx="2" stroke="currentColor" strokeWidth="1.45" />
    <path d="M6.75 8.75V6.25a3.25 3.25 0 0 1 6.25-1.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
  </svg>
)

function FichaBloque({ rol, nombre, area, email, celular }) {
  return (
    <div className="aapFicha">
      <span className="aapFichaRol">{rol}</span>
      <span className="aapFichaNombre">{nombre || '—'}</span>
      {area && <span className="aapFichaArea">{area}</span>}
      {email ? (
        <span className="aapFichaDato"><IconMailMini /><a href={`mailto:${email}`}>{email}</a></span>
      ) : null}
      {celular ? (
        <span className="aapFichaDato"><IconPhoneMini /><a href={`tel:${celular.replace(/[^\d+]/g, '')}`}>{celular}</a></span>
      ) : null}
      {!email && !celular && <span className="aapFichaVacio">Sin datos de contacto registrados.</span>}
    </div>
  )
}

/* Tarjeta de las dos fichas. `data` es lo que devuelve parseFichas(). */
export function FichasContacto({ data }) {
  if (!data) return null
  const pro = data.profesional || {}
  const cli = data.cliente || {}
  return (
    <>
      <style>{FICHAS_CSS}</style>
      <div className="aapFichas" role="note">
        <div className="aapFichasHead">
          <IconUnlock />
          <span>
            <strong className="aapFichasTitle">Datos de contacto habilitados</strong>
            <span className="aapFichasSub">
              El pago quedó confirmado. Ya pueden comunicarse directamente por fuera del chat.
            </span>
          </span>
        </div>
        <div className="aapFichasGrid">
          <FichaBloque
            rol="Profesional"
            nombre={pro.nombre}
            area={pro.area}
            email={pro.email}
            celular={pro.celular}
          />
          <FichaBloque
            rol="Cliente"
            nombre={cli.nombre}
            email={cli.email}
            celular={cli.celular}
          />
        </div>
      </div>
    </>
  )
}

/* ── Revisión de datos de contacto en archivos (los tres roles del chat) ─────
   Antes de subir un PDF/imagen se revisa si trae teléfono, correo o dirección.
   Orden de menor a mayor costo:
     1. PDF / Word / TXT con texto → se extrae el texto en el navegador
        (extractDocText) y pasa por contieneContacto. Gratis, sin IA.
     2. Imagen, o PDF escaneado (sin texto) → primeras páginas/imagen
        comprimida a /api/ai modo 'censura' (Haiku). Centavos por archivo.
     3. Más de REVISION_MAX_BYTES, Excel/PowerPoint/.doc, o la IA no responde →
        NO se revisa: sube igual y queda un aviso en consola (`revisado:false`).
   Devuelve { contiene, motivo, revisado, aviso }. Nunca lanza. */
export const REVISION_MAX_BYTES = 4 * 1024 * 1024
const REVISION_MAX_PAGINAS = 3

/* Dirección física a la colombiana ("Calle 26 # 13-19", "Cra 7 No. 32-16",
   "Av. Boyacá 45A-10"). Solo se usa en la revisión de ARCHIVOS: en los
   mensajes de texto contieneContacto sigue igual (una dirección mencionada en
   la descripción de un caso inmobiliario no debe bloquear la conversación). */
const RE_DIRECCION = /\b(?:calle|cll|cl|carrera|cra|kr|kra|avenida|av|transversal|tv|trv|diagonal|dg|diag|manzana|mz)\.?\s*\d{1,3}\s*[a-z]?(?:\s*(?:bis|sur|norte|este|oeste))?\s*(?:#|n[°ºo]\.?|no\.?|num\.?|numero)\s*\d{1,3}\s*[a-z]?\s*-\s*\d{1,3}/i
const contieneDireccion = (t) => RE_DIRECCION.test(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, ''))

function fileABase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export async function revisarContactoArchivo(file, { roomId, authHeader } = {}) {
  const sinRevisar = (aviso) => {
    console.warn(`[chat] archivo "${file?.name}" enviado sin revisión de contacto (${aviso}).`)
    return { contiene: false, motivo: '', revisado: false, aviso }
  }
  if (!file || !roomId) return { contiene: false, motivo: '', revisado: false, aviso: 'sin_sala' }
  if (file.size > REVISION_MAX_BYTES) return sinRevisar('supera 4 MB')

  const nombre = String(file.name || '').toLowerCase()
  const tipo   = file.type || ''
  const esImg  = /^image\/(jpeg|png|webp|gif)$/.test(tipo)
  const esPdf  = tipo === 'application/pdf' || nombre.endsWith('.pdf')
  const esTxt  = nombre.endsWith('.docx') || nombre.endsWith('.txt')

  let imagenes = []
  if (esPdf || esTxt) {
    // 1) Texto en el navegador → regex local (gratis).
    try {
      const { extractDocText } = await import('../utils/extractDocText')
      const { text } = await extractDocText(file, { maxChars: 400_000 })
      if (text && text.length >= 20) {
        const contiene = contieneContacto(text) || contieneDireccion(text)
        return { contiene, motivo: contiene ? 'texto del documento' : '', revisado: true, aviso: '' }
      }
    } catch (err) {
      if (!esPdf) return sinRevisar(err?.message || 'sin texto')
    }
    if (!esPdf) return sinRevisar('sin texto legible')
    // 2) PDF escaneado → primeras páginas como JPEG liviano para la IA.
    try {
      const { rasterizarPdf } = await import('./pdfARaster')
      const paginas = await rasterizarPdf(await file.arrayBuffer(), 1.2, {
        maxPaginas: REVISION_MAX_PAGINAS, tipo: 'image/jpeg', calidad: 0.7,
      })
      imagenes = paginas.map(p => ({ kind: 'image', media_type: 'image/jpeg', data: p.dataUrl.split(',')[1] }))
    } catch (err) {
      return sinRevisar(err?.message || 'no se pudo leer el PDF')
    }
  } else if (esImg) {
    // Copia PEQUEÑA solo para la revisión (1000 px, calidad 0.6): leer un
    // teléfono o un correo no necesita resolución completa, y así el envío a la
    // IA no retrasa la subida en el celular. La imagen que se sube es la otra.
    try {
      let chica = file
      try { chica = await compressImage(file, 1000, 0.6, 'image/jpeg') } catch { /* va la original */ }
      imagenes = [{ kind: 'image', media_type: chica.type || 'image/jpeg', data: await fileABase64(chica) }]
    } catch (err) {
      return sinRevisar(err?.message || 'no se pudo leer la imagen')
    }
  } else {
    return sinRevisar('tipo no revisable')
  }

  const { ok, status, data } = await pedirIA({ modo: 'censura', roomId, adjuntos: imagenes }, { authHeader })
  if (!ok) return sinRevisar(data?.mensaje || data?.error || `HTTP ${status}`)
  return { contiene: data?.contiene_contacto === true, motivo: data?.motivo || '', revisado: true, aviso: '' }
}

/* ── Transcripción de notas de voz con la Web Speech API (gratis) ──────────
   Corre EN PARALELO al MediaRecorder mientras se graba: el navegador
   reconoce el habla (es-CO) y al parar devuelve el texto, que uploadAudio
   revisa con contieneContacto y guarda en chat_messages.transcripcion.
   Soportado en Chrome, Edge y Safari; en Firefox `soportado` es false y la
   nota se envía sin transcripción (como hasta ahora). Chrome corta el
   reconocimiento a ~60 s: se reanuda solo mientras la grabación siga. */
export function crearTranscriptor(lang = 'es-CO') {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  if (!SR) return { soportado: false, start() {}, stop: () => Promise.resolve('') }
  let rec = null, activo = false, finales = [], interino = ''
  const texto = () => [...finales, interino].join(' ').replace(/\s+/g, ' ').trim()
  const armar = () => {
    rec = new SR()
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) { finales.push(String(r[0]?.transcript || '').trim()); interino = '' }
        else interino = String(r[0]?.transcript || '')
      }
    }
    rec.onerror = (e) => { if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') activo = false }
    rec.onend = () => { if (activo) { try { rec.start() } catch { /* ya activo */ } } }
  }
  return {
    soportado: true,
    start() {
      activo = true; finales = []; interino = ''
      try { armar(); rec.start() } catch { activo = false }
    },
    stop() {
      activo = false
      return new Promise((resolve) => {
        if (!rec) return resolve('')
        let listo = false
        const fin = () => { if (listo) return; listo = true; resolve(texto()) }
        rec.onend = fin
        try { rec.stop() } catch { fin() }
        setTimeout(fin, 1500)   // por si el navegador no dispara onend
      })
    },
  }
}

/* ── Visor de PDF por imágenes ──────────────────────────────────────────────
   Android Chrome (y varios navegadores móviles) NO renderizan un PDF dentro de
   un <iframe>: lo mandan a descargar o dejan el marco en blanco. Por eso las
   previsualizaciones "no se veían" en el celular. Aquí el PDF se descarga, se
   rasteriza con pdf.js (que el proyecto ya usa para la firma) y se muestran las
   páginas como imágenes: se ve igual en escritorio y en móvil, y sigue siendo
   solo lectura (no hay descarga ni menú contextual).
   Si algo falla, se ofrece el enlace directo como último recurso. */
const PDF_MAX_PAGINAS = 12

export function PdfVisor({ url, titulo = 'Documento', fondo = '#fff' }) {
  const [paginas, setPaginas] = useState(null)   // null = cargando
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    setPaginas(null); setError('')
    ;(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        const { rasterizarPdf } = await import('./pdfARaster')
        // 1.5x es nítido en pantallas densas sin disparar la memoria del móvil.
        const pags = await rasterizarPdf(bytes, 1.5, {
          maxPaginas: PDF_MAX_PAGINAS, tipo: 'image/jpeg', calidad: 0.82,
        })
        if (vivo) setPaginas(pags)
      } catch (err) {
        console.error('[PdfVisor] no se pudo rasterizar:', err)
        if (vivo) { setError('No se pudo mostrar el documento aquí.'); setPaginas([]) }
      }
    })()
    return () => { vivo = false }
  }, [url])

  const caja = {
    width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden',
    borderRadius: 12, background: fondo, WebkitOverflowScrolling: 'touch',
  }

  if (paginas === null) {
    return (
      <div style={{ ...caja, display: 'grid', placeItems: 'center', color: '#8a6a28', fontSize: '0.85rem' }}>
        Cargando documento…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ ...caja, display: 'grid', placeItems: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, color: '#6d3c1b', fontSize: '0.88rem' }}>{error}</p>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.82rem', fontWeight: 700, color: '#8a6a28' }}>
          Abrirlo en otra pestaña
        </a>
      </div>
    )
  }
  return (
    <div style={caja} onContextMenu={e => e.preventDefault()}>
      {paginas.map((p, i) => (
        <img key={i} src={p.dataUrl} alt={`${titulo}, página ${i + 1}`} draggable={false}
          style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }} />
      ))}
      {paginas.length >= PDF_MAX_PAGINAS && (
        <p style={{ margin: 0, padding: '10px 14px', fontSize: '0.75rem', color: '#8a6a28', textAlign: 'center' }}>
          Se muestran las primeras {PDF_MAX_PAGINAS} páginas.
        </p>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   VisorArchivo — todo archivo se ve DENTRO de la plataforma.

   Antes varios sitios hacían `window.open(signedUrl)`, y eso saca al usuario
   a una pestaña con la URL cruda de Supabase: se ve el bucket, el token y la
   ruta interna. Además rompe el hilo de lo que estaba haciendo.

   Decide por extensión:
     · imagen → se muestra a pantalla completa
     · PDF    → se rasteriza y se pinta aquí (PdfVisor), sin visor externo
     · resto  → no hay nada que mostrar: se descarga y no se abre ventana

   Siempre ofrece descargar, que es la otra salida legítima.
   ═══════════════════════════════════════════════════════════════════════ */
const VISOR_CSS = `
  .aapVisor {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(30, 18, 8, 0.9);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    display: flex; flex-direction: column;
    animation: aapVisorIn 0.2s ease-out;
  }
  @keyframes aapVisorIn { from { opacity: 0 } to { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .aapVisor { animation: none } }
  .aapVisorBarra {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; color: #fff; flex-shrink: 0;
  }
  .aapVisorNombre {
    font-family: 'Poppins', sans-serif; font-size: 0.82rem; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
  }
  .aapVisorBtn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 13px; border-radius: 9px; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.28); background: rgba(255,255,255,0.1);
    color: #fff; font-family: 'Poppins', sans-serif; font-size: 0.76rem; font-weight: 600;
    white-space: nowrap;
  }
  .aapVisorBtn:hover { background: rgba(255,255,255,0.2); }
  .aapVisorBtn:focus-visible { outline: 2px solid #e8c96a; outline-offset: 2px; }
  .aapVisorCuerpo {
    flex: 1; min-height: 0; overflow: auto;
    display: flex; align-items: center; justify-content: center;
    padding: 0 14px 16px;
  }
  .aapVisorImg {
    max-width: 100%; max-height: 100%; object-fit: contain;
    border-radius: 8px; user-select: none; -webkit-user-select: none;
  }
  .aapVisorPdf { width: 100%; max-width: 900px; align-self: flex-start; }
  @media (max-width: 600px) {
    .aapVisorBarra { padding: 8px 10px; gap: 8px; }
    .aapVisorCuerpo { padding: 0 8px 12px; }
    .aapVisorBtn { padding: 7px 10px; }
  }
`

const ES_IMAGEN = /\.(png|jpe?g|webp|gif|avif)$/i
const ES_PDF    = /\.pdf$/i

// `archivo`: { url, nombre } o null. `nombre` decide el tipo y el nombre de
// descarga, así que conviene pasarlo siempre.
export function VisorArchivo({ archivo, onClose }) {
  const [bajando, setBajando] = useState(false)

  useEffect(() => {
    if (!archivo) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [archivo, onClose])

  // Un archivo que no se puede mostrar no abre ventana: se descarga y punto.
  useEffect(() => {
    if (!archivo) return
    const n = archivo.nombre || archivo.url || ''
    if (!ES_IMAGEN.test(n) && !ES_PDF.test(n)) {
      downloadChatFile(archivo.url, archivo.nombre || 'documento')
      onClose?.()
    }
  }, [archivo, onClose])

  if (!archivo) return null
  const nombre = archivo.nombre || 'Documento'
  const esImagen = ES_IMAGEN.test(nombre) || ES_IMAGEN.test(archivo.url || '')
  const esPdf    = ES_PDF.test(nombre)    || ES_PDF.test(archivo.url || '')
  if (!esImagen && !esPdf) return null   // ya se disparó la descarga

  async function descargar() {
    setBajando(true)
    try { await downloadChatFile(archivo.url, nombre) }
    finally { setBajando(false) }
  }

  return createPortal(
    <>
      <style>{VISOR_CSS}</style>
      <div className="aapVisor" role="dialog" aria-modal="true" aria-label={nombre}
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
        <div className="aapVisorBarra">
          <span className="aapVisorNombre">{nombre}</span>
          <button type="button" className="aapVisorBtn" onClick={descargar} disabled={bajando}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
            </svg>
            {bajando ? 'Descargando…' : 'Descargar'}
          </button>
          <button type="button" className="aapVisorBtn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="aapVisorCuerpo" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
          {esImagen ? (
            <img src={archivo.url} alt={nombre} className="aapVisorImg"
              onContextMenu={(e) => e.preventDefault()} draggable="false" />
          ) : (
            <div className="aapVisorPdf">
              <PdfVisor url={archivo.url} titulo={nombre} />
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
