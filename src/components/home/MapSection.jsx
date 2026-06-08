import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis,
  LineChart, Line,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import styles from './MapSection.module.css'

const W = 1000, H = 640

/* ── Recorte a Colombia + vecinos ──────────────────────────────────────────
   IDs ISO 3166-1 numéricos (world-atlas). Colombia se resalta; los vecinos
   (Venezuela, Ecuador, Perú, Brasil, Panamá y demás de la región) se dibujan
   en tono tenue. En vez de listar cada vecino, filtramos por centroide dentro
   de una caja amplia → la región se dibuja completa y lo que sobra lo recorta
   el viewBox. */
const COLOMBIA_ID = 170
const REGION_BBOX = { lngMin: -95, lngMax: -45, latMin: -25, latMax: 22 }

/* Caja geográfica CENTRADA en Colombia (centro ≈ -73.5, 4.5°) a la que ajustamos
   la proyección con fitExtent → Colombia queda centrada y grande, con los vecinos
   rodeándola y llenando el marco. El aspecto de la caja (≈1.56) coincide con el
   del viewBox (1000/640) para que la tierra llene el cuadro sin franjas vacías. */
const MAP_BOX = {
  type: 'Polygon',
  coordinates: [[[-88, 14], [-59, 14], [-59, -5], [-88, -5], [-88, 14]]],
}

// ── Ciudades colombianas en [lng, lat] (Bogotá = hub principal) ──────────────
const CITIES = [
  { id: 0,  name: 'Bogotá',        coords: [-74.07,  4.71], main: true },
  { id: 1,  name: 'Medellín',      coords: [-75.56,  6.25] },
  { id: 2,  name: 'Cali',          coords: [-76.53,  3.45] },
  { id: 3,  name: 'Barranquilla',  coords: [-74.80, 10.97] },
  { id: 4,  name: 'Cartagena',     coords: [-75.51, 10.42] },
  { id: 5,  name: 'Bucaramanga',   coords: [-73.12,  7.13] },
  { id: 6,  name: 'Pereira',       coords: [-75.69,  4.81] },
  { id: 7,  name: 'Cúcuta',        coords: [-72.51,  7.89] },
  { id: 8,  name: 'Santa Marta',   coords: [-74.20, 11.24] },
  { id: 9,  name: 'Pasto',         coords: [-77.28,  1.21] },
  { id: 10, name: 'Villavicencio', coords: [-73.63,  4.14] },
  { id: 11, name: 'Manizales',     coords: [-75.51,  5.07] },
]

// Conexiones que simulan actividad nacional (hub Bogotá + enlaces cruzados).
const CONNECTIONS = [
  { from: 0, to: 1,  delay: 0   },
  { from: 0, to: 2,  delay: 1.2 },
  { from: 0, to: 3,  delay: 2.4 },
  { from: 0, to: 5,  delay: 0.8 },
  { from: 0, to: 7,  delay: 3.0 },
  { from: 0, to: 9,  delay: 2.0 },
  { from: 0, to: 10, delay: 1.6 },
  { from: 1, to: 4,  delay: 1.0 },
  { from: 2, to: 9,  delay: 2.8 },
  { from: 1, to: 6,  delay: 0.5 },
  { from: 3, to: 8,  delay: 1.8 },
  { from: 5, to: 7,  delay: 3.4 },
  { from: 1, to: 11, delay: 2.2 },
]

function curvePath(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  const curve = dist * 0.28
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const nx = -dy / dist, ny = dx / dist
  const cx = mx + nx * curve
  const cy = my + ny * curve
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

/* ── DATOS ILUSTRATIVOS (placeholder marcado) ───────────────────────────────
   Se usan como respaldo si la plataforma aún no tiene datos reales suficientes,
   y SIEMPRE para la serie temporal / "en vivo" (no hay fuente pública para
   sesiones activas ni histórico de casos). Reemplazar por datos reales cuando
   exista la fuente. Los gráficos de roles / área / departamento sí consultan
   datos reales de /api/professionals y solo caen aquí si vienen vacíos. */
const PH_ROLES = [{ name: 'Abogados', value: 8 }, { name: 'Contadores', value: 4 }]
const PH_AREAS = [
  { name: 'Civil', value: 7 }, { name: 'Penal', value: 5 }, { name: 'Laboral', value: 4 },
  { name: 'Familia', value: 3 }, { name: 'Comercial', value: 3 }, { name: 'Tributario', value: 2 },
]
const PH_DEPTOS = [
  { name: 'Cundinamarca', value: 9 }, { name: 'Antioquia', value: 6 }, { name: 'Valle', value: 5 },
  { name: 'Atlántico', value: 4 }, { name: 'Santander', value: 3 },
]
const ACTIVIDAD_ILUSTRATIVA = [
  { mes: 'Ene', v: 34 }, { mes: 'Feb', v: 41 }, { mes: 'Mar', v: 48 }, { mes: 'Abr', v: 45 },
  { mes: 'May', v: 58 }, { mes: 'Jun', v: 67 }, { mes: 'Jul', v: 72 }, { mes: 'Ago', v: 81 },
  { mes: 'Sep', v: 88 }, { mes: 'Oct', v: 102 }, { mes: 'Nov', v: 114 }, { mes: 'Dic', v: 131 },
]

// Paleta AAP (hex directos, sin variables CSS).
const NAVY = '#0d2d5e'
const GOLD = '#c9a84c'
const PALETTE = ['#c9a84c', '#0d2d5e', '#4a5568', '#e8c96a', '#6b7c93', '#9a7d32']

// Acorta etiquetas largas en los ejes (el nombre completo va en el tooltip).
const truncLabel = (s) => (typeof s === 'string' && s.length > 13 ? s.slice(0, 12) + '…' : s)

// ── Tooltip compartido (tarjeta blanca, texto navy) ──────────────────────────
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className={styles.tip}>
      {label != null && label !== '' && <span className={styles.tipLabel}>{label}</span>}
      <span className={styles.tipVal}>{p.name}: <strong>{p.value}</strong></span>
    </div>
  )
}

// ── Tarjeta contenedora de cada gráfico ──────────────────────────────────────
function ChartCard({ title, hint, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {hint && <span className={styles.cardHint}>{hint}</span>}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  )
}

export default function MapSection() {
  const sectionRef = useRef(null)
  const [worldPaths, setWorldPaths] = useState([])
  const [projected,  setProjected]  = useState([])
  const [paths,      setPaths]      = useState([])
  const [loading,    setLoading]    = useState(true)

  // ── Métricas (datos reales con respaldo ilustrativo) ──
  const [roleData, setRoleData] = useState(PH_ROLES)
  const [areaData, setAreaData] = useState(PH_AREAS)
  const [deptData, setDeptData] = useState(PH_DEPTOS)
  const [totalProf, setTotalProf] = useState(12)
  const [totalDeptos, setTotalDeptos] = useState(8)
  const [activos, setActivos] = useState(0)   // "consultas activas" — ilustrativo

  // ── Cargar TopoJSON y proyectar centrado en Colombia ──
  useEffect(() => {
    let cancel = false
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(world => {
        if (cancel) return
        const countries = topojson.feature(world, world.objects.countries)

        // Proyección Mercator ajustada a la caja centrada en Colombia → Colombia
        // grande y centrada, vecinos alrededor llenando el marco.
        const projection = d3.geoMercator()
        projection.fitExtent([[14, 14], [W - 14, H - 14]], MAP_BOX)
        const pathGen = d3.geoPath().projection(projection)

        // Solo países de la región (centroide dentro de la caja).
        const region = countries.features.filter(f => {
          const [lng, lat] = d3.geoCentroid(f)
          return lng >= REGION_BBOX.lngMin && lng <= REGION_BBOX.lngMax &&
                 lat >= REGION_BBOX.latMin && lat <= REGION_BBOX.latMax
        })
        const dPaths = region.map(f => ({
          id: f.id,
          d: pathGen(f),
          isCO: +f.id === COLOMBIA_ID,
        })).filter(p => p.d)
        setWorldPaths(dPaths)

        const pts = CITIES.map(c => {
          const [x, y] = projection(c.coords) || [0, 0]
          return { ...c, x, y }
        })
        setProjected(pts)

        const cPaths = CONNECTIONS.map((c, i) => {
          const a = pts[c.from], b = pts[c.to]
          return { ...c, i, path: curvePath(a.x, a.y, b.x, b.y) }
        })
        setPaths(cPaths)
        setLoading(false)
      })
      .catch(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [])

  // ── Cargar métricas reales (endpoint público cacheado) ──
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const [aRes, cRes] = await Promise.all([
          fetch('/api/professionals?rol=abogado'),
          fetch('/api/professionals?rol=contador'),
        ])
        const abogados   = aRes.ok ? await aRes.json() : []
        const contadores = cRes.ok ? await cRes.json() : []
        if (cancel) return
        const todos = [
          ...(Array.isArray(abogados) ? abogados : []),
          ...(Array.isArray(contadores) ? contadores : []),
        ]

        // Roles → dona.
        if (todos.length) {
          setRoleData([
            { name: 'Abogados',   value: abogados.length },
            { name: 'Contadores', value: contadores.length },
          ])
          setTotalProf(todos.length)
        }

        // Áreas de derecho → barras (area_derecho es lista separada por comas).
        const areaCount = {}
        todos.forEach(p => {
          (p.area_derecho || '').split(',').map(s => s.trim()).filter(Boolean)
            .forEach(a => { areaCount[a] = (areaCount[a] || 0) + 1 })
        })
        const areaReal = Object.entries(areaCount)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6)
        if (areaReal.length) setAreaData(areaReal)

        // Departamentos → barras horizontales.
        const deptCount = {}
        todos.forEach(p => {
          const d = (p.departamento || '').trim()
          if (d) deptCount[d] = (deptCount[d] || 0) + 1
        })
        const deptReal = Object.entries(deptCount)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
        if (deptReal.length) {
          setDeptData(deptReal)
          setTotalDeptos(Object.keys(deptCount).length)
        }
      } catch { /* se mantienen los placeholders */ }
    })()
    return () => { cancel = true }
  }, [])

  // ── Contador "consultas activas" (ilustrativo): cuenta hacia un base y
  //    fluctúa levemente para dar sensación de tiempo real. ──
  useEffect(() => {
    const target = 24
    let n = 0
    const up = setInterval(() => {
      n += 2
      setActivos(Math.min(n, target))
      if (n >= target) clearInterval(up)
    }, 45)
    const fluct = setInterval(() => {
      setActivos(t => Math.max(18, Math.min(31, t + (Math.random() > 0.5 ? 1 : -1))))
    }, 3500)
    return () => { clearInterval(up); clearInterval(fluct) }
  }, [])

  // ── IntersectionObserver (reveal) ──
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) e.target.classList.add(styles.visible) },
      { threshold: 0.08 }
    )
    if (sectionRef.current) obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [])

  return (
    <section className={styles.section} ref={sectionRef}>

      <div className={styles.header}>
        <span className={styles.label}>Alcance</span>
        <h2 className={styles.title}>COBERTURA <em>NACIONAL</em></h2>
        <p className={styles.subtitle}>Presencia jurídica y contable en toda Colombia</p>
      </div>

      {/* ── Dashboard: gráficos rodeando el mapa ── */}
      <div className={styles.dashboard}>

        {/* Columna izquierda */}
        <aside className={styles.colLeft}>
          <ChartCard title="Abogados vs Contadores">
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={roleData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={42} outerRadius={66}
                  paddingAngle={3} stroke="none"
                  isAnimationActive animationDuration={900}
                >
                  {roleData.map((e, i) => (
                    <Cell key={i} fill={i === 0 ? NAVY : GOLD} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: NAVY }} />
                Abogados ({roleData[0]?.value ?? 0})
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: GOLD }} />
                Contadores ({roleData[1]?.value ?? 0})
              </span>
            </div>
          </ChartCard>

          <ChartCard title="Profesionales por área">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={areaData} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="name" interval={0} angle={-30} textAnchor="end" height={62}
                  tickFormatter={truncLabel}
                  tick={{ fontSize: 9, fill: '#4a5568' }} tickLine={false} axisLine={{ stroke: 'rgba(13,45,94,0.15)' }}
                />
                <YAxis
                  allowDecimals={false} width={26}
                  tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false}
                />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(13,45,94,0.05)' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900}>
                  {areaData.map((e, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </aside>

        {/* Mapa central */}
        <div className={`${styles.mapWrap} ${styles.mapStage}`}>
          <div className={styles.glowCenter} />
          <div className={styles.glowLeft}   />
          <div className={styles.glowRight}  />

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.svg}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Mapa de Colombia y países vecinos con la red de ciudades donde la firma tiene presencia"
          >
            <title>Cobertura nacional de la firma en Colombia</title>
            <defs>
              <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0"   />
                <stop offset="45%"  stopColor="#C9A84C" stopOpacity="0.9" />
                <stop offset="55%"  stopColor="#e8c96a" stopOpacity="1"   />
                <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
              </linearGradient>

              <radialGradient id="dotGlow">
                <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
              </radialGradient>

              <radialGradient id="mainGlow">
                <stop offset="0%"   stopColor="#e8c96a" stopOpacity="0.8" />
                <stop offset="40%"  stopColor="#C9A84C" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
              </radialGradient>

              <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="countryGlow" x="-5%" y="-5%" width="110%" height="110%">
                <feGaussianBlur stdDeviation="0.6" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* ── Países (Colombia resaltada, vecinos tenues) ── */}
            {!loading && worldPaths.map(p => (
              <path
                key={p.id}
                d={p.d}
                className={p.isCO ? styles.colombia : styles.country}
                filter="url(#countryGlow)"
              />
            ))}

            {/* ── Líneas base estáticas ── */}
            {!loading && paths.map(c => (
              <path
                key={`base-${c.i}`}
                d={c.path}
                fill="none"
                stroke="rgba(201,168,76,0.10)"
                strokeWidth="0.7"
              />
            ))}

            {/* ── Líneas animadas + partícula ── */}
            {!loading && paths.map(c => (
              <g key={`anim-${c.i}`}>
                <path
                  d={c.path}
                  fill="none"
                  stroke="url(#lineGrad)"
                  strokeWidth="1.2"
                  className={styles.line}
                  style={{ animationDelay: `${c.delay}s` }}
                />
                <circle r="2.2" fill="#e8c96a" opacity="0.9" filter="url(#softGlow)">
                  <animateMotion dur="4.5s" repeatCount="indefinite" begin={`${c.delay}s`} path={c.path} />
                </circle>
                <circle r="1" fill="#ffffff" opacity="0.6">
                  <animateMotion dur="4.5s" repeatCount="indefinite" begin={`${c.delay + 0.05}s`} path={c.path} />
                </circle>
              </g>
            ))}

            {/* ── Puntos de ciudad ── */}
            {!loading && projected.map(p => (
              <g key={`pt-${p.id}`}>
                <circle
                  cx={p.x} cy={p.y}
                  r={p.main ? 20 : 10}
                  fill="url(#dotGlow)"
                  className={styles.pulse}
                  style={{ animationDelay: `${p.id * 0.22}s` }}
                />
                {p.main && (
                  <>
                    <circle cx={p.x} cy={p.y} r="14"
                      fill="none" stroke="rgba(201,168,76,0.3)" strokeWidth="0.8"
                      className={styles.ring} />
                    <circle cx={p.x} cy={p.y} r="9"
                      fill="none" stroke="rgba(201,168,76,0.18)" strokeWidth="0.5" />
                  </>
                )}
                <circle
                  cx={p.x} cy={p.y}
                  r={p.main ? 5 : 2.8}
                  fill={p.main ? '#e8c96a' : '#C9A84C'}
                  filter={p.main ? 'url(#strongGlow)' : 'url(#softGlow)'}
                />
                <circle
                  cx={p.x} cy={p.y}
                  r={p.main ? 2 : 1}
                  fill="#ffffff"
                  opacity={p.main ? 1 : 0.7}
                />
              </g>
            ))}
          </svg>
        </div>

        {/* Columna derecha */}
        <aside className={styles.colRight}>
          <ChartCard title="Profesionales por departamento">
            <ResponsiveContainer width="100%" height={170}>
              <BarChart layout="vertical" data={deptData} margin={{ top: 4, right: 14, left: 4, bottom: 4 }} barCategoryGap="32%">
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category" dataKey="name" width={92}
                  tickFormatter={truncLabel}
                  tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false}
                />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(13,45,94,0.05)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={GOLD} barSize={26} maxBarSize={30} isAnimationActive animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Actividad de la firma" hint="Últimos 12 meses">
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={ACTIVIDAD_ILUSTRATIVA} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="mes" interval={1}
                  tick={{ fontSize: 9, fill: '#4a5568' }} tickLine={false} axisLine={{ stroke: 'rgba(13,45,94,0.15)' }}
                />
                <YAxis
                  width={26} allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false}
                />
                <Tooltip content={<ChartTip />} />
                <Line
                  type="monotone" dataKey="v" stroke={NAVY} strokeWidth={2}
                  dot={{ r: 2.5, fill: GOLD, strokeWidth: 0 }} activeDot={{ r: 4, fill: GOLD }}
                  isAnimationActive animationDuration={1200}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </aside>
      </div>

      {/* Stats + contador en vivo */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.num}>{totalProf}</span>
          <span className={styles.lbl}>Profesionales</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.stat}>
          <span className={styles.num}>{totalDeptos}</span>
          <span className={styles.lbl}>Departamentos</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.stat}>
          <span className={styles.num}>+1000</span>
          <span className={styles.lbl}>Casos atendidos</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.live}>
          <span className={styles.liveDot} />
          <span className={styles.liveNum}>{activos}</span>
          <span className={styles.liveLbl}>Consultas activas</span>
        </div>
      </div>

    </section>
  )
}
