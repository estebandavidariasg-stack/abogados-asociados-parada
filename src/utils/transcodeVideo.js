/* ────────────────────────────────────────────────────────────────────────
   Transcodifica un video a MP4/H.264 optimizado para web vía ffmpeg.wasm.

   Resultados típicos:
     · 30 MB MOV iPhone (1080p, ~24Mbps)  →  ~3-5 MB MP4 H.264 (720p, 1.5Mbps)
     · 50 MB AVI (1080p, sin comprimir)   →  ~6-8 MB MP4 H.264 (720p)

   Flags clave:
     -c:v libx264 -crf 24 -preset fast    → calidad/peso equilibrados
     -vf "scale='min(1280,iw)':-2"        → tope 1280px ancho, preserva ratio
     -c:a aac -b:a 96k                    → audio compatible y liviano
     -movflags +faststart                 → moov al inicio: el browser empieza
                                            a reproducir antes de descargar todo

   El core ffmpeg-wasm (~30 MB) se carga LAZY desde CDN solo cuando el admin
   sube un video — no afecta el bundle inicial de la home.
──────────────────────────────────────────────────────────────────────── */

import { fetchFile } from '@ffmpeg/util'

// CDN del core single-thread (no requiere COOP/COEP). Si algún día queremos
// multi-thread, hay que servir el frontend con Cross-Origin-Opener-Policy:
// same-origin + Cross-Origin-Embedder-Policy: require-corp.
const CORE_VERSION = '0.12.6'
const CORE_BASE    = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`

// Si el video ya es chico y razonablemente comprimido, transcodificar puede
// dar más peso del que ahorra. Saltamos el transcoding bajo este umbral.
const SKIP_TRANSCODE_BYTES = 8 * 1024 * 1024 // 8 MB

let _ffmpeg     = null
let _loadingPromise = null

async function getFFmpeg(onLog) {
  if (_ffmpeg) return _ffmpeg
  if (_loadingPromise) return _loadingPromise
  _loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(message))
    await ff.load({
      coreURL: `${CORE_BASE}/ffmpeg-core.js`,
      wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
    })
    _ffmpeg = ff
    return ff
  })()
  return _loadingPromise
}

/**
 * @param {File}     file
 * @param {Object}   [opts]
 * @param {(stage: 'loading'|'transcoding', progress: number) => void} [opts.onProgress]
 *        progress en [0..1]. 'loading' es la descarga del core; 'transcoding' es ffmpeg corriendo.
 * @returns {Promise<File>} MP4/H.264 optimizado, o el original si:
 *   · el archivo es < SKIP_TRANSCODE_BYTES
 *   · el transcoding falla (lo logueamos pero no rompemos el upload)
 *   · el resultado es MAYOR que el original
 */
export async function transcodeVideo(file, opts = {}) {
  const { onProgress } = opts

  if (!(file instanceof File) && !(file instanceof Blob)) {
    throw new Error('transcodeVideo: se esperaba File o Blob')
  }
  if (file.size < SKIP_TRANSCODE_BYTES) {
    // Ya es chico — no vale la pena el costo de transcodificar.
    return file
  }

  let ff
  try {
    onProgress?.('loading', 0)
    ff = await getFFmpeg()
    onProgress?.('loading', 1)
  } catch (err) {
    console.warn('No se pudo cargar ffmpeg.wasm; subo el video sin transcodificar:', err)
    return file
  }

  const progressHandler = ({ progress }) => {
    // Algunos builds reportan progress > 1 al final — clampeamos.
    onProgress?.('transcoding', Math.max(0, Math.min(1, progress)))
  }
  ff.on('progress', progressHandler)

  const ext        = ((file.name || 'in.mp4').split('.').pop() || 'mp4').toLowerCase()
  const inputName  = `input.${ext}`
  const outputName = 'output.mp4'

  try {
    await ff.writeFile(inputName, await fetchFile(file))

    await ff.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '24',
      '-vf', "scale='min(1280,iw)':-2",
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y',
      outputName,
    ])

    const data = await ff.readFile(outputName)
    const blob = new Blob([data], { type: 'video/mp4' })

    if (blob.size >= file.size) {
      // El "optimizado" pesa más — el original ya estaba bien comprimido.
      return file
    }

    const baseName = (file.name || 'video').replace(/\.[^.]+$/, '')
    return new File([blob], `${baseName}.mp4`, {
      type: 'video/mp4',
      lastModified: Date.now(),
    })
  } catch (err) {
    console.warn('Transcoding falló; subo el video original:', err)
    return file
  } finally {
    ff.off('progress', progressHandler)
    // Limpieza del FS virtual; ignoramos errores si los archivos no existen.
    try { await ff.deleteFile(inputName) }  catch {}
    try { await ff.deleteFile(outputName) } catch {}
  }
}
