import { useEffect, useState } from 'react'
import styles from './Navbar.module.css'

export default function Navbar({ onLogin, onRegister }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
      <a href="/" className={styles.logoWrap}>
        <img src="/logo.png" alt="Abogados y Asociados Parada" className={styles.logoImg} />
      </a>

      <ul className={styles.links}>
        <li><a href="#lawyers">Abogados</a></li>
        <li><a href="#practicas">Áreas</a></li>
        <li><a href="#contacto">Contacto</a></li>
      </ul>

      <div className={styles.actions}>
        <button className="btn-ghost" onClick={onLogin}>Iniciar sesión</button>
        <button className="btn-solid" onClick={onRegister}>Registrarse</button>
      </div>
    </nav>
  )
}
