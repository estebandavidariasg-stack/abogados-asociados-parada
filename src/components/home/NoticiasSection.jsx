import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, gridStagger, cardReveal, VIEWPORT } from '../../lib/motionVariants'
import styles from './NoticiasSection.module.css'

/* ── Fuente de noticias (sin API key) ──────────────────────────────────────
   Google News RSS (búsqueda de temas jurídicos/contables de Colombia) leído a
   través del proxy público rss2json, que convierte el feed a JSON y evita los
   problemas de CORS del RSS crudo. Si algo falla (proxy caído, cuota, red), se
   usa el arreglo curado de abajo para que la sección NUNCA quede vacía. */
const GOOGLE_NEWS_RSS =
  'https://news.google.com/rss/search?q=(abogados%20OR%20contadores%20OR%20leyes%20OR%20DIAN%20OR%20jur%C3%ADdico)%20Colombia&hl=es-419&gl=CO&ceid=CO:es-419'
const RSS_TO_JSON =
  'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(GOOGLE_NEWS_RSS)

const MAX_ITEMS = 6

// Respaldo curado — titulares reales de fuentes oficiales y de prensa colombiana.
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
  {
    title: 'Nuevas Normas Internacionales de Información Financiera (NIIF) para pymes',
    source: 'Consejo Técnico de la Contaduría',
    date: '',
    excerpt: 'Los contadores públicos se preparan para actualizar sus procesos ante los ajustes normativos en materia de información financiera.',
    image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.ctcp.gov.co/',
  },
  {
    title: 'Superintendencia de Sociedades emite lineamientos de gobierno corporativo',
    source: 'Supersociedades',
    date: '',
    excerpt: 'Recomendaciones sobre transparencia, prevención del riesgo y cumplimiento para las empresas colombianas.',
    image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.supersociedades.gov.co/',
  },
  {
    title: 'Rama Judicial avanza en la digitalización de expedientes y audiencias virtuales',
    source: 'Rama Judicial',
    date: '',
    excerpt: 'El expediente electrónico y las audiencias en línea agilizan procesos y amplían el acceso a la justicia en el país.',
    image: 'https://images.unsplash.com/photo-1436450412740-6b988f486c6b?w=640&q=70&auto=format&fit=crop',
    link: 'https://www.ramajudicial.gov.co/',
  },
]

// Quita etiquetas HTML y entidades comunes de las descripciones del RSS.
function stripHtml(html = '') {
  const sinTags = html.replace(/<[^>]*>/g, ' ')
  return sinTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function acortar(texto = '', max = 140) {
  if (texto.length <= max) return texto
  return texto.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

// Google News antepone "Fuente" con " - " al final del título; lo separamos.
function partirTitulo(titulo = '') {
  const idx = titulo.lastIndexOf(' - ')
  if (idx > 0 && idx > titulo.length - 45) {
    return { title: titulo.slice(0, idx).trim(), source: titulo.slice(idx + 3).trim() }
  }
  return { title: titulo.trim(), source: '' }
}

function formatearFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function NoticiasSection() {
  const sectionRef = useRef(null)
  const [noticias, setNoticias] = useState(FALLBACK_NOTICIAS)
  const [shouldFetch, setShouldFetch] = useState(false)

  // Diferimos el fetch hasta que la sección se acerque al viewport.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { setShouldFetch(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some(e => e.isIntersecting)) { setShouldFetch(true); io.disconnect() } },
      { rootMargin: '450px 0px', threshold: 0.01 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Un solo fetch, cacheado en estado — no se repite en cada render.
  useEffect(() => {
    if (!shouldFetch) return
    let cancelled = false
    async function cargar() {
      try {
        const res = await fetch(RSS_TO_JSON)
        if (!res.ok) return
        const json = await res.json()
        if (cancelled) return
        const items = Array.isArray(json?.items) ? json.items : []
        if (!items.length) return
        const mapped = items.slice(0, MAX_ITEMS).map((it) => {
          const { title, source } = partirTitulo(it.title || '')
          return {
            title: title || 'Noticia',
            source: source || json?.feed?.title || 'Google News',
            date: formatearFecha(it.pubDate),
            excerpt: acortar(stripHtml(it.description || it.content || '')),
            image: it.thumbnail || it.enclosure?.link || '',
            link: it.link || '#',
          }
        })
        if (mapped.length) setNoticias(mapped)
      } catch {
        // Silencioso: nos quedamos con el respaldo curado.
      }
    }
    cargar()
    return () => { cancelled = true }
  }, [shouldFetch])

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
          Novedades sobre abogacía, contaduría, leyes y normatividad colombiana, actualizadas para mantenerte al día.
        </motion.p>
      </motion.div>

      <motion.div
        className={styles.grid}
        variants={gridStagger}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
      >
        {noticias.map((n, i) => (
          <motion.a
            key={`${n.link}-${i}`}
            className={styles.card}
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
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
                <span className={styles.mediaFallback} aria-hidden="true">AAP</span>
              )}
            </div>
            <div className={styles.body}>
              <div className={styles.meta}>
                {n.source && <span className={styles.source}>{n.source}</span>}
                {n.date && <span className={styles.date}>{n.date}</span>}
              </div>
              <h3 className={styles.cardTitle}>{n.title}</h3>
              {n.excerpt && <p className={styles.excerpt}>{n.excerpt}</p>}
              <span className={styles.leer}>Leer más →</span>
            </div>
          </motion.a>
        ))}
      </motion.div>
    </section>
  )
}
