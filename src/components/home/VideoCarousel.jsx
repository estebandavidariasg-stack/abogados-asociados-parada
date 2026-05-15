import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { compressVideo } from '../../utils/compressMedia'
import { transcodeVideo }       from '../../utils/transcodeVideo'
import { extractPosterFromVideo } from '../../utils/extractPoster'
import styles from './VideoCarousel.module.css'
import { IconVideoCamera, IconX } from '../shared/Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/* ─────────────────────────────────────────────
   Formatea segundos → "m:ss"
───────────────────────────────────────────── */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/* ─────────────────────────────────────────────
   VideoControls – barra de controles estilo YouTube
   Se muestra al hover y se oculta después de 3 s de inactividad
───────────────────────────────────────────── */
function VideoControls({ videoEl, onEnded }) {
  const [playing,    setPlaying]    = useState(false)
  const [muted,      setMuted]      = useState(false)
  const [volume,     setVolume]     = useState(1)
  const [current,    setCurrent]    = useState(0)
  const [duration,   setDuration]   = useState(0)
  const [buffered,   setBuffered]   = useState(0)
  const [visible,    setVisible]    = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const hideTimer = useRef(null)
  const barRef    = useRef(null)

  /* ── Sincronizar estado con el elemento video ── */
  useEffect(() => {
    const v = videoEl
    if (!v) return

    const onPlay    = () => setPlaying(true)
    const onPause   = () => setPlaying(false)
    const onVolume  = () => { setMuted(v.muted); setVolume(v.muted ? 0 : v.volume) }
    const onTime    = () => {
      setCurrent(v.currentTime)
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
    }
    const onMeta    = () => setDuration(v.duration)
    const onEnd     = () => { setPlaying(false); onEnded?.() }
    const onFullChg = () => setFullscreen(!!document.fullscreenElement)

    v.addEventListener('play',              onPlay)
    v.addEventListener('pause',             onPause)
    v.addEventListener('volumechange',      onVolume)
    v.addEventListener('timeupdate',        onTime)
    v.addEventListener('loadedmetadata',    onMeta)
    v.addEventListener('ended',             onEnd)
    document.addEventListener('fullscreenchange', onFullChg)

    // Estado inicial
    setPlaying(!v.paused)
    setMuted(v.muted)
    setVolume(v.muted ? 0 : v.volume)
    setDuration(v.duration || 0)

    return () => {
      v.removeEventListener('play',             onPlay)
      v.removeEventListener('pause',            onPause)
      v.removeEventListener('volumechange',     onVolume)
      v.removeEventListener('timeupdate',       onTime)
      v.removeEventListener('loadedmetadata',   onMeta)
      v.removeEventListener('ended',            onEnd)
      document.removeEventListener('fullscreenchange', onFullChg)
    }
  }, [videoEl, onEnded])

  /* ── Mostrar/ocultar barra con inactividad ── */
  const showControls = useCallback(() => {
    setVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), 3000)
  }, [])

  const hideControls = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), 500)
  }, [])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  /* ── Acciones ── */
  const togglePlay = () => {
    if (!videoEl) return
    videoEl.paused ? videoEl.play() : videoEl.pause()
  }

  const toggleMute = () => {
    if (!videoEl) return
    videoEl.muted = !videoEl.muted
    if (!videoEl.muted && videoEl.volume === 0) videoEl.volume = 0.5
  }

  const changeVolume = (val) => {
    if (!videoEl) return
    const v = parseFloat(val)
    videoEl.volume = v
    videoEl.muted  = v === 0
  }

  const seek = (e) => {
    if (!videoEl || !duration) return
    const rect = barRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    videoEl.currentTime = ratio * duration
  }

  const toggleFullscreen = () => {
    const container = videoEl?.closest?.('.' + styles.slide) || videoEl?.parentElement
    if (!document.fullscreenElement) {
      container?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  const progress = duration ? (current  / duration) * 100 : 0
  const buffPct  = duration ? (buffered / duration) * 100 : 0

  /* ── Icono volumen ── */
  const VolumeIcon = () => {
    if (muted || volume === 0) return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    )
    if (volume < 0.5) return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
      </svg>
    )
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    )
  }

  const PlayIcon = () => playing
    ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
    : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>

  const FullscreenIcon = () => fullscreen
    ? <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
    : <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>

  return (
    <div
      className={`${styles.controls} ${visible ? styles.controlsVisible : ''}`}
      onMouseEnter={showControls}
      onMouseMove={showControls}
      onMouseLeave={hideControls}
      onTouchStart={showControls}
    >
      {/* Gradiente oscuro inferior */}
      <div className={styles.controlsGradient} />

      <div className={styles.controlsInner}>
        {/* Barra de progreso */}
        <div
          ref={barRef}
          className={styles.progressBar}
          onClick={seek}
          onMouseMove={(e) => { if (e.buttons === 1) seek(e) }}
        >
          <div className={styles.progressBg} />
          <div className={styles.progressBuffered} style={{ width: `${buffPct}%` }} />
          <div className={styles.progressFill}     style={{ width: `${progress}%` }} />
          <div className={styles.progressThumb}    style={{ left:  `${progress}%` }} />
        </div>

        {/* Fila de botones */}
        <div className={styles.controlsRow}>
          {/* Izquierda */}
          <div className={styles.controlsLeft}>
            <button className={styles.ctrlBtn} onClick={togglePlay} title={playing ? 'Pausar' : 'Reproducir'}>
              <PlayIcon />
            </button>

            {/* Retroceder 10 s */}
            <button
              className={styles.ctrlBtn}
              onClick={() => { if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - 10) }}
              title="Retroceder 10s"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            </button>

            {/* Adelantar 10 s */}
            <button
              className={styles.ctrlBtn}
              onClick={() => { if (videoEl) videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10) }}
              title="Adelantar 10s"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
              </svg>
            </button>

            {/* Volumen */}
            <div className={styles.volumeGroup}>
              <button className={styles.ctrlBtn} onClick={toggleMute} title={muted ? 'Activar sonido' : 'Silenciar'}>
                <VolumeIcon />
              </button>
              <input
                type="range"
                min="0" max="1" step="0.02"
                value={muted ? 0 : volume}
                onChange={e => changeVolume(e.target.value)}
                className={styles.volumeSlider}
                title="Volumen"
              />
            </div>

            {/* Tiempo */}
            <span className={styles.timeDisplay}>
              {fmtTime(current)} / {fmtTime(duration)}
            </span>
          </div>

          {/* Derecha */}
          <div className={styles.controlsRight}>
            <button className={styles.ctrlBtn} onClick={toggleFullscreen} title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>
              <FullscreenIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   COMPONENTE PRINCIPAL
═══════════════════════════════════════════════ */
export default function VideoCarousel() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [videos,      setVideos]      = useState([])
  const [current,     setCurrent]     = useState(0)
  const [editing,     setEditing]     = useState(false)
  const [editVideos,  setEditVideos]  = useState([])
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(null)
  const [uploadStage, setUploadStage] = useState(null)  // 'loading' | 'transcoding' | 'poster' | 'uploading'
  const [uploadPct,   setUploadPct]   = useState(0)     // 0..100 dentro del stage actual
  const [videoRatios, setVideoRatios] = useState({})

  /* Controla si la sección es visible en viewport (para mute/unmute automático) */
  const [sectionVisible, setSectionVisible] = useState(false)
  /* Pre-aviso: el usuario está cerca de llegar al carrusel — ya podemos
     empezar a precargar el video activo y su vecino para que cuando entre
     en viewport ya esté buffereado (no se vea cargando). */
  const [sectionNear,    setSectionNear]    = useState(false)

  const videoInputRef   = useRef(null)
  const uploadTargetRef = useRef(null)
  const videoRefs       = useRef({})
  const sectionRef      = useRef(null)

  /* ── Cargar lista de videos ── */
  useEffect(() => { fetchVideos() }, [])

  async function fetchVideos() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/videos_carrusel?select=*&order=orden.asc&activo=eq.true`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) setVideos(data)
    } catch { /* sin videos aún */ }
  }

  const activeVideos = editing ? editVideos : videos

  /* ── IntersectionObserver: detectar visibilidad y pre-aviso ──
     Dos observers:
       · `near`    → rootMargin 1500 px → dispara MUCHO antes de entrar al
                     viewport. Damos tiempo a que el video descargue y arranque
                     muted offscreen, así cuando el usuario llegue ya está
                     reproduciéndose (ver effect de play/pause más abajo).
       · `visible` → threshold 0.35 → controla mute/unmute (no el play).
  */
  useEffect(() => {
    if (!sectionRef.current) return
    const target = sectionRef.current

    const obsVisible = new IntersectionObserver(
      ([entry]) => setSectionVisible(entry.isIntersecting),
      { threshold: 0.35 }
    )
    const obsNear = new IntersectionObserver(
      ([entry]) => setSectionNear(entry.isIntersecting),
      { rootMargin: '1500px 0px' }
    )
    obsVisible.observe(target)
    obsNear.observe(target)
    return () => { obsVisible.disconnect(); obsNear.disconnect() }
  }, [])

  /* ── Detectar ratio del video ── */
  function handleVideoMeta(e, i) {
    const { videoWidth, videoHeight } = e.target
    if (videoWidth && videoHeight) {
      setVideoRatios(prev => ({ ...prev, [i]: videoWidth / videoHeight }))
    }
  }

  /* ── Play / pause / mute de todos los videos según estado ──
     Estrategia de "pre-roll silencioso":
       · sectionNear (800 px antes del viewport)  → arranca muted offscreen.
         El video se descarga y reproduce silencioso mientras el usuario
         hace scroll. Cuando llega, ya está en marcha.
       · sectionVisible (35% en pantalla)         → quita el mute.
         (Si el browser bloquea el unmute por política de autoplay, el video
         se queda muted y el usuario puede activar el sonido con el botón.)
       · ni near ni visible                        → pausa el video activo.
       · slides inactivos                          → siempre pausados, muted, en t=0.
  */
  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([idx, videoEl]) => {
      if (!videoEl) return
      const isActive = parseInt(idx) === current

      if (!isActive) {
        videoEl.pause()
        videoEl.currentTime = 0
        videoEl.muted = true
        return
      }

      if (sectionNear) {
        // Pre-roll: empieza muted apenas estamos cerca.
        // Cuando esté visible, además quitamos el mute.
        videoEl.muted = !sectionVisible
        videoEl.play().catch(() => {
          // Política de autoplay con audio puede bloquear: forzar mute y reintentar.
          videoEl.muted = true
          videoEl.play().catch(() => {})
        })
      } else {
        videoEl.pause()
      }
    })
  }, [current, activeVideos.length, sectionNear, sectionVisible])

  /* ── Avance automático al terminar ── */
  function handleVideoEnded() {
    goTo(current + 1)
  }

  const goTo = useCallback((n) => {
    const len = activeVideos.length
    if (len === 0) return
    setCurrent(((n % len) + len) % len)
  }, [activeVideos.length])

  function getOffset(i) {
    const len = activeVideos.length
    let offset = i - current
    if (offset >  len / 2) offset -= len
    if (offset < -len / 2) offset += len
    return offset
  }

  /* ── Modo edición ── */
  function enterEdit() {
    setEditVideos(videos.map(v => ({ ...v })))
    setCurrent(0)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditVideos([])
    setCurrent(0)
  }

  /* ── Subir video ── */
  function triggerUpload(index) {
    uploadTargetRef.current = index
    videoInputRef.current?.click()
  }

  async function handleVideoUpload(e) {
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    const index = uploadTargetRef.current

    // Validación de tamaño (50MB max). Lanza Error si supera.
    try { compressVideo(rawFile) }
    catch (err) {
      alert(err.message)
      e.target.value = ''
      return
    }

    setUploading(index)
    setUploadStage('loading')
    setUploadPct(0)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const authHeaders = {
        Authorization: `Bearer ${token}`,
        apikey:        SUPABASE_KEY,
        'x-upsert':    'true',
      }

      // 1) Transcoding a MP4 H.264 720p (lazy-load de ffmpeg.wasm).
      //    Si el video es chico o el transcoding falla, devuelve el original.
      const file = await transcodeVideo(rawFile, {
        onProgress: (stage, p) => {
          setUploadStage(stage === 'loading' ? 'loading' : 'transcoding')
          setUploadPct(Math.round(p * 100))
        },
      })

      // 2) Extraer poster (primera frame visible) en paralelo a la subida del
      //    video para no bloquear: arrancamos ambas y esperamos al final.
      setUploadStage('poster')
      setUploadPct(0)
      const posterPromise = extractPosterFromVideo(file).catch(err => {
        console.warn('No se pudo generar poster:', err)
        return null
      })

      // 3) Subir video.
      setUploadStage('uploading')
      setUploadPct(0)
      const stamp     = Date.now()
      const videoPath = `carousel/${stamp}.mp4`
      const videoUrl  = await uploadToBucket(
        'carousel-videos', videoPath,
        file, file.type || 'video/mp4',
        authHeaders,
      )

      // 4) Subir poster (puede haber resuelto en paralelo).
      const poster = await posterPromise
      let posterUrl = null
      if (poster?.blob) {
        const posterPath = `carousel/${stamp}-poster.${poster.ext}`
        posterUrl = await uploadToBucket(
          'carousel-videos', posterPath,
          poster.blob, poster.mime,
          authHeaders,
        )
      }

      setEditVideos(prev => prev.map((v, i) =>
        i === index
          ? { ...v, video_url: videoUrl, poster_url: posterUrl }
          : v
      ))
    } catch (err) {
      alert('Error al subir video: ' + err.message)
    } finally {
      setUploading(null)
      setUploadStage(null)
      setUploadPct(0)
      e.target.value = ''
    }
  }

  /* Helper de subida directa al Storage REST de Supabase (sin SDK).
     Devuelve la public URL si ok; lanza si falla. */
  async function uploadToBucket(bucket, path, body, contentType, authHeaders) {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': contentType },
        body,
      }
    )
    if (!res.ok) throw new Error(`Error subiendo a ${bucket}`)
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
  }

  /* ── Agregar / Eliminar ── */
  function addVideo() {
    setEditVideos(prev => [...prev, { video_url: '', activo: true, _isNew: true }])
    setCurrent(editVideos.length)
  }

  async function removeVideo(index) {
    if (editVideos.length <= 1) return alert('Debe haber al menos un video')
    if (!confirm('¿Eliminar este video?')) return
    const removed = editVideos[index]
    setEditVideos(prev => prev.filter((_, i) => i !== index))
    setCurrent(c => Math.min(c, editVideos.length - 2))
    if (removed.id) {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      fetch(`${SUPABASE_URL}/rest/v1/videos_carrusel?id=eq.${removed.id}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      })
    }
  }

  /* ── Guardar ── */
  async function saveAll() {
    setSaving(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const headers = {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
      }
      for (let i = 0; i < editVideos.length; i++) {
        const v = editVideos[i]
        if (!v.video_url) continue
        const payload = {
          video_url:  v.video_url,
          poster_url: v.poster_url ?? null,
          orden:      i,
          activo:     true,
        }
        if (v.id && !v._isNew) {
          await fetch(`${SUPABASE_URL}/rest/v1/videos_carrusel?id=eq.${v.id}`, {
            method: 'PATCH', headers, body: JSON.stringify(payload),
          })
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/videos_carrusel`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          })
        }
      }
      await fetchVideos()
      setEditing(false)
      setEditVideos([])
      setCurrent(0)
    } catch (err) {
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const hasVideos = activeVideos.length > 0

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={styles.bg} />

      {/* Encabezado */}
      <div className={styles.header}>
        <span className={styles.eyebrow}>Bufete Jurídico · AAP</span>
        <h2 className={styles.title}>
          Conoce nuestra <em>firma</em>
        </h2>
        <p className={styles.subtitle}>
          Descubre quiénes somos, cómo trabajamos y el compromiso que tenemos con cada cliente.
        </p>
      </div>

      {/* FAB superadmin */}
      {isSuperAdmin && !editing && (
        <button className={styles.fab} onClick={enterEdit}>
          ✎ Editar videos
        </button>
      )}

      {/* Toolbar edición */}
      {editing && (
        <div className={styles.toolbar}>
          <button className={styles.toolAdd}    onClick={addVideo}>+ Agregar</button>
          <button className={styles.toolSave}   onClick={saveAll} disabled={saving}>
            {saving ? 'Guardando...' : '✓ Guardar'}
          </button>
          <button className={styles.toolCancel} onClick={cancelEdit}>✕ Cancelar</button>
        </div>
      )}

      {saving && <div className={styles.savingOverlay}>Guardando cambios...</div>}

      {/* Filmstrip */}
      {hasVideos ? (
        <>
          <div className={styles.filmstrip}>
            {activeVideos.map((vid, i) => {
              const offset     = getOffset(i)
              const absOffset  = Math.abs(offset)
              const isActive   = offset === 0
              const visible    = absOffset <= 2
              const ratio      = videoRatios[i] || (9 / 16)
              const isVertical = ratio < 1

              return (
                <div
                  key={i}
                  className={`${styles.slide} ${isActive ? styles.slideActive : ''}`}
                  style={{
                    ...(isVertical
                      ? { height: 'min(75vh, 620px)', width: 'auto' }
                      : { width:  'min(65vw, 800px)', height: 'auto' }
                    ),
                    aspectRatio: `${ratio}`,
                    transform: `translateX(calc(${offset} * var(--slide-gap))) scale(${isActive ? 1 : Math.max(0.65, 0.82 - absOffset * 0.1)})`,
                    opacity:    isActive ? 1 : Math.max(0.15, 0.45 - absOffset * 0.15),
                    filter:     isActive ? 'brightness(1)' : `brightness(${Math.max(0.3, 0.55 - absOffset * 0.1)})`,
                    zIndex:     isActive ? 10 : 10 - absOffset,
                    pointerEvents: visible ? 'auto' : 'none',
                    visibility:    visible ? 'visible' : 'hidden',
                    cursor:     isActive ? 'default' : 'pointer',
                  }}
                  onClick={() => !isActive && setCurrent(i)}
                >
                  {vid.video_url ? (
                    <>
                      <video
                        ref={el => videoRefs.current[i] = el}
                        /* Si hay poster persistido (los uploads nuevos lo generan
                           automáticamente), lo usamos como cartel: aparece al
                           instante sin descargar nada del MP4. Para videos viejos
                           sin poster, el media-fragment `#t=0.1` hace que el
                           navegador pinte el primer frame del propio video. */
                        src={vid.poster_url ? vid.video_url : `${vid.video_url}#t=0.1`}
                        poster={vid.poster_url || undefined}
                        className={`${styles.video} ${isActive ? styles.videoActive : ''}`}
                        /* Preload escalonado:
                           · slide activo + sección cerca → 'auto' (buffer agresivo)
                           · slide activo o vecino directo → 'metadata' (poster + dimensiones)
                           · resto                          → 'none'    (no toca red)
                        */
                        preload={
                          (isActive && sectionNear) ? 'auto'
                          : (absOffset <= 1)        ? 'metadata'
                          :                           'none'
                        }
                        playsInline
                        loop={false}
                        onLoadedMetadata={e => handleVideoMeta(e, i)}
                        /* NO ponemos muted aquí; se controla por JS en los effects */
                      />

                      {/* Controles de reproducción (solo slide activo, fuera del modo edición) */}
                      {isActive && !editing && (
                        <VideoControls
                          videoEl={videoRefs.current[i]}
                          onEnded={handleVideoEnded}
                        />
                      )}
                    </>
                  ) : (
                    <div className={styles.emptySlide}>
                      <span>Sin video</span>
                    </div>
                  )}

                  {/* Overlay play laterales */}
                  {!isActive && visible && vid.video_url && (
                    <div className={styles.playOverlay}>
                      <div className={styles.playIcon}>▶</div>
                    </div>
                  )}

                  {/* Overlay edición */}
                  {editing && isActive && (
                    <div className={styles.editOverlay} onClick={() => triggerUpload(i)}>
                      <div className={styles.editIcon}>
                        <IconVideoCamera size={20} />
                      </div>
                      <span className={styles.editText}>
                        {uploading === i
                          ? (
                              uploadStage === 'loading'      ? `Cargando optimizador… ${uploadPct}%` :
                              uploadStage === 'transcoding'  ? `Optimizando video… ${uploadPct}%`    :
                              uploadStage === 'poster'       ? 'Generando portada…'                  :
                              uploadStage === 'uploading'    ? 'Subiendo…'                           :
                              'Procesando…'
                            )
                          : 'Cambiar video'}
                      </span>
                    </div>
                  )}

                  {/* Botón eliminar */}
                  {editing && (
                    <button
                      className={styles.removeBtn}
                      onClick={e => { e.stopPropagation(); removeVideo(i) }}
                      title="Eliminar video"
                      aria-label="Eliminar video"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Dots */}
          <div className={styles.dots}>
            {activeVideos.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
                onClick={() => setCurrent(i)}
                aria-label={`Video ${i + 1}`}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          {isSuperAdmin
            ? <p>No hay videos aún. Haz clic en <strong>"✎ Editar videos"</strong> para agregar el primero.</p>
            : <p>Próximamente contenido multimedia.</p>
          }
        </div>
      )}

      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleVideoUpload}
      />
    </section>
  )
}