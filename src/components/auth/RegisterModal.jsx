import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import { compressImage } from '../../utils/compressMedia'
// Reutilizamos EXACTAMENTE la estética del AuthModal (overlay, tarjeta, campos,
// checklist de contraseña, términos, captcha, etc.).
import styles from './AuthModal.module.css'
import extra from './RegisterModal.module.css'
import ReCAPTCHA from 'react-google-recaptcha'
import { IconX } from '../shared/Icons'
import VerificationStep from './VerificationStep'
import { AREAS_DERECHO } from '../../lib/areasDerecho'
import { AREAS_CONTADURIA } from '../../lib/areasContaduria'
import {
  PASSWORD_RULES, getPasswordStrength, isPasswordValid,
  validarCelular, validarCorreo, normalizarCelular,
} from '../../lib/validaciones'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Opciones de experiencia — idénticas a las del perfil (ProfilePage.jsx)
const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año', '1 - 3 años', '3 - 5 años',
  '5 - 10 años', '10 - 15 años', 'Más de 15 años',
]

const COMUNIDAD_MAX = 500

// ── Ícono ojo ─────────────────────────────────────────────────────────────
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

// Cédula colombiana: 6–12 dígitos (obligatoria para los 3 roles).
function validarCedula(v) {
  const raw = String(v || '').trim()
  if (!raw) return { valid: null, msg: '' }
  if (!/^\d{6,12}$/.test(raw)) return { valid: false, msg: 'Debe tener entre 6 y 12 dígitos.' }
  return { valid: true, msg: 'Cédula válida' }
}

// ── Iconos de rol ──────────────────────────────────────────────────────────
const IconAbogado = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M4 7h16M6 7l-3 6a3 3 0 0 0 6 0L6 7zM18 7l-3 6a3 3 0 0 0 6 0l-3-6z"/>
  </svg>
)
const IconContador = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3"/>
  </svg>
)
const IconGestor = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const ROLES = [
  { key: 'abogado',  label: 'Abogado',  Icon: IconAbogado  },
  { key: 'contador', label: 'Contador', Icon: IconContador },
  { key: 'gestor',   label: 'Gestor',   Icon: IconGestor   },
]

const ROLE_TITLE = {
  abogado:  'Crear perfil como Abogado',
  contador: 'Crear perfil como Contador',
  gestor:   'Crear perfil como Gestor',
}

export default function RegisterModal({ onClose }) {
  // rol seleccionado en el paso inicial. null = aún elige rol.
  const [rol, setRol] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  // ── Campos comunes ──────────────────────────────────────────────────────
  const [nombre, setNombre]           = useState('')
  const [apellido, setApellido]       = useState('')
  const [username, setUsername]       = useState('')
  const [telefono, setTelefono]       = useState('')
  const [regEmail, setRegEmail]       = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pwTouched, setPwTouched]     = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [telTouched, setTelTouched]   = useState(false)
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [captchaValue, setCaptchaValue] = useState(null)

  // ── Campos de profesional (abogado / contador) ──────────────────────────
  const [areas, setAreas]             = useState([])          // string[]
  const [experiencia, setExperiencia] = useState('')
  const [tarjetaFile, setTarjetaFile] = useState(null)        // File | null
  const tarjetaInputRef = useRef(null)

  // ── Campos de gestor ────────────────────────────────────────────────────
  const [cedula, setCedula]           = useState('')
  const [cedulaTouched, setCedulaTouched] = useState(false)
  const [instagram, setInstagram]     = useState('')
  const [linkedin, setLinkedin]       = useState('')
  const [facebook, setFacebook]       = useState('')
  const [twitter, setTwitter]         = useState('')
  const [whatsapp, setWhatsapp]       = useState('')
  const [tiktok, setTiktok]           = useState('')
  const [comunidad, setComunidad]     = useState('')

  const recaptchaRef = useRef()

  // ── Flujo OTP ──────────────────────────────────────────────────────────
  // 'docs' = paso post-OTP del profesional: foto + certificados + oficina.
  const [verificationStep, setVerificationStep] = useState('form') // 'form' | 'verify' | 'docs' | 'done'
  const [otpError, setOtpError]                 = useState('')
  const [otpSubmitting, setOtpSubmitting]       = useState(false)
  const [emailErrorInline, setEmailErrorInline] = useState('')

  // ── Paso 'docs' (solo abogado/contador, con la sesión temporal viva) ────
  const [newUserId, setNewUserId]         = useState(null)
  const [fotoFile, setFotoFile]           = useState(null)   // File comprimido
  const [fotoPreview, setFotoPreview]     = useState(null)
  const [certBancFile, setCertBancFile]   = useState(null)
  const [certDiscFile, setCertDiscFile]   = useState(null)
  const [direccionOficina, setDireccionOficina] = useState('')
  const [paginaWeb, setPaginaWeb]         = useState('')
  const [docsSubmitting, setDocsSubmitting] = useState(false)
  const [docsError, setDocsError]         = useState('')
  const fotoInputRef     = useRef(null)
  const certBancInputRef = useRef(null)
  const certDiscInputRef = useRef(null)

  // Validaciones derivadas
  const pwRules    = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(regPassword) }))
  const pwStrength = getPasswordStrength(regPassword)
  const pwValid    = isPasswordValid(regPassword)
  const emailVal   = validarCorreo(regEmail)
  const telVal     = validarCelular(telefono)
  const cedulaVal  = validarCedula(cedula)
  const showPwList = pwTouched && regPassword.length > 0

  const isPro = rol === 'abogado' || rol === 'contador'

  const canRegister = (() => {
    const base = pwValid && emailVal.valid === true && aceptaTerminos && captchaValue && !loading
    if (!base) return false
    if (rol === 'gestor') return cedulaVal.valid === true && !!username.trim()
    // Profesional: nombre, apellido, cédula, celular y tarjeta son obligatorios.
    return !!nombre.trim() && !!apellido.trim() && !!username.trim()
      && cedulaVal.valid === true && telVal.valid === true && !!tarjetaFile
  })()

  const AREAS_LIST = rol === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  })

  function borderFor(valid, touched, value) {
    if (!touched || !value) return {}
    return {
      borderColor:
        valid === true  ? 'rgba(46,204,113,0.55)' :
        valid === false ? 'rgba(220,80,80,0.45)' :
        undefined,
    }
  }

  function toggleArea(a) {
    setAreas(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
  }

  function onTarjetaChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Formato de tarjeta no permitido. Usa PDF, PNG, JPG o WEBP.'); return
    }
    if (file.size / (1024 * 1024) > 10) {
      setError('La tarjeta no puede superar 10 MB'); return
    }
    setError(null)
    setTarjetaFile(file)
  }

  // Al elegir rol, limpiamos estado del formulario para evitar arrastres.
  function pickRole(r) {
    setRol(r)
    setError(null); setEmailErrorInline('')
    setAreas([]); setExperiencia(''); setTarjetaFile(null)
    setVerificationStep('form'); setOtpError('')
    setCaptchaValue(null); recaptchaRef.current?.reset()
  }

  // ── Paso A: validar formulario y enviar el código de verificación ────────
  async function handleRegister(e) {
    e.preventDefault()
    if (!captchaValue)   { setError('Por favor completa el captcha'); return }
    if (rol === 'gestor') {
      if (!username.trim())         { setError('Elige un nombre de usuario'); return }
      if (cedulaVal.valid !== true) { setError('Ingresa una cédula válida (6–12 dígitos)'); setCedulaTouched(true); return }
    }
    if (isPro) {
      if (cedulaVal.valid !== true) { setError('Ingresa una cédula válida (6–12 dígitos)'); setCedulaTouched(true); return }
      if (telVal.valid !== true)    { setError('Ingresa un celular válido (10 dígitos, empieza por 3)'); setTelTouched(true); return }
      if (!tarjetaFile)             { setError('Adjunta tu tarjeta profesional (PDF o imagen)'); return }
    }
    if (!pwValid)        { setError('La contraseña no cumple los requisitos'); setPwTouched(true); return }
    if (!emailVal.valid) { setError('El correo no es válido'); setEmailTouched(true); return }
    if (!aceptaTerminos) { setError('Debes aceptar los términos y condiciones'); return }

    setError(null); setEmailErrorInline(''); setLoading(true)
    try {
      // Username único — chequeo previo al envío del código.
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
      recaptchaRef.current?.reset(); setCaptchaValue(null)
    } finally {
      setLoading(false)
    }
  }

  // POST /api/send-verification-code — reutilizado por "Reenviar código".
  async function sendVerificationCode() {
    const res = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: regEmail.trim(),
        tipoRegistro: rol,          // 'abogado' | 'contador' | 'gestor'
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

  // ── Paso B → Paso C: validar OTP y, si pasa, crear la cuenta ─────────────
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

      // Verificación OK — recién ahora creamos la cuenta.
      await actuallyCreateAccount()
      // Profesional: sigue el paso de foto + certificados (sesión temporal
      // viva). Gestor: directo a la pantalla final.
      setVerificationStep(isPro ? 'docs' : 'done')
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

  // ── Paso C: signUp → signIn temporal → (subir tarjeta) → UPSERT perfil
  //    con el rol correcto → signOut. Un solo camino para los 3 roles.
  async function actuallyCreateAccount() {
    // 1. signUp — crea auth.users. El trigger crea la fila en profiles con
    //    rol='abogado' por defecto; la corregimos en el UPSERT (paso 4).
    const metaData =
      rol === 'gestor'
        ? { username }
        : { nombre, apellido, username, telefono }
    const { error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { data: metaData },
    })
    if (signUpError) throw new Error(signUpError.message || 'Error al crear cuenta')

    // 2. Sign-in temporal para obtener token (necesario para el UPSERT y para
    //    subir la tarjeta al bucket privado con RLS auth.uid() = folder).
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: regEmail,
      password: regPassword,
    })
    if (signInError || !signInData?.user?.id) {
      throw new Error('Cuenta creada pero no se pudo fijar el rol. Contacta al administrador.')
    }
    const userId = signInData.user.id

    // 3. Subir la tarjeta profesional (si aplica y se adjuntó). Mismo path y
    //    bucket que ProfilePage: `<userId>/tarjeta.<ext>` en
    //    tarjetas-profesionales. Guardamos el PATH (bucket privado → se firma
    //    on demand al visualizar en el perfil).
    let tarjetaPath = null
    if (isPro && tarjetaFile) {
      const headers = await getAuthHeaders()
      const ext  = tarjetaFile.name.split('.').pop().toLowerCase()
      const path = `${userId}/tarjeta.${ext}`
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': tarjetaFile.type, 'x-upsert': 'true' },
          body: tarjetaFile,
        }
      )
      // La tarjeta es opcional: si falla la subida, no abortamos la cuenta.
      if (upRes.ok) tarjetaPath = path
    }

    // 4. UPSERT en profiles con el rol y campos correctos.
    const headers = await getAuthHeaders()
    const payload = {
      id: userId,
      username,
      email: regEmail,
      rol,
      aprobado: false,
    }

    if (isPro) {
      Object.assign(payload, {
        nombre, apellido, telefono, cedula,
        // area_derecho guarda la lista separada por comas (para contador
        // significa especialidades contables — misma columna, ver CLAUDE.md).
        area_derecho: areas.length ? areas.join(', ') : null,
        experiencia: experiencia || null,
        tarjeta_archivo_url: tarjetaPath,
      })
    } else {
      // Gestor: cédula + redes + comunidad.
      Object.assign(payload, {
        cedula,
        instagram: instagram.trim() || null,
        linkedin:  linkedin.trim()  || null,
        facebook:  facebook.trim()  || null,
        twitter:   twitter.trim()   || null,
        whatsapp:  whatsapp.trim()  || null,
        tiktok:    tiktok.trim()    || null,
        comunidad_descripcion: comunidad.trim() || null,
      })
    }

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    })
    if (!upsertRes.ok) {
      const errBody = await upsertRes.json().catch(() => ({}))
      throw new Error(errBody.message || 'No se pudo crear el perfil')
    }

    // 5. Profesional: la sesión temporal se conserva para el paso 'docs'
    //    (foto + certificados suben con RLS auth.uid() = folder). El signOut
    //    ocurre al terminar ese paso. Gestor: cierra sesión de una vez.
    setNewUserId(userId)
    if (!isPro) await supabase.auth.signOut()
  }

  // ── Paso 'docs': foto + certificados + oficina → PATCH perfil → signOut ──
  function onFotoChange(e) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    if (!raw.type.startsWith('image/')) { setDocsError('La foto debe ser una imagen.'); return }
    setDocsError('')
    // Comprime de una vez (≤1200px, JPEG) — mismo criterio que ProfilePage.
    compressImage(raw, 1200, 0.85, 'image/jpeg')
      .then(f => {
        setFotoFile(f)
        setFotoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
      })
      .catch(() => setDocsError('No se pudo procesar la foto. Intenta con otra imagen.'))
  }

  function onDocChange(e, set) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(file.type)) { setDocsError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setDocsError('El archivo no puede superar 10 MB.'); return }
    setDocsError('')
    set(file)
  }

  const canFinishDocs = !!fotoFile && !!certBancFile && !!certDiscFile && !docsSubmitting

  async function handleDocsSubmit(e) {
    e.preventDefault()
    if (!canFinishDocs || !newUserId) return
    setDocsSubmitting(true); setDocsError('')
    try {
      const headers = await getAuthHeaders()

      // 1. Foto de perfil → profile-photos/avatars/<uid>.jpg (bucket público).
      const fotoPath = `avatars/${newUserId}.jpg`
      const fotoRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/profile-photos/${fotoPath}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': fotoFile.type, 'x-upsert': 'true' }, body: fotoFile }
      )
      if (!fotoRes.ok) throw new Error('No se pudo subir la foto de perfil.')
      const fotoUrl = `${SUPABASE_URL}/storage/v1/object/public/profile-photos/${fotoPath}?t=${Date.now()}`

      // 2. Certificados → tarjetas-profesionales/<uid>/… (bucket privado).
      async function subirDoc(file, nombreBase) {
        const ext  = file.name.split('.').pop().toLowerCase()
        const path = `${newUserId}/${nombreBase}.${ext}`
        const res  = await fetch(
          `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
          { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
        )
        if (!res.ok) throw new Error(`No se pudo subir ${nombreBase.replace(/-/g, ' ')}.`)
        return path
      }
      const certBancPath = await subirDoc(certBancFile, 'certificados/certificado')
      const certDiscPath = await subirDoc(certDiscFile, 'certificado-disciplinario')

      // 3. PATCH del perfil con todo lo del paso.
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), Prefer: 'return=minimal' },
        body: JSON.stringify({
          foto_url: fotoUrl,
          certificado_bancario_url: certBancPath,
          certificado_disciplinario_url: certDiscPath,
          direccion_oficina: direccionOficina.trim() || null,
          pagina_web: paginaWeb.trim() || null,
        }),
      })
      if (!patchRes.ok) throw new Error('No se pudo guardar la información del perfil.')

      // 4. Fin: cerrar la sesión temporal y mostrar la pantalla final.
      await supabase.auth.signOut()
      setVerificationStep('done')
    } catch (err) {
      setDocsError(err.message || 'No se pudo completar el paso. Intenta de nuevo.')
    } finally {
      setDocsSubmitting(false)
    }
  }

  // Cerrar durante 'docs' dejaría el registro incompleto — confirmar y cerrar
  // la sesión temporal para no dejarla viva.
  async function handleClose() {
    if (verificationStep === 'docs') {
      const seguro = window.confirm(
        'Tu registro quedará incompleto sin la foto y los certificados. ' +
        'Podrás completarlos luego desde tu perfil, pero el administrador no podrá revisarte hasta entonces. ¿Salir de todas formas?'
      )
      if (!seguro) return
      try { await supabase.auth.signOut() } catch (_) { /* noop */ }
    }
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={handleClose} aria-label="Cerrar"><IconX /></button>

        <p className={styles.eyebrow}><span style={{ color: 'var(--navy)' }}>Parada</span> Bridge</p>
        <h3 className={styles.title}>
          {verificationStep === 'docs' ? 'Completa tu perfil' : rol ? ROLE_TITLE[rol] : 'Registrarse'}
        </h3>

        {error && <p className={styles.msgError}>{error}</p>}

        {/* ══════════════════ SELECTOR DE ROL ══════════════════ */}
        <div className={extra.roleSelector} style={verificationStep === 'docs' ? { display: 'none' } : undefined}>
          {ROLES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`${extra.roleBtn} ${rol === key ? extra.roleBtnActive : ''}`}
              onClick={() => { if (rol !== key) pickRole(key) }}
              aria-pressed={rol === key}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        {!rol && (
          <p className={styles.hint} style={{ marginBottom: '0.5rem' }}>
            Elige el tipo de perfil que deseas crear para continuar.
          </p>
        )}

        {/* ══════════════════ REGISTRO — Paso B (verificación) ══════════════════ */}
        {rol && verificationStep === 'verify' && (
          <VerificationStep
            email={regEmail}
            error={otpError}
            submitting={otpSubmitting}
            onSubmit={handleVerifyCode}
            onResend={handleResendCode}
            onBack={() => { setVerificationStep('form'); setOtpError('') }}
          />
        )}

        {/* ══════════ REGISTRO — Paso 'docs' (foto + certificados) ══════════ */}
        {rol && verificationStep === 'docs' && (
          <form className={styles.form} onSubmit={handleDocsSubmit}>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              Correo verificado ✓ — Sube lo que el administrador revisará para
              aprobar tu perfil. Así no tendrás que esperar una segunda revisión.
            </p>

            {/* Foto de perfil */}
            <div className={styles.field}>
              <label className={styles.label}>Foto de perfil <span className={styles.req}>*</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 72, height: 72, borderRadius: '50%', flex: '0 0 auto',
                    background: fotoPreview
                      ? `center / cover no-repeat url(${fotoPreview})`
                      : 'rgba(120,120,120,0.08)',
                    border: fotoPreview ? '2px solid #c9a84c' : '2px dashed rgba(120,120,120,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {!fotoPreview && (
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none"
                      stroke="#9a938c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <button type="button" className={extra.uploadBtn}
                    onClick={() => fotoInputRef.current?.click()}>
                    {fotoFile ? 'Cambiar foto' : 'Subir foto'}
                  </button>
                  <span style={{ fontSize: '0.68rem', opacity: 0.65 }}>
                    Aparecerá en tu tarjeta pública. JPG/PNG.
                  </span>
                </div>
              </div>
              <input ref={fotoInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={onFotoChange} />
            </div>

            {/* Certificado bancario */}
            <div className={styles.field}>
              <label className={styles.label}>
                Cuenta bancaria certificada <span className={styles.req}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
              </label>
              <button type="button" className={extra.uploadBtn}
                onClick={() => certBancInputRef.current?.click()}>
                {certBancFile ? 'Cambiar archivo' : 'Subir certificado bancario'}
              </button>
              <input ref={certBancInputRef} type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }} onChange={(e) => onDocChange(e, setCertBancFile)} />
              {certBancFile && <div className={extra.fileName}>✓ {certBancFile.name}</div>}
            </div>

            {/* Certificado disciplinario */}
            <div className={styles.field}>
              <label className={styles.label}>
                Certificado disciplinario <span className={styles.req}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
              </label>
              <button type="button" className={extra.uploadBtn}
                onClick={() => certDiscInputRef.current?.click()}>
                {certDiscFile ? 'Cambiar archivo' : 'Subir certificado disciplinario'}
              </button>
              <input ref={certDiscInputRef} type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }} onChange={(e) => onDocChange(e, setCertDiscFile)} />
              {certDiscFile && <div className={extra.fileName}>✓ {certDiscFile.name}</div>}
              <span style={{ fontSize: '0.68rem', opacity: 0.65, marginTop: 4, display: 'block' }}>
                Los clientes podrán consultarlo dentro del chat para confiar en ti.
              </span>
            </div>

            {/* Dirección de oficina (opcional) */}
            <div className={styles.field}>
              <label className={styles.label}>
                Dirección de oficina <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(opcional)</span>
              </label>
              <input type="text" className={styles.input}
                placeholder="Cra 7 # 12-34, oficina 501, Bogotá"
                value={direccionOficina}
                onChange={(e) => setDireccionOficina(e.target.value)} />
            </div>

            {/* Página web (opcional) */}
            <div className={styles.field}>
              <label className={styles.label}>
                Página web <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(opcional)</span>
              </label>
              <input type="url" className={styles.input}
                placeholder="https://tusitio.com"
                value={paginaWeb}
                onChange={(e) => setPaginaWeb(e.target.value)} />
            </div>

            {docsError && <p className={styles.msgError}>{docsError}</p>}

            <button type="submit" className={`btn-solid ${styles.submit}`} disabled={!canFinishDocs}>
              {docsSubmitting ? 'Enviando…' : 'Enviar para revisión →'}
            </button>
            <p className={styles.hint}>
              El administrador revisará tu perfil completo y te avisaremos por correo.
            </p>
          </form>
        )}

        {/* ══════════════════ REGISTRO — Paso C (cuenta creada) ══════════════════ */}
        {rol && verificationStep === 'done' && (
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
              color: 'var(--navy, #6d3c1b)', fontSize: 14, lineHeight: 1.6,
              margin: '0 0 22px', padding: '0 4px',
            }}>
              Tu cuenta está pendiente de aprobación por el administrador.
              Te avisaremos por correo cuando esté lista.
            </p>
            <button type="button" className={`btn-solid ${styles.submit}`} onClick={onClose}>
              Ir al inicio
            </button>
          </div>
        )}

        {/* ══════════════════ REGISTRO — Paso A (formulario) ══════════════════ */}
        {rol && verificationStep === 'form' && (
          <form className={styles.form} onSubmit={handleRegister}>

            {/* Nombre + Apellido (solo profesional) */}
            {isPro && (
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
            )}

            {/* Username */}
            <div className={styles.field}>
              <label className={styles.label}>Nombre de usuario <span className={styles.req}>*</span></label>
              <input type="text" className={styles.input} placeholder="@usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())} required />
            </div>

            {/* Cédula (obligatoria para los 3 roles) */}
            {rol && (
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
            )}

            {/* Teléfono (solo profesional) */}
            {isPro && (
              <div className={styles.field}>
                <label className={styles.label}>Celular <span className={styles.req}>*</span></label>
                <input
                  type="tel"
                  inputMode="numeric"
                  className={styles.input}
                  placeholder="3001234567"
                  value={telefono}
                  onChange={(e) => setTelefono(normalizarCelular(e.target.value))}
                  onBlur={() => setTelTouched(true)}
                  maxLength={10}
                  required
                  style={borderFor(telVal.valid, telTouched, telefono)}
                />
                <FieldHint valid={telVal.valid} msg={telVal.msg} touched={telTouched && !!telefono} />
              </div>
            )}

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

            {/* ── Campos profesionales: áreas + experiencia + tarjeta ── */}
            {isPro && (
              <>
                {/* Áreas que ejerce (multi-select) */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    {rol === 'contador' ? 'Especialidades que ejerce' : 'Áreas que ejerce'}
                  </label>
                  <div className={extra.areasBox}>
                    {AREAS_LIST.map(a => (
                      <label key={a} className={extra.areaItem}>
                        <input
                          type="checkbox"
                          className={extra.areaCheck}
                          checked={areas.includes(a)}
                          onChange={() => toggleArea(a)}
                        />
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                  <div className={extra.areasCount}>{areas.length} seleccionada{areas.length === 1 ? '' : 's'}</div>
                </div>

                {/* Experiencia laboral */}
                <div className={styles.field}>
                  <label className={styles.label}>Experiencia laboral</label>
                  <select className={styles.input} value={experiencia}
                    onChange={(e) => setExperiencia(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {EXPERIENCIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                {/* Tarjeta profesional */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Tarjeta profesional <span className={styles.req}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
                  </label>
                  <button type="button" className={extra.uploadBtn}
                    onClick={() => tarjetaInputRef.current?.click()}>
                    {tarjetaFile ? 'Cambiar archivo' : 'Subir tarjeta profesional'}
                  </button>
                  <input
                    ref={tarjetaInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={onTarjetaChange}
                  />
                  {tarjetaFile && (
                    <div className={extra.fileName}>✓ {tarjetaFile.name}</div>
                  )}
                </div>
              </>
            )}

            {/* ── Campos de gestor: comunidad + redes ── */}
            {rol === 'gestor' && (
              <>
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
                    marginTop: 4, fontSize: '0.68rem', color: 'var(--muted, #907c6b)',
                  }}>
                    <span>Nos ayuda a entender tu alcance como gestor.</span>
                    <span style={{ color: comunidad.length >= COMUNIDAD_MAX ? 'rgba(220,120,100,0.95)' : 'var(--gold-dk, #b8841c)' }}>
                      {comunidad.length}/{COMUNIDAD_MAX}
                    </span>
                  </div>
                </div>

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
              </>
            )}

            {/* Términos y condiciones */}
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
