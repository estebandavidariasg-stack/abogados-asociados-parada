import { useEffect, useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './Navbar.module.css'

export default function Navbar({ onLogin, onRegister }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, profile, signOut } = useAuth()
  const menuRef = useRef(null)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const displayName = profile?.nombre
    ?? user?.user_metadata?.nombre
    ?? user?.email
    ?? 'Usuario'

  const isSuperAdmin = profile?.rol === 'superadmin'

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
      <a href="/" className={styles.logoWrap}>
        <img src="/logo.png" alt="Abogados y Asociados Parada" className={styles.logoImg} />
      </a>

      <div className={styles.firmTitle}>
        <span className={styles.firmName}>Abogados y Asociados</span>
        <span className={styles.firmHighlight}>Parada</span>
      </div>

      {/* ── Desktop actions ── */}
      <div className={styles.actions}>
        {user ? (
          <div className={styles.userMenu} ref={menuRef}>
            <button
              className={styles.userBtn}
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <span className={styles.avatar}>
                {profile?.foto_url
                  ? <img src={profile.foto_url} alt={displayName} className={styles.avatarImg} />
                  : (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  )
                }
              </span>
              <span className={styles.userName}>{displayName}</span>
            </button>

            {menuOpen && (
              <ul className={styles.dropdown}>
                {isSuperAdmin && (
                  <li>
                    <button className={`${styles.dropdownItem} ${styles.adminItem}`}
                      onClick={() => { window.location.href = '/admin'; }}>
                      ⚙ Panel Admin
                    </button>
                  </li>
                )}
                <li>
                  <button className={styles.dropdownItem}
                    onClick={() => { window.location.href = '/perfil'; setMenuOpen(false) }}>
                    Mi perfil
                  </button>
                </li>
                <li>
                  <button className={styles.dropdownItem}
                    onClick={() => { signOut(); setMenuOpen(false) }}>
                    Cerrar sesión
                  </button>
                </li>
              </ul>
            )}
          </div>
        ) : (
          <>
            <button className="btn-ghost" onClick={onLogin}>Iniciar sesión</button>
            <button className="btn-solid" onClick={onRegister}>Registrarse</button>
          </>
        )}
      </div>

      {/* ── Hamburguesa móvil ── */}
      <button
        className={`${styles.burger} ${mobileOpen ? styles.burgerOpen : ''}`}
        onClick={() => setMobileOpen((o) => !o)}
        aria-label="Menú"
      >
        <span /><span /><span />
      </button>

      {/* ── Menú móvil desplegable ── */}
      {mobileOpen && (
        <div className={styles.mobileMenu}>
          {user ? (
            <>
              <div className={styles.mobileUser}>
                <span className={styles.avatar}>
                  {profile?.foto_url
                    ? <img src={profile.foto_url} alt={displayName} className={styles.avatarImg} />
                    : (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                      </svg>
                    )
                  }
                </span>
                <span className={styles.mobileUserName}>{displayName}</span>
              </div>
              {isSuperAdmin && (
                <button className={styles.mobileItem} onClick={() => { window.location.href = '/admin'; setMobileOpen(false) }}>
                  ⚙ Panel Admin
                </button>
              )}
              <button className={styles.mobileItem} onClick={() => { window.location.href = '/perfil'; setMobileOpen(false) }}>
                Mi perfil
              </button>
              <button className={styles.mobileItem} onClick={() => { signOut(); setMobileOpen(false) }}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <button className={styles.mobileItem} onClick={() => { onLogin(); setMobileOpen(false) }}>
                Iniciar sesión
              </button>
              <button className={styles.mobileItemGold} onClick={() => { onRegister(); setMobileOpen(false) }}>
                Registrarse
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  )
}