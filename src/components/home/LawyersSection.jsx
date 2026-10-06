import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, VIEWPORT } from '../../lib/motionVariants'
import LawyerCard from './LawyerCard'
import FirmaCard from './FirmaCard'
import styles from './LawyersSection.module.css'
import { useAuth } from '../../context/AuthContext'
import { getAuthHeaders } from '../../lib/supabase'
import { useCarrusel } from '../../lib/useCarrusel'
import { esDeptoBogota, etiquetaCiudad } from '../../lib/validaciones'

/* Flechas de navegación centradas bajo la cinta de profesionales. Nudgean la
   cinta ~un ancho visible; el auto-desplazamiento continúa por su cuenta. */
function CintaFlechas({ onPrev, onNext }) {
  return (
    <div className={styles.cintaNav}>
      <button type="button" className={styles.cintaArrow} onClick={onPrev} aria-label="Ver profesionales anteriores">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className={styles.cintaArrow} onClick={onNext} aria-label="Ver más profesionales">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>
  )
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Mismas columnas públicas que devuelve /api/professionals (espejo de su
// PUBLIC_COLS). Solo se usan en la lectura directa del superadmin.
const PUBLIC_COLS = [
  'id', 'nombre', 'apellido', 'area_derecho',
  'ciudad', 'departamento',
  'foto_url', 'video_url', 'descripcion',
  'universidad', 'experiencia', 'rol',
  'instagram', 'linkedin', 'facebook', 'twitter', 'whatsapp', 'tiktok',
].join(',')

export default function LawyersSection() {
  const sectionRef = useRef(null)
  const [lawyers, setLawyers]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [profesion, setProfesion]       = useState('abogado')   // 'abogado' | 'contador' | 'firma'
  const [areaDerecho, setAreaDerecho]   = useState('')
  const [departamento, setDepartamento] = useState('')
  const [ciudad, setCiudad]             = useState('')
  const [shouldFetch, setShouldFetch]   = useState(false)
  const { profile }                     = useAuth()
  // Vista de administración del listado: superadmin o admin, sin distinción.
  const isSuperAdmin                    = profile?.rol === 'superadmin' || profile?.rol === 'admin'
  // Las firmas comparten esta cinta con abogados y contadores. Cada una es UNA
  // tarjeta (firma + Director + equipo); sus miembros no se repiten sueltos.
  const esFirmas = profesion === 'firma'
  const PLURAL   = { abogado: 'abogados', contador: 'contadores', firma: 'firmas' }[profesion]

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
        // Público: endpoint cacheado en el CDN de Vercel (api/professionals.js),
        // evita pegar a Supabase en cada carga del home. Superadmin: directo a
        // Supabase (mismo truco que VideoCarousel con fetchVideos(true)), para
        // que vea al profesional que acaba de aprobar sin esperar la caché.
        // Las firmas llegan siempre armadas del endpoint (firma + Director +
        // equipo): no hay lectura directa equivalente.
        const res = isSuperAdmin && !esFirmas
          ? await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${profesion}&select=${PUBLIC_COLS}`,
              { headers: await getAuthHeaders() }
            )
          : await fetch(`/api/professionals?rol=${profesion}`)
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          console.error('[LawyersSection] fetch failed:', res.status, detail)
          if (!cancelled) setLawyers([])
          return
        }
        const json = await res.json()
        if (cancelled) return
        let lista = Array.isArray(json) ? json : []
        // La lectura directa del superadmin no trae las consultas exitosas
        // ni a qué firma pertenece cada quien (los agrega el endpoint): se
        // toman de ahí para que vea la misma cinta que el visitante. Si falla,
        // la tarjeta va sin la cifra.
        if (isSuperAdmin && !esFirmas && lista.length) {
          try {
            const pub = await fetch(`/api/professionals?rol=${profesion}`).then(r => (r.ok ? r.json() : []))
            const meta = new Map((Array.isArray(pub) ? pub : []).map(p => [p.id, p]))
            for (const p of lista) {
              p.consultas_exitosas = meta.get(p.id)?.consultas_exitosas
              p.firma = meta.get(p.id)?.firma
            }
          } catch { /* sin cifra */ }
          if (cancelled) return
        }
        // Quien pertenece a una firma sale dentro de la tarjeta de su firma,
        // no como tarjeta suelta (la consulta sí lo sigue ofreciendo).
        if (!esFirmas) lista = lista.filter(p => !p.firma)
        setLawyers(lista)
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
  }, [profesion, shouldFetch, isSuperAdmin, esFirmas])

  // Al cambiar de profesión, resetear filtros secundarios
  function changeProfesion(p) {
    if (p === profesion) return
    // La lista anterior es de otro tipo (personas ↔ firmas): se vacía ya para
    // que no se pinte con la tarjeta equivocada mientras llega la nueva.
    setLawyers([]); setLoading(true)
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
  // Opciones del tercer filtro. En Bogotá D.C. son LOCALIDADES; sin
  // departamento elegido van en su propio grupo para que "Engativá" no se
  // lea como una ciudad más al lado de "Medellín".
  const ciudadesDelDepto = departamento
    ? ciudades.filter(c => lawyers.some(l => l.departamento === departamento && l.ciudad === c))
    : []
  const localidadesBogota = departamento ? [] : ciudades.filter(c =>
    lawyers.some(l => l.ciudad === c && etiquetaCiudad(l.departamento, c) === 'Localidad'))
  const ciudadesFueraDeBogota = departamento ? [] : ciudades.filter(c => !localidadesBogota.includes(c))

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
          Nuestra red de profesionales
        </motion.span>
        <motion.h2 className={styles.title} variants={fadeUp}>
          Encuentra el Profesional <em>Adecuado</em> para tu Caso
        </motion.h2>
        <motion.p className={styles.desc} variants={fadeUp}>
          Todos los profesionales que hacen parte de nuestra red han sido previamente verificados para ofrecer una experiencia basada en confianza, transparencia y calidad.
        </motion.p>
      </motion.div>

      {/* ── Switch de profesión (chips) ── */}
      <span className={`${styles.profesionLabel} fade-up`}>Profesión</span>
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
        <button
          type="button"
          className={`${styles.profesionChip} ${esFirmas ? styles.profesionChipActive : ''}`}
          onClick={() => changeProfesion('firma')}
        >
          Firmas
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
            <label className={styles.filterLabel}>{esDeptoBogota(departamento) ? 'Localidad' : 'Ciudad'}</label>
            <div className={styles.selectWrap}>
              <select className={styles.filterSelect} value={ciudad}
                onChange={e => setCiudad(e.target.value)}>
                <option value="">Todas</option>
                {departamento
                  ? ciudadesDelDepto.map(c => <option key={c} value={c}>{c}</option>)
                  : <>
                      {ciudadesFueraDeBogota.map(c => <option key={c} value={c}>{c}</option>)}
                      {localidadesBogota.length > 0 && (
                        <optgroup label="Bogotá D.C. · localidades">
                          {localidadesBogota.map(c => <option key={c} value={c}>{c}</option>)}
                        </optgroup>
                      )}
                    </>}
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
            {filtered.length} {esFirmas
              ? `firma${filtered.length !== 1 ? 's' : ''} encontrada${filtered.length !== 1 ? 's' : ''}`
              : profesion === 'contador'
              ? `contador${filtered.length !== 1 ? 'es' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`
              : `abogado${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <p className={styles.empty}>
          Cargando {PLURAL}...
        </p>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyWrap}>
          <p className={styles.empty}>
            {hasFilters
              ? `No hay ${PLURAL} que coincidan con los filtros.`
              : `Próximamente se añadirán ${PLURAL} a esta sección.`}
          </p>
          {hasFilters && (
            <button className={styles.filterClear} onClick={clearFilters}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <ProfesionalesCinta items={filtered} isSuperAdmin={isSuperAdmin} calm={!!hasFilters} firmas={esFirmas} />
      )}
    </section>
  )
}

/* ── Cinta de profesionales ────────────────────────────────────────────────
   Una sola fila de tarjetas de perfil (accionables) con tres formas de navegar:
   auto-desplazamiento continuo, arrastre con el dedo/mouse (como un scroll), y
   flechas centradas debajo. El auto-avance se PAUSA al pasar el mouse, enfocar
   con teclado o arrastrar, para poder abrir cada tarjeta. Cuando hay filtros
   activos, se reduce el movimiento, o hay pocas tarjetas para llenar la fila,
   se desactiva el bucle: la fila queda quieta pero el arrastre y las flechas
   siguen desplazándola. */
function ProfesionalesCinta({ items, isSuperAdmin, calm, firmas = false }) {
  const reduce = useReducedMotion()
  const wrapRef = useRef(null)
  const [anchoVisible, setAnchoVisible] = useState(0)

  // Antes el bucle se activaba con `items.length >= 4`, y con 3 profesionales
  // la cinta quedaba inmóvil. Pero que haga falta desplazarse no depende del
  // número de tarjetas sino de si DESBORDAN el ancho disponible: 3 caben en
  // escritorio y no caben en un teléfono. Así que se mide.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setAnchoVisible(el.clientWidth)
    if (!('ResizeObserver' in window)) return
    const ro = new ResizeObserver(([e]) => setAnchoVisible(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Espejo de .slide en el CSS: clamp(240px, 25vw, 280px) + 1.5rem de margen.
  const anchoTarjeta =
    Math.min(280, Math.max(240, (typeof window !== 'undefined' ? window.innerWidth : 1200) * 0.25)) + 24
  const desborda = anchoVisible > 0 && items.length * anchoTarjeta > anchoVisible + 8

  const loop = !reduce && !calm && desborda && items.length >= 2
  const { scrollerRef, step, handlers } = useCarrusel({ speed: 34, loop })
  const copias = loop ? [0, 1] : [0]
  // Las firmas arrancan siendo pocas: si caben todas, la fila se centra y no
  // finge desplazarse (sin desvanecido en los bordes, que tapaba media primera
  // tarjeta, ni flechas que no mueven nada).
  const quieta = firmas && anchoVisible > 0 && !desborda

  return (
    <div className={styles.cintaWrap} ref={wrapRef}>
      <div className={`${styles.cinta} ${quieta ? styles.cintaQuieta : ''}`} ref={scrollerRef} {...handlers}>
        <div className={styles.track}>
          {copias.flatMap((copia) =>
            items.map((l) => (
              <div className={styles.slide} key={`${copia}-${l.id}`}>
                {firmas ? (
                  <FirmaCard firma={l} reveal={false} ghost={copia === 1} />
                ) : (
                  <LawyerCard
                    lawyer={l}
                    isSuperAdmin={isSuperAdmin}
                    reveal={false}
                    ghost={copia === 1}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {!quieta && <CintaFlechas onPrev={() => step(-1)} onNext={() => step(1)} />}
    </div>
  )
}
