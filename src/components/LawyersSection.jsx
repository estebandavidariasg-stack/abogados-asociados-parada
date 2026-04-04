import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import LawyerCard from './LawyerCard'
import styles from './LawyersSection.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function LawyersSection() {
  const sectionRef = useRef(null)
  const [lawyers, setLawyers] = useState([])
  const [loading, setLoading] = useState(true)
  const [areaDerecho, setAreaDerecho] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [ciudad, setCiudad] = useState('')

  /* ── Fetch abogados aprobados ──────────────── */
  useEffect(() => {
    async function fetchLawyers() {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=*`,
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${token || SUPABASE_KEY}`,
            },
          },
        )
        const json = await res.json()
        setLawyers(Array.isArray(json) ? json : [])
      } catch {
        setLawyers([])
      } finally {
        setLoading(false)
      }
    }
    fetchLawyers()
  }, [])

  /* ── Intersection observer ─────────────────── */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible')
        }),
      { threshold: 0.12 },
    )
    const els = sectionRef.current?.querySelectorAll('.fade-up')
    els?.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [lawyers, areaDerecho, departamento, ciudad])

  /* ── Valores únicos para filtros ───────────── */
  const areas = [...new Set(lawyers.map((l) => l.area_derecho).filter(Boolean))].sort()
  const departamentos = [...new Set(lawyers.map((l) => l.departamento).filter(Boolean))].sort()
  const ciudades = [...new Set(lawyers.map((l) => l.ciudad).filter(Boolean))].sort()

  /* ── Filtrar abogados ──────────────────────── */
  const filtered = lawyers.filter((l) => {
    if (areaDerecho && l.area_derecho !== areaDerecho) return false
    if (departamento && l.departamento !== departamento) return false
    if (ciudad && l.ciudad !== ciudad) return false
    return true
  })

  const hasFilters = areaDerecho || departamento || ciudad

  function clearFilters() {
    setAreaDerecho('')
    setDepartamento('')
    setCiudad('')
  }

  return (
    <section className={styles.section} id="lawyers" ref={sectionRef}>
      <div className={`${styles.header} fade-up`}>
        <span className={styles.label}>Nuestros Socios</span>
        <h2 className={styles.title}>
          ABOGADOS DE <em>EXCELENCIA</em>
        </h2>
        <p className={styles.desc}>
          Profesionales especializados, comprometidos con cada caso y con la
          defensa de sus derechos.
        </p>
      </div>

      {/* ── Filtros ──────────────────────────────── */}
      {lawyers.length > 0 && (
        <div className={`${styles.filters} fade-up`}>
          {areas.length > 0 && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Área</label>
              <select
                className={styles.filterSelect}
                value={areaDerecho}
                onChange={(e) => setAreaDerecho(e.target.value)}
              >
                <option value="">Todas</option>
                {areas.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          )}

          {departamentos.length > 0 && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Departamento</label>
              <select
                className={styles.filterSelect}
                value={departamento}
                onChange={(e) => setDepartamento(e.target.value)}
              >
                <option value="">Todos</option>
                {departamentos.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {ciudades.length > 0 && (
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>Ciudad</label>
              <select
                className={styles.filterSelect}
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
              >
                <option value="">Todas</option>
                {ciudades.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {hasFilters && (
            <button className={styles.filterClear} onClick={clearFilters}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* ── Grid de abogados ─────────────────────── */}
      {loading ? (
        <p className={styles.empty}>Cargando abogados...</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>
          {hasFilters
            ? 'No hay abogados que coincidan con los filtros seleccionados.'
            : 'Próximamente se añadirán abogados a esta sección.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((lawyer, i) => (
            <LawyerCard key={lawyer.id} lawyer={lawyer} delay={i * 0.1} />
          ))}
        </div>
      )}
    </section>
  )
}
