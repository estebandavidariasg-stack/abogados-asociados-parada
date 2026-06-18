import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import styles from './RegisterContadorModal.module.css'
import ReCAPTCHA from 'react-google-recaptcha'
import { IconX } from '../shared/Icons'
import VerificationStep from './VerificationStep'
import {
  PASSWORD_RULES, getPasswordStrength, isPasswordValid,
  validarCelular, validarCorreo, normalizarCelular,
} from '../../lib/validaciones'

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

  // ── Verificación por código (Paso B del flujo) ─────────────────────────
  const [verificationStep, setVerificationStep] = useState('form')   // 'form' | 'verify' | 'done'
  const [otpError, setOtpError]                 = useState('')
  const [otpSubmitting, setOtpSubmitting]       = useState(false)
  const [emailErrorInline, setEmailErrorInline] = useState('')

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
    // Reset del flujo de verificación al cambiar de pestaña
    setVerificationStep('form'); setOtpError(''); setEmailErrorInline('')
  }

  // Resolver de identifier — acepta correo o @username (idéntico al de AuthModal)
  async function resolveEmail(identifier) {
    if (identifier.includes('@')) return identifier
    // Resolución usuario -> correo vía RPC SECURITY DEFINER. La lectura directa
    // de `profiles` con la anon está restringida por RLS a perfiles APROBADOS,
    // así que un profesional recién registrado (pendiente) no podía iniciar
    // sesión por usuario. El RPC devuelve solo el correo de UN usuario.
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

  // ── Paso A: validar el formulario y enviar el código de verificación ─
  async function handleRegister(e) {
    e.preventDefault()
    if (!captchaValue)   { setError('Por favor completa el captcha'); return }
    if (!pwValid)        { setError('La contraseña no cumple los requisitos'); setPwTouched(true); return }
    if (!emailVal.valid) { setError('El correo no es válido'); setEmailTouched(true); return }
    if (!aceptaTerminos) { setError('Debes aceptar los términos y condiciones'); return }

    setError(null); setEmailErrorInline(''); setLoading(true)
    try {
      // Username único — chequeo previo al envío del código
      if (username) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        const data = await res.json()
        if (data && data.length > 0) throw new Error('Ese nombre de usuario ya está en uso')
      }
      await sendVerificationCode()
    } catch (err) {
      if (err.message) setError(err.message)
      recaptchaRef.current?.reset()
      setCaptchaValue(null)
    } finally {
      setLoading(false)
    }
  }

  // POST /api/send-verification-code — extraído para reutilizar en
  // "Reenviar código" desde la pantalla de verificación.
  // El recaptchaToken se valida server-side; sin él, 403 y spam de OTPs trivial.
  async function sendVerificationCode() {
    const res = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: regEmail.trim(),
        tipoRegistro: 'contador',
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

  // ── Paso B → Paso C: validar el OTP y, si pasa, crear la cuenta ─────
  async function handleVerifyCode(code) {
    setOtpSubmitting(true); setOtpError('')
    try {
      // 1. Verificar el código contra el endpoint
      const verifyRes = await fetch('/api/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regEmail.trim(), code }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.error || 'Código inválido o expirado')
      }

      // 2. Verificación OK — crear la cuenta de contador (mismo flujo
      //    que el handleRegister anterior, pero ahora gateado por OTP)
      await actuallyCreateContadorAccount()

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

  // ── Paso C: secuencia signUp → signIn temporal → UPSERT con rol=contador
  //    → signOut. Idéntica al flujo previo, sólo extraída para que
  //    handleVerifyCode la dispare después de validar el OTP.
  async function actuallyCreateContadorAccount() {
    // 1. signUp — crea auth.users (el trigger crea la fila en profiles
    //    con rol='abogado' por defecto; lo corregimos en el paso 3).
    const { error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { data: { nombre, apellido, username, telefono } },
    })
    if (signUpError) throw new Error(signUpError.message || 'Error al crear cuenta')

    // 2. Sign-in temporal para obtener token (necesario para UPSERT con
    //    políticas RLS que requieran auth.uid() = id)
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: regEmail,
      password: regPassword,
    })
    if (signInError || !signInData?.user?.id) {
      throw new Error('Cuenta creada pero no se pudo fijar el rol. Contacta al administrador.')
    }
    const userId = signInData.user.id

    // 3. UPSERT en profiles: fija rol='contador'
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

    // 4. signOut — el usuario debe iniciar sesión formalmente cuando lo
    //    apruebe el administrador
    await supabase.auth.signOut()
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
              Tu cuenta está pendiente de aprobación por el administrador.
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
