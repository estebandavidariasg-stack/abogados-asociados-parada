import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, VIEWPORT } from '../../lib/motionVariants'
import LawyerCard, { mesRanking, ordenarPorRanking } from './LawyerCard'
import FirmaCard from './FirmaCard'
import styles from './LawyersSection.module.css'
import { useAuth } from '../../context/AuthContext'
import { getAuthHeaders } from '../../lib/supabase'
import { useCarrusel } from '../../lib/useCarrusel'
import { esDeptoBogota, etiquetaCiudad } from '../../lib/validaciones'

/* Flechas de navegación centradas bajo la cinta de profesionales. Nudgean la
   cinta ~un ancho visible; el auto-desplazamiento continúa por su cuenta. */
function CintaFlechas({ onPrev, onNext, varios }) {
  return (
    <div className={styles.cintaNav}>
      <button type="button" className={styles.cintaArrow} onClick={onPrev} aria-label={`Ver ${varios} anteriores`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className={styles.cintaArrow} onClick={onNext} aria-label={`Ver más ${varios}`}>
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

/* Los tres carruseles del inicio, uno debajo del otro. Cada uno tiene su
   propio ranking del mes y sus propios filtros (nombre y ubicación). El
   podio alterna de lado (derecha, izquierda, derecha) para que las tres
   franjas no se lean como la misma repetida. */
const CARRILES = [
  { rol: 'abogado',  titulo: 'Abogados',   uno: 'abogado',  varios: 'abogados',   ninguno: 'Ningún abogado',  buscar: 'Buscar abogado por nombre', podio: 'derecha' },
  { rol: 'contador', titulo: 'Contadores', uno: 'contador', varios: 'contadores', ninguno: 'Ningún contador', buscar: 'Buscar contador por nombre', podio: 'izquierda' },
  { rol: 'firma',    titulo: 'Firmas',     uno: 'firma',    varios: 'firmas',     ninguno: 'Ninguna firma',   buscar: 'Buscar firma o miembro de su equipo', femenino: true, podio: 'derecha' },
]

const CARGANDO = { estado: 'cargando', lista: [] }

// Para buscar sin que importen tildes ni mayúsculas ("Gonzalez" = "González").
const plano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// En una firma se busca también por su gente: quien llega buscando al
// Director por su nombre encuentra la firma que lo tiene.
function textoDeBusqueda(p, esFirma) {
  const partes = [p.nombre, p.apellido]
  if (esFirma) for (const m of [p.director, ...(p.miembros || [])]) if (m) partes.push(m.nombre, m.apellido)
  return plano(partes.filter(Boolean).join(' '))
}

const porNombre = (a, b) => a.localeCompare(b, 'es')

/* Público: endpoint cacheado en el CDN de Vercel (api/professionals.js), que
   evita pegar a Supabase en cada carga del home. Superadmin: directo a
   Supabase (mismo truco que VideoCarousel con fetchVideos(true)), para que
   vea al profesional que acaba de aprobar sin esperar la caché. Las firmas
   llegan siempre armadas del endpoint (firma + Director + equipo): no hay
   lectura directa equivalente. */
async function leerLista(rol, isSuperAdmin) {
  const esFirmas = rol === 'firma'
  const res = isSuperAdmin && !esFirmas
    ? await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${rol}&select=${PUBLIC_COLS}`,
        { headers: await getAuthHeaders() }
      )
    : await fetch(`/api/professionals?rol=${rol}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${detail}`)
  }
  const json = await res.json()
  let lista = Array.isArray(json) ? json : []
  // La lectura directa del superadmin no trae las cifras que agrega el
  // endpoint (consultas exitosas del mes y totales, calificación, firma de
  // cada quien): se toman de ahí para que vea el mismo ranking que el
  // visitante. Si falla, sus tarjetas van sin cifra y sin puesto.
  if (isSuperAdmin && !esFirmas && lista.length) {
    try {
      const pub = await fetch(`/api/professionals?rol=${rol}`).then(r => (r.ok ? r.json() : []))
      const meta = new Map((Array.isArray(pub) ? pub : []).map(p => [p.id, p]))
      lista = lista.map(p => {
        const m = meta.get(p.id)
        return m ? {
          ...p,
          consultas_exitosas: m.consultas_exitosas, consultas_mes: m.consultas_mes,
          rating_promedio: m.rating_promedio, rating_total: m.rating_total, firma: m.firma,
        } : p
      })
    } catch { /* sin cifras */ }
  }
  // Quien pertenece a una firma sale dentro de la tarjeta de su firma,
  // no como tarjeta suelta (la consulta sí lo sigue ofreciendo).
  return esFirmas ? lista : lista.filter(p => !p.firma)
}

export default function LawyersSection() {
  const sectionRef = useRef(null)
  const [shouldFetch, setShouldFetch] = useState(false)
  const [datos, setDatos] = useState({ abogado: CARGANDO, contador: CARGANDO, firma: CARGANDO })
  const { profile } = useAuth()
  // Vista de administración del listado: superadmin o admin, sin distinción.
  const isSuperAdmin = profile?.rol === 'superadmin' || profile?.rol === 'admin'
  // Cada carril descarta la respuesta de un pedido que ya no es el último
  // (reintento, cambio de sesión) en vez de pisar la lista nueva con la vieja.
  const pedidos = useRef({})

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

  const cargar = useCallback(async (rol) => {
    const id = (pedidos.current[rol] || 0) + 1
    pedidos.current[rol] = id
    const poner = (v) => { if (pedidos.current[rol] === id) setDatos(d => ({ ...d, [rol]: v })) }
    if (!SUPABASE_URL || !SUPABASE_KEY) { poner({ estado: 'listo', lista: [] }); return }
    poner(CARGANDO)
    try {
      poner({ estado: 'listo', lista: await leerLista(rol, isSuperAdmin) })
    } catch (err) {
      console.error(`[LawyersSection] ${rol}:`, err)
      poner({ estado: 'error', lista: [] })
    }
  }, [isSuperAdmin])

  // Los tres a la vez, en paralelo: cada carril se pinta cuando llega el suyo.
  useEffect(() => {
    if (!shouldFetch) return
    for (const c of CARRILES) cargar(c.rol)
    const vivos = pedidos.current
    return () => { for (const c of CARRILES) vivos[c.rol] = (vivos[c.rol] || 0) + 1 }
  }, [shouldFetch, cargar])

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

      <div className={styles.carriles}>
        {CARRILES.map(c => (
          <Carril
            key={c.rol}
            conf={c}
            datos={datos[c.rol]}
            isSuperAdmin={isSuperAdmin}
            onReintentar={() => cargar(c.rol)}
          />
        ))}
      </div>
    </section>
  )
}

/* ── Un carril: título, podio del mes y directorio (filtros + cinta) ─────── */
function Carril({ conf, datos, isSuperAdmin, onReintentar }) {
  const { rol, titulo, varios, ninguno } = conf
  const esFirmas = rol === 'firma'
  const [nombre, setNombre] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [municipio, setMunicipio] = useState('')
  const [elegido, setElegido] = useState(null)   // abierto desde el podio
  const mes = mesRanking()

  // El puesto se calcula sobre TODOS los del carril: filtrar por Antioquia no
  // convierte en "1.º" a quien va cuarto en el país. El podio tampoco se
  // filtra: es el ranking nacional del mes.
  const ranking = useMemo(() => ordenarPorRanking(datos.lista), [datos.lista])
  const podio = ranking.filter(p => p.puesto).slice(0, 3)

  const departamentos = useMemo(
    () => [...new Set(ranking.map(p => p.departamento).filter(Boolean))].sort(porNombre),
    [ranking])
  const municipios = useMemo(
    () => [...new Set(ranking.map(p => p.ciudad).filter(Boolean))].sort(porNombre),
    [ranking])
  // Opciones del tercer filtro. En Bogotá D.C. son LOCALIDADES; sin
  // departamento elegido van en su propio grupo para que "Engativá" no se
  // lea como un municipio más al lado de "Medellín".
  const delDepto = departamento
    ? municipios.filter(c => ranking.some(p => p.departamento === departamento && p.ciudad === c))
    : []
  const localidadesBogota = departamento ? [] : municipios.filter(c =>
    ranking.some(p => p.ciudad === c && etiquetaCiudad(p.departamento, c) === 'Localidad'))
  const fueraDeBogota = departamento ? [] : municipios.filter(c => !localidadesBogota.includes(c))
  const esLocalidad = esDeptoBogota(departamento)

  const palabras = plano(nombre).split(/\s+/).filter(Boolean)
  const filtrada = ranking.filter(p => {
    if (palabras.length) {
      const texto = textoDeBusqueda(p, esFirmas)
      if (!palabras.every(w => texto.includes(w))) return false
    }
    if (departamento && p.departamento !== departamento) return false
    if (municipio && p.ciudad !== municipio) return false
    return true
  })
  const hayFiltros = palabras.length > 0 || !!departamento || !!municipio
  const limpiar = () => { setNombre(''); setDepartamento(''); setMunicipio('') }

  const listo = datos.estado === 'listo'
  const total = datos.lista.length
  const sinControles = !listo || total === 0
  const n = filtrada.length
  const encontrados = `${n} ${n === 1 ? conf.uno : varios} ${conf.femenino
    ? (n === 1 ? 'encontrada' : 'encontradas')
    : (n === 1 ? 'encontrado' : 'encontrados')}`

  let cuerpo
  if (datos.estado === 'cargando') {
    cuerpo = <CintaEsqueleto />
  } else if (datos.estado === 'error') {
    cuerpo = (
      <div className={styles.vacio}>
        <p>No pudimos cargar {esFirmas ? 'las firmas' : `los ${varios}`}.</p>
        <button type="button" className={styles.vacioBtn} onClick={onReintentar}>Reintentar</button>
      </div>
    )
  } else if (total === 0) {
    cuerpo = (
      <div className={styles.vacio}>
        <p>Pronto verás aquí {esFirmas ? 'las primeras firmas' : `a los primeros ${varios}`} de la red.</p>
      </div>
    )
  } else if (n === 0) {
    cuerpo = (
      <div className={styles.vacio}>
        <p>{ninguno} coincide con esa búsqueda.</p>
        <button type="button" className={styles.vacioBtn} onClick={limpiar}>Limpiar Filtros</button>
      </div>
    )
  } else {
    cuerpo = (
      <ProfesionalesCinta
        items={filtrada}
        isSuperAdmin={isSuperAdmin}
        calm={hayFiltros}
        firmas={esFirmas}
        varios={varios}
        reinicio={`${palabras.join(' ')}|${departamento}|${municipio}`}
      />
    )
  }

  return (
    <motion.section
      className={styles.carril}
      aria-labelledby={`carril-${rol}`}
      aria-busy={datos.estado === 'cargando' || undefined}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
    >
      <h3 id={`carril-${rol}`} className={styles.carrilTitulo}>{titulo}</h3>

      <div className={`${styles.carrilCuerpo}${conf.podio === 'derecha' ? ` ${styles.podioDerecha}` : ''}`}>
        <PodioMes
          items={podio}
          mes={mes}
          titulo={titulo}
          esFirmas={esFirmas}
          cargando={datos.estado === 'cargando'}
          onAbrir={setElegido}
        />

        <div className={styles.directorio}>
      <div className={styles.filtros} role="search" aria-label={`Filtrar ${varios}`}>
        <label className={styles.buscar}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          <input
            type="search"
            className={styles.buscarInput}
            placeholder={conf.buscar}
            aria-label={`Buscar ${varios} por nombre`}
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            disabled={sinControles}
            autoComplete="off"
            enterKeyHint="search"
          />
        </label>
        <div className={styles.selectWrap}>
          <select
            className={styles.filterSelect}
            aria-label="Departamento"
            value={departamento}
            onChange={e => { setDepartamento(e.target.value); setMunicipio('') }}
            disabled={sinControles}
          >
            <option value="">Departamento</option>
            {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className={styles.selectWrap}>
          <select
            className={styles.filterSelect}
            aria-label={esLocalidad ? 'Localidad' : 'Municipio o localidad'}
            value={municipio}
            onChange={e => setMunicipio(e.target.value)}
            disabled={sinControles}
          >
            <option value="">{esLocalidad ? 'Localidad' : 'Municipio'}</option>
            {departamento
              ? delDepto.map(c => <option key={c} value={c}>{c}</option>)
              : <>
                  {fueraDeBogota.map(c => <option key={c} value={c}>{c}</option>)}
                  {localidadesBogota.length > 0 && (
                    <optgroup label="Bogotá D.C. · localidades">
                      {localidadesBogota.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  )}
                </>}
          </select>
        </div>
      </div>

      <p className={styles.filtroResumen} aria-live="polite">
        {/* Con cero resultados lo dice el recuadro de abajo, con su botón. */}
        {hayFiltros && listo && n > 0 && (
          <>
            {encontrados}
            <button type="button" className={styles.filtroLimpiar} onClick={limpiar}>Limpiar Filtros</button>
          </>
        )}
      </p>

      {cuerpo}
        </div>
      </div>

      {elegido && (esFirmas ? (
        <FirmaCard firma={elegido} reveal={false} hideCard controlledOpen onControlledClose={() => setElegido(null)} />
      ) : (
        <LawyerCard lawyer={elegido} isSuperAdmin={isSuperAdmin} reveal={false} hideCard controlledOpen onControlledClose={() => setElegido(null)} />
      ))}
    </motion.section>
  )
}

/* ── Podio del mes ─────────────────────────────────────────────────────────
   Los tres primeros del ranking del mes de este carril, en podio: 2.º · 1.º ·
   3.º, con corona para el primero y medallas de plata y bronce. En el DOM van
   en orden (1, 2, 3, como los lee un lector de pantalla) y el CSS los
   acomoda. Un puesto sin nadie todavía queda como pedestal libre: el podio
   conserva su forma aunque el mes recién empiece. */
const SLOT = ['first', 'second', 'third']

function CrownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 8.5l3.4 3L12 5l5.6 6.5 3.4-3L19 18.5H5L3 8.5zM5 20.5h14v1.2H5z" />
    </svg>
  )
}

const nombreDe    = (p) => `${p.nombre || ''} ${p.apellido || ''}`.trim()
const inicialesDe = (p, firma) => (firma
  ? (p.nombre || 'F').charAt(0)
  : (p.nombre?.[0] || '?') + (p.apellido?.[0] || '')).toUpperCase()
const areaDe      = (p) => (p.area_derecho || '').split(',')[0]?.trim() ||
  (p.rol === 'firma' ? 'Firma' : p.rol === 'contador' ? 'Contador' : 'Abogado')

const EASE_PODIO = [0.16, 1, 0.3, 1]
// El pedestal crece cuando su COLUMNA entra en pantalla (hereda el estado por
// variants). Con su propio whileInView no siempre arrancaba: en scaleY(0) no
// tiene alto y el observador no lo daba por visto.
const columnaVar = {
  oculta: { opacity: 0, y: 26 },
  vista: (d) => ({ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_PODIO, delay: d } }),
}
const pedestalVar = {
  oculta: { scaleY: 0 },
  vista: (d) => ({ scaleY: 1, transition: { duration: 0.7, ease: EASE_PODIO, delay: d + 0.08 } }),
}

function PodioMes({ items, mes, titulo, esFirmas, cargando, onAbrir }) {
  const reduce = useReducedMotion()
  const retraso = (i) => [0.1, 0.22, 0.34][i]
  const nota = cargando || items.length
    ? 'Por consultas exitosas del mes'
    : `Aún sin consultas exitosas en ${mes.actual}`

  return (
    <aside className={styles.podio} aria-label={`Ranking de ${mes.actual} · ${titulo}`}>
      <div className={styles.podioHead}>
        <span className={styles.podioTitulo}>Ranking de {mes.actual}</span>
        <span className={styles.podioNota}>{nota}</span>
      </div>

      <ol className={styles.podium}>
        {SLOT.map((slot, i) => {
          const p = items[i]
          if (!p) {
            return (
              <li key={slot} className={`${styles.columna} ${styles[slot]} ${styles.libre}`}>
                <span className={styles.colBtn}>
                  <span className={styles.badge} />
                  <span className={`${styles.avatarWrap} ${esFirmas ? styles.avatarFirma : ''}`}>
                    <span className={styles.avatarLibre} />
                  </span>
                  <span className={styles.name}>{cargando ? '\u00a0' : 'Por definir'}</span>
                  <span className={styles.block} />
                </span>
              </li>
            )
          }
          const nombre = esFirmas ? p.nombre : nombreDe(p)
          const una = Number(p.consultas_mes) === 1
          return (
            <li key={p.id} className={`${styles.columna} ${styles[slot]}`}>
              <motion.button
                type="button"
                className={styles.colBtn}
                onClick={() => onAbrir(p)}
                aria-label={`Puesto ${p.puesto}, ${nombre}, ${p.consultas_mes} ${una ? 'consulta exitosa' : 'consultas exitosas'} en ${mes.actual}. Ver perfil`}
                variants={columnaVar}
                custom={retraso(i)}
                initial={reduce ? 'vista' : 'oculta'}
                whileInView="vista"
                viewport={{ once: true, amount: 0.3 }}
              >
                <span className={styles.badge} aria-hidden="true">
                  {p.puesto === 1
                    ? <CrownIcon className={styles.badgeIcon} />
                    : <span className={styles.badgeMedal}>{p.puesto}</span>}
                </span>
                <span className={`${styles.avatarWrap} ${esFirmas ? styles.avatarFirma : ''}`}>
                  {p.foto_url
                    ? <img src={p.foto_url} alt="" className={styles.avatar} loading="lazy" decoding="async" />
                    : <span className={styles.avatarInitials}>{inicialesDe(p, esFirmas)}</span>}
                </span>
                <span className={styles.name} title={nombre}>{nombre}</span>
                <span className={styles.area}>{areaDe(p)}</span>
                <span className={styles.scoreNum}>{Number(p.consultas_mes).toLocaleString('es-CO')}</span>
                <span className={styles.count}>{una ? 'consulta' : 'consultas'} en {mes.actual}</span>
                <motion.span
                  className={styles.block}
                  variants={pedestalVar}
                  custom={retraso(i)}
                  aria-hidden="true"
                />
              </motion.button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

/* Mientras llega la lista: la forma de las tarjetas, no un texto suelto, para
   que la página no salte cuando aparecen. */
function CintaEsqueleto() {
  return (
    <div className={styles.esqueleto} aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={styles.esqueletoCard}>
          <span className={styles.esqCirculo} />
          <span className={styles.esqLinea} />
          <span className={styles.esqLineaCorta} />
        </div>
      ))}
    </div>
  )
}

/* ── Cinta de profesionales ────────────────────────────────────────────────
   Una sola fila de tarjetas de perfil (accionables) con tres formas de navegar:
   auto-desplazamiento continuo, arrastre con el dedo/mouse (como un scroll), y
   flechas centradas debajo. Va en el orden del ranking del mes: al entrar en
   pantalla se queda quieta un momento (se lee quién va primero) y después
   avanza sola. El auto-avance se PAUSA al enfocar con teclado o arrastrar.
   Con filtros activos, con movimiento reducido o si todas las tarjetas caben,
   no hay bucle: la fila queda quieta (centrada si cabe entera) y el arrastre
   y las flechas siguen desplazándola. */
function ProfesionalesCinta({ items, isSuperAdmin, calm, firmas = false, varios, reinicio }) {
  const reduce = useReducedMotion()
  const wrapRef = useRef(null)
  const [anchoVisible, setAnchoVisible] = useState(0)

  // Que haga falta desplazarse no depende del número de tarjetas sino de si
  // DESBORDAN el ancho disponible: 3 caben en escritorio y no en un teléfono.
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
  const { scrollerRef, step, handlers } = useCarrusel({ speed: 34, loop, espera: 2400 })
  const copias = loop ? [0, 1] : [0]
  // Si caben todas, la fila se centra y no finge desplazarse (sin desvanecido
  // en los bordes, que tapaba media primera tarjeta, ni flechas que no mueven
  // nada).
  const quieta = anchoVisible > 0 && !desborda

  // Al cambiar los filtros la fila vuelve al principio: el primero que se ve
  // es el mejor puesto entre los que coinciden.
  useEffect(() => {
    const el = scrollerRef.current
    if (el) { el.scrollLeft = 0; el.dataset.inicio = 'true' }
  }, [reinicio, scrollerRef])

  // Marca si la fila está en su comienzo (el CSS quita el desvanecido
  // izquierdo). Solo escribe al cruzar el umbral, no en cada cuadro.
  const alDesplazar = (e) => {
    const el = e.currentTarget
    const inicio = String(el.scrollLeft < 8)
    if (el.dataset.inicio !== inicio) el.dataset.inicio = inicio
  }

  return (
    <div className={styles.cintaWrap} ref={wrapRef}>
      <div
        className={`${styles.cinta} ${quieta ? styles.cintaQuieta : ''}`}
        ref={scrollerRef}
        data-inicio="true"
        onScroll={alDesplazar}
        {...handlers}
      >
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

      {!quieta && <CintaFlechas onPrev={() => step(-1)} onNext={() => step(1)} varios={varios} />}
    </div>
  )
}
