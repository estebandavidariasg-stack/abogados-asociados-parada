import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import LawyerCard from './LawyerCard'
import styles from './LawyersSection.module.css'
import { useAuth } from '../../context/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function LawyersSection() {
  const sectionRef = useRef(null)
  const [lawyers, setLawyers]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [profesion, setProfesion]       = useState('abogado')   // 'abogado' | 'contador'
  const [areaDerecho, setAreaDerecho]   = useState('')
  const [departamento, setDepartamento] = useState('')
  const [ciudad, setCiudad]             = useState('')
  const { profile }                     = useAuth()
  const isSuperAdmin                    = profile?.rol === 'superadmin'

  // Fetch reactivo a la profesión seleccionada
  useEffect(() => {
    let cancelled = false
    async function fetchLawyers() {
      setLoading(true)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        // Solo columnas estrictamente públicas — el visitante anónimo NO
        // debe recibir email, telefono, direccion, tarjeta_archivo_url, etc.
        // Antes era `select=*` y exponía todo en el JSON (scrape trivial).
        // Si una columna nueva debe ser pública, agrégala explícitamente.
        const PUBLIC_COLS = [
          'id', 'nombre', 'apellido', 'area_derecho',
          'ciudad', 'departamento',
          'foto_url', 'video_url', 'descripcion',
          'universidad', 'experiencia', 'rol',
          'instagram', 'linkedin', 'facebook', 'twitter', 'whatsapp', 'tiktok',
        ].join(',')
        const url =
          `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${profesion}` +
          `&select=${PUBLIC_COLS}`
        const res = await fetch(url, {
          headers: { 'Content-Type':'application/json', apikey: SUPABASE_KEY, Authorization:`Bearer ${token||SUPABASE_KEY}` },
        })
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
  }, [profesion])

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

      <div className={`${styles.header} fade-up`}>
        <span className={styles.label}>Nuestros Socios</span>
        <h2 className={styles.title}>
          {profesion === 'contador'
            ? <>CONTADORES <em>ALIADOS</em></>
            : <>ABOGADOS DE <em>EXCELENCIA</em></>}
        </h2>
        <p className={styles.desc}>
          {profesion === 'contador'
            ? 'Profesionales contables aliados, especialistas en auditoría, tributaria y gestión financiera.'
            : 'Profesionales especializados, comprometidos con cada caso y con la defensa de sus derechos.'}
        </p>
      </div>

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