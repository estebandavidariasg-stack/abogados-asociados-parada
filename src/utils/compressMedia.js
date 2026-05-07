/* ────────────────────────────────────────────────────────────────────────
   Utilidades de compresión / validación de media para subidas del admin.
   Sin librerías externas — solo Canvas API y validaciones nativas.

   compressImage(file, maxWidthPx, quality) → Promise<File>
   compressVideo(file, maxMb)               → File   (NO comprime, valida)
──────────────────────────────────────────────────────────────────────── */

const SKIP_THRESHOLD_BYTES = 300 * 1024 // 300KB

// Detección perezosa y cacheada del formato más eficiente que el canvas
// puede encodear. Orden de preferencia: AVIF > WebP > JPEG.
//   · AVIF da ~30% menos peso que WebP a igual calidad pero el soporte de
//     canvas.toDataURL('image/avif') es limitado (Chrome/Edge desde ~v126).
//   · WebP soporte universal moderno.
//   · JPEG último fallback.
let _bestFormat = null
function bestCanvasFormat() {
  if (_bestFormat !== null) return _bestFormat
  try {
    const c = document.createElement('canvas')
    c.width = 1; c.height = 1
    if (c.toDataURL('image/avif').startsWith('data:image/avif')) {
      _bestFormat = { mime: 'image/avif', ext: 'avif' }
    } else if (c.toDataURL('image/webp').startsWith('data:image/webp')) {
      _bestFormat = { mime: 'image/webp', ext: 'webp' }
    } else {
      _bestFormat = { mime: 'image/jpeg', ext: 'jpg' }
    }
  } catch {
    _bestFormat = { mime: 'image/jpeg', ext: 'jpg' }
  }
  return _bestFormat
}

/**
 * Redimensiona y comprime una imagen client-side usando Canvas.
 * Salida: WebP (~25% más liviano que JPEG) si el navegador lo soporta,
 * JPEG en otro caso.
 *
 * @param {File|Blob} file        Archivo de imagen a comprimir.
 * @param {number}    maxWidthPx  Ancho máximo en px (mantiene aspect ratio). Default 1200.
 * @param {number}    quality     Calidad 0..1 para WebP/JPEG. Default 0.82.
 * @returns {Promise<File>} Archivo nuevo (o el original si < 300KB / formato no compatible / re-encode resultaría mayor).
 */
export async function compressImage(file, maxWidthPx = 1200, quality = 0.82) {
  if (!file || (!(file instanceof File) && !(file instanceof Blob))) {
    throw new Error('compressImage: se esperaba un File o Blob')
  }

  // Formatos que NO conviene re-encodear:
  //  · SVG: vectorial, perdería todo al rasterizar
  //  · GIF: el canvas mata la animación
  //  · types vacíos: no es una imagen detectable
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file

  // Si ya es pequeño, lo dejamos tal cual.
  if (file.size < SKIP_THRESHOLD_BYTES) return file

  const bitmap = await loadBitmap(file)

  const srcWidth  = bitmap.width
  const srcHeight = bitmap.height
  if (!srcWidth || !srcHeight) {
    if (typeof bitmap.close === 'function') bitmap.close()
    return file
  }

  // Mantener aspect ratio. Si la imagen ya es más estrecha que maxWidthPx,
  // no upscaleamos — solo recomprimimos.
  const targetWidth  = Math.min(maxWidthPx, srcWidth)
  const targetHeight = Math.round(targetWidth * (srcHeight / srcWidth))

  const canvas = document.createElement('canvas')
  canvas.width  = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    if (typeof bitmap.close === 'function') bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  if (typeof bitmap.close === 'function') bitmap.close()

  const { mime, ext } = bestCanvasFormat()

  // AVIF rinde mejor a calidad menor: ajustamos al vuelo para mantener tamaños
  // razonables sin sobre-comprimir (q=0.55 AVIF ≈ q=0.82 JPEG visualmente).
  const effectiveQuality = mime === 'image/avif' ? Math.min(quality, 0.55) : quality

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Canvas toBlob devolvió null')),
      mime,
      effectiveQuality,
    )
  })

  // Recomprimir puede dar MAYOR tamaño si la fuente ya estaba optimizada
  // (PNG con poco color, JPEG ya a calidad alta). En ese caso devolvemos el
  // original — el usuario sube algo, no pretendemos empeorarlo.
  if (blob.size >= file.size) return file

  const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.${ext}`, {
    type: mime,
    lastModified: Date.now(),
  })
}

/**
 * Carga un File como ImageBitmap (preferido) o HTMLImageElement (fallback).
 * createImageBitmap es ~3-5x más rápido y respeta orientación EXIF.
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Algunos navegadores no soportan imageOrientation — reintentamos sin opciones
      try { return await createImageBitmap(file) } catch { /* fallback abajo */ }
    }
  }
  // Fallback: HTMLImageElement vía blob URL
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = ()  => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen')) }
    img.src = url
  })
}

/**
 * NO comprime video client-side — solo valida el tamaño máximo.
 * Mantenemos la firma con prefijo `compress*` para uniformidad con compressImage,
 * pero el cuerpo es solo una guarda.
 *
 * @param {File|Blob} file   Archivo de video.
 * @param {number}    maxMb  Tamaño máximo en MB. Default 50.
 * @returns {File} El mismo archivo si pasa la validación.
 * @throws {Error} `El video no puede superar ${maxMb}MB` si el archivo es mayor.
 */
export function compressVideo(file, maxMb = 50) {
  if (!file || (!(file instanceof File) && !(file instanceof Blob))) {
    throw new Error('compressVideo: se esperaba un File o Blob')
  }
  const sizeMb = file.size / (1024 * 1024)
  if (sizeMb > maxMb) {
    throw new Error(`El video no puede superar ${maxMb}MB`)
  }
  return file
}
