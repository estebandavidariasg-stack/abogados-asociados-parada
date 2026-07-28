import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, gridStagger, cardReveal, VIEWPORT } from '../../lib/motionVariants'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../utils/compressMedia'
import styles from './NoticiasSection.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/* ── Noticias gestionadas por el superadministrador ────────────────────────
   Las noticias viven en la tabla `noticias` (Supabase) y el superadmin las
   administra en línea desde el propio home (igual que el carrusel de videos).
   Lectura pública con la anon key (RLS deja ver solo `activo = true`). Si la
   tabla todavía no tiene noticias, se muestra un respaldo curado para que la
   sección nunca quede vacía. */

const FALLBACK_NOTICIAS = [
  {
    title: 'DIAN publica el calendario tributario y novedades para las declaraciones de renta',
    source: 'DIAN',
    date: '',
    excerpt: 'La Dirección de Impuestos y Aduanas Nacionales actualiza plazos y obligaciones para personas naturales y jurídicas del año gravable en curso.',
    image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.dian.gov.co/',
  },
  {
    title: 'Corte Constitucional profiere fallos clave sobre derechos fundamentales',
    source: 'Corte Constitucional',
    date: '',
    excerpt: 'Las últimas sentencias de tutela y control de constitucionalidad marcan precedentes que impactan la práctica jurídica en Colombia.',
    image: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.corteconstitucional.gov.co/',
  },
  {
    title: 'Reforma laboral: cambios que trabajadores y empleadores deben conocer',
    source: 'Ministerio del Trabajo',
    date: '',
    excerpt: 'Análisis de las modificaciones al Código Sustantivo del Trabajo y su efecto en contratos, jornadas y liquidaciones.',
    image: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.mintrabajo.gov.co/',
  },
]

function formatearFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Fila de BD → forma que consume la tarjeta.
function mapRow(r) {
  return {
    id: r.id,
    title: r.titulo || '',
    source: r.fuente || '',
    date: formatearFecha(r.fecha),
    excerpt: r.resumen || '',
    image: r.imagen_url || '',
    link: r.url || '',
  }
}

export default function NoticiasSection() {
  const { profile } = useAuth()
  const isSuperAdmin = profile?.rol === 'superadmin'

  const sectionRef = useRef(null)
  const fileInputRef = useRef(null)
  const uploadTargetRef = useRef(null)

  const [rows, setRows]         = useState([])      // filas crudas de la BD
  const [loaded, setLoaded]     = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editRows, setEditRows] = useState([])      // copias editables
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState(null)  // índice en subida

  // Carga las noticias reales (lectura pública con anon key).
  async function fetchNoticias() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/noticias?select=*&order=orden.asc&activo=eq.true`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) { setRows(data); setLoaded(true) }
    } catch { /* sin noticias en BD → se usa el respaldo curado */ }
  }

  useEffect(() => { fetchNoticias() }, [])

  // Lista pública: noticias reales o, si aún no hay, el respaldo curado.
  const noticias = rows.length ? rows.map(mapRow) : FALLBACK_NOTICIAS

  /* ── Edición (superadmin) ── */
  function enterEdit() {
    setEditRows(rows.map(r => ({ ...r })))
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setEditRows([])
  }
  function addNoticia() {
    setEditRows(prev => [...prev, {
      titulo: '', resumen: '', fuente: '', fecha: '', url: '', imagen_url: '', activo: true, _isNew: true,
    }])
  }
  function updateField(i, campo, valor) {
    setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, [campo]: valor } : r))
  }

  async function removeNoticia(index) {
    const removed = editRows[index]
    if (!confirm('¿Eliminar esta noticia?')) return
    setEditRows(prev => prev.filter((_, i) => i !== index))
    if (removed.id) {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      fetch(`${SUPABASE_URL}/rest/v1/noticias?id=eq.${encodeURIComponent(removed.id)}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      })
    }
  }

  /* ── Subida de imagen (comprimida) al bucket `noticias` ── */
  function triggerUpload(index) {
    uploadTargetRef.current = index
    fileInputRef.current?.click()
  }

  async function handleImageUpload(e) {
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    const index = uploadTargetRef.current
    setUploading(index)
    try {
      const file = await compressImage(rawFile)
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const path = `noticias/${Date.now()}.${ext}`
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/noticias/${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_KEY,
            'x-upsert': 'true',
            'Content-Type': file.type || 'image/jpeg',
          },
          body: file,
        }
      )
      if (!res.ok) throw new Error('No se pudo subir la imagen. Verifica que el bucket "noticias" exista.')
      const url = `${SUPABASE_URL}/storage/v1/object/public/noticias/${path}`
      updateField(index, 'imagen_url', url)
    } catch (err) {
      alert(err.message || 'Error subiendo la imagen')
    } finally {
      setUploading(null)
      e.target.value = ''
    }
  }

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
      for (let i = 0; i < editRows.length; i++) {
        const r = editRows[i]
        if (!r.titulo?.trim()) continue
        const payload = {
          titulo:     r.titulo.trim(),
          resumen:    r.resumen?.trim() || null,
          fuente:     r.fuente?.trim() || null,
          fecha:      r.fecha || null,
          url:        r.url?.trim() || null,
          imagen_url: r.imagen_url || null,
          orden:      i,
          activo:     true,
        }
        if (r.id && !r._isNew) {
          await fetch(`${SUPABASE_URL}/rest/v1/noticias?id=eq.${encodeURIComponent(r.id)}`, {
            method: 'PATCH', headers, body: JSON.stringify(payload),
          })
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/noticias`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          })
        }
      }
      await fetchNoticias()
      setEditing(false)
      setEditRows([])
    } catch (err) {
      alert('Error guardando: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.section} id="noticias" ref={sectionRef}>
      <motion.div
        className={styles.header}
        variants={headerStagger}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
      >
        <motion.span className={styles.label} variants={eyebrowReveal}>
          Actualidad
        </motion.span>
        <motion.h2 className={styles.title} variants={fadeUp}>
          Noticias <em>Jurídicas y Contables</em>
        </motion.h2>
        <motion.p className={styles.desc} variants={fadeUp}>
          Novedades sobre abogacía, contaduría, leyes y normatividad colombiana, seleccionadas por nuestro equipo.
        </motion.p>
      </motion.div>

      {/* Control de edición (solo superadmin) */}
      {isSuperAdmin && !editing && (
        <div className={styles.adminBar}>
          <button className={styles.fab} onClick={enterEdit}>✎ Editar noticias</button>
        </div>
      )}

      {editing ? (
        <div className={styles.editor}>
          <div className={styles.toolbar}>
            <button className={styles.toolAdd} onClick={addNoticia}>+ Agregar noticia</button>
            <button className={styles.toolSave} onClick={saveAll} disabled={saving}>
              {saving ? 'Guardando…' : '✓ Guardar'}
            </button>
            <button className={styles.toolCancel} onClick={cancelEdit} disabled={saving}>✕ Cancelar</button>
          </div>

          {editRows.length === 0 && (
            <p className={styles.editEmpty}>No hay noticias. Usa <strong>“+ Agregar noticia”</strong> para crear la primera.</p>
          )}

          <div className={styles.editGrid}>
            {editRows.map((r, i) => (
              <div key={r.id || `new-${i}`} className={styles.editCard}>
                <button
                  className={styles.editRemove}
                  onClick={() => removeNoticia(i)}
                  title="Eliminar noticia"
                  aria-label="Eliminar noticia"
                >✕</button>

                <button
                  type="button"
                  className={styles.editMedia}
                  onClick={() => triggerUpload(i)}
                  style={r.imagen_url ? { backgroundImage: `url(${r.imagen_url})` } : undefined}
                >
                  {uploading === i
                    ? <span className={styles.editMediaHint}>Subiendo…</span>
                    : <span className={styles.editMediaHint}>{r.imagen_url ? 'Cambiar imagen' : '＋ Imagen'}</span>}
                </button>

                <input
                  className={styles.editInput}
                  placeholder="Título"
                  value={r.titulo || ''}
                  onChange={e => updateField(i, 'titulo', e.target.value)}
                />
                <textarea
                  className={styles.editTextarea}
                  placeholder="Resumen"
                  rows={3}
                  value={r.resumen || ''}
                  onChange={e => updateField(i, 'resumen', e.target.value)}
                />
                <div className={styles.editRow2}>
                  <input
                    className={styles.editInput}
                    placeholder="Fuente (ej. DIAN)"
                    value={r.fuente || ''}
                    onChange={e => updateField(i, 'fuente', e.target.value)}
                  />
                  <input
                    className={styles.editInput}
                    type="date"
                    value={r.fecha ? String(r.fecha).slice(0, 10) : ''}
                    onChange={e => updateField(i, 'fecha', e.target.value)}
                  />
                </div>
                <input
                  className={styles.editInput}
                  placeholder="Enlace (https://…)"
                  value={r.url || ''}
                  onChange={e => updateField(i, 'url', e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          key={loaded ? 'live' : 'fallback'}
          className={styles.grid}
          variants={gridStagger}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {noticias.map((n, i) => {
            const clickable = !!n.link
            return (
              <motion.a
                key={`${n.id || n.link}-${i}`}
                className={styles.card}
                href={clickable ? n.link : undefined}
                target={clickable ? '_blank' : undefined}
                rel={clickable ? 'noopener noreferrer' : undefined}
                variants={cardReveal}
              >
                <div className={styles.media}>
                  {n.image ? (
                    <img
                      src={n.image}
                      alt=""
                      className={styles.image}
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <span className={styles.mediaFallback} aria-hidden="true">PB</span>
                  )}
                </div>
                <div className={styles.body}>
                  <div className={styles.meta}>
                    {n.source && <span className={styles.source}>{n.source}</span>}
                    {n.date && <span className={styles.date}>{n.date}</span>}
                  </div>
                  <h3 className={styles.cardTitle}>{n.title}</h3>
                  {n.excerpt && <p className={styles.excerpt}>{n.excerpt}</p>}
                  {clickable && <span className={styles.leer}>Leer más →</span>}
                </div>
              </motion.a>
            )
          })}
        </motion.div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />
    </section>
  )
}
