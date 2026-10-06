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
import { COP, COBRO_MINIMO, COBRO_MAXIMO } from '../../lib/cobroAsesoria'
import { AREAS_CONTADURIA } from '../../lib/areasContaduria'
import { UNIVERSIDADES } from '../../lib/universidades'
import UbicacionSelector from '../profile/UbicacionSelector'
// El contrato que firma cada rol (profesional / corretaje) y los documentos
// generales, leídos en un visor sobre el propio formulario, sin pestaña nueva.
import { DOCS_LEGALES, contratoDeRol, VisorLegal, EnlaceLegal } from '../shared/DocumentosLegales'
import {
  PASSWORD_RULES, getPasswordStrength, isPasswordValid,
  validarCelular, validarCorreo, normalizarCelular,
  limpiarUsername, normalizarUsername, validarUsername,
} from '../../lib/validaciones'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Opciones de experiencia — idénticas a las del perfil (ProfilePage.jsx)
const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año', '1 - 3 años', '3 - 5 años',
  '5 - 10 años', '10 - 15 años', 'Más de 15 años',
]

const COMUNIDAD_MAX = 500

// Presentación pública del profesional (profiles.descripcion). El tope 500 es
// el mismo que usa el perfil; el mínimo evita el "asdf" que dejaría la tarjeta
// del home tan vacía como si no se hubiera escrito nada.
const DESCRIPCION_MAX = 500
const DESCRIPCION_MIN = 60

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

// NIT: 9 dígitos, con o sin dígito de verificación ("900123456" o "900123456-7").
function validarNit(v) {
  const raw = String(v || '').trim()
  if (!raw) return { valid: null, msg: '' }
  if (!/^\d{9}(-?\d)?$/.test(raw)) return { valid: false, msg: '9 dígitos, con o sin dígito de verificación.' }
  return { valid: true, msg: 'NIT válido' }
}

// El logo se guarda sobre fondo blanco: así se muestra en la tarjeta de la
// firma, y un PNG transparente no sale con fondo negro al pasar a JPEG (el
// bucket de fotos recibe JPEG, igual que la foto de un profesional).
export function logoSobreBlanco(file, lado = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight, 1))
      const c = document.createElement('canvas')
      c.width  = Math.max(1, Math.round(img.naturalWidth * k))
      c.height = Math.max(1, Math.round(img.naturalHeight * k))
      const g = c.getContext('2d')
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      c.toBlob(
        (b) => (b ? resolve(new File([b], 'logo.jpg', { type: 'image/jpeg' })) : reject(new Error('sin imagen'))),
        'image/jpeg', 0.9
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no es una imagen')) }
    img.src = url
  })
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

const IconFirma = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {/* Un despacho: frontón, cuatro columnas y escalinata (la versión anterior
        era una casa con puerta y se leía como "inicio"). */}
    <path d="M12 2.6 20.6 7.6H3.4z"/>
    <path d="M5 10.6h14M6.5 10.6v6.3M10.2 10.6v6.3M13.8 10.6v6.3M17.5 10.6v6.3M4.6 16.9h14.8M3 20.6h18"/>
  </svg>
)

const IconContrato = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>
  </svg>
)

// Alcance del servicio de una firma (también lo usa su panel).
export const OPCIONES_ALCANCE = [
  { v: 'nacional',      t: 'Nivel nacional',      d: 'Atienden casos en Colombia.' },
  { v: 'internacional', t: 'Nivel internacional', d: 'Atienden solo fuera del país.' },
  { v: 'ambos',         t: 'Ambos',               d: 'Atienden en Colombia y fuera del país.' },
]

const ROLES = [
  { key: 'abogado',  label: 'Abogado',  Icon: IconAbogado  },
  { key: 'contador', label: 'Contador', Icon: IconContador },
  { key: 'gestor',   label: 'Gestor',   Icon: IconGestor   },
  { key: 'firma',    label: 'Firma',    Icon: IconFirma    },
]

/* Las reglas de dinero que nadie va a leer en el contrato.
   Van ANTES del formulario, no enterradas en unos términos: quien se registra
   tiene que saber cómo cobra (o cómo gana) antes de invertir diez minutos en
   llenar campos, no después. Tres por rol, sin letra pequeña.

   `COBRO_MINIMO` / `COBRO_MAXIMO` vienen de lib/cobroAsesoria, los mismos
   números que valida el formulario de cobro: si aquí dijera una cifra y allá
   otra, la promesa del registro sería falsa. El rango es el mismo para el
   abogado y el contador (2026-10-01). */
const REGLA_TODA_CONSULTA = {
  titulo: 'Toda consulta se cobra',
  texto: 'No hay asesorías gratuitas. Fijas el valor antes de empezar y el cliente te paga directamente a ti; la plataforma no intermedia el dinero.',
}
const REGLA_DESCUENTO = {
  titulo: 'Si tomas el caso, ese valor se descuenta',
  texto: 'Lo que el cliente ya pagó por la consulta se resta de tus honorarios cuando el caso sigue contigo. No se cobra dos veces.',
}
const CONDICIONES = {
  profesional: {
    titulo: 'Cómo se cobra en Parada Bridge',
    entrada: 'Tres reglas que aceptas al crear tu perfil.',
    puntos: [
      REGLA_TODA_CONSULTA,
      {
        titulo: `La consulta va de ${COP.format(COBRO_MINIMO)} a ${COP.format(COBRO_MAXIMO)}`,
        texto: 'Es el rango establecido en nuestras políticas internas. El profesional define el valor de la consulta dentro de este rango.',
      },
      REGLA_DESCUENTO,
    ],
  },
  gestor: {
    titulo: 'Cómo ganas como gestor',
    entrada: 'Tres reglas que aceptas al crear tu perfil.',
    puntos: [
      {
        titulo: 'Cuándo se paga tu comisión',
        texto: 'La comisión se genera solo si el caso es exitoso. El cliente le paga al profesional y, cuando el profesional consigna a la plataforma, tu comisión queda disponible. Desde ese momento, el pago se realiza dentro de los 5 días hábiles siguientes.',
      },
      {
        titulo: 'Es el 5% de lo que gana la plataforma',
        texto: 'No el 5% del total de la asesoría: el 5% de la comisión que retiene Parada Bridge sobre ese caso.',
      },
      {
        titulo: 'Todo entra por tu código',
        texto: 'Solo cuentan las consultas que abrieron escaneando tu QR o escribiendo tu código. Puedes seguir cada una desde tu perfil.',
      },
    ],
  },
}

/* La firma atiende TODAS las consultas; su Director y sus aliados son
   perfiles informativos de su tarjeta. Lo que tiene que saber antes de llenar
   nada es el orden (aprobación → Director → equipo) y que las consultas y los
   cobros son suyos. Sin dos puntos en los textos (pedido del dueño). */
CONDICIONES.firma = {
  titulo: 'Cómo funciona una firma en Parada Bridge',
  entrada: 'Tres reglas que aceptas al registrar tu firma.',
  puntos: [
    {
      titulo: 'Primero la firma, después su Director',
      texto: 'La administración revisa y aprueba la firma. Al entrar, el primer paso es registrar a tu Director. Es obligatorio y sin él la firma no aparece en el inicio.',
    },
    {
      titulo: 'Tu equipo se muestra en tu tarjeta',
      texto: 'Tu Director y tus aliados y colaboradores son perfiles informativos que tú registras y editas. Aparecen en la tarjeta de la firma, pero no tienen cuenta ni atienden por separado.',
    },
    {
      titulo: `La firma atiende y cobra cada consulta, de ${COP.format(COBRO_MINIMO)} a ${COP.format(COBRO_MAXIMO)}`,
      texto: 'Todas las consultas llegan al panel de la firma, sin importar a quién de tu equipo buscaba el cliente. La firma fija el valor dentro de ese rango y el cliente le paga directamente. Si toma el caso, ese valor se descuenta de los honorarios.',
    },
  ],
}

const ROLE_TITLE = {
  abogado:  'Crear perfil como Abogado',
  contador: 'Crear perfil como Contador',
  gestor:   'Crear perfil como Gestor',
  firma:    'Registrar una Firma',
}

/* Registro público: abogado, contador, gestor o firma. (El Director y los
   aliados de una firma NO se registran aquí: son fichas que la firma crea en
   su panel, ver MiembroFirmaModal.) */
export default function RegisterModal({ onClose }) {
  // rol seleccionado en el paso inicial. null = aún elige rol.
  const [rol, setRol] = useState(null)

  // Marcada la casilla de las condiciones del paso previo. Se reinicia al
  // cambiar de rol: las reglas del gestor no son las del profesional.
  const [aceptoCondiciones, setAceptoCondiciones] = useState(false)
  // Documento legal abierto en el visor desde el paso de condiciones
  // (clave de DOCS_LEGALES | null).
  const [docLegal, setDocLegal] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  // ── Campos comunes ──────────────────────────────────────────────────────
  const [nombre, setNombre]           = useState('')
  const [apellido, setApellido]       = useState('')
  const [username, setUsername]       = useState('')
  // Lo que de verdad viaja a la base: siempre en minúsculas.
  const usernameNorm                  = normalizarUsername(username)
  const [telefono, setTelefono]       = useState('')
  const [regEmail, setRegEmail]       = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pwTouched, setPwTouched]     = useState(false)
  const [pwFocus, setPwFocus]         = useState(false)   // requisitos visibles mientras se escribe
  const [emailTouched, setEmailTouched] = useState(false)
  const [telTouched, setTelTouched]   = useState(false)
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [captchaValue, setCaptchaValue] = useState(null)

  // ── Campos de profesional (abogado / contador) ──────────────────────────
  const [areas, setAreas]             = useState([])          // string[]
  const [experiencia, setExperiencia] = useState('')
  const [tarjetaFile, setTarjetaFile] = useState(null)        // File | null
  const tarjetaInputRef = useRef(null)
  // Universidad y ubicación se piden AQUÍ (no solo en el perfil): antes eran
  // editables únicamente en /perfil, así que un profesional podía quedar
  // aprobado sin llenarlas y salir en el home con la tarjeta medio vacía.
  const [universidad, setUniversidad]       = useState('')
  const [universidadOtra, setUniversidadOtra] = useState(false)
  const [departamento, setDepartamento]     = useState('')
  const [ciudad, setCiudad]                 = useState('')
  const [barrio, setBarrio]                 = useState('')

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
  // Certificado bancario del gestor: obligatorio en el registro. Sin él no hay
  // a dónde pagarle la comisión, y el perfil ya bloqueaba los cobros por eso;
  // pedirlo al final era dejar cuentas aprobadas a las que no se puede pagar.
  const [gestorCertFile, setGestorCertFile] = useState(null)
  const gestorCertInputRef = useRef(null)

  // ── Campos de firma ─────────────────────────────────────────────────────
  // El logo, la cámara de comercio y el certificado bancario reutilizan los
  // huecos del profesional (foto, "tarjeta", certificado bancario): es el
  // mismo paso con otro rótulo. Lo propio de la firma es el NIT y el alcance.
  const [nit, setNit]               = useState('')
  const [nitTouched, setNitTouched] = useState(false)
  const [alcance, setAlcance]       = useState('')   // 'nacional' | 'internacional' | 'ambos'
  // "Otro/Otra" en las áreas: lo que la persona escribe reemplaza al literal.
  const [areaOtraTexto, setAreaOtraTexto] = useState('')

  /* Los requisitos de la contraseña se pliegan al salir del campo, y al
     plegarse sube todo lo que hay debajo. Si eso ocurre en mitad del clic que
     quitó el foco, el botón se suelta sobre otro control y el clic se pierde:
     el primer clic después de escribir la contraseña (un área, el alcance de
     la firma) no hacía nada. Con un clic en curso se espera a que termine;
     con el teclado se pliegan de inmediato, como antes. */
  const punteroAbajo = useRef(false)
  useEffect(() => {
    const abajo  = () => { punteroAbajo.current = true }
    const arriba = () => { punteroAbajo.current = false }
    document.addEventListener('pointerdown', abajo, true)
    document.addEventListener('pointerup', arriba, true)
    document.addEventListener('pointercancel', arriba, true)
    return () => {
      document.removeEventListener('pointerdown', abajo, true)
      document.removeEventListener('pointerup', arriba, true)
      document.removeEventListener('pointercancel', arriba, true)
    }
  }, [])
  function cerrarRequisitos() {
    if (!punteroAbajo.current) { setPwFocus(false); return }
    const fin = () => {
      document.removeEventListener('pointerup', fin)
      document.removeEventListener('pointercancel', fin)
      // Tras el `click`, que se despacha justo después de soltar.
      setTimeout(() => setPwFocus(false), 0)
    }
    document.addEventListener('pointerup', fin)
    document.addEventListener('pointercancel', fin)
  }

  const recaptchaRef = useRef()
  // Para llevar el foco al primer campo marcado tras un intento fallido.
  const formRef = useRef(null)

  // ── Campos adicionales configurados por el admin maestro ───────────────
  // (tabla registro_campos; las respuestas van a profiles.datos_adicionales)
  const [camposExtra, setCamposExtra]         = useState([])
  const [respuestasExtra, setRespuestasExtra] = useState({})

  async function cargarCamposExtra(r) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/registro_campos?activo=eq.true&or=(rol.eq.todos,rol.eq.${r})&select=id,etiqueta,tipo,opciones,requerido&order=orden.asc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const data = await res.json()
      setCamposExtra(Array.isArray(data) ? data : [])
    } catch { setCamposExtra([]) } // sin tabla / sin red → registro normal
  }

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
  const [descripcionPublica, setDescripcionPublica] = useState('')
  const [docsSubmitting, setDocsSubmitting] = useState(false)
  const [docsError, setDocsError]         = useState('')
  // Tarjeta profesional: se sube en el Paso C (con la cuenta). Aquí guardamos
  // el path resultante para mostrarla como "adjunta" en 'docs' y, si esa
  // subida falló, exigir un nuevo archivo (obligatoria).
  const [tarjetaSubidaPath, setTarjetaSubidaPath] = useState(null)
  const [tarjetaDocsFile, setTarjetaDocsFile]     = useState(null)
  // Modelo contractual (OPCIONAL): un PDF → contratos/<uid>/modelo-contractual-<fecha>.pdf
  // (misma ruta que DocumentosConfianza en el perfil).
  const [modeloFile, setModeloFile]       = useState(null)
  const fotoInputRef     = useRef(null)
  const certBancInputRef = useRef(null)
  const certDiscInputRef = useRef(null)
  const tarjetaDocsInputRef = useRef(null)
  const modeloInputRef   = useRef(null)

  // Validaciones derivadas
  const pwRules    = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(regPassword) }))
  const pwStrength = getPasswordStrength(regPassword)
  const pwValid    = isPasswordValid(regPassword)
  const emailVal   = validarCorreo(regEmail)
  const telVal     = validarCelular(telefono)
  const cedulaVal  = validarCedula(cedula)
  // Requisitos de contraseña SIEMPRE visibles (vacío → neutro; escribiendo → ✓/✗).
  const pwEmpty    = regPassword.length === 0

  const isPro = rol === 'abogado' || rol === 'contador'
  const esFirma = rol === 'firma'
  // Pasan por el paso 'docs' (foto o logo + documentos) con la cuenta ya creada.
  const conDocs = isPro || esFirma
  const nitVal  = validarNit(nit)
  const rolesVisibles = ROLES
  // Cabeceras de la cuenta que se está creando (la sesión temporal recién abierta).
  const headersCuenta = () => getAuthHeaders()
  // "Otro" (contador, firma) u "Otra" (abogado) marcado en las áreas.
  const OTRO_AREA = rol === 'abogado' ? 'Otra' : 'Otro'
  const areaOtraOn = areas.includes(OTRO_AREA)
  // Lo que se guarda: la lista sin el literal, más el texto escrito.
  const areasFinales = areas.filter(a => a !== 'Otro' && a !== 'Otra').concat(areaOtraOn && areaOtraTexto.trim() ? [areaOtraTexto.trim()] : [])


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

  /* ── Validacion del formulario ────────────────────────────────────────
     Antes se paraba en el PRIMER fallo y solo se mostraba un mensaje: el
     usuario corregia, volvia a enviar, y aparecia el siguiente. Ahora se
     revisa todo de una y se devuelve un mapa campo -> motivo.

     `errores` se RECALCULA en cada render (no se guarda en estado) una vez
     que ya se intento enviar. Asi el rojo de un campo desaparece solo en
     cuanto el usuario lo corrige, sin necesidad de limpiar campo por campo
     desde cada onChange. */
  function validarTodo() {
    const e = {}
    if (!nombre.trim())   e.nombre = esFirma ? 'Escribe el nombre de la firma' : 'Escribe el nombre'
    if (!esFirma && !apellido.trim()) e.apellido = 'Escribe el apellido'
    if (!usernameNorm) e.username = 'Elige un nombre de usuario'
    else if (validarUsername(username).valid === false) e.username = validarUsername(username).msg
    if (telVal.valid !== true)    e.telefono = 'Celular de 10 dígitos que empiece por 3'
    if (!esFirma && cedulaVal.valid !== true) e.cedula = 'Cédula de 6 a 12 dígitos'
    if (esFirma && nitVal.valid !== true)     e.nit = 'NIT de 9 dígitos, con o sin dígito de verificación'
    if (!emailVal.valid)  e.email = 'Correo no válido'
    if (!pwValid)         e.password = 'La contraseña no cumple los requisitos'
    if (isPro) {
      if (!universidad.trim()) e.universidad = 'Selecciona tu universidad'
      if (!tarjetaFile)        e.tarjeta = 'Adjunta la tarjeta profesional'
    }
    if ((isPro || esFirma) && areaOtraOn && !areaOtraTexto.trim()) e.areaOtra = `Escribe cuál es esa ${rol === 'abogado' ? 'otra área' : 'otra especialidad'}`
    if (esFirma) {
      if (!alcance)     e.alcance = 'Indica si la firma atiende a nivel nacional, internacional o ambos'
      if (!tarjetaFile) e.tarjeta = 'Adjunta la cámara de comercio'
    }
    if (rol === 'gestor' && !gestorCertFile) e.certificado = 'Adjunta tu certificado bancario'
    if (!departamento)  e.ubicacion = 'Selecciona departamento y municipio'
    else if (!ciudad.trim()) e.ubicacion = 'Selecciona el municipio o la localidad'
    for (const c of camposExtra) {
      if (c.requerido && c.tipo !== 'checkbox' && !String(respuestasExtra[c.id] ?? '').trim()) {
        e[`extra_${c.id}`] = `Completa "${c.etiqueta}"`
      }
    }
    if (!aceptaTerminos) e.terminos = 'Debes aceptar los términos, la política de datos y el contrato'
    if (!captchaValue)   e.captcha = 'Completa el captcha'
    return e
  }

  // Solo se marcan campos DESPUES del primer intento: nadie quiere ver el
  // formulario en rojo antes de haber escrito nada.
  const [intentado, setIntentado] = useState(false)
  const errores = intentado ? validarTodo() : {}
  const nErrores = Object.keys(errores).length
  // Clase del campo: roja solo si ese campo concreto esta mal.
  const cls = (campo) => `${styles.input}${errores[campo] ? " " + extra.inputError : ""}`

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
      setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return
    }
    if (file.size / (1024 * 1024) > 10) {
      setError('El archivo no puede superar 10 MB'); return
    }
    setError(null)
    setTarjetaFile(file)
  }

  // Al elegir rol, limpiamos estado del formulario para evitar arrastres.
  function pickRole(r) {
    setRol(r)
    setError(null); setEmailErrorInline('')
    setAreas([]); setExperiencia(''); setTarjetaFile(null)
    setTarjetaSubidaPath(null); setTarjetaDocsFile(null); setModeloFile(null)
    setCertBancFile(null); setCertDiscFile(null); setDocsError('')
    setVerificationStep('condiciones'); setOtpError('')
    setAceptoCondiciones(false)
    setNit(''); setNitTouched(false); setAlcance(''); setAreaOtraTexto('')
    setCaptchaValue(null); recaptchaRef.current?.reset()
    setRespuestasExtra({})
    cargarCamposExtra(r)   // campos personalizados del admin maestro
  }

  // ── Paso A: validar formulario y enviar el código de verificación ────────
  async function handleRegister(e) {
    e.preventDefault()
    // Una sola pasada: se recogen TODOS los fallos, se marcan los campos y se
    // lleva el foco al primero, en vez de ir revelandolos de uno en uno.
    setIntentado(true)
    setCedulaTouched(true); setNitTouched(true); setTelTouched(true); setEmailTouched(true); setPwTouched(true)
    const errs = validarTodo()
    if (Object.keys(errs).length > 0) {
      setError(null)
      // El campo marcado puede haber quedado fuera de la vista en un
      // formulario largo: se lo trae y se le da el foco.
      requestAnimationFrame(() => {
        const primero = formRef.current?.querySelector(`.${extra.inputError}, [data-error="1"]`)
        primero?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        if (primero?.focus) primero.focus({ preventScroll: true })
      })
      return
    }

    setError(null); setEmailErrorInline(''); setLoading(true)
    try {
      // Username único — chequeo previo al envío del código.
      if (usernameNorm) {
        // Se compara con el normalizado: si no, "Esteban" pasaría el filtro
        // aunque "esteban" ya exista, y el choque saldría al final del registro.
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(usernameNorm)}&select=id`,
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
  // `emailOverride` permite reenviar a un correo recien corregido, cuyo
  // setState todavia no se refleja en `regEmail` en este render.
  async function sendVerificationCode(emailOverride) {
    const res = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: (emailOverride ?? regEmail).trim().toLowerCase(),
        // 'firma' en ese endpoint es la firma ELECTRÓNICA: el registro de
        // una firma-perfil tiene su propio tipo.
        tipoRegistro: esFirma ? 'firma_perfil' : rol,   // 'abogado' | 'contador' | 'gestor' | 'firma_perfil'
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
        body: JSON.stringify({ email: regEmail.trim().toLowerCase(), code }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.error || 'Código inválido o expirado')
      }

      // Verificación OK — recién ahora creamos la cuenta.
      await actuallyCreateAccount()
      // Profesional y firma: sigue el paso de foto/logo + documentos (con la
      // cuenta ya creada). Gestor: directo a la pantalla final.
      setVerificationStep(conDocs ? 'docs' : 'done')
    } catch (err) {
      setOtpError(err.message || 'Código inválido o expirado')
    } finally {
      setOtpSubmitting(false)
    }
  }

  // Cambiar el correo sin volver al formulario: valida, lo reemplaza y
  // reenvia el codigo. Util cuando se descubre la errata al no recibir nada.
  async function handleCambiarCorreo(nuevo) {
    const limpio = String(nuevo || '').trim()
    if (!validarCorreo(limpio).valid) throw new Error('El correo no es válido')
    setOtpError('')
    setRegEmail(limpio)
    // sendVerificationCode lee `regEmail` del estado, que aún no se ha
    // actualizado en este render: se le pasa el nuevo explícitamente.
    await sendVerificationCode(limpio)
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
    // Supabase Auth guarda el correo SIEMPRE en minúsculas y el trigger
    // handle_new_user lo copia así a profiles.email. Si aquí mandáramos el
    // correo tal como se escribió (con una mayúscula), el UPSERT del paso 4
    // se vería como un CAMBIO de email y el trigger lo rechaza con
    // "No puedes cambiar tu email desde este endpoint". Por eso se normaliza.
    const emailNorm = regEmail.trim().toLowerCase()
    let userId
    {
      // 1. signUp — crea auth.users. El trigger crea la fila en profiles con
      //    rol='abogado' por defecto; la corregimos en el UPSERT (paso 4).
      const metaData = { nombre, apellido, username: usernameNorm, telefono }
      const { error: signUpError } = await supabase.auth.signUp({
        email: emailNorm,
        password: regPassword,
        options: { data: metaData },
      })
      if (signUpError) throw new Error(signUpError.message || 'Error al crear cuenta')

      // 2. Sign-in temporal para obtener token (necesario para el UPSERT y para
      //    subir la tarjeta al bucket privado con RLS auth.uid() = folder).
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailNorm,
        password: regPassword,
      })
      if (signInError || !signInData?.user?.id) {
        throw new Error('Cuenta creada pero no se pudo fijar el rol. Contacta al administrador.')
      }
      userId = signInData.user.id
    }

    // 3. Subir la tarjeta profesional (si aplica y se adjuntó). Mismo path y
    //    bucket que ProfilePage: `<userId>/tarjeta.<ext>` en
    //    tarjetas-profesionales. Guardamos el PATH (bucket privado → se firma
    //    on demand al visualizar en el perfil).
    //    La firma sube aquí su cámara de comercio: mismo hueco, otro nombre.
    let tarjetaPath = null
    if (conDocs && tarjetaFile) {
      const headers = await headersCuenta()
      const ext  = tarjetaFile.name.split('.').pop().toLowerCase()
      const path = `${userId}/${esFirma ? 'camara-comercio' : 'tarjeta'}.${ext}`
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': tarjetaFile.type, 'x-upsert': 'true' },
          body: tarjetaFile,
        }
      )
      // Si falla la subida no abortamos la cuenta: el paso 'docs' la exige de
      // nuevo (es obligatoria) y la sube al mismo path.
      if (upRes.ok) tarjetaPath = path
    }
    setTarjetaSubidaPath(tarjetaPath)

    // 3b. Certificado bancario del gestor → mismo bucket y misma carpeta que
    //     usa su perfil (`<uid>/certificados/certificado.<ext>`), para que
    //     ProfileGestorPage lo encuentre sin cambios. Se sube AQUÍ, con la
    //     sesión temporal viva: el bucket es privado y su RLS exige que la
    //     carpeta sea el auth.uid() del que sube.
    let gestorCertPath = null
    if (rol === 'gestor' && gestorCertFile) {
      const hdrs = await getAuthHeaders()
      const ext  = gestorCertFile.name.split('.').pop().toLowerCase()
      const path = `${userId}/certificados/certificado.${ext}`
      const up = await fetch(
        `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        {
          method: 'POST',
          headers: { ...hdrs, 'Content-Type': gestorCertFile.type, 'x-upsert': 'true' },
          body: gestorCertFile,
        }
      )
      // Si la subida falla no se aborta la cuenta: el perfil del gestor ya
      // tiene su propio bloque para cargarlo, y allí se le exige antes de
      // poder cobrar.
      if (up.ok) gestorCertPath = path
    }

    // 4. UPSERT en profiles con el rol y campos correctos.
    const headers = await headersCuenta()
    // Respuestas a los campos personalizados → jsonb {etiqueta: valor}
    // (solo los respondidos; el admin las ve al revisar la solicitud).
    const datosAdicionales = {}
    for (const c of camposExtra) {
      const v = respuestasExtra[c.id]
      if (c.tipo === 'checkbox') { datosAdicionales[c.etiqueta] = v ? 'Sí' : 'No' }
      else if (String(v ?? '').trim()) { datosAdicionales[c.etiqueta] = String(v).trim() }
    }
    const payload = {
      id: userId,
      // En minúsculas, igual que en metaData y que en el chequeo de unicidad.
      username: usernameNorm,
      email: emailNorm,
      rol,
      aprobado: false,
      // Basicos de toda cuenta, sea profesional o gestor.
      nombre,
      apellido,
      telefono,
      cedula,
      ...(Object.keys(datosAdicionales).length ? { datos_adicionales: datosAdicionales } : {}),
    }

    if (esFirma) {
      // Firma: sin apellido ni cédula; NIT, alcance, áreas y su documento.
      Object.assign(payload, {
        apellido: '',
        cedula: null,
        nit: nit.trim(),
        alcance_servicio: alcance,
        area_derecho: areasFinales.length ? areasFinales.join(', ') : null,
        experiencia: experiencia || null,
        departamento: departamento || null,
        ciudad: (barrio.trim() ? `${ciudad.trim()} - ${barrio.trim()}` : ciudad.trim()) || null,
        camara_comercio_url: tarjetaPath,
      })
    } else if (isPro) {
      Object.assign(payload, {
        // area_derecho guarda la lista separada por comas (para contador
        // significa especialidades contables — misma columna, ver CLAUDE.md).
        area_derecho: areasFinales.length ? areasFinales.join(', ') : null,
        experiencia: experiencia || null,
        universidad: universidad.trim() || null,
        departamento: departamento || null,
        // Mismo formato que ProfilePage: el nivel 3 (barrio/comuna) se guarda
        // dentro de `ciudad` como "Municipio - Barrio" (no hay columna barrio),
        // y así el perfil lo rehidrata al editar.
        ciudad: (barrio.trim() ? `${ciudad.trim()} - ${barrio.trim()}` : ciudad.trim()) || null,
        tarjeta_archivo_url: tarjetaPath,
      })
    } else {
      // Gestor: cédula + redes + comunidad + certificado bancario.
      Object.assign(payload, {
        certificado_bancario_url: gestorCertPath,
        departamento: departamento || null,
        // Mismo formato que ProfilePage: el nivel 3 se guarda dentro de
        // `ciudad` como "Municipio - Barrio" (no hay columna barrio).
        ciudad: (barrio.trim() ? `${ciudad.trim()} - ${barrio.trim()}` : ciudad.trim()) || null,
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

    // 5. Profesional y firma: la cuenta sigue abierta para el paso 'docs'
    //    (foto/logo + documentos suben con RLS auth.uid() = folder). El
    //    signOut ocurre al terminar ese paso. Gestor: cierra sesión de una vez.
    setNewUserId(userId)
    if (!conDocs) await supabase.auth.signOut()
  }

  // ── Paso 'docs': foto + certificados + oficina → PATCH perfil → signOut ──
  function onFotoChange(e) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    if (!raw.type.startsWith('image/')) { setDocsError('La foto debe ser una imagen.'); return }
    setDocsError('')
    // Comprime de una vez (≤1200px, JPEG) — mismo criterio que ProfilePage.
    // El logo de una firma va aparte: sobre blanco y sin recortar.
    ;(esFirma ? logoSobreBlanco(raw) : compressImage(raw, 1200, 0.85, 'image/jpeg'))
      .then(f => {
        setFotoFile(f)
        setFotoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
      })
      .catch(() => setDocsError('No se pudo procesar la foto. Intenta con otra imagen.'))
  }

  // pdfOnly: el modelo contractual solo acepta PDF (igual que en el perfil).
  function onDocChange(e, set, { pdfOnly = false } = {}) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
    if (pdfOnly && !esPdf) { setDocsError('El modelo contractual debe ser un PDF.'); return }
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!pdfOnly && !allowed.includes(file.type)) { setDocsError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setDocsError('El archivo no puede superar 10 MB.'); return }
    setDocsError('')
    set(file)
  }

  // Reglas del paso: foto + tarjeta (path del Paso C o archivo nuevo) +
  // ambos certificados + presentación pública. Modelo contractual, oficina y
  // web: opcionales.
  const tieneTarjeta      = !!tarjetaSubidaPath || !!tarjetaDocsFile
  const tieneCertificado  = !!certBancFile && !!certDiscFile

  function validarDocs() {
    if (!fotoFile)         return esFirma ? 'Sube el logo de la firma (obligatorio).' : 'Sube la foto de perfil (obligatoria).'
    if (!tieneTarjeta)     return esFirma ? 'Adjunta la cámara de comercio (obligatoria).' : 'Adjunta la tarjeta profesional (obligatoria).'
    if (!certBancFile)     return 'Adjunta la cuenta bancaria certificada (obligatoria).'
    if (!esFirma && !certDiscFile) return 'Adjunta el certificado disciplinario (obligatorio).'
    if (descripcionPublica.trim().length < DESCRIPCION_MIN) {
      return esFirma
        ? `Presenta la firma: al menos ${DESCRIPCION_MIN} caracteres (es lo que los clientes leen en su tarjeta).`
        : `Cuenta la experiencia laboral: al menos ${DESCRIPCION_MIN} caracteres (es lo que los clientes leen en la tarjeta).`
    }
    return ''
  }

  async function handleDocsSubmit(e) {
    e.preventDefault()
    if (docsSubmitting || !newUserId) return
    const falta = validarDocs()
    if (falta) { setDocsError(falta); return }
    setDocsSubmitting(true); setDocsError('')
    try {
      const headers = await headersCuenta()

      // 1. Foto de perfil → profile-photos/avatars/<uid>.jpg (bucket público).
      const fotoPath = `avatars/${newUserId}.jpg`
      const fotoRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/profile-photos/${fotoPath}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': fotoFile.type, 'x-upsert': 'true' }, body: fotoFile }
      )
      if (!fotoRes.ok) throw new Error('No se pudo subir la foto de perfil.')
      const fotoUrl = `${SUPABASE_URL}/storage/v1/object/public/profile-photos/${fotoPath}?t=${Date.now()}`

      // 2. Documentos → tarjetas-profesionales/<uid>/… (bucket privado).
      //    Mismas rutas de siempre: tarjeta.<ext>, certificados/certificado.<ext>,
      //    certificado-disciplinario.<ext>.
      async function subirDoc(file, nombreBase, etiqueta) {
        const ext  = file.name.split('.').pop().toLowerCase()
        const path = `${newUserId}/${nombreBase}.${ext}`
        const res  = await fetch(
          `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
          { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
        )
        if (!res.ok) throw new Error(`No se pudo subir ${etiqueta}.`)
        return path
      }
      const cambios = { foto_url: fotoUrl }
      if (tarjetaDocsFile) {
        if (esFirma) cambios.camara_comercio_url = await subirDoc(tarjetaDocsFile, 'camara-comercio', 'la cámara de comercio')
        else cambios.tarjeta_archivo_url = await subirDoc(tarjetaDocsFile, 'tarjeta', 'la tarjeta profesional')
      }
      if (certBancFile) {
        cambios.certificado_bancario_url = await subirDoc(certBancFile, 'certificados/certificado', 'el certificado bancario')
      }
      if (certDiscFile) {
        cambios.certificado_disciplinario_url = await subirDoc(certDiscFile, 'certificado-disciplinario', 'el certificado disciplinario')
      }

      // 2b. Modelo contractual (opcional) → contratos/<uid>/modelo-contractual-<fecha>.pdf
      //     (misma columna que DocumentosConfianza en el perfil). Nombre nuevo
      //     y sin upsert: el bucket no deja reemplazar un archivo existente, y
      //     reintentar este paso tras un fallo a medias chocaba con el anterior.
      if (modeloFile) {
        const modeloPath = `${newUserId}/modelo-contractual-${Date.now()}.pdf`
        const mRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/contratos/${modeloPath}`,
          { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: modeloFile }
        )
        if (!mRes.ok) throw new Error('No se pudo subir el modelo contractual. Puedes quitarlo y subirlo luego desde tu perfil.')
        cambios.modelo_contrato_path = modeloPath
      }

      // 3. PATCH del perfil con todo lo del paso.
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
        method: 'PATCH',
        headers: { ...(await headersCuenta()), Prefer: 'return=minimal' },
        body: JSON.stringify({
          ...cambios,
          direccion_oficina: direccionOficina.trim() || null,
          pagina_web: paginaWeb.trim() || null,
          descripcion: descripcionPublica.trim(),
        }),
      })
      if (!patchRes.ok) throw new Error('No se pudo guardar la información del perfil.')

      // 4. Fin: cerrar la sesión temporal.
      await supabase.auth.signOut()
      setVerificationStep('done')
    } catch (err) {
      setDocsError(err.message || 'No se pudo completar el paso. Intenta de nuevo.')
    } finally {
      setDocsSubmitting(false)
    }
  }

  // Cerrar durante 'docs' dejaría el registro incompleto — modal de marca de
  // confirmación (no el diálogo nativo del navegador) y cierre de la sesión
  // temporal para no dejarla viva.
  const [confirmSalir, setConfirmSalir] = useState(false)

  async function handleClose() {
    if (verificationStep === 'docs') {
      setConfirmSalir(true)
      return
    }
    onClose()
  }

  async function salirSinCompletar() {
    setConfirmSalir(false)
    try { await supabase.auth.signOut() } catch (_) { /* noop */ }
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={handleClose} aria-label="Cerrar"><IconX /></button>

        <p className={styles.eyebrow}><span style={{ color: 'var(--navy)' }}>Parada</span> Bridge</p>
        <h3 className={styles.title}>
          {verificationStep === 'docs'
            ? (esFirma ? 'Completa tu firma' : 'Completa tu perfil')
            : rol ? ROLE_TITLE[rol] : 'Registrarse'}
        </h3>

        {error && <p className={styles.msgError}>{error}</p>}

        {/* ══════════════════ SELECTOR DE ROL ══════════════════ */}
        {/* Solo visible mientras se elige y se llena el formulario. Una vez
            enviado el codigo, cambiar de rol invalidaria lo ya escrito; y con
            la cuenta ya creada ('done') no queda nada que elegir. */}
        <div className={`${extra.roleSelector} ${rolesVisibles.length === 2 ? extra.roleCols2 : rolesVisibles.length === 4 ? extra.roleCols4 : ''}`}
          style={['docs', 'verify', 'done'].includes(verificationStep) ? { display: 'none' } : undefined}>
          {rolesVisibles.map(({ key, label, Icon }) => (
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
            onCambiarCorreo={handleCambiarCorreo}
          />
        )}

        {/* ══════════ REGISTRO — Paso 'docs' (foto + certificados) ══════════ */}
        {rol && verificationStep === 'docs' && (
          <form className={styles.form} onSubmit={handleDocsSubmit}>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              {esFirma
                ? 'Correo verificado ✓. Sube lo que el administrador revisará para aprobar la firma. Así no tendrás que esperar una segunda revisión.'
                : 'Correo verificado ✓. Sube lo que el administrador revisará para aprobar tu perfil. Así no tendrás que esperar una segunda revisión.'}
            </p>

            {/* Foto de perfil */}
            <div className={styles.field}>
              <label className={styles.label}>
                {esFirma ? 'Logo de la firma' : 'Foto de perfil'} <span className={styles.req}>*</span>
                <span className={`${extra.tag} ${extra.tagReq}`}>Obligatorio</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 72, height: 72, borderRadius: esFirma ? 14 : '50%', flex: '0 0 auto',
                    // El logo se ve entero (contain) sobre blanco; la foto llena el círculo.
                    background: fotoPreview
                      ? `#fff center / ${esFirma ? 'contain' : 'cover'} no-repeat url(${fotoPreview})`
                      : 'rgba(120,120,120,0.08)',
                    border: fotoPreview ? '2px solid #c9a84c' : '2px dashed rgba(120,120,120,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {!fotoPreview && (
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none"
                      stroke="#9a938c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      {esFirma
                        ? <path d="M3 21h18M5 21V10M19 21V10M9 21v-6h6v6M2.5 10 12 4l9.5 6z" />
                        : <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>}
                    </svg>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <button type="button" className={extra.uploadBtn}
                    onClick={() => fotoInputRef.current?.click()}>
                    {fotoFile ? (esFirma ? 'Cambiar logo' : 'Cambiar foto') : (esFirma ? 'Subir logo' : 'Subir foto')}
                  </button>
                  <span style={{ fontSize: '0.68rem', opacity: 0.65 }}>
                    {esFirma ? 'Aparecerá en la tarjeta pública de la firma. JPG/PNG.' : 'Aparecerá en la tarjeta pública. JPG/PNG.'}
                  </span>
                </div>
              </div>
              <input ref={fotoInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={onFotoChange} />
            </div>

            {/* Tarjeta profesional (obligatoria). Ya se subió con la cuenta en
                el Paso C; si esa subida falló, aquí se exige de nuevo. */}
            <div className={styles.field}>
              <label className={styles.label}>
                {esFirma ? 'Cámara de comercio' : 'Tarjeta profesional'} <span className={styles.req}>*</span>
                <span className={`${extra.tag} ${extra.tagReq}`}>Obligatorio</span>
              </label>
              {tarjetaSubidaPath && !tarjetaDocsFile ? (
                <div className={extra.docAdjunto}>
                  <span className={extra.fileName}>✓ {tarjetaFile?.name || 'Documento adjunto'} (ya recibida)</span>
                  <button type="button" className={extra.linkMini}
                    onClick={() => tarjetaDocsInputRef.current?.click()}>
                    Cambiar archivo
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className={extra.uploadBtn}
                    onClick={() => tarjetaDocsInputRef.current?.click()}>
                    {tarjetaDocsFile ? 'Cambiar archivo' : esFirma ? 'Subir cámara de comercio' : 'Subir tarjeta profesional'}
                  </button>
                  {tarjetaDocsFile && <div className={extra.fileName}>✓ {tarjetaDocsFile.name}</div>}
                  {!tarjetaSubidaPath && !tarjetaDocsFile && (
                    <span className={extra.docHint}>
                      No pudimos recibir el documento del formulario. Súbelo de nuevo (PDF o imagen).
                    </span>
                  )}
                </>
              )}
              <input ref={tarjetaDocsInputRef} type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }} onChange={(e) => onDocChange(e, setTarjetaDocsFile)} />
            </div>

            {/* Certificados: obligatorio al menos uno de los dos */}
            <fieldset className={extra.docGroup}>
              <legend className={styles.label}>
                {esFirma ? 'Certificado' : 'Certificados'} <span className={styles.req}>*</span>
                <span className={`${extra.tag} ${extra.tagReq}`}>{esFirma ? 'Obligatorio' : 'Obligatorio · ambos'}</span>
              </legend>
              <p className={extra.docHint} style={{ marginTop: 0 }}>
                {esFirma ? 'PDF o imagen, máx. 10 MB.' : 'Sube los dos. PDF o imagen, máx. 10 MB cada uno.'}
              </p>

              <div className={extra.docSlot}>
                <span className={extra.docSlotName}>Cuenta bancaria certificada</span>
                <button type="button" className={extra.uploadBtn}
                  onClick={() => certBancInputRef.current?.click()}>
                  {certBancFile ? 'Cambiar archivo' : 'Subir certificado bancario'}
                </button>
                <input ref={certBancInputRef} type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }} onChange={(e) => onDocChange(e, setCertBancFile)} />
                {certBancFile && (
                  <div className={extra.fileRow}>
                    <span className={extra.fileName}>✓ {certBancFile.name}</span>
                    <button type="button" className={extra.linkMini} onClick={() => setCertBancFile(null)}>Quitar</button>
                  </div>
                )}
              </div>

              {!esFirma && (
              <div className={extra.docSlot}>
                <span className={extra.docSlotName}>Certificado disciplinario</span>
                <button type="button" className={extra.uploadBtn}
                  onClick={() => certDiscInputRef.current?.click()}>
                  {certDiscFile ? 'Cambiar archivo' : 'Subir certificado disciplinario'}
                </button>
                <input ref={certDiscInputRef} type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }} onChange={(e) => onDocChange(e, setCertDiscFile)} />
                {certDiscFile && (
                  <div className={extra.fileRow}>
                    <span className={extra.fileName}>✓ {certDiscFile.name}</span>
                    <button type="button" className={extra.linkMini} onClick={() => setCertDiscFile(null)}>Quitar</button>
                  </div>
                )}
                <span className={extra.docHint}>
                  Los clientes podrán consultarlo dentro del chat para confiar en ti.
                </span>
              </div>
              )}
            </fieldset>

            {/* Modelo contractual (opcional) — herramienta de quien atiende
                consultas; una firma no envía contratos por sí misma. */}
            {!esFirma && (
            <div className={styles.field}>
              <label className={styles.label}>
                Modelo contractual
                <span className={`${extra.tag} ${extra.tagOpt}`}>Opcional</span>
              </label>
              <button type="button" className={extra.uploadBtn}
                onClick={() => modeloInputRef.current?.click()}>
                {modeloFile ? 'Cambiar archivo' : 'Subir modelo contractual (PDF)'}
              </button>
              <input ref={modeloInputRef} type="file" accept="application/pdf,.pdf"
                style={{ display: 'none' }} onChange={(e) => onDocChange(e, setModeloFile, { pdfOnly: true })} />
              {modeloFile && (
                <div className={extra.fileRow}>
                  <span className={extra.fileName}>✓ {modeloFile.name}</span>
                  <button type="button" className={extra.linkMini} onClick={() => setModeloFile(null)}>Quitar</button>
                </div>
              )}
              <span className={extra.docHint}>
                Tu contrato base para enviar a firma desde cualquier chat. Podrás subirlo o cambiarlo luego en tu perfil.
              </span>
            </div>
            )}

            {/* Experiencia laboral (obligatoria) — es el "Sobre mí" que el
                cliente lee al abrir su tarjeta en el home. Se pide aquí y no
                en el paso anterior porque es lo único del formulario que el
                aspirante tiene que redactar, y venía quedando en blanco.

                Se llama "Experiencia laboral" y no "Tu presentación" porque el
                rótulo vago se contestaba con una línea vacía ("Tengo una
                experiencia profesional en Contaduría Pública, con"). Preguntar
                por dónde ha trabajado y qué procesos ha llevado se contesta con
                hechos, que es lo que el cliente necesita para decidir. */}
            <div className={styles.field}>
              <label className={styles.label}>
                {esFirma ? 'Presentación de la firma' : 'Experiencia laboral'}
                <span className={`${extra.tag} ${extra.tagReq}`}>Obligatorio</span>
              </label>
              <span className={extra.docHint} style={{ marginTop: 0, marginBottom: 6 }}>
                {esFirma
                  ? 'Qué hace la firma, a quién atiende y en qué casos tiene más recorrido.'
                  : 'Dónde has trabajado, en qué eres bueno y qué tipo de procesos has llevado.'}
              </span>
              <textarea
                className={styles.input}
                rows={4}
                maxLength={DESCRIPCION_MAX}
                placeholder={esFirma
                  ? "Ej: Firma de abogados y contadores con 15 años acompañando a pymes y familias en Bogotá. Atendemos derecho laboral, societario y tributario, y llevamos la contabilidad y la revisoría fiscal de empresas del sector comercial."
                  : rol === 'contador'
                  ? "Ej: Contadora pública con 12 años en revisoría fiscal y auditoría externa. He trabajado en el sector solidario y en empresas comerciales, llevando cierres contables, declaraciones de renta e implementación de NIIF."
                  : "Ej: Abogado especializado en derecho laboral, con 6 años acompañando a trabajadores en procesos de despido injustificado y liquidaciones. He llevado casos ante el Ministerio de Trabajo y tribunales de Bogotá."}
                value={descripcionPublica}
                onChange={(e) => setDescripcionPublica(e.target.value.slice(0, DESCRIPCION_MAX))}
                style={{ resize: 'vertical', minHeight: 96, fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 8,
                marginTop: 4, fontSize: '0.68rem', color: 'var(--muted, #6f5c48)',
              }}>
                <span>{esFirma ? 'Es lo primero que lee un cliente en la tarjeta de la firma.' : 'Es lo primero que lee un cliente en la tarjeta del inicio.'}</span>
                <span style={{
                  color: descripcionPublica.trim().length < DESCRIPCION_MIN
                    ? '#9a5b3a'
                    : (descripcionPublica.length >= DESCRIPCION_MAX - 20 ? '#9a5b3a' : 'var(--gold-dk, #8a6a28)'),
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                  {descripcionPublica.trim().length < DESCRIPCION_MIN
                    ? `${DESCRIPCION_MIN - descripcionPublica.trim().length} caracteres más`
                    : `${descripcionPublica.length}/${DESCRIPCION_MAX}`}
                </span>
              </div>
            </div>

            {/* Dirección de oficina (opcional) */}
            <div className={styles.field}>
              <label className={styles.label}>
                Dirección de oficina
                <span className={`${extra.tag} ${extra.tagOpt}`}>Opcional</span>
              </label>
              <input type="text" className={styles.input}
                placeholder="Cra 7 # 12-34, oficina 501, Bogotá"
                value={direccionOficina}
                onChange={(e) => setDireccionOficina(e.target.value)} />
            </div>

            {/* Página web (opcional) */}
            <div className={styles.field}>
              <label className={styles.label}>
                Página web
                <span className={`${extra.tag} ${extra.tagOpt}`}>Opcional</span>
              </label>
              <input type="url" className={styles.input}
                placeholder="https://tusitio.com"
                value={paginaWeb}
                onChange={(e) => setPaginaWeb(e.target.value)} />
            </div>

            {docsError && <p className={styles.msgError} role="alert">{docsError}</p>}

            {/* El botón queda activo para que la validación explique qué falta. */}
            <button type="submit" className={`btn-solid ${styles.submit}`} disabled={docsSubmitting}>
              {docsSubmitting ? 'Enviando…' : 'Enviar para revisión →'}
            </button>
            <p className={styles.hint}>
              {esFirma
                ? 'El administrador revisará la firma y te avisaremos por correo.'
                : 'El administrador revisará tu perfil completo y te avisaremos por correo.'}
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
              {esFirma
                ? 'Tu firma está pendiente de aprobación por el administrador. Te avisaremos por correo; al entrar, el primer paso será registrar a tu Director.'
                : 'Tu cuenta está pendiente de aprobación por el administrador. Te avisaremos por correo cuando esté lista.'}
            </p>
            <button type="button" className={`btn-solid ${styles.submit}`} onClick={onClose}>
              Ir al inicio
            </button>
          </div>
        )}

        {/* ══════════════ CONDICIONES — antes de pedir un solo dato ══════════════ */}
        {rol && verificationStep === 'condiciones' && (() => {
          const c = CONDICIONES[rol === 'gestor' ? 'gestor' : esFirma ? 'firma' : 'profesional']
          const claveContrato = contratoDeRol(rol)
          const contrato = DOCS_LEGALES[claveContrato]
          return (
            <div className={extra.condiciones}>
              <p className={extra.condTitulo}>{c.titulo}</p>
              <p className={extra.condEntrada}>
                {c.entrada}
              </p>

              <ul className={extra.condLista}>
                {c.puntos.map((p) => (
                  <li key={p.titulo} className={extra.condPunto}>
                    <span className={extra.condIcono} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    <span className={extra.condCuerpo}>
                      <strong className={extra.condPuntoTitulo}>{p.titulo}</strong>
                      <span className={extra.condPuntoTexto}>{p.texto}</span>
                    </span>
                  </li>
                ))}
              </ul>

              {/* El contrato completo. Las reglas de arriba son el resumen;
                  esto es lo que de verdad se acepta, y se lee aquí mismo
                  (el visor se abre sobre el formulario, sin perderlo). La
                  fila entera es el botón: se toca el archivo y se abre. */}
              <button
                type="button"
                className={extra.contrato}
                onClick={() => setDocLegal(claveContrato)}
                aria-label={`Abrir ${contrato.titulo}`}
              >
                <span className={extra.contratoIcono} aria-hidden="true"><IconContrato /></span>
                <span className={extra.contratoInfo}>
                  <strong className={extra.contratoTitulo}>{contrato.titulo}</strong>
                  <span className={extra.contratoSub}>{contrato.resumen || contrato.sub} · PDF</span>
                </span>
                <span className={extra.contratoAbrir} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </span>
              </button>

              <label className={extra.condCheck}>
                <input
                  type="checkbox"
                  checked={aceptoCondiciones}
                  onChange={(e) => setAceptoCondiciones(e.target.checked)}
                />
                <span>Leí el {contrato.titulo} y acepto estas condiciones.</span>
              </label>

              <button
                type="button"
                className="aap-accion aap-accion--primaria aap-accion--ancha"
                style={{ minHeight: 46, marginTop: '0.9rem' }}
                disabled={!aceptoCondiciones}
                onClick={() => setVerificationStep('form')}
              >
                Continuar al registro
              </button>
            </div>
          )
        })()}

        {/* ══════════════════ REGISTRO — Paso A (formulario) ══════════════════ */}
        {rol && verificationStep === 'form' && (
          <form className={styles.form} onSubmit={handleRegister} ref={formRef} noValidate>

            {/* Nombre + Apellido: los pide todo rol, gestor incluido. Es a quien
                se le paga una comision, hace falta saber quien es. */}
            {esFirma ? (
              <div className={styles.field}>
                <label className={styles.label}>Nombre de la firma <span className={styles.req}>*</span></label>
                <input type="text" className={cls('nombre')} placeholder="Razón social o nombre comercial"
                  value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={90} required />
              </div>
            ) : (
            <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Nombre <span className={styles.req}>*</span></label>
                  <input type="text" className={cls('nombre')} placeholder="Nombre"
                    value={nombre} onChange={(e) => setNombre(e.target.value)} required />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Apellido <span className={styles.req}>*</span></label>
                  <input type="text" className={cls('apellido')} placeholder="Apellido"
                    value={apellido} onChange={(e) => setApellido(e.target.value)} required />
              </div>
            </div>
            )}

            {/* Username. Se teclea como la persona quiera y se GUARDA en
                minúsculas: así "EstebanArias" y "estebanarias" no acaban siendo
                dos cuentas distintas. No se avisa de la conversión (pedido
                2026-09-28): se entra con el correo, no con el usuario. */}
            <div className={styles.field}>
              <label className={styles.label}>Nombre de usuario <span className={styles.req}>*</span></label>
              <input type="text" className={cls('username')} placeholder={esFirma ? 'Ej: RinconAsociados' : 'Ej: JuanPerez'}
                value={username}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text"
                onChange={(e) => setUsername(limpiarUsername(e.target.value))} required />
              {(() => {
                const v = validarUsername(username)
                if (v.valid === false) {
                  return <span className={extra.docHint} style={{ color: '#9a5b3a' }}>{v.msg}</span>
                }
                return <span className={extra.docHint}>Letras, números, guión y guión bajo. Sin espacios ni tildes.</span>
              })()}
            </div>

            {/* NIT de la firma, en el lugar de la cédula. */}
            {esFirma && (
              <div className={styles.field}>
                <label className={styles.label}>NIT <span className={styles.req}>*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={cls('nit')}
                  placeholder="900123456-7"
                  value={nit}
                  onChange={(e) => setNit(e.target.value.replace(/[^\d-]/g, '').slice(0, 11))}
                  onBlur={() => setNitTouched(true)}
                  required
                  style={borderFor(nitVal.valid, nitTouched, nit)}
                />
                <FieldHint valid={nitVal.valid} msg={nitVal.msg} touched={nitTouched && !!nit} />
              </div>
            )}

            {/* Cédula (obligatoria para las personas: abogado, contador, gestor) */}
            {rol && !esFirma && (
              <div className={styles.field}>
                <label className={styles.label}>Cédula <span className={styles.req}>*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={cls('cedula')}
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

            {/* Celular: tambien para el gestor, es el contacto si un pago falla. */}
            <div className={styles.field}>
                <label className={styles.label}>Celular <span className={styles.req}>*</span></label>
                <input
                  type="tel"
                  inputMode="numeric"
                  className={cls('telefono')}
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

            {/* Correo */}
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico <span className={styles.req}>*</span></label>
              <input
                type="email"
                className={cls('email')}
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
                  className={cls('password')}
                  placeholder="Mínimo 8 caracteres"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  onFocus={() => { setPwTouched(true); setPwFocus(true) }}
                  onBlur={cerrarRequisitos}
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

              {/* Barra de fortaleza (siempre visible; vacía si no hay texto) */}
              <div className={styles.strengthRow} aria-live="polite">
                <div className={styles.strengthBars}>
                  {[1,2,3].map(lvl => (
                    <div key={lvl} className={styles.strengthBar}
                      style={{ background: pwStrength && pwStrength.level >= lvl ? pwStrength.color : 'rgba(109,60,27,0.12)' }} />
                  ))}
                </div>
                <span className={styles.strengthLabel} style={{ color: pwStrength ? pwStrength.color : '#6f5c48' }}>
                  {pwStrength ? pwStrength.label : 'Fuerza'}
                </span>
              </div>

              {/* Requisitos: aparecen al enfocar el campo y se desvanecen al
                  salir. Si la contraseña quedó incompleta siguen a la vista,
                  para que no se pierda el motivo del error. */}
              <div className={`${styles.pwChecklistWrap} ${(pwFocus || (!pwEmpty && !pwValid)) ? styles.pwChecklistWrapOpen : ''}`}>
                <div>
                  <ul className={styles.pwChecklist} aria-label="Requisitos de la contraseña">
                    {pwRules.map(rule => {
                      const estado = pwEmpty ? 'pending' : rule.ok ? 'ok' : 'fail'
                      return (
                        <li key={rule.id}
                          className={`${styles.pwItem} ${estado === 'ok' ? styles.pwItemOk : estado === 'fail' ? styles.pwItemFail : styles.pwItemPending}`}>
                          <span className={styles.pwIcon} aria-hidden="true">
                            {estado === 'ok' ? '✓' : estado === 'fail' ? '✗' : '○'}
                          </span>
                          <span>{rule.label}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
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
                    {/* El abogado no trae "Otra" en su lista; el contador sí trae "Otro". */}
                    {rol === 'abogado' && (
                      <label className={extra.areaItem}>
                        <input type="checkbox" className={extra.areaCheck}
                          checked={areaOtraOn} onChange={() => toggleArea('Otra')} />
                        <span>Otra</span>
                      </label>
                    )}
                  </div>
                  {areaOtraOn && (
                    <input type="text" className={cls('areaOtra')} style={{ marginTop: '0.6rem' }} maxLength={60}
                      placeholder={rol === 'abogado' ? 'Escribe tu otra área' : 'Escribe tu otra especialidad'}
                      aria-label={rol === 'abogado' ? 'Otra área' : 'Otra especialidad'}
                      value={areaOtraTexto} onChange={(e) => setAreaOtraTexto(e.target.value)} />
                  )}
                  <div className={extra.areasCount}>{areasFinales.length} seleccionada{areasFinales.length === 1 ? '' : 's'}</div>
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

                {/* Universidad — obligatoria: sale en la tarjeta del home.
                    "Otra" revela un input libre (mismo patrón que el perfil). */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Universidad <span className={styles.req}>*</span>
                  </label>
                  <select
                    className={cls('universidad')}
                    value={universidadOtra ? 'Otra' : universidad}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === 'Otra') { setUniversidadOtra(true); setUniversidad('') }
                      else { setUniversidadOtra(false); setUniversidad(v) }
                    }}
                  >
                    <option value="">Selecciona…</option>
                    {UNIVERSIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {universidadOtra && (
                    <input
                      type="text"
                      className={styles.input}
                      style={{ marginTop: '0.5rem' }}
                      placeholder="Escribe el nombre de tu universidad"
                      value={universidad}
                      onChange={(e) => setUniversidad(e.target.value)}
                      aria-label="Nombre de tu universidad"
                    />
                  )}
                </div>

                {/* Ubicación — obligatoria: los clientes filtran el home por
                    departamento y ciudad. Mismo selector en cascada del perfil. */}
                <UbicacionSelector
                  departamento={departamento}
                  municipio={ciudad}
                  barrio={barrio}
                  required
                  classes={{ field: styles.field, label: styles.label, select: cls('ubicacion') }}
                  onChange={({ departamento: d, municipio, barrio: b }) => {
                    setDepartamento(d); setCiudad(municipio); setBarrio(b)
                  }}
                />

                {/* Tarjeta profesional */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Tarjeta profesional <span className={styles.req}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
                  </label>
                  <button type="button" className={extra.uploadBtn}
                    data-error={errores.tarjeta ? '1' : undefined}
                    style={errores.tarjeta ? { borderColor: '#a23b3b', color: '#a23b3b' } : undefined}
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

            {/* ── Campos de firma: alcance + áreas + trayectoria + sede + cámara ── */}
            {esFirma && (
              <>
                {/* Alcance del servicio: tres opciones excluyentes, a la vista. */}
                <div className={styles.field}>
                  <span className={styles.label} id="alcance-label">
                    ¿Cómo prestan el servicio? <span className={styles.req}>*</span>
                  </span>
                  <div className={extra.alcance} role="radiogroup" aria-labelledby="alcance-label"
                    data-error={errores.alcance ? '1' : undefined}>
                    {OPCIONES_ALCANCE.map(({ v, t, d }) => (
                      <label key={v}
                        className={`${extra.alcanceOp} ${alcance === v ? extra.alcanceOpActiva : ''} ${errores.alcance ? extra.alcanceOpError : ''}`}>
                        <input type="radio" name="alcance" value={v} checked={alcance === v}
                          onChange={() => setAlcance(v)} className={extra.alcanceRadio} />
                        <span className={extra.alcanceTxt}>
                          <strong>{t}</strong>
                          <span>{d}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Áreas de práctica: una firma puede ser jurídica, contable o las dos. */}
                <div className={styles.field}>
                  <label className={styles.label}>Áreas en las que trabaja la firma</label>
                  <div className={extra.areasBox}>
                    <span className={extra.areasGrupo}>Derecho</span>
                    {AREAS_DERECHO.map(a => (
                      <label key={`d-${a}`} className={extra.areaItem}>
                        <input type="checkbox" className={extra.areaCheck}
                          checked={areas.includes(a)} onChange={() => toggleArea(a)} />
                        <span>{a}</span>
                      </label>
                    ))}
                    <span className={extra.areasGrupo}>Contaduría</span>
                    {AREAS_CONTADURIA.filter(a => !AREAS_DERECHO.includes(a)).map(a => (
                      <label key={`c-${a}`} className={extra.areaItem}>
                        <input type="checkbox" className={extra.areaCheck}
                          checked={areas.includes(a)} onChange={() => toggleArea(a)} />
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                  {areaOtraOn && (
                    <input type="text" className={cls('areaOtra')} style={{ marginTop: '0.6rem' }} maxLength={60}
                      placeholder="Escribe esa otra área" aria-label="Otra área"
                      value={areaOtraTexto} onChange={(e) => setAreaOtraTexto(e.target.value)} />
                  )}
                  <div className={extra.areasCount}>{areasFinales.length} seleccionada{areasFinales.length === 1 ? '' : 's'}</div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Trayectoria de la firma</label>
                  <select className={styles.input} value={experiencia}
                    onChange={(e) => setExperiencia(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {EXPERIENCIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                {/* Sede principal — obligatoria: los clientes filtran por ciudad. */}
                <UbicacionSelector
                  departamento={departamento}
                  municipio={ciudad}
                  barrio={barrio}
                  required
                  classes={{ field: styles.field, label: styles.label, select: cls('ubicacion') }}
                  onChange={({ departamento: d, municipio, barrio: b }) => {
                    setDepartamento(d); setCiudad(municipio); setBarrio(b)
                  }}
                />

                {/* Cámara de comercio — el documento que acredita a la firma,
                    en el lugar de la tarjeta profesional. */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Cámara de comercio <span className={styles.req}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
                  </label>
                  <button type="button" className={extra.uploadBtn}
                    data-error={errores.tarjeta ? '1' : undefined}
                    style={errores.tarjeta ? { borderColor: '#a23b3b', color: '#a23b3b' } : undefined}
                    onClick={() => tarjetaInputRef.current?.click()}>
                    {tarjetaFile ? 'Cambiar archivo' : 'Subir cámara de comercio'}
                  </button>
                  <input
                    ref={tarjetaInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={onTarjetaChange}
                  />
                  {tarjetaFile && <div className={extra.fileName}>✓ {tarjetaFile.name}</div>}
                  <span className={extra.docHint}>
                    Certificado de existencia y representación legal de la firma.
                  </span>
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

                {/* Ubicacion — obligatoria. El selector ya distingue Bogota (Localidad)
                    del resto del pais (Municipio) y ofrece Barrio / Comuna cuando existe. */}
                <UbicacionSelector
                  departamento={departamento}
                  municipio={ciudad}
                  barrio={barrio}
                  required
                  classes={{ field: styles.field, label: styles.label, select: cls('ubicacion') }}
                  onChange={({ departamento: d, municipio, barrio: b }) => {
                    setDepartamento(d); setCiudad(municipio); setBarrio(b)
                  }}
                />

                {/* Certificado bancario — obligatorio: es la cuenta a la que
                    se le consignan las comisiones. Mismo patrón visual que la
                    tarjeta profesional del abogado. */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Certificado bancario <span className={styles.req}>*</span>{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>(PDF o imagen)</span>
                  </label>
                  <button type="button" className={extra.uploadBtn}
                    data-error={errores.certificado ? '1' : undefined}
                    style={errores.certificado ? { borderColor: '#a23b3b', color: '#a23b3b' } : undefined}
                    onClick={() => gestorCertInputRef.current?.click()}>
                    {gestorCertFile ? 'Cambiar archivo' : 'Subir certificado bancario'}
                  </button>
                  <input
                    ref={gestorCertInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      const permitidos = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
                      if (!permitidos.includes(file.type)) {
                        setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return
                      }
                      if (file.size / (1024 * 1024) > 10) {
                        setError('El certificado no puede superar 10 MB'); return
                      }
                      setError(null)
                      setGestorCertFile(file)
                    }}
                  />
                  {gestorCertFile && <div className={extra.fileName}>✓ {gestorCertFile.name}</div>}
                  <span style={{ fontSize: '0.68rem', color: 'var(--muted, #6f5c48)', marginTop: 4, display: 'block' }}>
                    Es la cuenta donde recibirás tus comisiones.
                  </span>
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

            {/* ── Campos personalizados (configurados por el admin maestro) ── */}
            {camposExtra.map(c => (
              <div key={c.id} className={styles.field}>
                <label className={styles.label}>
                  {c.etiqueta} {c.requerido && <span className={styles.req}>*</span>}
                </label>
                {c.tipo === 'checkbox' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!respuestasExtra[c.id]}
                      onChange={e => setRespuestasExtra(r => ({ ...r, [c.id]: e.target.checked }))}
                    />
                    Sí
                  </label>
                ) : c.tipo === 'opciones' ? (
                  <select
                    className={styles.input}
                    value={respuestasExtra[c.id] || ''}
                    onChange={e => setRespuestasExtra(r => ({ ...r, [c.id]: e.target.value }))}
                  >
                    <option value="">Selecciona…</option>
                    {(c.opciones || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={c.tipo === 'numero' ? 'number' : c.tipo === 'url' ? 'url' : 'text'}
                    className={styles.input}
                    placeholder={c.tipo === 'url' ? 'https://…' : ''}
                    value={respuestasExtra[c.id] || ''}
                    onChange={e => setRespuestasExtra(r => ({ ...r, [c.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}

            {/* Términos, datos y el contrato del rol: cada uno se abre en el
                visor sobre el formulario, sin pestaña nueva. */}
            <label className={styles.terminosRow}>
              <input
                type="checkbox"
                checked={aceptaTerminos}
                onChange={e => setAceptaTerminos(e.target.checked)}
                className={styles.terminosCheck}
              />
              <span className={styles.terminosTxt}>
                Acepto los{' '}
                <EnlaceLegal doc="terminos" className={styles.terminosLink}>términos de uso</EnlaceLegal>,{' '}
                la{' '}
                <EnlaceLegal doc="datos" className={styles.terminosLink}>política de tratamiento de datos</EnlaceLegal>{' '}
                y el{' '}
                <EnlaceLegal doc={contratoDeRol(rol)} className={styles.terminosLink}>
                  {DOCS_LEGALES[contratoDeRol(rol)].titulo.toLowerCase()}
                </EnlaceLegal>
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

            {/* Resumen de lo que falta, pegado al boton: es donde mira el
                usuario cuando pulsa y no pasa nada. Enumera los campos en vez
                de decir solo "revisa los datos", para no obligar a buscarlos. */}
            {nErrores > 0 && (
              <div className={extra.resumenErrores} role="alert">
                {nErrores === 1 ? (
                  <><strong>Falta un dato:</strong>{' '}{Object.values(errores)[0]}.</>
                ) : (
                  <><strong>Revisa los datos:</strong>{' '}quedan {nErrores} campos por completar.</>
                )}
                {nErrores > 1 && (
                  <ul className={extra.resumenLista}>
                    {Object.entries(errores).map(([k, msg]) => <li key={k}>{msg}</li>)}
                  </ul>
                )}
              </div>
            )}

            <button type="submit" className={`btn-solid ${styles.submit}`} disabled={loading}>
              {loading ? 'Creando cuenta...' : 'Crear cuenta →'}
            </button>

            <p className={styles.hint}>
              {esFirma
                ? 'Al registrarse, la firma quedará pendiente de aprobación.'
                : 'Al registrarse, su perfil quedará pendiente de aprobación.'}
            </p>
          </form>
        )}
      </div>

      {/* ── Confirmación de salida del paso de documentos (modal de marca) ── */}
      {confirmSalir && (
        <div
          role="dialog" aria-modal="true" aria-label="Salir sin completar el registro"
          onClick={() => setConfirmSalir(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(30,20,12,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fffdf6', borderRadius: 18, padding: '26px 24px',
            maxWidth: 420, width: '100%', textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            <div aria-hidden="true" style={{
              width: 52, height: 52, margin: '0 auto 14px', borderRadius: '50%',
              background: 'rgba(201,168,76,0.14)', border: '1.5px solid rgba(201,168,76,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
                stroke="#b8942f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h4 style={{
              margin: '0 0 8px', color: '#472f29', fontSize: '1.05rem',
              fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.02em',
            }}>
              ¿Salir sin completar?
            </h4>
            <p style={{ margin: '0 0 20px', fontSize: '0.85rem', lineHeight: 1.6, color: '#5a4a3d' }}>
              {esFirma
                ? 'El registro de la firma quedará incompleto sin el logo, la cámara de comercio y el certificado bancario, y el administrador no podrá revisarla hasta entonces.'
                : 'Tu registro quedará incompleto sin la foto, la tarjeta profesional y los dos certificados. Podrás completarlos luego desde tu perfil, pero el administrador no podrá revisarte hasta entonces.'}
            </p>
            <div className={extra.confirmActions}>
              <button type="button" onClick={() => setConfirmSalir(false)}
                className={`btn-solid ${styles.submit} ${extra.confirmBtn}`}>
                Seguir completando
              </button>
              <button type="button" onClick={salirSinCompletar}
                className={`${styles.submit} ${extra.confirmBtn} ${extra.confirmBtnDanger}`}>
                Salir de todas formas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contrato del rol abierto desde el paso de condiciones */}
      <VisorLegal doc={docLegal} onClose={() => setDocLegal(null)} />
    </div>
  )
}
