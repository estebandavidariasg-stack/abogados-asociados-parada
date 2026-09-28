import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, gridStagger, cardReveal, VIEWPORT } from '../../lib/motionVariants'
import { useAuth } from '../../context/AuthContext'
import styles from './NoticiasSection.module.css'

// El editor solo lo abren superadmin y admin: lazy para que quien visita la
// home no descargue nada de él.
const NoticiasEditorModal = lazy(() => import('./NoticiasEditorModal'))

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/* ── Noticias gestionadas por la administración ────────────────────────────
   Las noticias viven en la tabla `noticias` (Supabase) y el superadmin o el
   admin las administran desde el propio home, en un modal (NoticiasEditorModal).
   Lectura pública con la anon key (RLS deja ver solo `activo = true`). Si la
   tabla todavía no tiene noticias, se muestra un respaldo curado para que la
   sección nunca quede vacía; el modal lo explica y permite guardarlas. */

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

// `fecha` es una columna DATE ('AAAA-MM-DD'). Se arma como fecha LOCAL:
// new Date('2026-09-28') es medianoche UTC, y en Colombia (UTC-5) salía el
// día anterior en la tarjeta.
function formatearFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
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
  // Superadmin o admin (el admin hace todo menos gestionar roles).
  const { isPanelAdmin: puedeEditar } = useAuth()

  const sectionRef = useRef(null)

  const [rows, setRows]         = useState([])      // filas crudas de la BD
  const [loaded, setLoaded]     = useState(false)
  const [editorAbierto, setEditorAbierto] = useState(false)

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

      {/* Control de edición (superadmin o admin): abre el modal. */}
      {puedeEditar && (
        <div className={styles.adminBar}>
          <button className={styles.fab} onClick={() => setEditorAbierto(true)} aria-haspopup="dialog">
            ✎ Editar noticias
          </button>
        </div>
      )}

      {puedeEditar && editorAbierto && (
        <Suspense fallback={null}>
          <NoticiasEditorModal
            ejemplos={FALLBACK_NOTICIAS}
            onClose={() => setEditorAbierto(false)}
            onCambio={fetchNoticias}
          />
        </Suspense>
      )}

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
    </section>
  )
}
