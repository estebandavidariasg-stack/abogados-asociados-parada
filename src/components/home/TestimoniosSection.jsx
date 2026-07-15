import React, { useState } from 'react'
import { motion } from 'framer-motion'
import styles from './TestimoniosSection.module.css'
import { useCarrusel } from '../../lib/useCarrusel'

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
        <div>
          <p className={styles.nombre}>{nombre}</p>
          <p className={styles.rol}>{rol}</p>
        </div>
      </div>
    </article>
  )
}

// Una fila: renderiza los items dos veces para un bucle continuo. El
// desplazamiento (auto-avance, arrastre y pausa en hover) lo maneja el hook
// useCarrusel sobre el contenedor con scroll; aquí solo pintamos las tarjetas.
function Fila({ items, carrusel }) {
  return (
    <div className={styles.fila} ref={carrusel.scrollerRef} {...carrusel.handlers}>
      <div className={styles.track}>
        {[0, 1].map((copia) => (
          <React.Fragment key={copia}>
            {items.map((t, i) => (
              <Tarjeta key={`${copia}-${i}`} {...t} oculto={copia === 1} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── Testimonios mockeados (TEMPORAL) ──────────────────────────────────────
// Mientras se acumulan reseñas reales aprobadas, mostramos estos ejemplos.
// Para volver a las reseñas reales de la BD: borrar MOCK_TESTIMONIOS y restaurar
// el fetch a `/rest/v1/resenas?aprobado=eq.true` dentro de un useEffect (ver git).
const MOCK_TESTIMONIOS = [
  { texto: 'Necesitaba orientación en un proceso de sucesión y no sabía por dónde empezar. En menos de un día ya estaba hablando con una abogada que me explicó todo con claridad. Excelente acompañamiento.', nombre: 'Laura Restrepo', rol: 'Cliente · Bogotá', rating: 5, imagen: null },
  { texto: 'Como dueño de una pyme, el tema tributario me abrumaba. El contador que me asignaron organizó mi declaración de renta y me ahorró varios dolores de cabeza. Muy recomendados.', nombre: 'Andrés Gómez', rol: 'Cliente · Medellín', rating: 5, imagen: null },
  { texto: 'Tenía dudas sobre un contrato laboral y la asesoría fue rápida, seria y sin vueltas. Me sentí acompañada en todo el proceso y con respuestas concretas.', nombre: 'Valentina Ríos', rol: 'Cliente · Cali', rating: 4.5, imagen: null },
  { texto: 'Consulté por un tema de derecho de familia bastante delicado. El trato fue humano y profesional, y siempre supe cuáles eran mis opciones reales según la ley.', nombre: 'Carlos Mendoza', rol: 'Cliente · Barranquilla', rating: 5, imagen: null },
  { texto: 'La plataforma me conectó con un abogado de derecho penal que respondió mis dudas con paciencia. Todo transparente, incluido el costo antes de empezar.', nombre: 'Diana Vargas', rol: 'Cliente · Bucaramanga', rating: 4.5, imagen: null },
  { texto: 'Manejo varios locales y necesitaba poner al día la contabilidad. El profesional fue puntual, ordenado y me dejó todo claro para el cierre del año fiscal.', nombre: 'Jorge Patiño', rol: 'Cliente · Pereira', rating: 5, imagen: null },
]

export default function TestimoniosSection() {
  const [items] = useState(MOCK_TESTIMONIOS)

  // Dos filas en sentidos opuestos, en desplazamiento continuo.
  const fila1Carrusel = useCarrusel({ speed: 40, direction: 1, loop: true })
  const fila2Carrusel = useCarrusel({ speed: 32, direction: -1, loop: true })

  // Solo reseñas aprobadas: si aún no hay ninguna, la sección no se muestra.
  if (!items || items.length === 0) return null

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
          Personas de todo Colombia han confiado en nosotros para resolver sus asuntos jurídicos y
          contables con respaldo profesional. Arrastra las reseñas o usa las flechas para recorrerlas.
        </p>
      </motion.header>

      <div
        className={styles.filas}
        role="region"
        aria-label="Testimonios de clientes en desplazamiento continuo"
      >
        <Fila items={fila1} carrusel={fila1Carrusel} />
        <Fila items={fila2} carrusel={fila2Carrusel} />
      </div>
    </section>
  )
}
