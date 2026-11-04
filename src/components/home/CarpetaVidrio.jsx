import { useEffect, useId, useRef, useState } from 'react'
import styles from './CarpetaVidrio.module.css'

/* ── Carpeta de vidrio ──────────────────────────────────────────────────────
   Una carpeta dibujada como objeto, en tres capas de atrás hacia adelante: el
   panel trasero con un papel marmoleado (como las guardas de un libro de
   derecho), las hojas que guarda y un panel delantero de vidrio esmerilado que
   desenfoca lo que tiene detrás. Las hojas son elementos reales entre los dos
   paneles, así que el vidrio las empaña mientras se mueven.

   · Quieta: plana y cerrada; apenas asoma el borde de las hojas.
   · Al pasar el puntero o con foco: el vidrio se inclina sobre su bisagra de
     abajo y las hojas suben un poco.
   · Clic, Enter o Espacio: avisa a la sección (onAbrir), que abre la carpeta
     en grande con todos sus modelos.
   · Hoja nueva (el admin subió un modelo): cae dentro y la carpeta cede.

   El mármol no es una imagen: es ruido deformado sobre sí mismo y sombreado
   como un líquido, pintado una vez por receta en un canvas a lo largo de
   varios cuadros y compartido entre todas las carpetas que lo usan.
   Adaptado de "Glass Folder Cards" a la paleta café + dorado. */

// ── Papeles marmoleados en la paleta (espresso, café, arena, dorado, crema) ─
export const GUARDAS = [
  // tinta café con vetas de oro
  { style: 'marble', colors: ['#140c09', '#2e1d16', '#472f29', '#6d3c1b', '#1d120d', '#8A6A28', '#C9A84C', '#f1dca8'], scale: 0.66, warp: 3.3, angle: -0.5, gloss: 0.5, veins: 0.55 },
  // arena y oro estirados, como una exposición larga
  { style: 'streak', colors: ['#fffef1', '#f1dfc0', '#e6c194', '#C9A84C', '#6d3c1b', '#472f29', '#e9d3ad', '#fffaf0'], scale: 0.7, warp: 1.5, angle: -0.6, gloss: 0.2, veins: 0 },
  // crema que se pliega en café
  { style: 'marble', colors: ['#f7efe0', '#e6c194', '#b98a4e', '#472f29', '#24160f', '#8a4e26', '#E8C96A', '#fffef1'], scale: 0.74, warp: 3.6, angle: 0.8, gloss: 0.45, veins: 0.4 },
]

function hexToRgb(hex) {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0x808080
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// PRNG pequeño y con semilla (mulberry32).
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Entero estable para un texto: el mármol de una categoría no cambia de visita en visita.
export function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Ruido de gradiente con semilla, sumado en octavas con una rotación entre cada una.
function makeFbm(seed) {
  const r = rng(seed)
  const perm = new Uint8Array(512)
  const grad = new Float32Array(512)
  const p = []
  for (let i = 0; i < 256; i++) p.push(i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2
    grad[i * 2] = Math.cos(a)
    grad[i * 2 + 1] = Math.sin(a)
  }
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const X = xi & 255, Y = yi & 255
    const h00 = perm[X + perm[Y]] * 2
    const h10 = perm[X + 1 + perm[Y]] * 2
    const h01 = perm[X + perm[Y + 1]] * 2
    const h11 = perm[X + 1 + perm[Y + 1]] * 2
    const d00 = grad[h00] * xf + grad[h00 + 1] * yf
    const d10 = grad[h10] * (xf - 1) + grad[h10 + 1] * yf
    const d01 = grad[h01] * xf + grad[h01 + 1] * (yf - 1)
    const d11 = grad[h11] * (xf - 1) + grad[h11 + 1] * (yf - 1)
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    return d00 + u * (d10 - d00) + v * (d01 - d00 + u * (d11 - d01 - d10 + d00))
  }
  return (x, y, octaves) => {
    let sum = 0, amp = 0.5
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x, y)
      const nx = 1.6 * x + 1.2 * y + 7.1
      y = -1.2 * x + 1.6 * y + 3.3
      x = nx
      amp *= 0.5
    }
    return sum
  }
}

/* El mármol como trabajo repartible en varios cuadros. El campo se deforma dos
   veces (cada pliegue alimenta el siguiente), se normaliza por sus propios
   percentiles para que toda semilla recorra la paleta entera y se trata como
   la altura de un líquido: su pendiente da la luz difusa y un brillo
   especular, y unas estrías finas siguen las curvas como tinta peinada.
   "streak" aplasta un eje antes y convierte los mismos pliegues en una
   exposición larga. */
function createArtJob(width, height, recipe, seed) {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const colors = recipe.colors.length >= 2 ? recipe.colors : ['#111111', '#eeeeee']
  const stops = colors.map((c, i) => ({ t: i / (colors.length - 1), c: hexToRgb(c) }))
  const scale = recipe.scale ?? 0.7
  const warp = recipe.warp ?? 3
  const gloss = recipe.gloss ?? 0.4
  const veins = recipe.veins ?? 0
  const streak = recipe.style === 'streak'
  const fbm = makeFbm(seed * 977 + 13)
  const r = rng(seed + 1)
  const ox = r() * 50
  const oy = r() * 50
  const angle = (recipe.angle ?? 0) + (r() - 0.5) * 0.5
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const m = Math.min(w, h)
  // Se muestrea a media resolución (con un margen de una celda) y se sube con
  // Catmull-Rom, que conserva continua la pendiente para la luz: un cuarto
  // del ruido sin pérdida visible.
  const gw = Math.ceil(w / 2) + 3
  const gh = Math.ceil(h / 2) + 3
  const G = new Float32Array(gw * gh)
  const GQ = new Float32Array(gw * gh)
  const F = new Float32Array(w * h)
  const Q = new Float32Array(w * h)
  const pixels = new Uint8ClampedArray(w * h * 4)
  let row = 0

  const field = (gy) => {
    for (let gx = 0; gx < gw; gx++) {
      const u = ((gx - 1) * 2 - w / 2) / m
      const v = ((gy - 1) * 2 - h / 2) / m
      let px = (u * ca - v * sa) * scale
      let py = (u * sa + v * ca) * scale
      if (streak) { px *= 0.14; py *= 2.2 }
      px += ox
      py += oy
      const qx = fbm(px, py, 3)
      const qy = fbm(px + 5.2, py + 1.3, 3)
      const rx = fbm(px + warp * qx + 1.7, py + warp * qy + 9.2, 3)
      const ry = fbm(px + warp * qx + 8.3, py + warp * qy + 2.8, 3)
      G[gy * gw + gx] = fbm(px + warp * rx, py + warp * ry, 4)
      GQ[gy * gw + gx] = Math.sqrt(qx * qx + qy * qy)
    }
  }

  const upsample = () => {
    const cr = (a, b, c, d) => (-a + 9 * b + 9 * c - d) / 16
    const T = new Float32Array(w * gh)
    for (let gy = 0; gy < gh; gy++) {
      const base = gy * gw
      for (let x = 0; x < w; x++) {
        const c = (x >> 1) + 1
        T[gy * w + x] = x & 1 ? cr(G[base + c - 1], G[base + c], G[base + c + 1], G[base + c + 2]) : G[base + c]
      }
    }
    for (let y = 0; y < h; y++) {
      const c = (y >> 1) + 1
      for (let x = 0; x < w; x++) {
        F[y * w + x] = y & 1
          ? cr(T[(c - 1) * w + x], T[c * w + x], T[(c + 1) * w + x], T[(c + 2) * w + x])
          : T[c * w + x]
        const gx = (x >> 1) + 1
        const q0 = GQ[c * gw + gx]
        const qx = x & 1 ? (q0 + GQ[c * gw + gx + 1]) / 2 : q0
        const q1 = y & 1
          ? (x & 1 ? (GQ[(c + 1) * gw + gx] + GQ[(c + 1) * gw + gx + 1]) / 2 : GQ[(c + 1) * gw + gx])
          : qx
        Q[y * w + x] = (qx + q1) / 2
      }
    }
  }

  const colorize = () => {
    // Percentiles de una muestra, no de un orden completo: barato e igual de estable.
    const sample = []
    const stride = Math.max(1, Math.floor(F.length / 4096))
    for (let i = 0; i < F.length; i += stride) sample.push(F[i])
    sample.sort((a, b) => a - b)
    const lo = sample[Math.floor(sample.length * 0.02)]
    const hi = sample[Math.floor(sample.length * 0.98)]
    const k = 1 / (hi - lo || 1)
    const lx = -0.55, ly = -0.65, lz = 0.52
    const slope = k * m * 0.012
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        let t = (F[i] - lo) * k
        t = t < 0 ? 0 : t > 1 ? 1 : t
        let j = 1
        while (j < stops.length - 1 && stops[j].t < t) j++
        const a = stops[j - 1], b = stops[j]
        let f = (t - a.t) / (b.t - a.t || 1)
        f = f < 0 ? 0 : f > 1 ? 1 : f
        f = f * f * (3 - 2 * f)
        const gx = (F[x < w - 1 ? i + 1 : i] - F[x > 0 ? i - 1 : i]) * slope
        const gy = (F[y < h - 1 ? i + w : i] - F[y > 0 ? i - w : i]) * slope
        const nd = (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1)
        const spec = Math.pow(nd > 0 ? nd : 0, 24) * gloss * 255
        const silk = 1 + 0.035 * Math.sin(t * 150 + Q[i] * 24)
        const vein = veins * Math.max(0, 1 - Math.abs(Q[i] - 0.42) * 14) * 0.6
        const lit = (0.82 + 0.28 * nd) * silk * (1 - vein)
        pixels[i * 4]     = (a.c[0] + (b.c[0] - a.c[0]) * f) * lit + spec
        pixels[i * 4 + 1] = (a.c[1] + (b.c[1] - a.c[1]) * f) * lit + spec
        pixels[i * 4 + 2] = (a.c[2] + (b.c[2] - a.c[2]) * f) * lit + spec
        pixels[i * 4 + 3] = 255
      }
    }
  }

  const step = (rows) => {
    if (row >= gh) return true
    const end = Math.min(gh, row + Math.max(1, rows))
    while (row < end) field(row++)
    if (row < gh) return false
    upsample()
    colorize()
    return true
  }

  return { width: w, height: h, pixels, step }
}

// Dónde va una hoja en el abanico: de -1 a 1 a lo ancho, 0 si es una sola.
const fanSlot = (index, count) => (count <= 1 ? 0 : (index / (count - 1)) * 2 - 1)

/* Un solo pintor para toda la página: cada carpeta pone su mármol en la cola
   y la cola gasta unos milisegundos por cuadro, así una fila de carpetas no
   traba el desplazamiento. */
const artCache = new Map()
const queue = []
let pumping = false

function pump() {
  if (pumping) return
  pumping = true
  const tick = () => {
    const until = performance.now() + 7
    while (queue.length && performance.now() < until) {
      const head = queue[0]
      if (head.job.step(4)) {
        queue.shift()
        const c = document.createElement('canvas')
        c.width = head.job.width
        c.height = head.job.height
        c.getContext('2d')?.putImageData(new ImageData(head.job.pixels, c.width, c.height), 0, 0)
        head.done(c)
      }
    }
    if (queue.length) requestAnimationFrame(tick)
    else pumping = false
  }
  requestAnimationFrame(tick)
}

function paint(recipe, seed, w, h) {
  const key = JSON.stringify([recipe, seed, w, h])
  let p = artCache.get(key)
  if (!p) {
    p = new Promise((done) => {
      queue.push({ job: createArtJob(w, h, recipe, seed), done })
      pump()
    })
    artCache.set(key, p)
  }
  return p
}

/* El mármol en su canvas. `cubrir` lo estira para llenar su caja (la franja
   de la carpeta abierta) en vez de medir lo que mide la carpeta: con la misma
   receta, semilla, tamaño y densidad sale de la caché al instante. */
export function Marmol({ receta, semilla, w, h, densidad, cubrir = false, className }) {
  const ref = useRef(null)
  const [listo, setListo] = useState(false)
  const clave = JSON.stringify(receta)
  const pw = Math.round(w * densidad)
  const ph = Math.round(h * densidad)

  useEffect(() => {
    let vivo = true
    setListo(false)
    paint(JSON.parse(clave), semilla, pw, ph).then((src) => {
      const c = ref.current
      if (!vivo || !c) return
      c.width = src.width
      c.height = src.height
      c.getContext('2d')?.drawImage(src, 0, 0)
      setListo(true)
    })
    return () => { vivo = false }
  }, [clave, semilla, pw, ph])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`${styles.art}${cubrir ? ` ${styles.artCubre}` : ''}${className ? ` ${className}` : ''}`}
      data-ready={listo || undefined}
      style={cubrir ? undefined : { width: w, height: h }}
    />
  )
}

/* Geometría en unidades de la carpeta: el escenario se dibuja a 340 × 272 y
   se escala al ancho pedido, así las formas pueden ser trazos fijos. */
const W = 340
const H = 272
const HEADROOM = 54   // aire sobre el panel trasero para que suban las hojas
const FRONT_TOP = 74
const FRONT_H = H - FRONT_TOP

// Tamaño del mármol de una carpeta (con 12 px de margen por lado, por el paralaje).
export const MARMOL_W = W + 24
export const MARMOL_H = H + 24
// Densidad de píxeles del mármol para una carpeta de este ancho.
export const densidadPara = (ancho) =>
  Math.min(1.5, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)) * (ancho / W)

export const BACK_PATH =
  'M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z'
const FRONT_PATH =
  `M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 ${FRONT_H - 22}` +
  `A22 22 0 0 1 318 ${FRONT_H}L22 ${FRONT_H}A22 22 0 0 1 0 ${FRONT_H - 22}Z`

const MAX_HOJAS = 4

/* `archivos` llega del más viejo al más nuevo: el más nuevo queda adelante,
   junto al vidrio. Cada uno es { id, nombre, meta }. Las hojas de la carpeta
   son decoración (asoman, suben con el puntero): los modelos se ven y se
   descargan en la carpeta abierta que dibuja la sección.
   `fantasma`: la copia que el carrusel pone detrás para el bucle; ni el
   teclado ni un lector de pantalla la ven, pero el clic sí la abre (sin eso,
   cuando la cinta pasa a la copia, las carpetas dejarían de abrirse). */
export default function CarpetaVidrio({
  titulo,
  meta,
  receta = GUARDAS[0],
  semilla = 3,
  archivos = [],
  onAbrir,
  onAgregar,
  ancho = 320,
  retrasoEntrada = 0,
  fantasma = false,
}) {
  const uid = useId().replace(/:/g, '')
  const rootRef = useRef(null)
  const [entrada, setEntrada] = useState(false)
  const [caida, setCaida] = useState(null)   // id de la hoja que acaba de entrar
  const [golpe, setGolpe] = useState(0)
  const conocidos = useRef(new Set(archivos.map(a => a.id)))

  const k = ancho / W
  const densidad = densidadPara(ancho)

  // Entrada: se arma sola la primera vez que aparece en pantalla. Umbral
  // bajo: en el carrusel la carpeta que entra por el borde se arma apenas
  // asoma, no cuando ya va por la mitad.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setEntrada(true); return }
    let t = 0
    const io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      t = window.setTimeout(() => setEntrada(true), retrasoEntrada)
    }, { threshold: 0.12 })
    io.observe(el)
    return () => { io.disconnect(); window.clearTimeout(t) }
  }, [retrasoEntrada])

  // Luz y paralaje siguen al puntero, sin volver a renderizar.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let raf = 0, px = 0, py = 0
    const write = () => {
      raf = 0
      el.style.setProperty('--gf-px', px.toFixed(3))
      el.style.setProperty('--gf-py', py.toFixed(3))
    }
    const move = (e) => {
      if (e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      px = ((e.clientX - r.left) / r.width) * 2 - 1
      py = ((e.clientY - r.top) / r.height) * 2 - 1
      if (!raf) raf = requestAnimationFrame(write)
    }
    const leave = () => { px = 0; py = 0; if (!raf) raf = requestAnimationFrame(write) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Un modelo nuevo cae dentro de la carpeta y el vidrio cede bajo su peso.
  const firmaIds = archivos.map(a => a.id).join('|')
  useEffect(() => {
    const nuevo = archivos.find(a => !conocidos.current.has(a.id))
    archivos.forEach(a => conocidos.current.add(a.id))
    if (nuevo) { setCaida(nuevo.id); setGolpe(g => g + 1) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaIds])

  const visibles = archivos.slice(-MAX_HOJAS)

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-entered={entrada || undefined}
      data-key={onAgregar ? '' : undefined}
      aria-hidden={fantasma || undefined}
      style={{ width: ancho, height: (H + HEADROOM) * k }}
    >
      <div className={styles.stage} style={{ transform: `translateY(${HEADROOM * k}px) scale(${k})` }}>
        <div className={styles.tilt}>
          <div className={styles.shadow} aria-hidden="true" />

          {/* Panel trasero y su papel marmoleado */}
          <div className={styles.back} style={{ clipPath: `path('${BACK_PATH}')` }} aria-hidden="true">
            <Marmol receta={receta} semilla={semilla} w={MARMOL_W} h={MARMOL_H} densidad={densidad} />
            <div className={styles.backSheen} />
          </div>
          <svg className={`${styles.rim} ${styles.backRim}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <path d={BACK_PATH} />
          </svg>

          {/* Vidrio delantero, con bisagra en su borde de abajo */}
          <div
            key={golpe}
            className={`${styles.front}${golpe ? ` ${styles.frontBump}` : ''}`}
            style={{ clipPath: `path('${FRONT_PATH}')` }}
          >
            <div className={styles.tint} aria-hidden="true" />
            <div className={styles.spec} aria-hidden="true" />
            <svg className={`${styles.rim} ${styles.frontRim}`} viewBox={`0 0 ${W} ${FRONT_H}`} aria-hidden="true">
              <defs>
                <linearGradient id={`gf-rim-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#E8C96A" stopOpacity="0.95" />
                  <stop offset="0.35" stopColor="#C9A84C" stopOpacity="0.45" />
                  <stop offset="1" stopColor="#C9A84C" stopOpacity="0.18" />
                </linearGradient>
              </defs>
              <path d={FRONT_PATH} stroke={`url(#gf-rim-${uid})`} />
            </svg>
            <button
              type="button"
              className={styles.hit}
              aria-haspopup="dialog"
              aria-label={`Abrir la carpeta ${titulo}, ${meta}`}
              tabIndex={fantasma ? -1 : undefined}
              onClick={(e) => onAbrir?.(e.currentTarget)}
            />
            <div className={styles.label}>
              <span className={styles.title}>{titulo}</span>
              <span className={styles.meta} key={meta}>{meta}</span>
            </div>
            {/* La seña de que se abre: parte del vidrio, no un botón aparte. */}
            <span className={styles.abrir} aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M8 16L16 8M9.5 8H16v6.5" /></svg>
            </span>
          </div>

          {/* Las hojas: asoman por encima del bolsillo, detrás del vidrio */}
          <div className={styles.files} aria-hidden="true">
            {visibles.map((a, v) => {
              const jitter = rng(hashString(String(a.id)))
              return (
                <span
                  key={a.id}
                  className={`${styles.sheet}${a.id === caida ? ` ${styles.sheetDrop}` : ''}`}
                  style={{
                    '--gf-slot': fanSlot(v, visibles.length),
                    '--gf-depth': visibles.length - 1 - v,
                    '--gf-jx': `${((jitter() - 0.5) * 10).toFixed(2)}px`,
                    '--gf-jr': `${((jitter() - 0.5) * 3.2).toFixed(2)}deg`,
                    zIndex: v + 1,
                  }}
                  onAnimationEnd={a.id === caida ? () => setCaida(null) : undefined}
                >
                  <span className={styles.sheetHead}>
                    <span className={styles.sheetName}>{a.nombre}</span>
                    {a.meta && <span className={styles.sheetMeta}>{a.meta}</span>}
                  </span>
                  <span className={styles.sheetRule} />
                  <span className={styles.lines}>
                    <i style={{ width: '88%' }} />
                    <i style={{ width: '94%' }} />
                    <i style={{ width: '66%' }} />
                    <i style={{ width: '90%' }} />
                    <i style={{ width: '44%' }} />
                  </span>
                </span>
              )
            })}
          </div>

          {onAgregar && (
            <button
              type="button"
              className={styles.key}
              aria-label={`Agregar un modelo a ${titulo}`}
              tabIndex={fantasma ? -1 : undefined}
              onClick={onAgregar}
            >
              <svg key={golpe} className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.5v15M4.5 12h15" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
