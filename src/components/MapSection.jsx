import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import styles from './MapSection.module.css'

const W = 1000, H = 500

// ── Ciudades en [lng, lat] ────────────────────────────────────────────────
const CITIES = [
  { id: 0,  name: 'Bogotá',        coords: [-74.1,   4.7],  main: true  },
  { id: 1,  name: 'Medellín',      coords: [-75.6,   6.2],  main: false },
  { id: 2,  name: 'Cali',          coords: [-76.5,   3.4],  main: false },
  { id: 3,  name: 'Barranquilla',  coords: [-74.8,  11.0],  main: false },
  { id: 4,  name: 'Miami',         coords: [-80.2,  25.8],  main: false },
  { id: 5,  name: 'New York',      coords: [-74.0,  40.7],  main: false },
  { id: 6,  name: 'Ciudad México', coords: [-99.1,  19.4],  main: false },
  { id: 7,  name: 'Madrid',        coords: [ -3.7,  40.4],  main: false },
  { id: 8,  name: 'Lima',          coords: [-77.0, -12.0],  main: false },
  { id: 9,  name: 'Buenos Aires',  coords: [-58.4, -34.6],  main: false },
  { id: 10, name: 'São Paulo',     coords: [-46.6, -23.5],  main: false },
  { id: 11, name: 'Londres',       coords: [ -0.1,  51.5],  main: false },
  { id: 12, name: 'Lagos',         coords: [  3.4,   6.5],  main: false },
  { id: 13, name: 'Tokio',         coords: [139.7,  35.7],  main: false },
  { id: 14, name: 'Sídney',        coords: [151.2, -33.9],  main: false },
  { id: 15, name: 'París',         coords: [  2.3,  48.9],  main: false },
  { id: 16, name: 'Dubai',         coords: [ 55.3,  25.2],  main: false },
  { id: 17, name: 'Toronto',       coords: [-79.4,  43.7],  main: false },
]

const CONNECTIONS = [
  { from: 0, to: 4,  delay: 0   },
  { from: 0, to: 5,  delay: 1.5 },
  { from: 0, to: 7,  delay: 3.0 },
  { from: 0, to: 6,  delay: 0.8 },
  { from: 0, to: 8,  delay: 2.0 },
  { from: 0, to: 9,  delay: 4.0 },
  { from: 0, to: 10, delay: 2.5 },
  { from: 4, to: 7,  delay: 1.2 },
  { from: 5, to: 11, delay: 3.5 },
  { from: 7, to: 15, delay: 0.5 },
  { from: 7, to: 12, delay: 4.2 },
  { from: 11, to: 13, delay: 2.8 },
  { from: 13, to: 14, delay: 1.0 },
  { from: 16, to: 13, delay: 3.2 },
  { from: 0, to: 17, delay: 1.8 },
  { from: 5, to: 17, delay: 0.4 },
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

export default function MapSection() {
  const sectionRef = useRef(null)
  const [worldPaths, setWorldPaths] = useState([])
  const [projected,  setProjected]  = useState([])
  const [paths,      setPaths]      = useState([])
  const [loading,    setLoading]    = useState(true)

  // ── Proyección Natural Earth ──────────────────────────────────────────────
  const projection = useMemo(() =>
    d3.geoNaturalEarth1().scale(158).translate([W / 2, H / 2 + 25])
  , [])

  const pathGen = useMemo(() => d3.geoPath().projection(projection), [projection])

  // ── Cargar TopoJSON ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(world => {
        const countries = topojson.feature(world, world.objects.countries)
        const dPaths = countries.features.map(f => ({
          id: f.id,
          d: pathGen(f),
        })).filter(p => p.d)
        setWorldPaths(dPaths)

        // Proyectar ciudades
        const pts = CITIES.map(c => {
          const [x, y] = projection(c.coords) || [0, 0]
          return { ...c, x, y }
        })
        setProjected(pts)

        // Calcular paths de conexiones
        const cPaths = CONNECTIONS.map((c, i) => {
          const a = pts[c.from], b = pts[c.to]
          return { ...c, i, path: curvePath(a.x, a.y, b.x, b.y) }
        })
        setPaths(cPaths)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [pathGen, projection])

  // ── IntersectionObserver ──────────────────────────────────────────────────
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
        <h2 className={styles.title}>PRESENCIA <em>GLOBAL</em></h2>
        <p className={styles.subtitle}>Asesoría legal colombiana con conexiones internacionales</p>
      </div>

      <div className={styles.mapWrap}>

        {/* Glow ambiental */}
        <div className={styles.glowCenter} />
        <div className={styles.glowLeft}   />
        <div className={styles.glowRight}  />

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Gradiente para líneas de conexión */}
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0"    />
              <stop offset="45%"  stopColor="#C9A84C" stopOpacity="0.9"  />
              <stop offset="55%"  stopColor="#e8c96a" stopOpacity="1"    />
              <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"    />
            </linearGradient>

            {/* Fondo del mapa — degradado azul navy */}
            <linearGradient id="mapBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#06122e" />
              <stop offset="40%"  stopColor="#0a1e4a" />
              <stop offset="100%" stopColor="#071535" />
            </linearGradient>

            {/* Brillo central sobre el fondo */}
            <radialGradient id="mapGlow" cx="30%" cy="50%" r="55%">
              <stop offset="0%"   stopColor="#142d6e" stopOpacity="1" />
              <stop offset="100%" stopColor="#06122e" stopOpacity="1" />
            </radialGradient>

            {/* Glow de puntos */}
            <radialGradient id="dotGlow">
              <stop offset="0%"   stopColor="#C9A84C" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
            </radialGradient>

            {/* Glow principal (Bogotá) */}
            <radialGradient id="mainGlow">
              <stop offset="0%"   stopColor="#e8c96a" stopOpacity="0.8" />
              <stop offset="40%"  stopColor="#C9A84C" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#C9A84C" stopOpacity="0"   />
            </radialGradient>

            {/* Filtros blur */}
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

          {/* ── Países ── */}
          {!loading && worldPaths.map(p => (
            <path
              key={p.id}
              d={p.d}
              className={styles.country}
              filter="url(#countryGlow)"
            />
          ))}

          {/* ── Líneas base estáticas ── */}
          {!loading && paths.map(c => (
            <path
              key={`base-${c.i}`}
              d={c.path}
              fill="none"
              stroke="rgba(201,168,76,0.08)"
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

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.num}>18+</span>
          <span className={styles.lbl}>Ciudades</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.stat}>
          <span className={styles.num}>2</span>
          <span className={styles.lbl}>Continente</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.stat}>
          <span className={styles.num}>+1000</span>
          <span className={styles.lbl}>Casos nacionales</span>
        </div>
      </div>

    </section>
  )
}