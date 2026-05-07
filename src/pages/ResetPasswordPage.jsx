import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './ResetPasswordPage.module.css'

/* Cuando Supabase redirige al usuario aquí, llega con el hash:
   #access_token=...&refresh_token=...&type=recovery&expires_in=...
   Lo parseamos manualmente y lo guardamos en localStorage para que el
   cliente custom (lib/supabase.js) lo recoja en updateUser(). */
function parseRecoveryHash() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash || ''
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.slice(1))
  const type = params.get('type')
  const accessToken  = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const expiresIn    = parseInt(params.get('expires_in') || '0', 10)
  if (type !== 'recovery' || !accessToken) return null
  return { accessToken, refreshToken, expiresIn }
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decodeURIComponent(escape(json)))
  } catch { return null }
}

const PwToggle = ({ shown, onClick }) => (
  <button
    type="button"
    className={styles.pwToggle}
    onClick={onClick}
    aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
    title={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
  >
    {shown ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    )}
  </button>
)

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready,   setReady]   = useState(false)        // session de recovery activa
  const [invalid, setInvalid] = useState(false)        // enlace inválido o expirado
  const [pw1,     setPw1]     = useState('')
  const [pw2,     setPw2]     = useState('')
  const [show1,   setShow1]   = useState(false)
  const [show2,   setShow2]   = useState(false)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)

  // Al montar: parsear el hash de recovery y guardar el token para que
  // updateUser() lo use. Si el hash no es válido o ya expiró, marcar invalid.
  useEffect(() => {
    const recovery = parseRecoveryHash()
    if (!recovery) {
      // Si tampoco hay sesión local previa, el enlace no sirve
      setInvalid(true)
      return
    }
    const claims = decodeJwt(recovery.accessToken)
    if (!claims || (claims.exp && claims.exp * 1000 < Date.now())) {
      setInvalid(true)
      return
    }
    // Persistimos el token de recovery con la misma estructura que usa
    // signInWithPassword del cliente custom — así getSession()/updateUser()
    // lo encuentran sin lógica adicional.
    localStorage.setItem('sb_token', recovery.accessToken)
    if (recovery.refreshToken) localStorage.setItem('sb_refresh_token', recovery.refreshToken)
    localStorage.setItem('sb_token_exp', String(claims.exp || ''))
    if (claims.sub) {
      localStorage.setItem('sb_user', JSON.stringify({ id: claims.sub, email: claims.email || '' }))
    }
    // Limpiar el hash de la URL para que no quede el token visible
    try { window.history.replaceState({}, '', window.location.pathname) } catch { /* no-op */ }
    setReady(true)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (pw1.length < 8) { setError('La contraseña debe tener mínimo 8 caracteres.'); return }
    if (pw1 !== pw2)    { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    setLoading(false)
    if (err) { setError(err.message || 'No se pudo actualizar la contraseña.'); return }
    // Limpiar la sesión de recovery — el usuario debe loguearse normal con la pw nueva
    await supabase.auth.signOut()
    setDone(true)
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>ABOGADOS Y ASOCIADOS PARADA</div>
        <h1 className={styles.title}>Nueva contraseña</h1>

        {/* Enlace inválido / expirado */}
        {invalid && (
          <>
            <p className={styles.muted}>
              El enlace para restablecer la contraseña no es válido o ya expiró.
              Solicítalo de nuevo desde el inicio de sesión.
            </p>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => navigate('/')}
            >
              Volver al inicio
            </button>
          </>
        )}

        {/* Sesión válida — mostrar formulario */}
        {!invalid && ready && !done && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.label}>Nueva contraseña</label>
              <div className={styles.pwWrap}>
                <input
                  type={show1 ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="Mínimo 8 caracteres"
                  value={pw1}
                  onChange={(e) => { setPw1(e.target.value); setError('') }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                <PwToggle shown={show1} onClick={() => setShow1(s => !s)} />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Confirmar contraseña</label>
              <div className={styles.pwWrap}>
                <input
                  type={show2 ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="Repite la contraseña"
                  value={pw2}
                  onChange={(e) => { setPw2(e.target.value); setError('') }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                <PwToggle shown={show2} onClick={() => setShow2(s => !s)} />
              </div>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={loading || !pw1 || !pw2}
            >
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {/* Estado: cargando sesión inicial */}
        {!invalid && !ready && !done && (
          <p className={styles.muted}>Verificando enlace…</p>
        )}

        {/* Éxito */}
        {done && (
          <>
            <div className={styles.successIcon}>✓</div>
            <p className={styles.successText}>
              ¡Contraseña actualizada! Ya puedes iniciar sesión.
            </p>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => navigate('/')}
            >
              Ir al inicio
            </button>
          </>
        )}
      </div>
    </div>
  )
}
