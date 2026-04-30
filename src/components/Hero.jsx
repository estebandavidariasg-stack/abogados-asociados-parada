import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import styles from './Hero.module.css'
import { IconPencil, IconCamera } from './Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const DEFAULT_SLIDES = [
  { imagen_url: '/hero-1.png' },
  { imagen_url: '/hero-2.png' },
  { imagen_url: '/hero-3.png' },
  { imagen_url: '/hero-4.png' },
  { imagen_url: '/hero-5.png' },
]

export default function Hero() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [slides, setSlides]       = useState(DEFAULT_SLIDES)
  const [current, setCurrent]     = useState(0)
  const [editing, setEditing]     = useState(false)
  const [editSlides, setEditSlides] = useState([])
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(null) // índice que se está subiendo

  const imgInputRef      = useRef(null)
  const uploadTargetRef  = useRef(null)

  useEffect(() => { fetchSlides() }, [])

  async function fetchSlides() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/carrusel?select=*&order=orden.asc&activo=eq.true`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) setSlides(data)
    } catch { /* usa defaults */ }
  }

  /* ── Navegación ───────────────────────────────────── */
  const activeSlides = editing ? editSlides : slides

  const goTo = useCallback((n) => {
    const len = activeSlides.length
    setCurrent(((n % len) + len) % len)
  }, [activeSlides.length])

  useEffect(() => {
    if (editing) return
    const timer = setInterval(() => goTo(current + 1), 5000)
    return () => clearInterval(timer)
  }, [current, goTo, editing])

  /* ── Offset circular para filmstrip ──────────────── */
  function getOffset(i) {
    const len = activeSlides.length
    let offset = i - current
    if (offset > len / 2)  offset -= len
    if (offset < -len / 2) offset += len
    return offset
  }

  /* ── Modo edición ────────────────────────────────── */
  function enterEdit() {
    setEditSlides(slides.map(s => ({ ...s })))
    setCurrent(0)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditSlides([])
    setCurrent(0)
  }

  /* ── Subir imagen ────────────────────────────────── */
  function triggerUpload(index) {
    uploadTargetRef.current = index
    imgInputRef.current?.click()
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const index = uploadTargetRef.current
    setUploading(index)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const ext  = file.name.split('.').pop()
      const path = `hero/${Date.now()}.${ext}`
      const res  = await fetch(
        `${SUPABASE_URL}/storage/v1/object/carousel-images/${path}`,
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
      if (!res.ok) throw new Error('Error subiendo imagen')
      const url = `${SUPABASE_URL}/storage/v1/object/public/carousel-images/${path}`
      setEditSlides(prev => prev.map((s, i) => i === index ? { ...s, imagen_url: url } : s))
    } catch (err) {
      alert('Error al subir imagen: ' + err.message)
    } finally {
      setUploading(null)
      e.target.value = ''
    }
  }

  /* ── Agregar / Eliminar ──────────────────────────── */
  function addSlide() {
    setEditSlides(prev => [...prev, { imagen_url: '/hero-1.png', activo: true, _isNew: true }])
    setCurrent(editSlides.length)
  }

  async function removeSlide(index) {
    if (editSlides.length <= 1) return alert('Debe haber al menos una imagen')
    if (!confirm('¿Eliminar esta imagen?')) return
    const removed = editSlides[index]
    setEditSlides(prev => prev.filter((_, i) => i !== index))
    setCurrent(c => Math.min(c, editSlides.length - 2))
    if (removed.id) {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${removed.id}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      })
    }
  }

  /* ── Guardar ─────────────────────────────────────── */
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
      for (let i = 0; i < editSlides.length; i++) {
        const s = editSlides[i]
        const payload = { imagen_url: s.imagen_url, orden: i, activo: true }
        if (s.id && !s._isNew) {
          await fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${s.id}`, {
            method: 'PATCH', headers, body: JSON.stringify(payload),
          })
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/carrusel`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          })
        }
      }
      await fetchSlides()
      setEditing(false)
      setEditSlides([])
      setCurrent(0)
    } catch (err) {
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  /* ── Render ──────────────────────────────────────── */
  return (
    <section className={`${styles.hero} ${editing ? styles.heroEditing : ''}`}>
      <div className={styles.heroBg} />


      {/* FAB superadmin */}
      {isSuperAdmin && !editing && (
        <button className={styles.fab} onClick={enterEdit} style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}>
          <IconPencil /> Editar imágenes
        </button>
      )}

      {/* Toolbar edición */}
      {editing && (
        <div className={styles.toolbar}>
          <button className={styles.toolAdd}    onClick={addSlide}>+ Agregar</button>
          <button className={styles.toolSave}   onClick={saveAll} disabled={saving}>
            {saving ? 'Guardando...' : '✓ Guardar'}
          </button>
          <button className={styles.toolCancel} onClick={cancelEdit}>✕ Cancelar</button>
        </div>
      )}

      {saving && <div className={styles.savingOverlay}>Guardando cambios...</div>}

      {/* ── Filmstrip ── */}
      <div className={styles.filmstrip}>
        {activeSlides.map((slide, i) => {
          const offset    = getOffset(i)
          const absOffset = Math.abs(offset)
          const isActive  = offset === 0
          const visible   = absOffset <= 3

          return (
            <div
              key={i}
              className={styles.slide}
              style={{
                transform: `translateX(calc(${offset} * var(--slide-gap))) scale(${isActive ? 1 : Math.max(0.65, 0.88 - absOffset * 0.1)})`,
                opacity:   isActive ? 1 : Math.max(0.3, 0.72 - absOffset * 0.18),
                filter:    isActive ? 'brightness(1)' : `brightness(${Math.max(0.55, 0.82 - absOffset * 0.12)})`,
                zIndex:    isActive ? 10 : 10 - absOffset,
                pointerEvents: visible ? 'auto' : 'none',
                visibility:    visible ? 'visible' : 'hidden',
                cursor:    isActive ? 'default' : 'pointer',
              }}
              onClick={() => !isActive && setCurrent(i)}
            >
              <img
                src={slide.imagen_url}
                alt={`Slide ${i + 1}`}
                className={`${styles.slideImg} ${isActive ? styles.slideImgActive : ''}`}
              />

              {/* Overlay edición — solo en slide activo */}
              {editing && isActive && (
                <div className={styles.editOverlay} onClick={() => triggerUpload(i)}>
                  <div className={styles.editIcon}>
                    <IconCamera size={20} />
                  </div>
                  <span className={styles.editText}>
                    {uploading === i ? 'Subiendo...' : 'Cambiar imagen'}
                  </span>
                </div>
              )}

              {/* Botón eliminar */}
              {editing && (
                <button
                  className={styles.removeBtn}
                  onClick={e => { e.stopPropagation(); removeSlide(i) }}
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
        {activeSlides.map((_, i) => (
          <button
            key={i}
            className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Imagen ${i + 1}`}
          />
        ))}
      </div>

      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />
    </section>
  )
}