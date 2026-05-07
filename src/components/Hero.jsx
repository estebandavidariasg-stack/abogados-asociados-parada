import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { compressImage } from '../utils/compressMedia'
import { lqipHero }     from '../lqip-hero'
import styles from './Hero.module.css'
import { IconPencil, IconCamera } from './Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Las defaults ahora son una clave base ('/hero-1') y `deriveImgSources` arma
// las 9 variantes (3 anchos × 3 formatos) generadas por scripts/optimize-hero.js.
const DEFAULT_SLIDES = [
  { imagen_url: '/hero-1' },
  { imagen_url: '/hero-2' },
  { imagen_url: '/hero-3' },
  { imagen_url: '/hero-4' },
  { imagen_url: '/hero-5' },
]

const RESPONSIVE_WIDTHS = [480, 800, 1200]
// Le decimos al browser qué ancho renderizamos para que pueda elegir el archivo
// correcto del srcset. Coincide con los breakpoints de Hero.module.css.
const RESPONSIVE_SIZES = '(max-width: 600px) 480px, (max-width: 1024px) 800px, 1200px'

function buildSrcSet(base, ext) {
  return RESPONSIVE_WIDTHS.map(w => `${base}-${w}.${ext} ${w}w`).join(', ')
}

/**
 * Para una imagen del slide devuelve los srcset AVIF/WebP/JPG cuando es local
 * (tenemos las 9 variantes); para URLs remotas (lo que sube el admin) usa la
 * URL única — el upload ya entrega un único archivo optimizado.
 *
 * Reconoce defaults guardadas en la tabla `carrusel` aunque tengan extensión
 * antigua (`/hero-1.png`, `/hero-1.webp`…) y las normaliza a `/hero-1` para
 * que carguen las variantes responsive nuevas.
 */
function deriveImgSources(url) {
  if (typeof url === 'string') {
    const heroMatch = url.match(/^(\/hero-\d+)(?:-\d+)?(?:\.(?:png|jpe?g|webp|avif))?$/i)
    if (heroMatch) {
      const base = heroMatch[1] // p.ej. "/hero-1"
      return {
        isResponsive: true,
        avif:    buildSrcSet(base, 'avif'),
        webp:    buildSrcSet(base, 'webp'),
        jpg:     buildSrcSet(base, 'jpg'),
        sizes:   RESPONSIVE_SIZES,
        // src del <img>: el de 800w es buen punto medio (mobile usa 480, desktop 1200)
        fallback: `${base}-800.jpg`,
        // Para el <link rel="preload"> usamos el AVIF más probable según viewport
        preloadHref: `${base}-1200.avif`,
        preloadType: 'image/avif',
        preloadSrcSet: buildSrcSet(base, 'avif'),
        preloadSizes:  RESPONSIVE_SIZES,
        // LQIP base64 inline — sin red, aparece en el primer paint.
        lqip: lqipHero[base] || null,
      }
    }
  }
  return {
    isResponsive: false,
    webp:     url,
    fallback: url,
    preloadHref: url,
    preloadType: typeof url === 'string' && url.endsWith('.webp') ? 'image/webp' : null,
    lqip: null,
  }
}

export default function Hero() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [slides, setSlides]       = useState(DEFAULT_SLIDES)
  const [loading, setLoading]     = useState(true)        // mientras llega data de Supabase
  const [current, setCurrent]     = useState(0)
  const [editing, setEditing]     = useState(false)
  const [editSlides, setEditSlides] = useState([])
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(null) // índice que se está subiendo
  // Trackea qué imagen real ya cargó (para fade-in sobre el LQIP).
  const [imgLoaded, setImgLoaded] = useState({})

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
    finally { setLoading(false) }
  }

  // Preload del primer slide (el que va con fetchpriority=high) en cuanto
  // conocemos su URL — gana ~100-300 ms vs esperar al render del <img>.
  // Para defaults usamos imagesrcset/imagesizes para que el browser preload
  // SOLO el ancho que va a renderizar (480/800/1200 según viewport).
  useEffect(() => {
    if (loading || !slides[0]?.imagen_url) return
    const s = deriveImgSources(slides[0].imagen_url)
    const link = document.createElement('link')
    link.rel  = 'preload'
    link.as   = 'image'
    link.href = s.preloadHref
    if (s.preloadType) link.type = s.preloadType
    if (s.preloadSrcSet) link.setAttribute('imagesrcset', s.preloadSrcSet)
    if (s.preloadSizes)  link.setAttribute('imagesizes',  s.preloadSizes)
    link.fetchPriority = 'high'
    document.head.appendChild(link)
    return () => { try { document.head.removeChild(link) } catch {} }
  }, [loading, slides])

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
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    const index = uploadTargetRef.current
    setUploading(index)
    try {
      // Compresión client-side (1400px max, JPEG q=0.82). Si el archivo es
      // chico o no comprimible (svg/gif), devuelve el original.
      const file = await compressImage(rawFile)
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
    setEditSlides(prev => [...prev, { imagen_url: '/hero-1', activo: true, _isNew: true }])
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
        {loading && !editing && Array.from({ length: 5 }).map((_, i) => {
          const offset    = i - 2  // skeleton centrado en el medio
          const absOffset = Math.abs(offset)
          const isActive  = offset === 0
          return (
            <div
              key={`sk-${i}`}
              className={`${styles.slide} ${styles.slideSkeleton}`}
              aria-hidden="true"
              style={{
                transform: `translateX(calc(${offset} * var(--slide-gap))) scale(${isActive ? 1 : Math.max(0.65, 0.88 - absOffset * 0.1)})`,
                opacity:   isActive ? 1 : Math.max(0.3, 0.72 - absOffset * 0.18),
                zIndex:    isActive ? 10 : 10 - absOffset,
              }}
            />
          )
        })}
        {!loading && activeSlides.map((slide, i) => {
          const offset    = getOffset(i)
          const absOffset = Math.abs(offset)
          const isActive  = offset === 0
          const visible   = absOffset <= 3
          const s         = deriveImgSources(slide.imagen_url)
          const isLoaded  = !!imgLoaded[i]

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
                // LQIP base64 como background — aparece en el primer paint,
                // sin esperar red. La <img> hace fade-in encima cuando carga.
                backgroundImage:    s.lqip ? `url(${s.lqip})` : undefined,
                backgroundSize:     'cover',
                backgroundPosition: 'center',
              }}
              onClick={() => !isActive && setCurrent(i)}
            >
              {(() => {
                return (
                  <picture>
                    {s.isResponsive && (
                      <source type="image/avif" srcSet={s.avif} sizes={s.sizes} />
                    )}
                    <source
                      type="image/webp"
                      srcSet={s.webp}
                      sizes={s.isResponsive ? s.sizes : undefined}
                    />
                    <img
                      src={s.fallback}
                      srcSet={s.isResponsive ? s.jpg : undefined}
                      sizes={s.isResponsive ? s.sizes : undefined}
                      alt={`Slide ${i + 1}`}
                      className={`${styles.slideImg} ${isActive ? styles.slideImgActive : ''}`}
                      width="580"
                      height="740"
                      decoding="async"
                      loading={i === 0 ? 'eager' : 'lazy'}
                      fetchpriority={i === 0 ? 'high' : 'auto'}
                      onLoad={() => setImgLoaded(prev => prev[i] ? prev : { ...prev, [i]: true })}
                      style={{
                        opacity:    isLoaded ? 1 : 0,
                        transition: 'opacity 0.4s ease-out',
                      }}
                    />
                  </picture>
                )
              })()}

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