import styles from './Footer.module.css'

const LINKS = {
  práctica: ['Derecho Penal', 'Derecho Civil', 'Derecho Corporativo', 'Derecho de Familia'],
  firma: ['Nuestro equipo', 'Historia', 'Noticias', 'Trabaje con nosotros'],
  contacto: ['Calle 93 # 15-23, Of. 804', 'Bogotá, Colombia', '+57 300 123 4567', 'contacto@aapabogados.co'],
}

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <a href="/" className={styles.logoWrap}>
            <img src="/logo.png" alt="Abogados y Asociados Parada" className={styles.logoImg} />
          </a>
          <p>Bufete jurídico comprometido con la excelencia y la defensa de sus derechos. Bogotá, Colombia.</p>
        </div>

        {Object.entries(LINKS).map(([title, items]) => (
          <div key={title} className={styles.col}>
            <h4>{title.charAt(0).toUpperCase() + title.slice(1)}</h4>
            <ul>
              {items.map((item) => (
                <li key={item}><a href="#">{item}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className={styles.bottom}>
        <span>© 2026 Abogados y Asociados Parada. Todos los derechos reservados.</span>
      </div>
    </footer>
  )
}
