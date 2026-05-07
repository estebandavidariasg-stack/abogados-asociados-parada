/* ────────────────────────────────────────────────────────────────────────
   Utilidades de compresión / validación de media para subidas del admin.
   Sin librerías externas — solo Canvas API y validaciones nativas.

   compressImage(file, maxWidthPx, qualityJpeg) → Promise<File>
   compressVideo(file, maxMb)                   → File   (NO comprime, valida)
──────────────────────────────────────────────────────────────────────── */

const SKIP_THRESHOLD_BYTES = 300 * 1024 // 300KB

/**
 * Redimensiona y comprime una imagen client-side usando Canvas.
 *
 * @param {File|Blob} file        Archivo de imagen a comprimir.
 * @param {number}    maxWidthPx  Ancho máximo en px (mantiene aspect ratio). Default 1400.
 * @param {number}    qualityJpeg Calidad JPEG 0..1. Default 0.82.
 * @returns {Promise<File>} Archivo JPEG nuevo (o el original si < 300KB / formato no compatible).
 */
export async function compressImage(file, maxWidthPx = 1400, qualityJpeg = 0.82) {
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
    // No pudimos leer dimensiones — devolvemos el original
    if (typeof bitmap.close === 'function') bitmap.close()
    return file
  }

  // Mantener aspect ratio. Si la imagen ya es más estrecha que maxWidthPx,
  // no upscaleamos — solo recomprimimos a JPEG.
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

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Canvas toBlob devolvió null')),
      'image/jpeg',
      qualityJpeg,
    )
  })

  // Recomprimir puede dar MAYOR tamaño si la fuente ya estaba optimizada
  // (PNG con poco color, JPEG ya a calidad alta). En ese caso devolvemos el
  // original — el usuario sube algo, no pretendemos empeorarlo.
  if (blob.size >= file.size) return file

  const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.jpg`, {
    type: 'image/jpeg',
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
