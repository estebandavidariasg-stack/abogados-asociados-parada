import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, getAuthHeaders } from '../lib/supabase'
import styles from './RegisterContadorModal.module.css'
import ReCAPTCHA from 'react-google-recaptcha'
import { IconX } from './Icons'
import {
  PASSWORD_RULES, getPasswordStrength, isPasswordValid,
  validarCelular, validarCorreo, normalizarCelular,
} from '../lib/validaciones'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Ícono ojo — copiado de AuthModal para consistencia visual
function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function FieldHint({ valid, msg, touched }) {
  if (!touched || !msg) return null
  return (
    <span style={{
      fontSize: '0.68rem', marginTop: 4,
      display: 'flex', alignItems: 'center', gap: 4,
      color: valid === true ? 'rgba(46,204,113,0.95)' : 'rgba(220,100,80,0.95)',
    }}>
      {valid === true ? '✓' : '⚠'} {msg}
    </span>
  )
}

export default function RegisterContadorModal({ onClose }) {
  const { signIn } = useAuth()

  const [tab, setTab]         = useState('register')   // 'login' | 'register'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(null)

  // Login
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword,   setLoginPassword]   = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)

  // Campos
  const [nombre, setNombre]                       = useState('')
  const [apellido, setApellido]                   = useState('')
  const [username, setUsername]                   = useState('')
  const [telefono, setTelefono]                   = useState('')
  const [regEmail, setRegEmail]                   = useState('')
  const [regPassword, setRegPassword]             = useState('')
  const [showPassword, setShowPassword]           = useState(false)
  const [pwTouched, setPwTouched]                 = useState(false)
  const [emailTouched, setEmailTouched]           = useState(false)
  const [telTouched, setTelTouched]               = useState(false)
  const [aceptaTerminos, setAceptaTerminos]       = useState(false)
  const [captchaValue, setCaptchaValue]           = useState(null)

  const recaptchaRef = useRef()

  // Validaciones derivadas
  const pwRules    = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(regPassword) }))
  const pwStrength = getPasswordStrength(regPassword)
  const pwValid    = isPasswordValid(regPassword)
  const emailVal   = validarCorreo(regEmail)
  const telVal     = validarCelular(telefono)
  const showPwList = pwTouched && regPassword.length > 0

  const canRegister =
    pwValid && emailVal.valid === true && aceptaTerminos &&
    captchaValue && !loading

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  function borderFor(valid, touched, value) {
    if (!touched || !value) return {}
    return {
      borderColor:
        valid === true  ? 'rgba(46,204,113,0.55)' :
        valid === false ? 'rgba(220,80,80,0.45)' :
        undefined,
    }
  }

  function switchTab(t) {
    setTab(t); setError(null); setSuccess(null)
    setCaptchaValue(null); recaptchaRef.current?.reset()
  }

  // Resolver de identifier — acepta correo o @username (idéntico al de AuthModal)
  async function resolveEmail(identifier) {
    if (identifier.includes('@')) return identifier
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?username=eq.${identifier}&select=email`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const data = await res.json()
    if (!data || data.length === 0) throw new Error('Usuario no encontrado')
    return data[0].email
  }

  async function handleLogin() {
    if (!captchaValue) { setError('Por favor completa el captcha'); return }
    setLoading(true); setError(null)
    try {
      const email = await resolveEmail(loginIdentifier.trim())
      await signIn({ email, password: loginPassword })
      onClose()
    } catch (err) {
      setError(err.message === 'Usuario no encontrado'
        ? 'Usuario no encontrado'
        : 'Correo, usuario o contraseña incorrectos')
      recaptchaRef.current?.reset(); setCaptchaValue(null)
    } finally { setLoading(false) }
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (!captchaValue)   { setError('Por favor completa el captcha'); return }
    if (!pwValid)        { setError('La contraseña no cumple los requisitos'); setPwTouched(true); return }
    if (!emailVal.valid) { setError('El correo no es válido'); setEmailTouched(true); return }
    if (!aceptaTerminos) { setError('Debes aceptar los términos y condiciones'); return }

    setError(null); setLoading(true)
    try {
      // 0. Username único
      if (username) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        const data = await res.json()
        if (data && data.length > 0) throw new Error('Ese nombre de usuario ya está en uso')
      }

      // 1. signUp — crea auth.users (trigger BD probablemente crea profiles
      // con rol='abogado' default; lo sobreescribimos en el paso 3)
      const { error: signUpError } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: { data: { nombre, apellido, username, telefono } },
      })
      if (signUpError) throw new Error(signUpError.message || 'Error al crear cuenta')

      // 2. Sign-in temporal para obtener token (necesario para UPSERT)
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: regEmail,
        password: regPassword,
      })
      if (signInError || !signInData?.user?.id) {
        // Email confirmation activada o flujo diferente: no podemos fijar rol
        setSuccess('Cuenta creada. Cuando confirmes tu correo e inicies sesión, contacta al administrador para fijar tu rol como contador.')
        return
      }
      const userId = signInData.user.id

      // 3. UPSERT en profiles: fija rol='contador' (especialidades y tarjeta
      // se completan luego en /perfil-contador)
      const headers = await getAuthHeaders()
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          id: userId,
          nombre, apellido, username, telefono,
          email: regEmail,
          rol: 'contador',
          aprobado: false,
        }),
      })
      if (!upsertRes.ok) {
        const errBody = await upsertRes.json().catch(() => ({}))
        throw new Error(errBody.message || 'No se pudo crear el perfil de contador')
      }

      // 4. signOut — el usuario debe iniciar sesión formalmente
      await supabase.auth.signOut()

      setSuccess('¡Registro exitoso! Tu perfil quedó pendiente de aprobación. Ya puedes iniciar sesión.')
    } catch (err) {
      setError(err.message || 'Error al registrarse')
      recaptchaRef.current?.reset()
      setCaptchaValue(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Cerrar"><IconX /></button>

        <p className={styles.eyebrow}>Abogados y Asociados Parada</p>
        <h3 className={styles.title}>
          {tab === 'login' ? 'Bienvenido' : 'Crear perfil como Contador'}
        </h3>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === 'login' ? styles.active : ''}`}
            onClick={() => switchTab('login')}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === 'register' ? styles.active : ''}`}
            onClick={() => switchTab('register')}
          >
            Registrarse
          </button>
        </div>

        {error   && <p className={styles.msgError}>{error}</p>}
        {success && <p className={styles.msgSuccess}>{success}</p>}

        {/* ══════════════════ LOGIN ══════════════════ */}
        {tab === 'login' && !success && (
          <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
            <div className={styles.field}>
              <label className={styles.label}>Correo o usuario</label>
              <input type="text" className={styles.input}
                placeholder="correo@ejemplo.com o @usuario"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Contraseña</label>
              <div className={styles.pwWrap}>
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className={styles.pwToggle}
                  onClick={() => setShowLoginPassword(s => !s)}
                  aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showLoginPassword ? (
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
              </div>
            </div>
            <div style={{ textAlign: 'center', margin: '20px 0' }}>
              <ReCAPTCHA ref={recaptchaRef} sitekey="6Lc50NEsAAAAANHXeDejrPO9up93HP9tlMDzFXON"
                onChange={(v) => setCaptchaValue(v)} />
            </div>
            <button type="button" className={`btn-solid ${styles.submit}`}
              disabled={loading || !captchaValue} onClick={handleLogin}>
              {loading ? 'Ingresando...' : 'Ingresar →'}
            </button>
            <p className={styles.hint}>¿Olvidó su contraseña? <a href="#" className={styles.hintLink}>Recuperar</a></p>
          </form>
        )}

        {/* ══════════════════ REGISTRO ══════════════════ */}
        {tab === 'register' && !success && (
          <form className={styles.form} onSubmit={handleRegister}>

            {/* Nombre + Apellido */}
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre <span className={styles.req}>*</span></label>
                <input type="text" className={styles.input} placeholder="Nombre"
                  value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido <span className={styles.req}>*</span></label>
                <input type="text" className={styles.input} placeholder="Apellido"
                  value={apellido} onChange={(e) => setApellido(e.target.value)} required />
              </div>
            </div>

            {/* Username */}
            <div className={styles.field}>
              <label className={styles.label}>Nombre de usuario <span className={styles.req}>*</span></label>
              <input type="text" className={styles.input} placeholder="@usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())} required />
            </div>

            {/* Teléfono */}
            <div className={styles.field}>
              <label className={styles.label}>Celular</label>
              <input
                type="tel"
                inputMode="numeric"
                className={styles.input}
                placeholder="3001234567"
                value={telefono}
                onChange={(e) => setTelefono(normalizarCelular(e.target.value))}
                onBlur={() => setTelTouched(true)}
                maxLength={10}
                style={borderFor(telVal.valid, telTouched, telefono)}
              />
              <FieldHint valid={telVal.valid} msg={telVal.msg} touched={telTouched && !!telefono} />
            </div>

            {/* Correo */}
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico <span className={styles.req}>*</span></label>
              <input
                type="email"
                className={styles.input}
                placeholder="correo@ejemplo.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                required
                style={borderFor(emailVal.valid, emailTouched, regEmail)}
              />
              <FieldHint valid={emailVal.valid} msg={emailVal.msg} touched={emailTouched && !!regEmail} />
            </div>

            {/* Contraseña con checklist (idéntico al de abogado) */}
            <div className={styles.field}>
              <label className={styles.label}>Contraseña <span className={styles.req}>*</span></label>
              <div className={styles.pwWrap}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="Mínimo 8 caracteres"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  onFocus={() => setPwTouched(true)}
                  required
                  autoComplete="new-password"
                  style={{
                    paddingRight: '2.4rem',
                    ...(pwTouched && regPassword
                      ? { borderColor: pwValid ? 'rgba(46,204,113,0.55)' : 'rgba(220,80,80,0.4)' }
                      : {}),
                  }}
                />
                <button type="button" className={styles.pwToggle}
                  onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                  <EyeIcon open={showPassword} />
                </button>
              </div>

              {showPwList && pwStrength && (
                <div className={styles.strengthRow}>
                  <div className={styles.strengthBars}>
                    {[1,2,3].map(lvl => (
                      <div key={lvl} className={styles.strengthBar}
                        style={{ background: pwStrength.level >= lvl ? pwStrength.color : 'rgba(255,255,255,0.1)' }} />
                    ))}
                  </div>
                  <span className={styles.strengthLabel} style={{ color: pwStrength.color }}>
                    {pwStrength.label}
                  </span>
                </div>
              )}

              {showPwList && (
                <ul className={styles.pwChecklist}>
                  {pwRules.map(rule => (
                    <li key={rule.id}
                      className={`${styles.pwItem} ${rule.ok ? styles.pwItemOk : styles.pwItemPending}`}>
                      <span className={styles.pwIcon}>{rule.ok ? '✓' : '○'}</span>
                      <span>{rule.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Términos */}
            <label className={styles.terminosRow}>
              <input
                type="checkbox"
                checked={aceptaTerminos}
                onChange={e => setAceptaTerminos(e.target.checked)}
                className={styles.terminosCheck}
              />
              <span className={styles.terminosTxt}>
                Acepto los{' '}
                <a href="/terminos" target="_blank" rel="noopener noreferrer" className={styles.terminosLink}>
                  términos y condiciones
                </a>{' '}
                y la{' '}
                <a href="/privacidad" target="_blank" rel="noopener noreferrer" className={styles.terminosLink}>
                  política de privacidad
                </a>
              </span>
            </label>

            {/* Captcha */}
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              <ReCAPTCHA ref={recaptchaRef} sitekey="6Lc50NEsAAAAANHXeDejrPO9up93HP9tlMDzFXON"
                onChange={(v) => setCaptchaValue(v)} />
            </div>

            <button type="submit" className={`btn-solid ${styles.submit}`} disabled={!canRegister}>
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
