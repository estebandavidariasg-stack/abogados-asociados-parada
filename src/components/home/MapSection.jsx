import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis,
  AreaChart, Area,
  CartesianGrid,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import styles from './MapSection.module.css'

const W = 960, H = 470

// Hubs globales en [lng, lat] — presencia/alcance de la firma
const CITIES = [
  { id: 0,  name: 'Bogotá',           coords: [-74.07,   4.71], main: true },
  { id: 1,  name: 'Ciudad de México', coords: [-99.13,  19.43] },
  { id: 2,  name: 'Miami',            coords: [-80.19,  25.76] },
  { id: 3,  name: 'Nueva York',       coords: [-74.00,  40.71] },
  { id: 4,  name: 'Madrid',           coords: [ -3.70,  40.41] },
  { id: 5,  name: 'Lima',             coords: [-77.04, -12.04] },
  { id: 6,  name: 'Santiago',         coords: [-70.65, -33.45] },
  { id: 7,  name: 'Buenos Aires',     coords: [-58.38, -34.60] },
  { id: 8,  name: 'São Paulo',        coords: [-46.63, -23.55] },
  { id: 9,  name: 'Panamá',           coords: [-79.53,   8.98] },
  { id: 10, name: 'Londres',          coords: [ -0.12,  51.50] },
  { id: 11, name: 'Toronto',          coords: [-79.38,  43.65] },
]

// Arcos desde Bogotá (hub principal) + algunos cruces
const CONNECTIONS = [
  { from: 0, to: 1,  delay: 0.4 },
  { from: 0, to: 2,  delay: 1.2 },
  { from: 0, to: 4,  delay: 0.0 },
  { from: 0, to: 5,  delay: 1.8 },
  { from: 0, to: 7,  delay: 0.8 },
  { from: 0, to: 9,  delay: 2.4 },
  { from: 0, to: 10, delay: 1.5 },
  { from: 2, to: 3,  delay: 2.0 },
  { from: 4, to: 10, delay: 2.8 },
  { from: 5, to: 6,  delay: 1.0 },
  { from: 7, to: 8,  delay: 2.2 },
  { from: 2, to: 11, delay: 3.0 },
]

function curvePath(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const curve = dist * 0.18
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const nx = -dy / dist, ny = dx / dist
  return `M ${x1} ${y1} Q ${mx + nx * curve} ${my + ny * curve} ${x2} ${y2}`
}

// Datos ilustrativos (reemplazados por datos reales cuando hay profesionales)
const PH_ROLES   = [{ name: 'Abogados', value: 8 }, { name: 'Contadores', value: 4 }]
const PH_AREAS   = [
  { name: 'Civil', value: 7 }, { name: 'Penal', value: 5 }, { name: 'Laboral', value: 4 },
  { name: 'Familia', value: 3 }, { name: 'Comercial', value: 3 }, { name: 'Tributario', value: 2 },
]
const PH_DEPTOS  = [
  { name: 'Cundinamarca', value: 9 }, { name: 'Antioquia', value: 6 }, { name: 'Valle', value: 5 },
  { name: 'Atlántico', value: 4 }, { name: 'Santander', value: 3 },
]
const ACTIVIDAD  = [
  { mes: 'Ene', v: 34 }, { mes: 'Feb', v: 41 }, { mes: 'Mar', v: 48 }, { mes: 'Abr', v: 45 },
  { mes: 'May', v: 58 }, { mes: 'Jun', v: 67 }, { mes: 'Jul', v: 72 }, { mes: 'Ago', v: 81 },
  { mes: 'Sep', v: 88 }, { mes: 'Oct', v: 102 }, { mes: 'Nov', v: 114 }, { mes: 'Dic', v: 131 },
]

const NAVY = '#0d2d5e'
const GOLD = '#c9a84c'
const barColor = (i) => i === 0 ? GOLD : `rgba(13,45,94,${Math.max(0.45, 0.82 - i * 0.09)})`

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const isGenericKey = ['value', 'v'].includes(p.name)
  const title = isGenericKey
    ? (p.payload?.name ?? (label != null && label !== '' ? label : null))
    : p.name
  return (
    <div className={styles.tip}>
      {title != null && <span className={styles.tipLabel}>{title}</span>}
      <span className={styles.tipVal}><strong>{p.value}</strong></span>
    </div>
  )
}

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
  const [landPath,    setLandPath]    = useState(null)   // todo el territorio (merge de países)
  const [bordersPath, setBordersPath] = useState(null)   // fronteras internas tenues
  const [projected,   setProjected]   = useState([])
  const [paths,       setPaths]       = useState([])
  const [loading,     setLoading]     = useState(true)

  const [roleData,    setRoleData]    = useState(PH_ROLES)
  const [areaData,    setAreaData]    = useState(PH_AREAS)
  const [deptData,    setDeptData]    = useState(PH_DEPTOS)
  const [totalProf,   setTotalProf]   = useState(12)
  const [totalDeptos, setTotalDeptos] = useState(8)
  const [activos,     setActivos]     = useState(0)

  // Cargar mapa mundial (world-atlas) y proyectar hubs
  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const world = await fetch(
          'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
        ).then(r => r.json())
        if (cancel) return

        const land    = topojson.merge(world, world.objects.countries.geometries)
        const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b)

        const projection = d3.geoNaturalEarth1()
        projection.fitExtent([[12, 12], [W - 12, H - 12]], { type: 'Sphere' })
        const pathGen = d3.geoPath().projection(projection)

        setLandPath(pathGen(land))
        setBordersPath(pathGen(borders))

        const pts = CITIES.map(c => {
          const [x, y] = projection(c.coords) || [0, 0]
          return { ...c, x, y }
        })
        setProjected(pts)
        setPaths(CONNECTIONS.map((c, i) => {
          const a = pts[c.from], b = pts[c.to]
          return { ...c, i, path: curvePath(a.x, a.y, b.x, b.y) }
        }))
      } catch { /* sin mapa → la sección sigue mostrando gráficas */ }
      finally { if (!cancel) setLoading(false) }
    }
    load()
    return () => { cancel = true }
  }, [])

  // Métricas reales
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
        if (todos.length) {
          setRoleData([
            { name: 'Abogados',   value: abogados.length },
            { name: 'Contadores', value: contadores.length },
          ])
          setTotalProf(todos.length)
        }
        const areaCount = {}
        todos.forEach(p => {
          (p.area_derecho || '').split(',').map(s => s.trim()).filter(Boolean)
            .forEach(a => { areaCount[a] = (areaCount[a] || 0) + 1 })
        })
        const areaReal = Object.entries(areaCount)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value).slice(0, 6)
        if (areaReal.length) setAreaData(areaReal)

        const deptCount = {}
        todos.forEach(p => {
          const d = (p.departamento || '').trim()
          if (d) deptCount[d] = (deptCount[d] || 0) + 1
        })
        const deptReal = Object.entries(deptCount)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value).slice(0, 5)
        if (deptReal.length) { setDeptData(deptReal); setTotalDeptos(Object.keys(deptCount).length) }
      } catch { /* placeholders */ }
    })()
    return () => { cancel = true }
  }, [])

  // Contador en vivo (ilustrativo)
  useEffect(() => {
    const target = 24
    let n = 0
    const up = setInterval(() => { n += 2; setActivos(Math.min(n, target)); if (n >= target) clearInterval(up) }, 45)
    const fluct = setInterval(() => { setActivos(t => Math.max(18, Math.min(31, t + (Math.random() > 0.5 ? 1 : -1)))) }, 3500)
    return () => { clearInterval(up); clearInterval(fluct) }
  }, [])

  // Reveal
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
        <h2 className={styles.title}>Cobertura <em>Global</em></h2>
        <p className={styles.subtitle}>Presencia jurídica y contable a nivel global</p>
      </div>

      <div className={styles.dashboard}>

        {/* ── Mapa mundial (banda principal) ── */}
        <div className={styles.mapHero}>
          <div className={styles.glowCenter} />
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.svg}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Mapa mundial con los hubs donde la firma tiene presencia"
          >
            <title>Cobertura global de la firma</title>
            <defs>
              <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0"   />
                <stop offset="45%"  stopColor="#C9A84C" stopOpacity="0.9" />
                <stop offset="55%"  stopColor="#e8c96a" stopOpacity="1"   />
                <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
              </linearGradient>
              <radialGradient id="dotGlow">
                <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"    />
              </radialGradient>
              <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="mapGlow" x="-4%" y="-4%" width="108%" height="108%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Fill base del territorio mundial */}
            {!loading && landPath && (
              <path d={landPath} className={styles.land} filter="url(#mapGlow)" />
            )}

            {/* Fronteras internas entre países */}
            {!loading && bordersPath && (
              <path d={bordersPath} className={styles.countryBorder} />
            )}

            {/* Contorno dorado difuminado — encima de todo, sin filtro nítido */}
            {!loading && landPath && (
              <path d={landPath} className={styles.worldOutline} />
            )}

            {/* Líneas base estáticas */}
            {!loading && paths.map(c => (
              <path key={`base-${c.i}`} d={c.path} fill="none" stroke="rgba(201,168,76,0.12)" strokeWidth="0.8" />
            ))}

            {/* Arcos animados + partícula */}
            {!loading && paths.map(c => (
              <g key={`anim-${c.i}`}>
                <path
                  d={c.path} fill="none" stroke="url(#lineGrad)" strokeWidth="1.4"
                  className={styles.line} style={{ animationDelay: `${c.delay}s` }}
                />
                <circle r="2.5" fill="#e8c96a" opacity="0.92" filter="url(#softGlow)">
                  <animateMotion dur="4.5s" repeatCount="indefinite" begin={`${c.delay}s`} path={c.path} />
                </circle>
                <circle r="1.1" fill="#ffffff" opacity="0.65">
                  <animateMotion dur="4.5s" repeatCount="indefinite" begin={`${c.delay + 0.05}s`} path={c.path} />
                </circle>
              </g>
            ))}

            {/* Puntos de hub */}
            {!loading && projected.map(p => (
              <g key={`pt-${p.id}`}>
                <circle cx={p.x} cy={p.y} r={p.main ? 20 : 11}
                  fill="url(#dotGlow)" className={styles.pulse}
                  style={{ animationDelay: `${p.id * 0.22}s` }} />
                {p.main && (
                  <>
                    <circle cx={p.x} cy={p.y} r="13" fill="none" stroke="rgba(201,168,76,0.32)" strokeWidth="0.9" className={styles.ring} />
                    <circle cx={p.x} cy={p.y} r="8" fill="none" stroke="rgba(201,168,76,0.18)" strokeWidth="0.5" />
                  </>
                )}
                <circle cx={p.x} cy={p.y} r={p.main ? 5 : 3}
                  fill={p.main ? '#e8c96a' : '#C9A84C'}
                  filter={p.main ? 'url(#strongGlow)' : 'url(#softGlow)'} />
                <circle cx={p.x} cy={p.y} r={p.main ? 2 : 1.1} fill="#ffffff" opacity={p.main ? 1 : 0.7} />
              </g>
            ))}
          </svg>
        </div>

        {/* ── Gráficas a los lados (superpuestas al mapa) ── */}
        <aside className={styles.colLeft}>

          {/* Donut: Abogados vs Contadores */}
          <ChartCard title="Abogados vs Contadores">
            <div className={styles.donutWrap}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={roleData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={52} outerRadius={82}
                    paddingAngle={4} stroke="none"
                    isAnimationActive animationDuration={900}
                  >
                    {roleData.map((e, i) => (
                      <Cell key={i} fill={i === 0 ? NAVY : GOLD} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className={styles.donutCenter} aria-hidden="true">
                <span className={styles.donutNum}>{totalProf}</span>
                <span className={styles.donutSub}>Total</span>
              </div>
            </div>
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

          {/* Barras: Profesionales por área */}
          <ChartCard title="Profesionales por área">
            <ResponsiveContainer width="100%" height={232}>
              <BarChart data={areaData} margin={{ top: 22, right: 8, left: 8, bottom: 8 }} barCategoryGap="38%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,45,94,0.07)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickFormatter={n => { const s = String(n).replace(/^Derecho\s+/i, ''); return s.length > 12 ? s.slice(0, 11) + '…' : s }}
                  interval={0} angle={-28} textAnchor="end" height={60}
                  tick={{ fontSize: 10, fill: '#7a8fad' }} tickLine={false} axisLine={false}
                />
                <YAxis hide width={0} allowDecimals={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(13,45,94,0.04)' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={900} maxBarSize={40}>
                  {areaData.map((e, i) => (
                    <Cell key={i} fill={barColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </aside>

        <aside className={styles.colRight}>
          {/* Barras horizontales: Profesionales por departamento */}
          <ChartCard title="Profesionales por departamento">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                layout="vertical" data={deptData}
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                barCategoryGap="30%"
              >
                <defs>
                  <linearGradient id="hBarGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor={GOLD} stopOpacity={0.65} />
                    <stop offset="100%" stopColor={GOLD} stopOpacity={1}    />
                  </linearGradient>
                </defs>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category" dataKey="name" width={100}
                  tick={{ fontSize: 11, fill: '#4a5568' }} tickLine={false} axisLine={false}
                />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(13,45,94,0.04)' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="url(#hBarGrad)" barSize={24} maxBarSize={28}
                  isAnimationActive animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Área: Actividad de la firma */}
          <ChartCard title="Actividad de la firma" hint="Últimos 12 meses">
            <ResponsiveContainer width="100%" height={232}>
              <AreaChart data={ACTIVIDAD} margin={{ top: 16, right: 10, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={GOLD} stopOpacity={0.22} />
                    <stop offset="55%" stopColor={NAVY} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={NAVY} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,45,94,0.07)" vertical={false} />
                <XAxis
                  dataKey="mes" interval={1}
                  tick={{ fontSize: 10, fill: '#7a8fad' }} tickLine={false} axisLine={false}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Area
                  type="monotone" dataKey="v"
                  stroke={NAVY} strokeWidth={3}
                  fill="url(#actGrad)"
                  dot={{ r: 3, fill: GOLD, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: GOLD, stroke: '#fff', strokeWidth: 1.5 }}
                  isAnimationActive animationDuration={1200}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </aside>
      </div>

      {/* Stats */}
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
          <span className={styles.liveNum}>{activos}</span>
          <span className={styles.liveLbl}>Consultas activas</span>
        </div>
      </div>

    </section>
  )
}
