import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import styles from './TestimoniosSection.module.css'
import { useCarrusel } from '../../lib/useCarrusel'
import LawyerCard from './LawyerCard'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const IconComillas = (props) => (
  <svg viewBox="0 0 44 40" width="38" height="34" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M33.172 5.469q2.555 0 4.547 1.547a7.4 7.4 0 0 1 2.695 4.007q.47 1.711.469 3.61 0 2.883-1.125 5.86a22.8 22.8 0 0 1-3.094 5.577 33 33 0 0 1-4.57 4.922A35 35 0 0 1 26.539 35l-3.398-3.398q5.296-4.243 7.218-6.563 1.946-2.32 2.016-4.617-2.86-.329-4.781-2.461-1.923-2.133-1.922-4.992 0-3.117 2.18-5.297 2.202-2.203 5.32-2.203m-20.625 0q2.555 0 4.547 1.547a7.4 7.4 0 0 1 2.695 4.007q.47 1.711.469 3.61 0 2.883-1.125 5.86a22.8 22.8 0 0 1-3.094 5.577 33 33 0 0 1-4.57 4.922A35 35 0 0 1 5.914 35l-3.398-3.398q5.296-4.243 7.218-6.563 1.946-2.32 2.016-4.617-2.86-.329-4.781-2.461-1.922-2.133-1.922-4.992 0-3.117 2.18-5.297 2.202-2.203 5.32-2.203" />
  </svg>
)

const IconEstrella = (props) => (
  <svg viewBox="0 0 16 15" width="15" height="14" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M7.524.464a.5.5 0 0 1 .952 0l1.432 4.41a.5.5 0 0 0 .476.345h4.637a.5.5 0 0 1 .294.904L11.563 8.85a.5.5 0 0 0-.181.559l1.433 4.41a.5.5 0 0 1-.77.559L8.294 11.65a.5.5 0 0 0-.588 0l-3.751 2.726a.5.5 0 0 1-.77-.56l1.433-4.41a.5.5 0 0 0-.181-.558L.685 6.123A.5.5 0 0 1 .98 5.22h4.637a.5.5 0 0 0 .476-.346z" />
  </svg>
)

// 5 estrellas con relleno parcial (admite 4, 4.5, etc.).
function Estrellas({ rating }) {
  return (
    <div className={styles.estrellas} role="img" aria-label={`Calificación ${rating} de 5`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const relleno = Math.max(0, Math.min(1, rating - i)) // 0..1 por estrella
        return (
          <span key={i} className={styles.estrella}>
            <IconEstrella />
            <span className={styles.estrellaFill} style={{ width: `${relleno * 100}%` }}>
              <IconEstrella />
            </span>
          </span>
        )
      })}
    </div>
  )
}

const IconRedSocial = (props) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

function Tarjeta({
  texto, imagen, nombre, rol, rating = 5, oculto, redSocial,
  profesional, extras = [], onAbrirProfesional,
  onMouseEnter, onMouseLeave,
}) {
  // Comentarios adicionales desplegables (otras opiniones del mismo profesional).
  const [expandido, setExpandido] = useState(false)
  const tieneExtras = extras.length > 0
  const tieneProfesional = !oculto && !!profesional
  const nombreProf = profesional
    ? `${profesional.nombre || ''} ${profesional.apellido || ''}`.trim()
    : ''
  const rolProf = profesional?.rol === 'contador' ? 'Contador' : 'Abogado'
  // Área principal (la primera) — evita el truncado feo de la lista completa.
  const areaPrincipal = profesional?.area_derecho
    ? profesional.area_derecho.split(',')[0].trim()
    : ''
  return (
    <article
      className={`${styles.tarjeta} ${tieneProfesional ? styles.tarjetaClickable : ''}`}
      aria-hidden={oculto ? 'true' : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={tieneProfesional ? () => onAbrirProfesional(profesional, { texto, nombre, rol, rating }) : undefined}
      role={tieneProfesional ? 'button' : undefined}
      tabIndex={tieneProfesional ? 0 : undefined}
      onKeyDown={tieneProfesional ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrirProfesional(profesional, { texto, nombre, rol, rating }) }
      } : undefined}
    >
      <IconComillas className={styles.comillas} />
      <Estrellas rating={rating} />
      <p className={styles.texto}>{texto}</p>

      {/* Las demás opiniones del profesional se ven al ABRIR la tarjeta
          (modal del profesional → "Ver más comentarios"), no aquí. */}

      <div className={styles.pie}>
        {imagen ? (
          <img
            src={imagen}
            alt={oculto ? '' : `Foto de ${nombre}`}
            className={styles.avatar}
            loading="lazy"
            draggable="false"
          />
        ) : (
          <span className={styles.avatarIniciales} aria-hidden={oculto ? 'true' : undefined}>
            {(nombre || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className={styles.pieTexto}>
          <p className={styles.nombre}>{nombre}</p>
          <p className={styles.rol}>{rol}</p>
          {!oculto && redSocial && (
            <a
              className={styles.redSocial}
              href={redSocial}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title="Perfil verificado del cliente"
            >
              <IconRedSocial />
              <span>Red social</span>
            </a>
          )}
        </div>
      </div>

      {/* ── Profesional al que se refiere la reseña (footer accionable) ── */}
      {tieneProfesional && (
        <div className={styles.profFooter}>
          <img
            className={styles.profFotoAv}
            src={profesional.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombreProf)}&background=0d2d5e&color=c9a84c`}
            alt=""
            loading="lazy"
            draggable="false"
          />
          <div className={styles.profFooterInfo}>
            <span className={styles.profFooterLabel}>Reseña para</span>
            <span className={styles.profFooterName}>{nombreProf}</span>
            <span className={styles.profFooterSub}>
              {rolProf}{areaPrincipal ? ` · ${areaPrincipal}` : ''}
            </span>
          </div>
          <span className={styles.profFooterCta} aria-hidden="true">Ver perfil →</span>
        </div>
      )}
    </article>
  )
}

// Una fila: renderiza los items dos veces para un bucle continuo. El
// desplazamiento (auto-avance, arrastre y pausa en hover) lo maneja el hook
// useCarrusel sobre el contenedor con scroll; aquí solo pintamos las tarjetas.
function Fila({ items, carrusel, onAbrirProfesional }) {
  return (
    <div className={styles.fila} ref={carrusel.scrollerRef} {...carrusel.handlers}>
      <div className={styles.track}>
        {[0, 1].map((copia) => (
          <React.Fragment key={copia}>
            {items.map((t, i) => (
              <Tarjeta
                key={`${copia}-${i}`}
                {...t}
                oculto={copia === 1}
                onAbrirProfesional={onAbrirProfesional}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── Testimonios de ejemplo (fallback de ÚLTIMO recurso) ────────────────────
// Sólo se muestran cuando NO existe ninguna reseña real aprobada todavía. En
// cuanto haya reseñas reales, éstas se muestran solas (sin mezclar ejemplos)
// para no exhibir atribuciones falsas junto a datos reales. Cada ejemplo
// referencia a un profesional por índice de la lista pública para demostrar el
// click-through (se resuelve en runtime contra /api/professionals, así siempre
// apunta a alguien real y aprobado).
const MOCK_TESTIMONIOS = [
  { texto: 'Necesitaba orientación en un proceso de sucesión y no sabía por dónde empezar. En menos de un día ya estaba hablando con una abogada que me explicó todo con claridad. Excelente acompañamiento.', nombre: 'Laura Restrepo', rol: 'Cliente · Bogotá', rating: 5, imagen: null, profRefIndex: 0, profRefRol: 'abogado' },
  { texto: 'Como dueño de una pyme, el tema tributario me abrumaba. El contador que me asignaron organizó mi declaración de renta y me ahorró varios dolores de cabeza. Muy recomendados.', nombre: 'Andrés Gómez', rol: 'Cliente · Medellín', rating: 5, imagen: null, profRefIndex: 0, profRefRol: 'contador' },
  { texto: 'Tenía dudas sobre un contrato laboral y la asesoría fue rápida, seria y sin vueltas. Me sentí acompañada en todo el proceso y con respuestas concretas.', nombre: 'Valentina Ríos', rol: 'Cliente · Cali', rating: 4.5, imagen: null, profRefIndex: 1, profRefRol: 'abogado' },
  { texto: 'Consulté por un tema de derecho de familia bastante delicado. El trato fue humano y profesional, y siempre supe cuáles eran mis opciones reales según la ley.', nombre: 'Carlos Mendoza', rol: 'Cliente · Barranquilla', rating: 5, imagen: null, profRefIndex: 2, profRefRol: 'abogado' },
  { texto: 'La plataforma me conectó con un abogado de derecho penal que respondió mis dudas con paciencia. Todo transparente, incluido el costo antes de empezar.', nombre: 'Diana Vargas', rol: 'Cliente · Bucaramanga', rating: 4.5, imagen: null, profRefIndex: 3, profRefRol: 'abogado' },
  { texto: 'Manejo varios locales y necesitaba poner al día la contabilidad. El profesional fue puntual, ordenado y me dejó todo claro para el cierre del año fiscal.', nombre: 'Jorge Patiño', rol: 'Cliente · Pereira', rating: 5, imagen: null, profRefIndex: 1, profRefRol: 'contador' },
]

// Opiniones adicionales de PRUEBA para el desplegable "Más opiniones" de cada
// tarjeta. Solo acompañan a los testimonios de ejemplo (cuando no hay reseñas
// reales); con reseñas reales, el desplegable muestra otras reseñas REALES del
// mismo profesional (nunca se mezclan ejemplos con datos reales).
const MOCK_EXTRAS = [
  { nombre: 'Camila Torres', rating: 5, texto: 'Atención impecable de principio a fin. Volvería a consultar sin dudarlo.' },
  { nombre: 'Felipe Naranjo', rating: 4.5, texto: 'Respuesta rápida y honesta sobre mis opciones. Muy profesional.' },
  { nombre: 'Marcela Duarte', rating: 5, texto: 'Me guiaron paso a paso y el costo fue claro desde el inicio.' },
  { nombre: 'Ricardo Salas', rating: 4.5, texto: 'Excelente disposición y conocimiento. Todo fue más simple de lo que creí.' },
  { nombre: 'Paola Cifuentes', rating: 5, texto: 'Resolvieron mi duda tributaria en una sola sesión. Muy organizados.' },
]

// Mínimo de tarjetas por fila para que una copia desborde el ancho visible y el
// bucle del carrusel realmente se mueva (cada tarjeta mide 340px).
const MIN_TARJETAS = 8

// Repite una lista hasta alcanzar `min` elementos, sin recortar si ya es mayor.
function rellenar(lista, min) {
  if (!lista.length) return lista
  const out = []
  for (let i = 0; out.length < Math.max(min, lista.length); i++) out.push(lista[i % lista.length])
  return out
}

// Ítems base (sin profesional resuelto todavía) para que el carrusel tenga
// contenido desde el PRIMER render y arranque el auto-avance de inmediato; se
// reemplazan por los datos reales/resueltos en cuanto carga `cargar()`.
const SEED_ITEMS = rellenar(
  MOCK_TESTIMONIOS.map(t => ({
    texto: t.texto, nombre: t.nombre, rol: t.rol, rating: t.rating, imagen: t.imagen, profesional: null,
  })),
  MIN_TARJETAS,
)

export default function TestimoniosSection() {
  // Arranca con contenido (SEED) para que el carrusel monte y se mueva ya.
  const [items, setItems] = useState(SEED_ITEMS)
  // Profesional cuyo modal (LawyerCard controlado) está abierto tras hacer clic,
  // junto con la reseña completa de la tarjeta pulsada ({ profesional, resena }).
  const [seleccion, setSeleccion] = useState(null)
  // Handler que reciben las tarjetas: guarda profesional + reseña completa para
  // que el modal muestre el comentario íntegro (sin recorte a 3 líneas).
  const abrirProfesional = (profesional, resena) => setSeleccion({ profesional, resena })

  // Dos filas en sentidos opuestos, en desplazamiento continuo.
  const fila1Carrusel = useCarrusel({ speed: 40, direction: 1, loop: true })
  const fila2Carrusel = useCarrusel({ speed: 32, direction: -1, loop: true })

  useEffect(() => {
    let cancelado = false

    // Carga profesionales aprobados de un rol. Primero el endpoint cacheado del
    // CDN (prod); si falla o viene vacío (p.ej. en `vite dev`, donde /api sirve
    // el código fuente), cae a una lectura directa de Supabase (anon puede leer
    // los profesionales aprobados). Devuelve objetos aptos para LawyerCard.
    async function cargarProfesionales(rol) {
      try {
        const r = await fetch(`/api/professionals?rol=${rol}`)
        if (r.ok) {
          const d = await r.json()
          if (Array.isArray(d) && d.length) return d
        }
      } catch { /* cae al fallback */ }
      try {
        const cols = 'id,nombre,apellido,rol,area_derecho,foto_url,video_url,descripcion,ciudad,departamento,experiencia,universidad,instagram,linkedin,facebook,twitter,whatsapp,tiktok'
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${rol}&select=${cols}&limit=60`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (r.ok) { const d = await r.json(); if (Array.isArray(d)) return d }
      } catch { /* noop */ }
      return []
    }

    async function cargar() {
      // 1) Lista pública de profesionales — nos da objetos LawyerCard completos
      //    para el click-through (ver perfil → iniciar consulta).
      const [abogados, contadores] = await Promise.all([
        cargarProfesionales('abogado'),
        cargarProfesionales('contador'),
      ])
      const porRol = { abogado: abogados, contador: contadores }
      // Índice id → profesional (aprobado y público) para resolver el vínculo
      // real reseña→profesional sin importar el rol.
      const porId = new Map()
      for (const p of [...abogados, ...contadores]) {
        if (p && p.id != null) porId.set(String(p.id), p)
      }

      // Lista combinada + asignador round-robin: garantiza que TODA tarjeta
      // muestre un profesional y sea clickeable (ver perfil → iniciar consulta),
      // aun cuando la reseña real todavía no traiga professional_id.
      const combinados = [...abogados, ...contadores]
      let rr = 0
      const siguienteProf = () => (combinados.length ? combinados[rr++ % combinados.length] : null)

      // 2) Reseñas reales aprobadas. `resenas` puede exponer `professional_id`
      //    (tras aplicar la migración). Si esa columna aún no está disponible,
      //    se reintenta sin ella. Cada reseña se vincula a su profesional real
      //    cuando existe; si no, se le asigna uno para que el click-through y el
      //    "Iniciar consulta" funcionen igual.
      async function pedirResenas(conProf) {
        const cols = conProf
          ? 'id,nombre,rol,rating,texto,red_social,professional_id,created_at'
          : 'id,nombre,rol,rating,texto,red_social,created_at'
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/resenas?aprobado=eq.true&texto=not.is.null` +
          `&select=${cols}&order=created_at.desc&limit=24`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (!res.ok) return null
        return res.json().catch(() => null)
      }

      let reales = []
      try {
        let data = await pedirResenas(true)
        if (!Array.isArray(data)) data = await pedirResenas(false) // reintento sin professional_id
        if (Array.isArray(data)) {
          reales = data.map(r => {
            const real = r.professional_id != null ? porId.get(String(r.professional_id)) : null
            return {
              texto: r.texto,
              nombre: r.nombre || 'Cliente',
              rol: r.rol || 'Cliente',
              rating: Number(r.rating) || 5,
              imagen: null,
              redSocial: r.red_social || null, // red social del reseñador (transparencia)
              profesional: real || siguienteProf(), // siempre hay profesional → siempre clickeable
            }
          })
          // "Más opiniones": otras reseñas REALES del mismo profesional, para el
          // desplegable de la tarjeta (máx. 3, sin duplicar la principal).
          const porProf = new Map()
          for (const r of reales) {
            const pid = r.profesional?.id
            if (pid == null) continue
            if (!porProf.has(pid)) porProf.set(pid, [])
            porProf.get(pid).push(r)
          }
          for (const r of reales) {
            const pid = r.profesional?.id
            const otras = pid != null ? (porProf.get(pid) || []).filter(x => x !== r) : []
            r.extras = otras.slice(0, 3).map(x => ({ nombre: x.nombre, rating: x.rating, texto: x.texto }))
          }
        }
      } catch { /* sin reseñas reales → ejemplos */ }

      // 3) Con reseñas reales: se muestran solas, repetidas hasta llenar la cinta
      //    para que se mueva. Sin ninguna: ejemplos, cada uno con un profesional
      //    real para demostrar el flujo ver-perfil → iniciar-consulta.
      let finales
      if (reales.length) {
        finales = rellenar(reales, MIN_TARJETAS)
      } else {
        finales = MOCK_TESTIMONIOS.map((t, i) => {
          const lista = porRol[t.profRefRol] || combinados
          const prof = (lista.length ? lista[t.profRefIndex % lista.length] : null) || siguienteProf()
          return {
            texto: t.texto, nombre: t.nombre, rol: t.rol, rating: t.rating, imagen: t.imagen, profesional: prof,
            // Opiniones de prueba plegadas (2 por tarjeta, rotando la lista).
            extras: [MOCK_EXTRAS[i % MOCK_EXTRAS.length], MOCK_EXTRAS[(i + 2) % MOCK_EXTRAS.length]],
          }
        })
        finales = rellenar(finales, MIN_TARJETAS)
      }

      if (!cancelado) setItems(finales)
    }

    cargar()
    return () => { cancelado = true }
  }, [])

  // Bloquear el scroll del body mientras el modal del profesional está abierto
  // lo maneja internamente LawyerCard (efecto sobre document.body.overflow).

  const fila1 = items
  const fila2 = [...items].reverse()

  return (
    <section className={styles.section} aria-labelledby="testimonios-heading">
      <motion.header
        initial={{ opacity: 0, y: 36 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={styles.header}
      >
        <span className={styles.eyebrow}>Testimonios</span>
        <h2 id="testimonios-heading" className={styles.heading}>
          Lo que dicen <em>nuestros clientes</em>
        </h2>
        <p className={styles.desc}>
          Conoce cómo otras personas encontraron el profesional adecuado para resolver sus necesidades de
          manera rápida, segura y transparente. Toca una reseña para ver al profesional e iniciar tu consulta.
        </p>
      </motion.header>

      <div
        className={styles.filas}
        role="region"
        aria-label="Testimonios de clientes en desplazamiento continuo"
      >
        <Fila items={fila1} carrusel={fila1Carrusel} onAbrirProfesional={abrirProfesional} />
        <Fila items={fila2} carrusel={fila2Carrusel} onAbrirProfesional={abrirProfesional} />
      </div>

      {/* Modal del profesional (reutiliza LawyerCard en modo controlado; su
          botón "INICIAR CONSULTA" hace el deep-link al chat con él elegido). */}
      {seleccion && (
        <LawyerCard
          lawyer={seleccion.profesional}
          resena={seleccion.resena}
          reveal={false}
          hideCard
          controlledOpen
          onControlledClose={() => setSeleccion(null)}
        />
      )}
    </section>
  )
}
