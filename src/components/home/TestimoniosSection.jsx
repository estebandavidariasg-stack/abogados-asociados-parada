import React, { useRef } from 'react'
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

const col1 = testimonios.slice(0, 3)
const col2 = testimonios.slice(3, 6)
const col3 = testimonios.slice(6, 9)

function ColumnaTestimonios({ testimonios: items, duracion = 18, className }) {
  const prefersReduced = useReducedMotion()

  return (
    <div className={`${styles.columna} ${className ?? ''}`}>
      <motion.ul
        animate={prefersReduced ? false : { y: '-50%' }}
        transition={{
          duration: duracion,
          repeat: Infinity,
          ease: 'linear',
          repeatType: 'loop',
        }}
        className={styles.lista}
      >
        {[0, 1].map((copy) => (
          <React.Fragment key={copy}>
            {items.map(({ texto, imagen, nombre, rol }, i) => (
              <motion.li
                key={`${copy}-${i}`}
                aria-hidden={copy === 1 ? 'true' : 'false'}
                tabIndex={copy === 1 ? -1 : 0}
                whileHover={
                  prefersReduced
                    ? {}
                    : {
                        scale: 1.025,
                        y: -6,
                        transition: { type: 'spring', stiffness: 380, damping: 18 },
                      }
                }
                className={styles.tarjeta}
              >
                <blockquote className={styles.blockquote}>
                  <p className={styles.texto}>{texto}</p>
                  <footer className={styles.pie}>
                    <img
                      src={imagen}
                      alt={`Foto de ${nombre}`}
                      width={40}
                      height={40}
                      className={styles.avatar}
                      loading="lazy"
                    />
                    <div>
                      <cite className={styles.nombre}>{nombre}</cite>
                      <span className={styles.rol}>{rol}</span>
                    </div>
                  </footer>
                </blockquote>
              </motion.li>
            ))}
          </React.Fragment>
        ))}
      </motion.ul>
    </div>
  )
}

export default function TestimoniosSection() {
  return (
    <section className={styles.section} aria-labelledby="testimonios-heading">
      <motion.div
        initial={{ opacity: 0, y: 36 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
        className={styles.container}
      >
        <header className={styles.header}>
          <span className={styles.eyebrow}>Testimonios</span>
          <h2 id="testimonios-heading" className={styles.heading}>
            Lo que dicen <em>nuestros clientes</em>
          </h2>
          <p className={styles.desc}>
            Personas de todo Colombia han confiado en nosotros para resolver sus asuntos jurídicos y
            contables con respaldo profesional.
          </p>
        </header>

        <div
          className={styles.columnas}
          role="region"
          aria-label="Testimonios de clientes en desplazamiento continuo"
        >
          <ColumnaTestimonios testimonios={col1} duracion={20} />
          <ColumnaTestimonios testimonios={col2} duracion={25} className={styles.ocultaMd} />
          <ColumnaTestimonios testimonios={col3} duracion={22} className={styles.ocultaLg} />
        </div>
      </motion.div>
    </section>
  )
}
