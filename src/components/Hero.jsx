import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import styles from './Hero.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
  }
}

/* ── Slides por defecto ──────────────────────────────── */
const DEFAULT_SLIDES = [
  {
    imagen_url: '/hero-1.png',
    eyebrow: 'Bufete Jurídico · Colombia',
    titulo_1: 'Soluciones legales con ',
    titulo_2: 'resultados reales',
    titulo_gold_index: 1,
    subtitulo: 'Asesoría jurídica especializada con el compromiso y la seriedad que su caso merece.',
    cta_label: 'Consulta gratuita',
    cta_href: '#contacto',
  },
  {
    imagen_url: '/hero-2.png',
    eyebrow: 'Derecho Civil · Penal · Corporativo',
    titulo_1: 'Estrategia legal de ',
    titulo_2: 'alto nivel',
    titulo_gold_index: 1,
    subtitulo: 'Un equipo comprometido con la justicia, la ética y la defensa de sus intereses.',
    cta_label: 'Conocer al equipo',
    cta_href: '#lawyers',
  },
  {
    imagen_url: '/hero-3.png',
    eyebrow: 'Experiencia · Compromiso · Resultados',
    titulo_1: 'Su confianza, ',
    titulo_2: 'nuestra mayor responsabilidad',
    titulo_gold_index: 0,
    subtitulo: 'Cada caso es único. Cada cliente recibe atención personalizada y dedicación absoluta.',
    cta_label: 'Ver perfiles',
    cta_href: '#lawyers',
  },
  {
    imagen_url: '/hero-4.png',
    eyebrow: 'Parada & Asociados · Bufete Jurídico',
    titulo_1: 'Defendemos lo que ',
    titulo_2: 'más importa',
    titulo_gold_index: 1,
    subtitulo: 'Representación legal sólida en litigios civiles, penales y asuntos corporativos.',
    cta_label: 'Contáctenos',
    cta_href: '#contacto',
  },
  {
    imagen_url: '/hero-5.png',
    eyebrow: 'Justicia · Ética · Excelencia',
    titulo_1: 'El derecho como ',
    titulo_2: 'herramienta de justicia',
    titulo_gold_index: 1,
    subtitulo: 'Con visión estratégica y profundo conocimiento jurídico, luchamos por usted.',
    cta_label: 'Agendar cita',
    cta_href: '#contacto',
  },
]

/* ── Estilos inline para modo edición ────────────────── */
const editStyles = {
  fab: {
    position: 'absolute', top: 220, right: 1500, zIndex: 100,
    background: 'linear-gradient(135deg, #c9a84c, #a0822e)',
    color: '#0d0d0d', border: 'none', borderRadius: 30,
    padding: '10px 22px', fontWeight: 700, fontSize: '0.85rem',
    cursor: 'pointer', letterSpacing: '0.5px',
    boxShadow: '0 4px 20px rgba(201,168,76,0.4)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    fontFamily: 'inherit',
  },
  toolbar: {
    position: 'absolute', top: 130, left: '35%', transform: 'translateX(-50%)',
    zIndex: 100, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
  },
  toolBtn: (variant) => ({
    padding: '8px 18px', border: 'none', borderRadius: 20, fontSize: '0.8rem',
    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.2s',
    ...(variant === 'save'
      ? { background: 'linear-gradient(135deg,#c9a84c,#a0822e)', color: '#0d0d0d' }
      : variant === 'cancel'
        ? { background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }
        : variant === 'danger'
          ? { background: 'rgba(220,50,50,0.8)', color: '#fff' }
          : { background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }),
  }),
  slideCounter: {
    padding: '8px 14px', background: 'rgba(0,0,0,0.6)', color: '#c9a84c',
    borderRadius: 20, fontSize: '0.8rem', fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 4,
  },
  input: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(201,168,76,0.4)',
    borderRadius: 8, color: '#fff', padding: '8px 12px', width: '100%',
    fontFamily: 'inherit', fontSize: 'inherit', outline: 'none',
    transition: 'border-color 0.2s',
  },
  inputSmall: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 6, color: '#c9a84c', padding: '5px 10px',
    fontFamily: 'inherit', fontSize: '0.75rem', outline: 'none',
    width: '100%', letterSpacing: '1px', textTransform: 'uppercase',
  },
  textarea: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(201,168,76,0.4)',
    borderRadius: 8, color: '#fff', padding: '10px 12px', width: '100%',
    fontFamily: 'inherit', fontSize: 'inherit', outline: 'none',
    resize: 'vertical', minHeight: 60,
  },
  fieldLabel: {
    fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1.5px',
    color: 'rgba(201,168,76,0.7)', marginBottom: 4, display: 'block',
  },
  fieldGroup: {
    display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
  },
  titleRow: {
    display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap',
  },
  goldToggle: (active) => ({
    padding: '4px 10px', borderRadius: 12, fontSize: '0.65rem',
    fontWeight: 600, cursor: 'pointer', border: 'none',
    fontFamily: 'inherit', transition: 'all 0.2s',
    background: active ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.05)',
    color: active ? '#c9a84c' : 'rgba(255,255,255,0.4)',
  }),
  ctaRow: {
    display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap',
  },
  imgOverlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 10, borderRadius: 'inherit',
    cursor: 'pointer', zIndex: 5, transition: 'opacity 0.3s',
  },
  imgOverlayIcon: {
    width: 48, height: 48, borderRadius: '50%',
    background: 'rgba(201,168,76,0.2)', border: '2px solid #c9a84c',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1.4rem', color: '#c9a84c',
  },
  imgOverlayText: {
    color: '#fff', fontSize: '0.8rem', fontWeight: 500,
  },
  saving: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, color: '#c9a84c', fontSize: '1.1rem', fontWeight: 600,
  },
}

export default function Hero() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [slides, setSlides] = useState(DEFAULT_SLIDES)
  const [current, setCurrent] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  /* ── Modo edición ──────────────────────────── */
  const [editing, setEditing] = useState(false)
  const [editSlides, setEditSlides] = useState([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const imgInputRef = useRef(null)

  /* ── Cargar slides de Supabase ─────────────── */
  useEffect(() => {
    fetchSlides()
  }, [])

  async function fetchSlides() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/carrusel?select=*&order=orden.asc&activo=eq.true`,
        { headers },
      )
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        setSlides(data)
      }
    } catch {
      /* usa defaults */
    }
  }

  /* ── Navegación carrusel ───────────────────── */
  const total = editing ? editSlides.length : slides.length
  const goTo = useCallback(
    (n) => {
      const len = editing ? editSlides.length : slides.length
      setCurrent(((n % len) + len) % len)
      setAnimKey((k) => k + 1)
    },
    [slides.length, editing, editSlides.length],
  )

  useEffect(() => {
    if (editing) return
    const timer = setInterval(() => goTo(current + 1), 6000)
    return () => clearInterval(timer)
  }, [current, goTo, editing])

  /* ── Datos del slide actual ────────────────── */
  const slideData = editing ? editSlides[current] : slides[current]
  if (!slideData) return null

  /* ── Entrar / salir del modo edición ───────── */
  function enterEdit() {
    setEditSlides(slides.map((s, i) => ({ ...s, _index: i })))
    setCurrent(0)
    setAnimKey((k) => k + 1)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditSlides([])
    setCurrent(0)
    setAnimKey((k) => k + 1)
  }

  /* ── Actualizar campo del slide actual ─────── */
  function updateField(field, value) {
    setEditSlides((prev) =>
      prev.map((s, i) => (i === current ? { ...s, [field]: value } : s)),
    )
  }

  /* ── Subir imagen ──────────────────────────── */
  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const ext = file.name.split('.').pop()
      const path = `hero/${Date.now()}.${ext}`
      const res = await fetch(
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
        },
      )
      if (!res.ok) throw new Error('Error subiendo imagen')
      const url = `${SUPABASE_URL}/storage/v1/object/public/carousel-images/${path}`
      updateField('imagen_url', url)
    } catch (err) {
      alert('Error al subir imagen: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  /* ── Agregar slide ─────────────────────────── */
  function addSlide() {
    const newSlide = {
      eyebrow: 'Nuevo · Slide',
      titulo_1: 'Título parte 1 ',
      titulo_2: 'parte destacada',
      titulo_gold_index: 1,
      subtitulo: 'Descripción del slide...',
      cta_label: 'Acción',
      cta_href: '#contacto',
      imagen_url: '/hero-1.png',
      activo: true,
      _isNew: true,
    }
    setEditSlides((prev) => [...prev, newSlide])
    setCurrent(editSlides.length)
    setAnimKey((k) => k + 1)
  }

  /* ── Eliminar slide actual ─────────────────── */
  async function removeCurrentSlide() {
    if (editSlides.length <= 1) return alert('Debe haber al menos un slide')
    if (!confirm('¿Eliminar este slide?')) return
    const removed = editSlides[current]
    setEditSlides((prev) => prev.filter((_, i) => i !== current))
    setCurrent((c) => Math.min(c, editSlides.length - 2))
    setAnimKey((k) => k + 1)
    if (removed.id) {
      const headers = await getAuthHeaders()
      fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${removed.id}`, {
        method: 'DELETE',
        headers,
      })
    }
  }

  /* ── Guardar todo ──────────────────────────── */
  async function saveAll() {
    setSaving(true)
    try {
      const headers = await getAuthHeaders()
      for (let i = 0; i < editSlides.length; i++) {
        const s = editSlides[i]
        const payload = {
          eyebrow: s.eyebrow,
          titulo_1: s.titulo_1,
          titulo_2: s.titulo_2,
          titulo_gold_index: s.titulo_gold_index ?? 1,
          subtitulo: s.subtitulo,
          imagen_url: s.imagen_url,
          cta_label: s.cta_label,
          cta_href: s.cta_href,
          orden: i,
          activo: true,
        }
        if (s.id && !s._isNew) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${s.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json()
            console.error('PATCH ERROR:', err)
          }
        } else {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/carrusel`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json()
            console.error('POST ERROR:', err)
          }
        }
      }
      await fetchSlides()
      setEditing(false)
      setEditSlides([])
      setCurrent(0)
      setAnimKey((k) => k + 1)
    } catch (err) {
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  /* ── Render ────────────────────────────────── */
  return (
    <section className={styles.hero} style={editing ? { outline: '2px solid rgba(201,168,76,0.3)', outlineOffset: -2 } : undefined}>

      <div className={styles.heroBg} />
      <div className={styles.goldLine} />

      {/* ── FAB editar (solo superadmin) ──────────── */}
      {isSuperAdmin && !editing && (
        <button
          style={editStyles.fab}
          onClick={enterEdit}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(201,168,76,0.5)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(201,168,76,0.4)' }}
        >
          ✎ Editar
        </button>
      )}

      {/* ── Toolbar edición ──────────────────────── */}
      {editing && (
        <div style={editStyles.toolbar}>
          <div style={editStyles.slideCounter}>
            Slide {current + 1} / {editSlides.length}
          </div>
          <button style={editStyles.toolBtn('default')} onClick={addSlide}>+ Agregar</button>
          {editSlides.length > 1 && (
            <button style={editStyles.toolBtn('danger')} onClick={removeCurrentSlide}>Eliminar</button>
          )}
          <button style={editStyles.toolBtn('save')} onClick={saveAll} disabled={saving}>
            {saving ? 'Guardando...' : '✓ Guardar todo'}
          </button>
          <button style={editStyles.toolBtn('cancel')} onClick={cancelEdit}>✕ Cancelar</button>
        </div>
      )}

      {saving && (
        <div style={editStyles.saving}>Guardando cambios...</div>
      )}

      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />

      {/* ── Layout principal ─────────────────────── */}
      <div className={styles.layout} key={`layout-${animKey}`}>

        {/* — TEXTO — */}
        <div className={styles.textSide}>

          {editing ? (
            <div style={editStyles.fieldGroup}>
              <span style={editStyles.fieldLabel}>Eyebrow</span>
              <input
                style={editStyles.inputSmall}
                value={slideData.eyebrow}
                onChange={(e) => updateField('eyebrow', e.target.value)}
              />
            </div>
          ) : (
            <span className={styles.eyebrow}>{slideData.eyebrow}</span>
          )}

          {editing ? (
            <div style={editStyles.fieldGroup}>
              <span style={editStyles.fieldLabel}>Título</span>
              <div style={editStyles.titleRow}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <input
                    style={{ ...editStyles.input, fontSize: '1.1rem', fontWeight: 700 }}
                    value={slideData.titulo_1}
                    onChange={(e) => updateField('titulo_1', e.target.value)}
                    placeholder="Parte 1"
                  />
                  <button
                    style={{ ...editStyles.goldToggle(slideData.titulo_gold_index === 0), marginTop: 4 }}
                    onClick={() => updateField('titulo_gold_index', 0)}
                  >
                    ★ Dorado
                  </button>
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <input
                    style={{ ...editStyles.input, fontSize: '1.1rem', fontWeight: 700 }}
                    value={slideData.titulo_2}
                    onChange={(e) => updateField('titulo_2', e.target.value)}
                    placeholder="Parte 2"
                  />
                  <button
                    style={{ ...editStyles.goldToggle(slideData.titulo_gold_index === 1), marginTop: 4 }}
                    onClick={() => updateField('titulo_gold_index', 1)}
                  >
                    ★ Dorado
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <h1 className={styles.title}>
              {slideData.titulo_gold_index === 0 ? (
                <>
                  <em>{slideData.titulo_1}</em>
                  {slideData.titulo_2}
                </>
              ) : (
                <>
                  {slideData.titulo_1}
                  <em>{slideData.titulo_2}</em>
                </>
              )}
            </h1>
          )}

          {editing ? (
            <div style={editStyles.fieldGroup}>
              <span style={editStyles.fieldLabel}>Subtítulo</span>
              <textarea
                style={editStyles.textarea}
                value={slideData.subtitulo}
                onChange={(e) => updateField('subtitulo', e.target.value)}
              />
            </div>
          ) : (
            <p className={styles.subtitle}>{slideData.subtitulo}</p>
          )}

          <a href={slideData.cta_href || '#contacto'} className={`btn-solid btn-lg ${styles.cta}`}>
            {slideData.cta_label || 'Consulta gratuita'}
          </a>

          <div className={styles.dots}>
            {Array.from({ length: total }).map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* — FOTO — */}
        <div className={styles.photoSide}>
          <div className={styles.photoFrame} style={{ position: 'relative' }}>
            <img
              key={`img-${animKey}`}
              src={slideData.imagen_url}
              alt="Abogado"
              className={styles.photo}
            />
            <div className={styles.photoFade} />

            {editing && (
              <div
                style={editStyles.imgOverlay}
                onClick={() => imgInputRef.current?.click()}
              >
                <div style={editStyles.imgOverlayIcon}>
                  {uploading ? '⏳' : '📷'}
                </div>
                <span style={editStyles.imgOverlayText}>
                  {uploading ? 'Subiendo...' : 'Cambiar imagen'}
                </span>
              </div>
            )}
          </div>

          <div className={styles.arrows}>
            <button className={styles.arrow} onClick={() => goTo(current - 1)}>←</button>
            <button className={styles.arrow} onClick={() => goTo(current + 1)}>→</button>
          </div>
        </div>

      </div>
    </section>
  )
}
