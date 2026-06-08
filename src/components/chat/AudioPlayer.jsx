import { useState, useRef, useEffect } from 'react'
import styles from './AudioPlayer.module.css'
import { resolveSignedUrl } from '../../lib/chatFiles'

/* La resolución de URL (firma fresca on-demand para que el audio nunca
   expire) vive en src/lib/chatFiles.jsx — compartida con ChatImage y la
   apertura de archivos. */
export default function AudioPlayer({ src, mine, theme = 'dark' }) {
  const audioRef                          = useRef(null)
  const [playing, setPlaying]             = useState(false)
  const [progress, setProgress]           = useState(0)
  const [duration, setDuration]           = useState(0)
  const [current, setCurrent]             = useState(0)
  const [error, setError]                 = useState(false)
  const [loaded, setLoaded]               = useState(false)
  const [resolvedSrc, setResolvedSrc]     = useState(null)
  const [resolveFailed, setResolveFailed] = useState(false)

  // Resolver el src a un signed URL fresco antes de pasarlo al <audio>
  useEffect(() => {
    let cancelled = false
    setResolvedSrc(null); setResolveFailed(false)
    setError(false);      setLoaded(false)
    resolveSignedUrl(src, 60 * 60)
      .then(url => {
        if (cancelled) return
        if (url) setResolvedSrc(url)
        else     setResolveFailed(true)
      })
      .catch(() => { if (!cancelled) setResolveFailed(true) })
    return () => { cancelled = true }
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !resolvedSrc) return
    setError(false); setLoaded(false)

    // Flag para distinguir errores reales del audio vs errores
    // disparados por el truco del seek a 1e101 (durationFix).
    let isAttemptingDurationFix = false
    // Una vez que el seek a 1e101 fallo (webm legacy sin Cues), NO reintentar
    // — el reload del audio dispara loadedmetadata de nuevo y entrariamos
    // en loop infinito.
    let skipDurationFix = false
    let durationFixTimer = null

    const onDurationFix = () => {
      isAttemptingDurationFix = false
      if (audio.duration !== Infinity && !isNaN(audio.duration)) {
        setDuration(audio.duration)
      }
      audio.removeEventListener('timeupdate', onDurationFix)
      clearTimeout(durationFixTimer)
      try { audio.currentTime = 0 } catch {}
    }

    const onLoaded = () => {
      setLoaded(true)
      if (audio.duration !== Infinity && !isNaN(audio.duration)) {
        setDuration(audio.duration)
        return
      }
      // Si ya intentamos antes y fallo (webm legacy), no reintentar.
      if (skipDurationFix) return
      // WebM blobs de MediaRecorder llegan con duration=Infinity. Truco:
      // forzar seek a un valor imposible para que el navegador recalcule.
      // Firefox a veces no dispara timeupdate → timeout de seguridad.
      isAttemptingDurationFix = true
      audio.addEventListener('timeupdate', onDurationFix)
      durationFixTimer = setTimeout(() => {
        isAttemptingDurationFix = false
        audio.removeEventListener('timeupdate', onDurationFix)
      }, 1500)
      try { audio.currentTime = 1e101 } catch {}
    }
    const onTime = () => {
      setCurrent(audio.currentTime)
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0)
      if (audio.duration !== Infinity && !isNaN(audio.duration)) setDuration(audio.duration)
    }
    const onEnded  = () => { setPlaying(false); setProgress(0); setCurrent(0) }
    const onError  = (ev) => {
      const code = ev?.currentTarget?.error?.code
      const msg  = ev?.currentTarget?.error?.message
      // Caso especial: webm viejos de MediaRecorder sin Cues. El seek a 1e101
      // del durationFix falla con "FFmpegDemuxer: demuxer seek failed". El
      // archivo IGUAL es reproducible desde 0 — solo el seek no funciona.
      // Recuperamos: limpiamos el error state recargando el <audio> y
      // dejamos que el usuario pueda darle play normalmente.
      if (isAttemptingDurationFix) {
        console.warn('[AudioPlayer] seek del durationFix falló (webm legacy sin Cues); recuperando para permitir play', { msg, resolvedSrc })
        isAttemptingDurationFix = false
        skipDurationFix = true   // NUNCA reintentar — evita loop infinito al recargar.
        audio.removeEventListener('timeupdate', onDurationFix)
        clearTimeout(durationFixTimer)
        // Reload del audio: limpia el error state y permite play desde 0.
        // El loadedmetadata que viene tras el load() vera skipDurationFix=true
        // y NO volvera a intentar el seek.
        const currentSrc = audio.src
        try {
          audio.removeAttribute('src')
          audio.load()
          audio.src = currentSrc
          audio.load()
        } catch {}
        return
      }
      console.warn('[AudioPlayer] <audio> error', { code, msg, resolvedSrc, srcOriginal: src })
      setError(true)
      setPlaying(false)
    }
    const onCanPlay = () => setLoaded(true)

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('canplay', onCanPlay)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('timeupdate', onDurationFix)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('canplay', onCanPlay)
      clearTimeout(durationFixTimer)
    }
  }, [resolvedSrc])

  async function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    try {
      if (playing) {
        audio.pause()
        setPlaying(false)
      } else {
        await audio.play()
        setPlaying(true)
      }
    } catch (err) {
      console.error('Error reproduciendo audio:', err)
      setError(true)
    }
  }

  function handleSeek(e) {
    const audio = audioRef.current
    if (!audio || !audio.duration || audio.duration === Infinity) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * audio.duration
    setProgress(pct * 100)
  }

  function fmt(s) {
    if (!s || isNaN(s) || s === Infinity || s === 0) return '0:00'
    const m   = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const HEIGHTS = [20,35,55,40,65,80,50,35,70,45,60,30,75,55,40,65,35,80,50,40,70,30,55,65,45,75,35,60,50,40]

  // theme 'light' (ChatSection, fondo claro): el audio adopta el color de la
  // burbuja → cliente (mine) navy, profesional (other) blanco. 'dark' (default,
  // dashboards): se mantiene el skin dorado original sobre fondo oscuro.
  const light = theme === 'light'
  const skin = light
    ? (mine ? styles.playerMineLight : styles.playerOtherLight)
    : (mine ? styles.playerMine : styles.playerOther)

  if (error || resolveFailed) {
    return (
      <div className={`${styles.player} ${skin}`}>
        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Audio no disponible</span>
      </div>
    )
  }

  return (
    <div className={`${styles.player} ${skin}`}>
      <audio ref={audioRef} src={resolvedSrc || undefined} preload="auto" crossOrigin="anonymous" />

      <button className={styles.playBtn} onClick={togglePlay} disabled={!loaded}>
        {playing
          ? <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
          : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
        }
      </button>

      <div className={styles.waveWrap} onClick={handleSeek}>
        <div className={styles.waveTrack}>
          <div className={styles.waveLines}>
            {HEIGHTS.map((h, i) => {
              const filled = (i / HEIGHTS.length) * 100 <= progress
              return (
                <div key={i} className={styles.waveLine}
                  style={{
                    height: `${h}%`,
                    background: filled
                      ? (light
                          ? (mine ? 'rgba(255,255,255,0.9)' : 'var(--navy, #0d2d5e)')
                          : (mine ? 'rgba(0,0,0,0.5)' : 'var(--gold)'))
                      : (light
                          ? (mine ? 'rgba(255,255,255,0.4)' : 'rgba(13,45,94,0.28)')
                          : (mine ? 'rgba(0,0,0,0.2)' : 'rgba(201,168,76,0.25)'))
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      <span className={styles.time}>
        {playing ? fmt(current) : fmt(duration)}
      </span>
    </div>
  )
}