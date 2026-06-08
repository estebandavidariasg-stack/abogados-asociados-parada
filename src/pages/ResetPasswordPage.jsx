import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PASSWORD_RULES, getPasswordStrength, isPasswordValid } from '../lib/validaciones'
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
    // Misma exigencia que el registro (PASSWORD_RULES), no solo longitud.
    if (!isPasswordValid(pw1)) { setError('La contraseña no cumple todos los requisitos.'); return }
    if (pw1 !== pw2)           { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    setLoading(false)
    if (err) { setError(err.message || 'No se pudo actualizar la contraseña.'); return }
    // Limpiar la sesión de recovery — el usuario debe loguearse normal con la pw nueva
    await supabase.auth.signOut()
    setDone(true)
  }

  const strength      = getPasswordStrength(pw1)
  const rules         = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(pw1) }))
  const showChecklist = pw1.length > 0
  const canSubmit     = isPasswordValid(pw1) && pw1 === pw2

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
                  autoFocus
                />
                <PwToggle shown={show1} onClick={() => setShow1(s => !s)} />
              </div>

              {/* Medidor de fuerza + requisitos (mismas reglas que el registro) */}
              {showChecklist && strength && (
                <div className={styles.strengthRow}>
                  <div className={styles.strengthBars}>
                    {[1, 2, 3].map(lvl => (
                      <div
                        key={lvl}
                        className={styles.strengthBar}
                        style={{ background: strength.level >= lvl ? strength.color : 'rgba(13,45,94,0.1)' }}
                      />
                    ))}
                  </div>
                  <span className={styles.strengthLabel} style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                </div>
              )}
              {showChecklist && (
                <ul className={styles.checklist}>
                  {rules.map(rule => (
                    <li
                      key={rule.id}
                      className={`${styles.checkItem} ${rule.ok ? styles.checkOk : styles.checkPending}`}
                    >
                      <span className={styles.checkIcon} aria-hidden="true">
                        {rule.ok ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                            <circle cx="12" cy="12" r="8" />
                          </svg>
                        )}
                      </span>
                      <span className={styles.checkLabel}>{rule.label}</span>
                    </li>
                  ))}
                </ul>
              )}
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
              disabled={loading || !canSubmit}
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
            <div className={styles.successIcon}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
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
