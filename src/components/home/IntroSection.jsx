import { Link } from 'react-router-dom'
import styles from './IntroSection.module.css'

/* Scroll suave a un ancla. Si el elemento no existe (raro pero defensivo),
   cae al ancla nativa del navegador. */
function smoothScrollTo(e, hash) {
  // "Cuéntanos tu caso" apunta al cuadro de identificación (cédula), no al
  // encabezado de la sección: aterriza justo donde el usuario debe escribir,
  // con la tarjeta pegada bajo el navbar (~56px, sin el subtítulo asomando).
  const target = document.getElementById(hash) || document.getElementById('chat')
  if (!target) return
  e.preventDefault()
  history.replaceState(null, '', `#${hash}`)
  const posicionar = (behavior) => {
    // 80px = navbar flotante (~67) + un pequeño respiro.
    const top = target.getBoundingClientRect().top + window.scrollY - 80
    window.scrollTo({ top: Math.max(0, top), behavior })
  }
  posicionar('smooth')
  // Los reveals de framer-motion cambian el alto de las secciones mientras el
  // scroll viaja y desplazan el objetivo. Una corrección exacta al asentarse
  // deja la tarjeta en su sitio de forma fiable.
  setTimeout(() => posicionar('auto'), 700)
}

function ArrowIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function IntroSection({ onUnirse }) {
  return (
    <section id="intro" className={styles.section} aria-labelledby="intro-heading">
      <div className={styles.content}>
        <span className={styles.eyebrow}>
          <span style={{ color: 'var(--navy)' }}>Parada</span> Bridge
        </span>

        <h1 id="intro-heading" className={styles.heading}>
          <em>Conectamos personas</em> con las soluciones profesionales que necesitan.
        </h1>

        <div className={styles.divider} aria-hidden="true" />

        <p className={styles.subtitle}>
          Conecta con profesionales verificados y de experiencia confiable, de
          forma simple y sin barreras geográficas, en Colombia y el exterior.
        </p>

        <div className={styles.actions}>
          <a
            href="#consulta-form"
            onClick={(e) => smoothScrollTo(e, 'consulta-form')}
            className={styles.ctaPrimary}
          >
            Cuéntanos tu caso <ArrowIcon />
          </a>
          <button
            type="button"
            onClick={onUnirse}
            className={styles.ctaSecondary}
          >
            Únete como profesional <ArrowIcon />
          </button>
        </div>

        <Link to="/proyectos-ley" className={styles.ctaCivic}>
          Debate ciudadano de proyectos de ley
          <ArrowIcon />
        </Link>
      </div>
    </section>
  )
}
