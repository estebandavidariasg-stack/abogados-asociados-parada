import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import styles from './AuthModal.module.css'

export default function AuthModal({ initialTab = 'login', onClose }) {
  const { signIn, signUp } = useAuth()
  const [tab, setTab]         = useState(initialTab)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(null)

  // Login — acepta correo o usuario
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword]     = useState('')

  // Registro
  const [nombre, setNombre]       = useState('')
  const [apellido, setApellido]   = useState('')
  const [username, setUsername]   = useState('')
  const [telefono, setTelefono]   = useState('')
  const [regEmail, setRegEmail]   = useState('')
  const [regPassword, setRegPassword] = useState('')

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // Determina si es correo o username y obtiene el email
  async function resolveEmail(identifier) {
    if (identifier.includes('@')) return identifier
    // Buscar el correo por username en profiles
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?username=eq.${identifier}&select=email`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        }
      }
    )
    const data = await res.json()
    if (!data || data.length === 0) throw new Error('Usuario no encontrado')
    return data[0].email
  }

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      const email = await resolveEmail(loginIdentifier.trim())
      await signIn({ email, password: loginPassword })
      onClose()
    } catch (err) {
      setError(err.message === 'Usuario no encontrado'
        ? 'Usuario no encontrado'
        : 'Correo, usuario o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Verificar que el username no esté tomado
      if (username) {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            }
          }
        )
        const data = await res.json()
        if (data && data.length > 0) throw new Error('Ese nombre de usuario ya está en uso')
      }
      await signUp({ nombre, apellido, username, telefono, email: regEmail, password: regPassword })
      setSuccess('¡Registro exitoso! Ya puedes iniciar sesión.')
    } catch (err) {
      setError(err.message || 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t) {
    setTab(t)
    setError(null)
    setSuccess(null)
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose}>✕</button>

        <p className={styles.eyebrow}>Abogados y Asociados Parada</p>
        <h3 className={styles.title}>
          {tab === 'login' ? 'Bienvenido' : 'Crear perfil'}
        </h3>

        <div className={styles.tabs}>
          <button className={`${styles.tabBtn} ${tab === 'login' ? styles.active : ''}`} onClick={() => switchTab('login')}>
            Iniciar sesión
          </button>
          <button className={`${styles.tabBtn} ${tab === 'register' ? styles.active : ''}`} onClick={() => switchTab('register')}>
            Registrarse
          </button>
        </div>

        {error   && <p className={styles.msgError}>{error}</p>}
        {success && <p className={styles.msgSuccess}>{success}</p>}

        {/* LOGIN */}
        {tab === 'login' && !success && (
          <form className={styles.form} onSubmit={e => e.preventDefault()}>
            <div className={styles.field}>
              <label className={styles.label}>Correo o usuario</label>
              <input
                type="text"
                className={styles.input}
                placeholder="correo@ejemplo.com o @usuario"
                value={loginIdentifier}
                onChange={e => setLoginIdentifier(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contraseña</label>
              <input
                type="password"
                className={styles.input}
                placeholder="••••••••"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="button"
              className={`btn-solid ${styles.submit}`}
              disabled={loading}
              onClick={handleLogin}
            >
              {loading ? 'Ingresando...' : 'Ingresar →'}
            </button>
            <p className={styles.hint}>
              ¿Olvidó su contraseña? <a href="#" className={styles.hintLink}>Recuperar</a>
            </p>
          </form>
        )}

        {/* REGISTRO */}
        {tab === 'register' && !success && (
          <form className={styles.form} onSubmit={handleRegister}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre</label>
                <input type="text" className={styles.input} placeholder="Nombre"
                  value={nombre} onChange={e => setNombre(e.target.value)} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido</label>
                <input type="text" className={styles.input} placeholder="Apellido"
                  value={apellido} onChange={e => setApellido(e.target.value)} required />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nombre de usuario</label>
              <input type="text" className={styles.input} placeholder="@usuario"
                value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())}
                required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Teléfono</label>
              <input type="tel" className={styles.input} placeholder="+57 300 000 0000"
                value={telefono} onChange={e => setTelefono(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              <input type="email" className={styles.input} placeholder="correo@ejemplo.com"
                value={regEmail} onChange={e => setRegEmail(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contraseña</label>
              <input type="password" className={styles.input} placeholder="Mínimo 6 caracteres"
                value={regPassword} onChange={e => setRegPassword(e.target.value)}
                required minLength={6} />
            </div>
            <button type="submit" className={`btn-solid ${styles.submit}`} disabled={loading}>
              {loading ? 'Creando cuenta...' : 'Crear cuenta →'}
            </button>
            <p className={styles.hint}>
              Al registrarse, su perfil quedará pendiente de aprobación.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
