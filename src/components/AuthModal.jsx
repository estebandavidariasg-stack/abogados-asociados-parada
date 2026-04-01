import { useState, useEffect } from 'react'
import styles from './AuthModal.module.css'

export default function AuthModal({ initialTab = 'login', onClose }) {
  const [tab, setTab] = useState(initialTab)

  // Cerrar con Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Cerrar">✕</button>

        <p className={styles.eyebrow}>Abogados y Asociados Parada</p>
        <h3 className={styles.title}>
          {tab === 'login' ? 'Bienvenido' : 'Crear perfil'}
        </h3>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tabBtn} ${tab === 'login' ? styles.active : ''}`}
            onClick={() => setTab('login')}
          >
            Iniciar sesión
          </button>
          <button
            className={`${styles.tabBtn} ${tab === 'register' ? styles.active : ''}`}
            onClick={() => setTab('register')}
          >
            Registrarse
          </button>
        </div>

        {/* Login */}
        {tab === 'login' && (
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              <input type="email" className={styles.input} placeholder="correo@ejemplo.com" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contraseña</label>
              <input type="password" className={styles.input} placeholder="••••••••" />
            </div>
            <button className={`btn-solid ${styles.submit}`}>Ingresar →</button>
            <p className={styles.hint}>
              ¿Olvidó su contraseña?{' '}
              <a href="#" className={styles.hintLink}>Recuperar</a>
            </p>
          </div>
        )}

        {/* Register */}
        {tab === 'register' && (
          <div className={styles.form}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre</label>
                <input type="text" className={styles.input} placeholder="Nombre" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido</label>
                <input type="text" className={styles.input} placeholder="Apellido" />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              <input type="email" className={styles.input} placeholder="correo@ejemplo.com" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Teléfono</label>
              <input type="tel" className={styles.input} placeholder="+57 300 000 0000" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contraseña</label>
              <input type="password" className={styles.input} placeholder="••••••••" />
            </div>
            <button className={`btn-solid ${styles.submit}`}>Crear cuenta →</button>
            <p className={styles.hint}>
              Al registrarse, su perfil quedará pendiente de aprobación.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
