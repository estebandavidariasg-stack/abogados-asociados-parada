import styles from './Footer.module.css'

const AREAS = ['Derecho Penal', 'Derecho Civil', 'Derecho Corporativo', 'Derecho de Familia', 'Derecho Laboral', 'Derecho Administrativo']
const FIRMA = ['Nuestro equipo', 'Historia', 'Noticias', 'Trabaje con nosotros']

const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)
const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6.29 6.29l1.16-1.16a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)
const IconMapPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
  </svg>
)

export default function Footer() {
  return (
    <footer className={styles.footer}>
      {/* Glow de fondo */}
      <div className={styles.glow} />

      <div className={styles.inner}>
        {/* ── Columna 1: Logo + dirección ── */}
        <div className={styles.brand}>
          <a href="/" className={styles.logoWrap}>
            <picture>
              <source srcSet="/logo-nav.webp" type="image/webp" />
              <img
                src="/logo-nav.png"
                alt="Abogados y Asociados Parada"
                className={styles.logoImg}
                width="96"
                height="96"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </a>
          <p className={styles.tagline}>Bufete jurídico comprometido con la excelencia y la defensa de sus derechos.</p>
          <div className={styles.address}>
            <IconMapPin />
            <span>Calle 93 # 15-23, Of. 804<br />Bogotá D.C., Colombia</span>
          </div>
        </div>

        {/* ── Columna 2: Contacto ── */}
        <div className={styles.contact}>
          <h4 className={styles.colTitle}>Contacto</h4>
          <a href="mailto:abogadosyasociados.parada@gmail.com" className={styles.contactItem}>
            <span className={styles.contactIcon}><IconMail /></span>
            <div>
              <span className={styles.contactLabel}>En cualquier momento</span>
              <span className={styles.contactValue}>abogadosyasociados.parada@gmail.com</span>
              <span className={styles.contactSub}>Respondemos en menos de 24 horas</span>
            </div>
          </a>
          <a href="https://wa.me/573124086734" target="_blank" rel="noopener noreferrer" className={styles.contactItem}>
            <span className={styles.contactIcon}><IconPhone /></span>
            <div>
              <span className={styles.contactLabel}>¿Tienes dudas?</span>
              <span className={styles.contactValue}>+57 312 408 6734</span>
              <span className={styles.contactSub}>Escríbenos por WhatsApp</span>
            </div>
          </a>
        </div>

        {/* ── Columna 3: Áreas + Social ── */}
        <div className={styles.col}>
          <h4 className={styles.colTitle}>Áreas de práctica</h4>
          <ul className={styles.linkList}>
            {AREAS.map(item => <li key={item}><a href="/#lawyers">{item}</a></li>)}
          </ul>
          {/* Redes sociales */}
          <div className={styles.socials}>
            {[
              { label: 'Instagram', href: '#', path: 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 1.5A4 4 0 0 0 3.5 7.5v9a4 4 0 0 0 4 4h9a4 4 0 0 0 4-4v-9a4 4 0 0 0-4-4h-9zm4.5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm5.25-.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z' },
              { label: 'LinkedIn', href: '#', path: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
              { label: 'Facebook', href: '#', path: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z' },
            ].map(({ label, href, path }) => (
              <a key={label} href={href} className={styles.socialBtn} aria-label={label} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={path} />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── Marca gigante ── */}
      <div className={styles.bigBrand}>
        <span className={styles.bigBrace}>{'{'}</span>
        <span className={styles.bigText}>PARADA</span>
        <span className={styles.bigBrace}>{'}'}</span>
      </div>

      {/* ── Bottom bar ── */}
      <div className={styles.bottom}>
        <span>© 2026 Abogados y Asociados Parada. Todos los derechos reservados.</span>
        <span className={styles.bottomDot}>·</span>
        <span>Bogotá, Colombia</span>
      </div>
    </footer>
  )
}
