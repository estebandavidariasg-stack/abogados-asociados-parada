import styles from './IntroSection.module.css'

/* Scroll suave a un ancla. Si el elemento no existe (raro pero defensivo),
   cae al ancla nativa del navegador. */
function smoothScrollTo(e, hash) {
  const target = document.getElementById(hash)
  if (!target) return
  e.preventDefault()
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.replaceState(null, '', `#${hash}`)
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
        <span className={styles.eyebrow}>Abogados y Asociados Parada</span>

        <h1 id="intro-heading" className={styles.heading}>
          <em>Defendemos sus derechos,</em><br />
          acompañamos sus decisiones.
        </h1>

        <div className={styles.divider} aria-hidden="true" />

        <p className={styles.subtitle}>
          Asesoría jurídica y contable con presencia en Colombia y cobertura
          internacional. Derecho civil, penal, laboral, comercial y más.
        </p>

        <div className={styles.actions}>
          <a
            href="#chat"
            onClick={(e) => smoothScrollTo(e, 'chat')}
            className={styles.ctaPrimary}
          >
            Cuéntanos tu caso <ArrowIcon />
          </a>
          <button
            type="button"
            onClick={onUnirse}
            className={styles.ctaSecondary}
          >
            Únete a la firma <ArrowIcon />
          </button>
        </div>
      </div>
    </section>
  )
}
