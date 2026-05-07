import { useEffect, useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './Navbar.module.css'

export default function Navbar({ onLogin, onRegister, onRegisterContador }) {
  const [scrolled, setScrolled]   = useState(false)
  const [menuOpen, setMenuOpen]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const { user, profile, signOut } = useAuth()
  const menuRef     = useRef(null)
  const registerRef = useRef(null)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Click fuera cierra el dropdown de registro (necesario para tap en móvil)
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (registerRef.current && !registerRef.current.contains(e.target)) setRegisterOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close mobile menu on resize
  useEffect(() => {
    const handleResize = () => { if (window.innerWidth > 768) setMobileOpen(false) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const displayName = profile?.nombre ?? user?.user_metadata?.nombre ?? user?.email ?? 'Usuario'
  const isSuperAdmin = profile?.rol === 'superadmin'
  const perfilHref = profile?.rol === 'contador' ? '/perfil-contador' : '/perfil'

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
      {/* Logo */}
      <a href="/" className={styles.logoWrap}>
        <img src="/favicon.png" alt="Abogados y Asociados Parada" className={styles.logoImg} />
      </a>

      {/* Firm name — centered on desktop */}
      <div className={`${styles.firmTitle} ${scrolled ? styles.firmTitleScrolled : ''}`}>
        <span className={`${styles.firmName} ${scrolled ? styles.firmNameDark : ''}`}>
          Abogados y Asociados
        </span>
        <span className={`${styles.firmHighlight} ${scrolled ? styles.firmHighlightDark : ''}`}>
          Parada
        </span>
      </div>

      {/* Desktop actions */}
      <div className={styles.actions}>
        {user ? (
          <div className={styles.userMenu} ref={menuRef}>
            <button
              className={`${styles.userBtn} ${scrolled ? styles.userBtnDark : ''}`}
              onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <span className={`${styles.avatar} ${scrolled ? styles.avatarDark : ''}`}>
                {profile?.foto_url
                  ? <img src={profile.foto_url} alt={displayName} className={styles.avatarImg} />
                  : (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  )
                }
              </span>
              <span className={`${styles.userName} ${scrolled ? styles.userNameDark : ''}`}>
                {displayName}
              </span>
            </button>

            {menuOpen && (
              <ul className={styles.dropdown}>
                {isSuperAdmin && (
                  <li>
                    <button className={`${styles.dropdownItem} ${styles.adminItem}`}
                      onClick={() => { window.location.href = '/admin' }}>
                      ⚙ Panel Admin
                    </button>
                  </li>
                )}
                <li>
                  <button className={styles.dropdownItem}
                    onClick={() => { window.location.href = perfilHref; setMenuOpen(false) }}>
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
            <button
              className={`${styles.btnLogin} ${scrolled ? styles.btnLoginDark : ''}`}
              onClick={onLogin}
            >
              Iniciar sesión
            </button>
            <div
              className={styles.registerWrap}
              ref={registerRef}
              onMouseEnter={() => setRegisterOpen(true)}
              onMouseLeave={() => setRegisterOpen(false)}
            >
              <button
                className={`${styles.btnRegister} ${scrolled ? styles.btnRegisterDark : ''}`}
                onClick={onRegister}
                aria-haspopup="true"
                aria-expanded={registerOpen}
              >
                Registrarse como abogado
              </button>
              {registerOpen && (
                <div className={styles.registerDropdownWrap}>
                  <button
                    type="button"
                    className={`${styles.btnRegister} ${scrolled ? styles.btnRegisterDark : ''}`}
                    onClick={() => { onRegisterContador?.(); setRegisterOpen(false) }}
                  >
                    Registrarse como contador
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Hamburger — mobile */}
      <button
        className={`${styles.burger} ${scrolled ? styles.burgerDark : ''} ${mobileOpen ? styles.burgerOpen : ''}`}
        onClick={() => setMobileOpen(o => !o)}
        aria-label="Menú"
      >
        <span /><span /><span />
      </button>

      {/* Mobile dropdown */}
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
                <button className={styles.mobileItem}
                  onClick={() => { window.location.href = '/admin'; setMobileOpen(false) }}>
                  ⚙ Panel Admin
                </button>
              )}
              <button className={styles.mobileItem}
                onClick={() => { window.location.href = perfilHref; setMobileOpen(false) }}>
                Mi perfil
              </button>
              <button className={styles.mobileItem}
                onClick={() => { signOut(); setMobileOpen(false) }}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <button className={styles.mobileItem} onClick={() => { onLogin(); setMobileOpen(false) }}>
                Iniciar sesión
              </button>
              <button className={styles.mobileItemGold} onClick={() => { onRegister?.(); setMobileOpen(false) }}>
                Registrarse como Abogado
              </button>
              <button className={styles.mobileItemGold} onClick={() => { onRegisterContador?.(); setMobileOpen(false) }}>
                Registrarse como Contador
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
