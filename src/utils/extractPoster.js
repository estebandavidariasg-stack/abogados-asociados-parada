/* ────────────────────────────────────────────────────────────────────────
   Extrae la primera frame visible de un video como imagen comprimida.
   Sirve como `poster` del <video> en el carrusel: el navegador la pinta
   instantáneamente sin tener que descargar nada del MP4.

   La frame se toma a t=0.5s (no en t=0 porque muchos videos arrancan con
   un fade-in negro). Salida: WebP a ~720p ancho, q=0.75.
──────────────────────────────────────────────────────────────────────── */

const POSTER_WIDTH    = 720
const POSTER_QUALITY  = 0.75
const SEEK_TIME       = 0.5  // segundos
const SEEK_TIMEOUT_MS = 8000

/**
 * @param {File|Blob} videoFile  Archivo de video.
 * @returns {Promise<{ blob: Blob, ext: string, mime: string, width: number, height: number }>}
 */
export async function extractPosterFromVideo(videoFile) {
  if (!videoFile || (!(videoFile instanceof File) && !(videoFile instanceof Blob))) {
    throw new Error('extractPosterFromVideo: se esperaba File o Blob')
  }

  const url = URL.createObjectURL(videoFile)
  const video = document.createElement('video')
  video.preload     = 'auto'
  video.muted       = true        // requerido para autoplay/seek silencioso en algunos browsers
  video.playsInline = true
  video.crossOrigin = 'anonymous' // por si el blob es servido desde otro origen
  video.src         = url

  try {
    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error',          onError)
        resolve()
      }
      const onError = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error',          onError)
        reject(new Error('No se pudo leer el video para extraer poster'))
      }
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error',          onError)
    })

    // Buscar al frame deseado (sin pasarse de la duración)
    const seekTo = Math.min(SEEK_TIME, Math.max(0, (video.duration || 0) - 0.05))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked)
        reject(new Error('Timeout buscando frame del video'))
      }, SEEK_TIMEOUT_MS)
      const onSeeked = () => {
        clearTimeout(timer)
        video.removeEventListener('seeked', onSeeked)
        resolve()
      }
      video.addEventListener('seeked', onSeeked)
      try { video.currentTime = seekTo } catch (e) { reject(e) }
    })

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) throw new Error('Video sin dimensiones legibles')

    const targetW = Math.min(POSTER_WIDTH, srcW)
    const targetH = Math.round(targetW * (srcH / srcW))

    const canvas = document.createElement('canvas')
    canvas.width  = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No hay contexto 2D para extraer poster')
    ctx.drawImage(video, 0, 0, targetW, targetH)

    // Preferimos WebP; fallback a JPEG si el browser no encodea WebP.
    const supportsWebp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    const mime = supportsWebp ? 'image/webp' : 'image/jpeg'
    const ext  = supportsWebp ? 'webp' : 'jpg'

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('Canvas toBlob devolvió null')),
        mime,
        POSTER_QUALITY,
      )
    })

    return { blob, ext, mime, width: targetW, height: targetH }
  } finally {
    URL.revokeObjectURL(url)
    // Limpiar el elemento para liberar memoria
    video.src = ''
    video.load()
  }
}
