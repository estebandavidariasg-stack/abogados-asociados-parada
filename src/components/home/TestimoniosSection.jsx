import React, { useRef, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import styles from './TestimoniosSection.module.css'

const testimonios = [
  {
    texto:
      'Contraté sus servicios para un proceso laboral y quedé muy satisfecho. Me explicaron cada paso con claridad y logramos un resultado muy favorable.',
    imagen:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Andrés Morales',
    rol: 'Cliente — Derecho Laboral',
  },
  {
    texto:
      'Me asesoraron en mi proceso de custodia con mucha profesionalidad y calidez humana. En un momento tan difícil, sentí el respaldo de un equipo comprometido.',
    imagen:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Carolina Ospina',
    rol: 'Clienta — Derecho de Familia',
  },
  {
    texto:
      'Los contadores hicieron mi declaración de renta sin ningún contratiempo y me explicaron cómo optimizar mis impuestos de manera legal. Excelente servicio.',
    imagen:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Felipe Restrepo',
    rol: 'Empresario — Asesoría Contable',
  },
  {
    texto:
      'Me ayudaron a constituir mi empresa SAS en menos de una semana. El proceso fue transparente, rápido y sin ninguna complicación. Muy agradecida.',
    imagen:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Daniela Vargas',
    rol: 'Emprendedora — Derecho Corporativo',
  },
  {
    texto:
      'Tuve un problema con mi arrendador y el abogado me orientó perfectamente desde la primera consulta. Resolvimos el conflicto sin llegar a juicio.',
    imagen:
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Juan Pablo Herrera',
    rol: 'Cliente — Derecho Civil',
  },
  {
    texto:
      'Su plataforma es muy fácil de usar. Pude consultar con un abogado desde Medellín sin desplazarme. La atención fue rápida y el consejo, muy claro.',
    imagen:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Natalia Gómez',
    rol: 'Clienta — Consulta en Línea',
  },
  {
    texto:
      'Me apoyaron en un proceso penal complicado. Sentí en todo momento el respaldo de un equipo preparado y genuinamente comprometido con mi caso.',
    imagen:
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Diego Martínez',
    rol: 'Cliente — Derecho Penal',
  },
  {
    texto:
      'La asesoría contable fue impecable. Cumplieron todos los plazos tributarios y estuvieron disponibles para resolver mis dudas en cualquier momento.',
    imagen:
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Valentina Ríos',
    rol: 'Empresaria — Asesoría Tributaria',
  },
  {
    texto:
      'Resolvieron un conflicto laboral que llevaba meses sin solución, en pocas semanas y con resultados excelentes. Profesionales de primera calidad.',
    imagen:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150&h=150',
    nombre: 'Camilo Suárez',
    rol: 'Cliente — Derecho Laboral',
  },
]

// Calificaciones variadas (no todas 5); admite medias estrellas.
const RATINGS = [5, 4.5, 5, 4, 4.5, 5, 4, 4.5, 5]
const testimoniosRated = testimonios.map((t, i) => ({ ...t, rating: RATINGS[i] ?? 5 }))

const fila1 = testimoniosRated
const fila2 = [...testimoniosRated].reverse()

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

function Tarjeta({ texto, imagen, nombre, rol, rating = 5, oculto, onMouseEnter, onMouseLeave }) {
  return (
    <article
      className={styles.tarjeta}
      aria-hidden={oculto ? 'true' : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <IconComillas className={styles.comillas} />
      <Estrellas rating={rating} />
      <p className={styles.texto}>{texto}</p>
      <div className={styles.pie}>
        <img
          src={imagen}
          alt={oculto ? '' : `Foto de ${nombre}`}
          className={styles.avatar}
          loading="lazy"
          draggable="false"
        />
        <div>
          <p className={styles.nombre}>{nombre}</p>
          <p className={styles.rol}>{rol}</p>
        </div>
      </div>
    </article>
  )
}

// Una fila marquee: renderiza los items dos veces para un bucle continuo.
// La velocidad baja al pasar el mouse (regla .fila:hover .track en el CSS).
// Desplazamiento continuo manejado con requestAnimationFrame: al pasar el
// cursor baja la VELOCIDAD (no se detiene). Cambiar la velocidad aquí no
// produce saltos, a diferencia de animar la duración en CSS.
function Fila({ items, reverse, velocidad = 40 }) {
  const trackRef = useRef(null)
  const lento = useRef(false)
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    if (prefersReduced) return
    const el = trackRef.current
    if (!el) return

    const mitad = el.scrollWidth / 2 // ancho de una copia (hay dos)
    let offset = reverse ? -mitad : 0
    let raf
    let last = null

    const tick = (t) => {
      if (last == null) last = t
      const dt = Math.min((t - last) / 1000, 0.05) // limita saltos al volver de pestaña oculta
      last = t
      const v = velocidad * (lento.current ? 0.18 : 1)
      offset += (reverse ? v : -v) * dt
      if (!reverse && offset <= -mitad) offset += mitad
      if (reverse && offset >= 0) offset -= mitad
      el.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reverse, velocidad, prefersReduced])

  const frenar = () => { lento.current = true }
  const acelerar = () => { lento.current = false }

  return (
    <div className={styles.fila}>
      <div className={styles.track} ref={trackRef}>
        {[0, 1].map((copia) => (
          <React.Fragment key={copia}>
            {items.map((t, i) => (
              <Tarjeta
                key={`${copia}-${i}`}
                {...t}
                oculto={copia === 1}
                onMouseEnter={frenar}
                onMouseLeave={acelerar}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export default function TestimoniosSection() {
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
          Personas de todo Colombia han confiado en nosotros para resolver sus asuntos jurídicos y
          contables con respaldo profesional. Pasa el cursor sobre una tarjeta para leerla con calma.
        </p>
      </motion.header>

      <div
        className={styles.filas}
        role="region"
        aria-label="Testimonios de clientes en desplazamiento continuo"
      >
        <Fila items={fila1} velocidad={42} />
        <Fila items={fila2} reverse velocidad={34} />
      </div>
    </section>
  )
}
