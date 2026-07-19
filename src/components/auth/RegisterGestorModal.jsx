import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase, getAuthHeaders } from '../../lib/supabase'
// Reutilizamos el CSS del modal de contador para mantener EXACTAMENTE la misma
// estética (overlay, tarjeta, campos, checklist de contraseña, etc.).
import styles from './RegisterContadorModal.module.css'
import ReCAPTCHA from 'react-google-recaptcha'
import { IconX } from '../shared/Icons'
import VerificationStep from './VerificationStep'
import {
  PASSWORD_RULES, getPasswordStrength, isPasswordValid, validarCorreo,
} from '../../lib/validaciones'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

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

// Cédula colombiana: 6–12 dígitos.
function validarCedula(v) {
  const raw = String(v || '').trim()
  if (!raw) return { valid: null, msg: '' }
  if (!/^\d{6,12}$/.test(raw)) return { valid: false, msg: 'Debe tener entre 6 y 12 dígitos.' }
  return { valid: true, msg: 'Cédula válida' }
}

export default function RegisterGestorModal({ onClose }) {
  const { signIn } = useAuth()

  const [tab, setTab]         = useState('register')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(null)

  // Login
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword,   setLoginPassword]   = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)

  // Registro — solo datos básicos: usuario, correo, contraseña, cédula.
  const [username, setUsername]           = useState('')
  const [cedula, setCedula]               = useState('')
  const [regEmail, setRegEmail]           = useState('')
  const [regPassword, setRegPassword]     = useState('')
  const [showPassword, setShowPassword]   = useState(false)
  const [pwTouched, setPwTouched]         = useState(false)
  const [emailTouched, setEmailTouched]   = useState(false)
  const [cedulaTouched, setCedulaTouched] = useState(false)
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [captchaValue, setCaptchaValue]   = useState(null)

  // Redes sociales (opcionales) — mismas claves que SocialLinks.jsx.
  const [instagram, setInstagram] = useState('')
  const [linkedin,  setLinkedin]  = useState('')
  const [facebook,  setFacebook]  = useState('')
  const [twitter,   setTwitter]   = useState('')
  const [whatsapp,  setWhatsapp]  = useState('')
  const [tiktok,    setTiktok]    = useState('')

  // ¿Manejas alguna comunidad? (máx 500) → profiles.comunidad_descripcion.
  const [comunidad, setComunidad] = useState('')
  const COMUNIDAD_MAX = 500

  const recaptchaRef = useRef()

  const [verificationStep, setVerificationStep] = useState('form')
  const [otpError, setOtpError]                 = useState('')
  const [otpSubmitting, setOtpSubmitting]       = useState(false)
  const [emailErrorInline, setEmailErrorInline] = useState('')

  const pwRules    = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(regPassword) }))
  const pwStrength = getPasswordStrength(regPassword)
  const pwValid    = isPasswordValid(regPassword)
  const emailVal   = validarCorreo(regEmail)
  const cedulaVal  = validarCedula(cedula)
  const showPwList = pwTouched && regPassword.length > 0

  const canRegister =
    pwValid && emailVal.valid === true && cedulaVal.valid === true &&
    username.trim() && aceptaTerminos && captchaValue && !loading

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
    setVerificationStep('form'); setOtpError(''); setEmailErrorInline('')
  }

  async function resolveEmail(identifier) {
    if (identifier.includes('@')) return identifier
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_login_email`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_username: identifier }),
    })
    const email = res.ok ? await res.json() : null
    if (!email || typeof email !== 'string') throw new Error('Usuario no encontrado')
    return email
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
    if (!captchaValue)          { setError('Por favor completa el captcha'); return }
    if (!username.trim())       { setError('Elige un nombre de usuario'); return }
    if (cedulaVal.valid !== true) { setError('Ingresa una cédula válida (6–12 dígitos)'); setCedulaTouched(true); return }
    if (!pwValid)               { setError('La contraseña no cumple los requisitos'); setPwTouched(true); return }
    if (!emailVal.valid)        { setError('El correo no es válido'); setEmailTouched(true); return }
    if (!aceptaTerminos)        { setError('Debes aceptar los términos y condiciones'); return }

    setError(null); setEmailErrorInline(''); setLoading(true)
    try {
      // Username único — chequeo previo al envío del código.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const data = await res.json()
      if (data && data.length > 0) throw new Error('Ese nombre de usuario ya está en uso')
      await sendVerificationCode()
    } catch (err) {
      if (err.message) setError(err.message)
      recaptchaRef.current?.reset()
      setCaptchaValue(null)
    } finally {
      setLoading(false)
    }
  }

  async function sendVerificationCode() {
    const res = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: regEmail.trim(),
        tipoRegistro: 'gestor',
        recaptchaToken: captchaValue,
      }),
    })

    if (res.status === 409) {
      setEmailErrorInline('Este correo ya está registrado')
      setEmailTouched(true)
      throw new Error('')
    }
    if (res.status === 429) {
      setEmailErrorInline('Demasiados intentos. Espera 10 minutos antes de pedir otro código.')
      throw new Error('')
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'No se pudo enviar el código')
    }

    setVerificationStep('verify')
    setOtpError('')
  }

  async function handleVerifyCode(code) {
    setOtpSubmitting(true); setOtpError('')
    try {
      const verifyRes = await fetch('/api/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regEmail.trim(), code }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.error || 'Código inválido o expirado')
      }

      await actuallyCreateGestorAccount()
      setVerificationStep('done')
    } catch (err) {
      setOtpError(err.message || 'Código inválido o expirado')
    } finally {
      setOtpSubmitting(false)
    }
  }

  async function handleResendCode() {
    setOtpError('')
    try {
      await sendVerificationCode()
    } catch (err) {
      if (err.message) setOtpError(err.message)
      throw err
    }
  }

  async function actuallyCreateGestorAccount() {
    const { error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { data: { username } },
    })
    if (signUpError) throw new Error(signUpError.message || 'Error al crear cuenta')

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: regEmail,
      password: regPassword,
    })
    if (signInError || !signInData?.user?.id) {
      throw new Error('Cuenta creada pero no se pudo fijar el rol. Contacta al administrador.')
    }
    const userId = signInData.user.id

    const headers = await getAuthHeaders()
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: userId,
        username,
        cedula,
        email: regEmail,
        rol: 'gestor',
        aprobado: false,
        // Redes sociales (opcionales) + descripción de comunidad.
        instagram: instagram.trim() || null,
        linkedin:  linkedin.trim()  || null,
        facebook:  facebook.trim()  || null,
        twitter:   twitter.trim()   || null,
        whatsapp:  whatsapp.trim()  || null,
        tiktok:    tiktok.trim()    || null,
        comunidad_descripcion: comunidad.trim() || null,
      }),
    })
    if (!upsertRes.ok) {
      const errBody = await upsertRes.json().catch(() => ({}))
      throw new Error(errBody.message || 'No se pudo crear el perfil de gestor')
    }

    await supabase.auth.signOut()
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Cerrar"><IconX /></button>

        <p className={styles.eyebrow}><span style={{ color: 'var(--navy)' }}>Parada</span> Bridge</p>
        <h3 className={styles.title}>
          {tab === 'login' ? 'Bienvenido' : 'Crear perfil como Gestor'}
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
                  <EyeIcon open={showLoginPassword} />
                </button>
              </div>
            </div>
            <div className={styles.captchaWrap}>
              <ReCAPTCHA
                ref={recaptchaRef}
                sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6LeCveUsAAAAAHPFzHpB8KrLMaNEu0E7UORrkgMA'}
                onChange={(v) => setCaptchaValue(v)}
              />
            </div>
            <button type="button" className={`btn-solid ${styles.submit}`}
              disabled={loading || !captchaValue} onClick={handleLogin}>
              {loading ? 'Ingresando...' : 'Ingresar →'}
            </button>
            <p className={styles.hint}>¿Olvidó su contraseña? <a href="#" className={styles.hintLink}>Recuperar</a></p>
          </form>
        )}

        {/* ══════════════════ REGISTRO — Paso B (verificación) ══════════════════ */}
        {tab === 'register' && !success && verificationStep === 'verify' && (
          <VerificationStep
            email={regEmail}
            error={otpError}
            submitting={otpSubmitting}
            onSubmit={handleVerifyCode}
            onResend={handleResendCode}
            onBack={() => { setVerificationStep('form'); setOtpError('') }}
          />
        )}

        {/* ══════════════════ REGISTRO — Paso C (cuenta creada) ══════════════════ */}
        {tab === 'register' && !success && verificationStep === 'done' && (
          <div className={styles.form} style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{
              width: 64, height: 64, margin: '0 auto 16px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(201,168,76,0.20), rgba(201,168,76,0.06))',
              border: '2px solid #c9a84c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, color: '#c9a84c', fontWeight: 'bold', lineHeight: 1,
              boxShadow: '0 0 16px rgba(201,168,76,0.25)',
            }}>✓</div>
            <h3 style={{
              fontFamily: "'Cinzel', Georgia, serif",
              color: '#c9a84c', fontSize: '1.15rem',
              letterSpacing: '0.06em', margin: '0 0 10px',
            }}>¡Registro completado!</h3>
            <p style={{
              color: '#ffffff', fontSize: 14, lineHeight: 1.6,
              margin: '0 0 22px', padding: '0 4px',
            }}>
              Tu cuenta de gestor está pendiente de aprobación por el administrador.
              Te avisaremos por correo cuando esté lista.
            </p>
            <button
              type="button"
              className={`btn-solid ${styles.submit}`}
              onClick={onClose}
            >
              Ir al inicio
            </button>
          </div>
        )}

        {/* ══════════════════ REGISTRO — Paso A (formulario) ══════════════════ */}
        {tab === 'register' && !success && verificationStep === 'form' && (
          <form className={styles.form} onSubmit={handleRegister}>

            {/* Usuario */}
            <div className={styles.field}>
              <label className={styles.label}>Nombre de usuario <span className={styles.req}>*</span></label>
              <input type="text" className={styles.input} placeholder="@usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())} required />
            </div>

            {/* Cédula */}
            <div className={styles.field}>
              <label className={styles.label}>Cédula <span className={styles.req}>*</span></label>
              <input
                type="text"
                inputMode="numeric"
                className={styles.input}
                placeholder="Número de cédula"
                value={cedula}
                onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))}
                onBlur={() => setCedulaTouched(true)}
                maxLength={12}
                required
                style={borderFor(cedulaVal.valid, cedulaTouched, cedula)}
              />
              <FieldHint valid={cedulaVal.valid} msg={cedulaVal.msg} touched={cedulaTouched && !!cedula} />
            </div>

            {/* Correo */}
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico <span className={styles.req}>*</span></label>
              <input
                type="email"
                className={styles.input}
                placeholder="correo@ejemplo.com"
                value={regEmail}
                onChange={(e) => { setRegEmail(e.target.value); setEmailErrorInline('') }}
                onBlur={() => setEmailTouched(true)}
                required
                style={emailErrorInline
                  ? { borderColor: 'rgba(220,80,80,0.55)' }
                  : borderFor(emailVal.valid, emailTouched, regEmail)}
              />
              {emailErrorInline ? (
                <span style={{
                  fontSize: '0.72rem', marginTop: 4,
                  display: 'flex', alignItems: 'center', gap: 4,
                  color: 'rgba(220,100,80,0.95)',
                }}>
                  ⚠ {emailErrorInline}
                </span>
              ) : (
                <FieldHint valid={emailVal.valid} msg={emailVal.msg} touched={emailTouched && !!regEmail} />
              )}
            </div>

            {/* Contraseña con checklist */}
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

            {/* ¿Manejas alguna comunidad? */}
            <div className={styles.field}>
              <label className={styles.label}>¿Manejas alguna comunidad?</label>
              <textarea
                className={styles.input}
                rows={3}
                maxLength={COMUNIDAD_MAX}
                placeholder="Cuéntanos brevemente. Ej: soy líder comunal, dirijo una fundación o asociación, coordino un colectivo, JAC, grupo religioso, sindicato, cooperativa…"
                value={comunidad}
                onChange={(e) => setComunidad(e.target.value.slice(0, COMUNIDAD_MAX))}
                style={{ resize: 'vertical', minHeight: 76, fontFamily: 'inherit' }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 8,
                marginTop: 4, fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)',
              }}>
                <span>Nos ayuda a entender tu alcance como gestor.</span>
                <span style={{ color: comunidad.length >= COMUNIDAD_MAX ? 'rgba(220,120,100,0.95)' : 'rgba(201,168,76,0.9)' }}>
                  {comunidad.length}/{COMUNIDAD_MAX}
                </span>
              </div>
            </div>

            {/* Redes sociales (opcionales) */}
            <div className={styles.field}>
              <label className={styles.label}>
                Redes sociales <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(opcional)</span>
              </label>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { ph: 'https://instagram.com/tu_usuario',  value: instagram, set: setInstagram },
                  { ph: 'https://linkedin.com/in/tu_perfil', value: linkedin,  set: setLinkedin  },
                  { ph: 'https://facebook.com/tu_perfil',    value: facebook,  set: setFacebook  },
                  { ph: 'https://x.com/tu_usuario',          value: twitter,   set: setTwitter   },
                  { ph: 'https://wa.me/57300…',              value: whatsapp,  set: setWhatsapp  },
                  { ph: 'https://tiktok.com/@tu_usuario',    value: tiktok,    set: setTiktok    },
                ].map(({ ph, value, set }) => (
                  <input
                    key={ph}
                    type="url"
                    className={styles.input}
                    placeholder={ph}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                ))}
              </div>
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
            <div className={styles.captchaWrap}>
              <ReCAPTCHA
                ref={recaptchaRef}
                sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6LeCveUsAAAAAHPFzHpB8KrLMaNEu0E7UORrkgMA'}
                onChange={(v) => setCaptchaValue(v)}
              />
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
