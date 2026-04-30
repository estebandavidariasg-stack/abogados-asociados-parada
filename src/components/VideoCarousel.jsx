import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import styles from './VideoCarousel.module.css'
import { IconVideoCamera } from './Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function VideoCarousel() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [videos, setVideos]         = useState([])
  const [current, setCurrent]       = useState(0)
  const [editing, setEditing]       = useState(false)
  const [editVideos, setEditVideos] = useState([])
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(null)
  const [videoRatios, setVideoRatios] = useState({})

  const videoInputRef   = useRef(null)
  const uploadTargetRef = useRef(null)
  const videoRefs       = useRef({})

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

  /* ── Detectar ratio del video ── */
  function handleVideoMeta(e, i) {
    const { videoWidth, videoHeight } = e.target
    if (videoWidth && videoHeight) {
      setVideoRatios(prev => ({ ...prev, [i]: videoWidth / videoHeight }))
    }
  }

  /* ── Controlar play/pause según slide activo ── */
  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([idx, videoEl]) => {
      if (!videoEl) return
      if (parseInt(idx) === current) {
        videoEl.play().catch(() => {})
      } else {
        videoEl.pause()
        videoEl.currentTime = 0
      }
    })
  }, [current, activeVideos.length])

  /* ── Avance automático al terminar el video ── */
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
    if (offset > len / 2)  offset -= len
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
    const file = e.target.files?.[0]
    if (!file) return
    const index = uploadTargetRef.current
    setUploading(index)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const ext   = file.name.split('.').pop()
      const path  = `carousel/${Date.now()}.${ext}`
      const res   = await fetch(
        `${SUPABASE_URL}/storage/v1/object/carousel-videos/${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_KEY,
            'Content-Type': file.type,
            'x-upsert': 'true',
          },
          body: file,
        }
      )
      if (!res.ok) throw new Error('Error subiendo video')
      const url = `${SUPABASE_URL}/storage/v1/object/public/carousel-videos/${path}`
      setEditVideos(prev => prev.map((v, i) => i === index ? { ...v, video_url: url } : v))
    } catch (err) {
      alert('Error al subir video: ' + err.message)
    } finally {
      setUploading(null)
      e.target.value = ''
    }
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
        const payload = { video_url: v.video_url, orden: i, activo: true }
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
    <section className={styles.section}>
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
              const offset    = getOffset(i)
              const absOffset = Math.abs(offset)
              const isActive  = offset === 0
              const visible   = absOffset <= 2
              const ratio     = videoRatios[i] || (9 / 16)
              const isVertical = ratio < 1

              return (
                <div
                  key={i}
                  className={`${styles.slide} ${isActive ? styles.slideActive : ''}`}
                  style={{
                    ...(isVertical
                      ? { height: 'min(75vh, 620px)', width: 'auto' }  // ← sube de 72vh/580px
                      : { width: 'min(65vw, 800px)', height: 'auto' }  // ← sube de 88vw/700px
                    ),
                    aspectRatio: `${ratio}`,
                    transform: `translateX(calc(${offset} * var(--slide-gap))) scale(${isActive ? 1 : Math.max(0.65, 0.82 - absOffset * 0.1)})`,
                    opacity:   isActive ? 1 : Math.max(0.15, 0.45 - absOffset * 0.15),
                    filter:    isActive ? 'brightness(1)' : `brightness(${Math.max(0.3, 0.55 - absOffset * 0.1)})`,
                    zIndex:    isActive ? 10 : 10 - absOffset,
                    pointerEvents: visible ? 'auto' : 'none',
                    visibility:    visible ? 'visible' : 'hidden',
                    cursor:    isActive ? 'default' : 'pointer',
                  }}
                  onClick={() => !isActive && setCurrent(i)}
                >
                  {vid.video_url ? (
                    <video
                      ref={el => videoRefs.current[i] = el}
                      src={vid.video_url}
                      className={`${styles.video} ${isActive ? styles.videoActive : ''}`}
                      muted
                      playsInline
                      loop={false}
                      onLoadedMetadata={e => handleVideoMeta(e, i)}
                      onEnded={isActive ? handleVideoEnded : undefined}
                    />
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
                        {uploading === i ? 'Subiendo...' : 'Cambiar video'}
                      </span>
                    </div>
                  )}

                  {/* Botón eliminar */}
                  {editing && (
                    <button
                      className={styles.removeBtn}
                      onClick={e => { e.stopPropagation(); removeVideo(i) }}
                      title="Eliminar"
                    >
                      ✕
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