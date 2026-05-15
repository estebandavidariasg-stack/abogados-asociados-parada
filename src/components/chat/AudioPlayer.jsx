import { useState, useRef, useEffect } from 'react'
import styles from './AudioPlayer.module.css'
import { supabase } from '../../lib/supabase'

/* ── Resolución de URL del audio ──────────────────────────────────────────
   Los uploads viejos guardaban el signed URL completo en chat_messages
   (con expiración de 7 días). Después de 7 días el URL muere y el audio
   queda inaccesible aunque el archivo SIGA en el bucket.

   Esta función rescata esos audios:
     · Si recibimos un path simple ("<userId>/voz.webm") → firmamos por 1h
     · Si recibimos un URL firmado expirado → extraemos el path interno y
       re-firmamos
     · Si no podemos derivar un path → devolvemos el src original (último
       intento, por si era un URL público válido)
*/
function extractChatFilesPath(url) {
  if (!url) return null
  // URL firmado:  /storage/v1/object/sign/chat-files/<path>?token=...
  const signed = url.match(/\/storage\/v1\/object\/sign\/chat-files\/([^?]+)/)
  if (signed) return decodeURIComponent(signed[1])
  // URL público/directo: /storage/v1/object/(public/)?chat-files/<path>
  const direct = url.match(/\/storage\/v1\/object\/(?:public\/)?chat-files\/([^?]+)/)
  if (direct) return decodeURIComponent(direct[1])
  return null
}

async function resolveAudioUrl(src) {
  if (!src) return null
  // Path puro (formato nuevo)
  if (!/^https?:\/\//.test(src)) {
    const { data } = await supabase.storage
      .from('chat-files')
      .createSignedUrl(src, 60 * 60) // 1 h, suficiente para reproducir
    return data?.signedUrl || null
  }
  // URL — intentar extraer el path interno y re-firmar
  const path = extractChatFilesPath(src)
  if (path) {
    const { data } = await supabase.storage
      .from('chat-files')
      .createSignedUrl(path, 60 * 60)
    return data?.signedUrl || src
  }
  // Formato no reconocido — devolver tal cual (último intento)
  return src
}

export default function AudioPlayer({ src, mine }) {
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
    resolveAudioUrl(src)
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

    let durationFixTimer = null
    const onDurationFix = () => {
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
      // WebM blobs de MediaRecorder llegan con duration=Infinity. Truco:
      // forzar seek a un valor imposible para que el navegador recalcule.
      // Firefox a veces no dispara timeupdate → timeout de seguridad.
      audio.addEventListener('timeupdate', onDurationFix)
      durationFixTimer = setTimeout(() => {
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
    const onError  = () => { setError(true); setPlaying(false) }
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

  if (error || resolveFailed) {
    return (
      <div className={`${styles.player} ${mine ? styles.playerMine : styles.playerOther}`}>
        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Audio no disponible</span>
      </div>
    )
  }

  return (
    <div className={`${styles.player} ${mine ? styles.playerMine : styles.playerOther}`}>
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
                      ? (mine ? 'rgba(0,0,0,0.5)' : 'var(--gold)')
                      : (mine ? 'rgba(0,0,0,0.2)' : 'rgba(201,168,76,0.25)')
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