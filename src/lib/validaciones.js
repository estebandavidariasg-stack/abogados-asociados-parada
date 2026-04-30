// ── Contraseña ────────────────────────────────────────────────────────────
export const PASSWORD_RULES = [
  { id: 'length',   label: 'Mínimo 8 caracteres',          test: p => p.length >= 8 },
  { id: 'upper',    label: 'Al menos una mayúscula',        test: p => /[A-Z]/.test(p) },
  { id: 'lower',    label: 'Al menos una minúscula',        test: p => /[a-z]/.test(p) },
  { id: 'number',   label: 'Al menos un número',            test: p => /\d/.test(p) },
  { id: 'special',  label: 'Al menos un carácter especial', test: p => /[^A-Za-z0-9\s]/.test(p) },
  { id: 'nospaces', label: 'Sin espacios',                  test: p => p.length > 0 && !/\s/.test(p) },
]

export function getPasswordStrength(password) {
  if (!password) return null
  const passed = PASSWORD_RULES.filter(r => r.test(password)).length
  if (passed <= 2) return { label: 'Débil',  level: 1, color: '#e05555', bg: 'rgba(220,85,85,0.15)' }
  if (passed <= 4) return { label: 'Media',  level: 2, color: '#c9a030', bg: 'rgba(201,160,48,0.15)' }
  return              { label: 'Fuerte', level: 3, color: '#2ecc71', bg: 'rgba(46,204,113,0.15)' }
}

export function isPasswordValid(password) {
  return PASSWORD_RULES.every(r => r.test(password))
}

// ── Celular colombiano ────────────────────────────────────────────────────
export function normalizarCelular(raw) {
  // Eliminar todo excepto dígitos
  let v = raw.replace(/\D/g, '')
  // Quitar prefijo 57 si viene con él y tiene más de 10 dígitos
  if ((v.startsWith('57')) && v.length > 10) v = v.slice(2)
  return v
}

export function validarCelular(raw) {
  if (!raw || raw.trim() === '') return { valid: null, msg: '' }
  const v = normalizarCelular(raw)
  if (!/^\d+$/.test(raw.replace(/[+\s]/g, ''))) return { valid: false, msg: 'Solo se permiten números' }
  if (!v.startsWith('3'))  return { valid: false, msg: 'Debe iniciar por 3 (ej: 3001234567)' }
  if (v.length < 10)       return { valid: false, msg: `Faltan ${10 - v.length} dígito${10 - v.length > 1 ? 's' : ''}` }
  if (v.length > 10)       return { valid: false, msg: 'Demasiados dígitos (máx. 10)' }
  return { valid: true, msg: 'Número válido ✓' }
}

// ── Correo ────────────────────────────────────────────────────────────────
export function validarCorreo(email) {
  if (!email || email.trim() === '') return { valid: null, msg: '' }
  if (/\s/.test(email))              return { valid: false, msg: 'No se permiten espacios' }
  if (!email.includes('@'))          return { valid: false, msg: 'Falta el símbolo @' }
  const [local, domain] = email.split('@')
  if (!local || local.length === 0)  return { valid: false, msg: 'Falta el texto antes del @' }
  if (!domain || domain.length === 0) return { valid: false, msg: 'Falta el dominio' }
  if (!domain.includes('.'))         return { valid: false, msg: 'El dominio debe tener un punto (ej: .com)' }
  const ext = domain.split('.').pop()
  if (!ext || ext.length < 2)        return { valid: false, msg: 'Extensión inválida (ej: .com, .co)' }
  const regex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
  if (!regex.test(email))            return { valid: false, msg: 'Formato inválido (ej: usuario@gmail.com)' }
  return { valid: true, msg: 'Correo válido ✓' }
}