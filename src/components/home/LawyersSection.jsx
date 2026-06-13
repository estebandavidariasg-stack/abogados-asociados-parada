import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, VIEWPORT } from '../../lib/motionVariants'
import LawyerCard from './LawyerCard'
import styles from './LawyersSection.module.css'
import { useAuth } from '../../context/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export default function LawyersSection() {
  const sectionRef = useRef(null)
  const [lawyers, setLawyers]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [profesion, setProfesion]       = useState('abogado')   // 'abogado' | 'contador'
  const [areaDerecho, setAreaDerecho]   = useState('')
  const [departamento, setDepartamento] = useState('')
  const [ciudad, setCiudad]             = useState('')
  const [shouldFetch, setShouldFetch]   = useState(false)
  const { profile }                     = useAuth()
  const isSuperAdmin                    = profile?.rol === 'superadmin'

  // Performance: esta seccion esta debajo del hero, asi que diferimos perfiles
  // y fotos remotas hasta que el usuario este cerca de verla.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setShouldFetch(true)
          observer.disconnect()
        }
      },
      { rootMargin: '450px 0px', threshold: 0.01 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fetch reactivo a la profesión seleccionada
  useEffect(() => {
    if (!shouldFetch || !SUPABASE_URL || !SUPABASE_KEY) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function fetchLawyers() {
      setLoading(true)
      try {
        // Endpoint cacheado en el CDN de Vercel (ver api/professionals.js):
        // evita pegar a Supabase en cada carga del home. Devuelve SOLO las
        // columnas públicas (la whitelist vive ahora server-side).
        const res = await fetch(`/api/professionals?rol=${profesion}`)
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          console.error('[LawyersSection] fetch failed:', res.status, detail)
          if (!cancelled) setLawyers([])
          return
        }
        const json = await res.json()
        if (cancelled) return
        setLawyers(Array.isArray(json) ? json : [])
      } catch (err) {
        console.error('[LawyersSection] fetch error:', err)
        if (!cancelled) setLawyers([])
      }
      finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchLawyers()
    return () => { cancelled = true }
  }, [profesion, shouldFetch])

  // Al cambiar de profesión, resetear filtros secundarios
  function changeProfesion(p) {
    if (p === profesion) return
    setProfesion(p)
    setAreaDerecho(''); setDepartamento(''); setCiudad('')
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.12 }
    )
    const els = sectionRef.current?.querySelectorAll('.fade-up')
    els?.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [lawyers, areaDerecho, departamento, ciudad])

  // Áreas: extraer todas las áreas individuales (están separadas por coma)
  const todasAreas = [...new Set(
    lawyers.flatMap(l => l.area_derecho
      ? l.area_derecho.split(',').map(a => a.trim()).filter(Boolean)
      : []
    )
  )].sort()

  const departamentos = [...new Set(lawyers.map(l => l.departamento).filter(Boolean))].sort()
  const ciudades      = [...new Set(lawyers.map(l => l.ciudad).filter(Boolean))].sort()

  const filtered = lawyers.filter(l => {
    if (areaDerecho && !l.area_derecho?.split(',').map(a => a.trim()).includes(areaDerecho)) return false
    if (departamento && l.departamento !== departamento) return false
    if (ciudad && l.ciudad !== ciudad) return false
    return true
  })

  const hasFilters = areaDerecho || departamento || ciudad
  function clearFilters() { setAreaDerecho(''); setDepartamento(''); setCiudad('') }

  return (
    <section className={styles.section} id="lawyers" ref={sectionRef}>

      <motion.div
        className={styles.header}
        variants={headerStagger}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
      >
        <motion.span className={styles.label} variants={eyebrowReveal}>
          Nuestros Socios
        </motion.span>
        <motion.h2 className={styles.title} variants={fadeUp}>
          Abogados y Contadores de <em>Excelencia</em>
        </motion.h2>
        <motion.p className={styles.desc} variants={fadeUp}>
          Profesionales del derecho y la contaduría, comprometidos con cada caso y con tus resultados.
        </motion.p>
      </motion.div>

      {/* ── Switch de profesión (chips) ── */}
      <div className={`${styles.profesionRow} fade-up`}>
        <button
          type="button"
          className={`${styles.profesionChip} ${profesion === 'abogado'  ? styles.profesionChipActive : ''}`}
          onClick={() => changeProfesion('abogado')}
        >
          Abogados
        </button>
        <button
          type="button"
          className={`${styles.profesionChip} ${profesion === 'contador' ? styles.profesionChipActive : ''}`}
          onClick={() => changeProfesion('contador')}
        >
          Contadores
        </button>
      </div>

      {/* ── Filtros — siempre visibles para que la UI sea consistente entre
          abogados y contadores, incluso si todavía no hay perfiles cargados. ── */}
      <div className={`${styles.filtersWrap} fade-up`}>
        <div className={styles.filters}>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>
              {profesion === 'contador' ? 'Especialidad' : 'Área'}
            </label>
            <div className={styles.selectWrap}>
              <select className={styles.filterSelect} value={areaDerecho}
                onChange={e => setAreaDerecho(e.target.value)}>
                <option value="">Todas</option>
                {todasAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Departamento</label>
            <div className={styles.selectWrap}>
              <select className={styles.filterSelect} value={departamento}
                onChange={e => { setDepartamento(e.target.value); setCiudad('') }}>
                <option value="">Todos</option>
                {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Ciudad</label>
            <div className={styles.selectWrap}>
              <select className={styles.filterSelect} value={ciudad}
                onChange={e => setCiudad(e.target.value)}>
                <option value="">Todas</option>
                {(departamento
                  ? ciudades.filter(c => lawyers.some(l => l.departamento === departamento && l.ciudad === c))
                  : ciudades
                ).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {hasFilters && (
            <button className={styles.filterClear} onClick={clearFilters}>
              ✕ Limpiar
            </button>
          )}
        </div>

        {/* Contador de resultados */}
        {hasFilters && (
          <p className={styles.filterCount}>
            {filtered.length} {profesion === 'contador'
              ? `contador${filtered.length !== 1 ? 'es' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`
              : `abogado${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <p className={styles.empty}>
          Cargando {profesion === 'contador' ? 'contadores' : 'abogados'}...
        </p>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyWrap}>
          <p className={styles.empty}>
            {hasFilters
              ? `No hay ${profesion === 'contador' ? 'contadores' : 'abogados'} que coincidan con los filtros.`
              : `Próximamente se añadirán ${profesion === 'contador' ? 'contadores' : 'abogados'} a esta sección.`}
          </p>
          {hasFilters && (
            <button className={styles.filterClear} onClick={clearFilters}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((lawyer, i) => (
            <LawyerCard key={lawyer.id} lawyer={lawyer} delay={i * 0.1} isSuperAdmin={isSuperAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}
