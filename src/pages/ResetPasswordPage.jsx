import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PASSWORD_RULES, getPasswordStrength, isPasswordValid } from '../lib/validaciones'
import styles from './ResetPasswordPage.module.css'

/* Recuperación de contraseña. Dos caminos:
   1) ENLACE (legacy): Supabase redirige con #access_token=...&type=recovery.
      Lo parseamos y guardamos el token → el usuario solo pone la nueva clave.
   2) CÓDIGO (por defecto): el correo trae un código de 6-8 dígitos (email_otp).
      El usuario entra a /nueva-contrasena?email=... y teclea el código.
      Un código NO se puede consumir por el prefetch de Gmail, que sí "gastaba"
      el magic-link antes del clic (llegaba siempre "expirado"). */
function parseRecoveryHash() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash || ''
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.slice(1))
  const type = params.get('type')
  const accessToken  = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (type !== 'recovery' || !accessToken) return null
  return { accessToken, refreshToken }
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decodeURIComponent(escape(json)))
  } catch { return null }
}

// Guarda la sesión de recovery con la misma estructura que usa el cliente
// custom (lib/supabase.js) para que getSession()/updateUser() la encuentren.
function storeSession(accessToken, refreshToken) {
  const claims = decodeJwt(accessToken)
  localStorage.setItem('sb_token', accessToken)
  if (refreshToken) localStorage.setItem('sb_refresh_token', refreshToken)
  localStorage.setItem('sb_token_exp', String(claims?.exp || ''))
  if (claims?.sub) {
    localStorage.setItem('sb_user', JSON.stringify({ id: claims.sub, email: claims.email || '' }))
  }
  return claims
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
  const [mode,   setMode]   = useState('loading')   // 'loading' | 'link' | 'code'
  const [emailInput, setEmailInput] = useState('')
  const [code,   setCode]   = useState('')
  const [pw1,    setPw1]    = useState('')
  const [pw2,    setPw2]    = useState('')
  const [show1,  setShow1]  = useState(false)
  const [show2,  setShow2]  = useState(false)
  const [error,  setError]  = useState('')
  const [loading, setLoading] = useState(false)
  const [done,   setDone]   = useState(false)

  useEffect(() => {
    // ¿Vino por enlace (hash con token de recovery válido)?
    const recovery = parseRecoveryHash()
    if (recovery) {
      const claims = decodeJwt(recovery.accessToken)
      if (claims && (!claims.exp || claims.exp * 1000 > Date.now())) {
        storeSession(recovery.accessToken, recovery.refreshToken)
        try { window.history.replaceState({}, '', window.location.pathname) } catch { /* no-op */ }
        setMode('link')
        return
      }
    }
    // Por defecto: flujo por CÓDIGO. Prefill del correo si viene en la URL.
    try {
      const q = new URLSearchParams(window.location.search)
      const em = q.get('email')
      if (em) setEmailInput(em)
    } catch { /* no-op */ }
    setMode('code')
  }, [])

  // Aplica la nueva contraseña (la sesión de recovery ya está guardada).
  async function aplicarPassword() {
    const { error: err } = await supabase.auth.updateUser({ password: pw1 })
    if (err) throw new Error(err.message || 'No se pudo actualizar la contraseña.')
    await supabase.auth.signOut()
    setDone(true)
  }

  function validarPassword() {
    if (!isPasswordValid(pw1)) { setError('La contraseña no cumple todos los requisitos.'); return false }
    if (pw1 !== pw2)           { setError('Las contraseñas no coinciden.'); return false }
    return true
  }

  // Enlace: la sesión ya está; solo actualizamos.
  async function submitLink(e) {
    e.preventDefault(); setError('')
    if (!validarPassword()) return
    setLoading(true)
    try { await aplicarPassword() }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  // Código: lo enviamos a nuestro endpoint, que valida el código y cambia la
  // contraseña con el service-role. No hay token de Supabase que expire/pise.
  async function submitCode(e) {
    e.preventDefault(); setError('')
    const em = emailInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError('Ingresa un correo válido.'); return }
    if (!/^\d{4,10}$/.test(code.trim()))        { setError('Ingresa el código que te enviamos por correo.'); return }
    if (!validarPassword()) return
    setLoading(true)
    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, code: code.trim(), newPassword: pw1 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Código inválido o expirado.')
      setDone(true)
    } catch (err) {
      setError(err.message || 'No se pudo cambiar la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  const strength      = getPasswordStrength(pw1)
  const rules         = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(pw1) }))
  const showChecklist = pw1.length > 0
  const pwOk          = isPasswordValid(pw1) && pw1 === pw2
  const canSubmitCode = pwOk && /^\d{4,10}$/.test(code.trim()) && emailInput.trim().length > 3

  // Bloque de campos de contraseña (compartido por ambos flujos).
  const PasswordFields = (
    <>
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
            required minLength={8}
          />
          <PwToggle shown={show1} onClick={() => setShow1(s => !s)} />
        </div>

        {showChecklist && strength && (
          <div className={styles.strengthRow}>
            <div className={styles.strengthBars}>
              {[1, 2, 3].map(lvl => (
                <div key={lvl} className={styles.strengthBar}
                  style={{ background: strength.level >= lvl ? strength.color : 'rgba(109,60,27,0.1)' }} />
              ))}
            </div>
            <span className={styles.strengthLabel} style={{ color: strength.color }}>{strength.label}</span>
          </div>
        )}
        {showChecklist && (
          <ul className={styles.checklist}>
            {rules.map(rule => (
              <li key={rule.id} className={`${styles.checkItem} ${rule.ok ? styles.checkOk : styles.checkPending}`}>
                <span className={styles.checkIcon} aria-hidden="true">
                  {rule.ok ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="8" /></svg>
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
            required minLength={8}
          />
          <PwToggle shown={show2} onClick={() => setShow2(s => !s)} />
        </div>
      </div>
    </>
  )

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}><span style={{ color: 'var(--navy)' }}>PARADA</span> BRIDGE</div>
        <h1 className={styles.title}>Nueva contraseña</h1>

        {mode === 'loading' && !done && (
          <p className={styles.muted}>Cargando…</p>
        )}

        {/* Flujo por ENLACE — solo la contraseña */}
        {mode === 'link' && !done && (
          <form className={styles.form} onSubmit={submitLink}>
            {PasswordFields}
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.btnPrimary} disabled={loading || !pwOk}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {/* Flujo por CÓDIGO — correo + código + contraseña */}
        {mode === 'code' && !done && (
          <form className={styles.form} onSubmit={submitCode}>
            <p className={styles.muted} style={{ marginBottom: 14 }}>
              Ingresa el <strong>código</strong> que te enviamos por correo y tu nueva contraseña.
            </p>
            <div className={styles.field}>
              <label className={styles.label}>Correo</label>
              <input
                type="email"
                className={styles.input}
                placeholder="tucorreo@ejemplo.com"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setError('') }}
                autoComplete="email"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Código del correo</label>
              <input
                type="text"
                inputMode="numeric"
                className={styles.input}
                placeholder="Código de 6-8 dígitos"
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                autoComplete="one-time-code"
                required
              />
            </div>
            {PasswordFields}
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.btnPrimary} disabled={loading || !canSubmitCode}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {/* Éxito */}
        {done && (
          <>
            <div className={styles.successIcon}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className={styles.successText}>¡Contraseña actualizada! Ya puedes iniciar sesión.</p>
            <button type="button" className={styles.btnPrimary} onClick={() => navigate('/')}>Ir al inicio</button>
          </>
        )}
      </div>
    </div>
  )
}
