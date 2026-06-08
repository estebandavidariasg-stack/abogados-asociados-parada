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

// ── Datos de contacto en texto libre (anti-evasión) ────────────────────────
// Usada por los chats (cliente, abogado, contador) para impedir que se
// compartan teléfonos o correos. Tolerante a:
//   · separadores y espacios entre dígitos:  300 123 4567 · 3-0-0-...
//   · prefijo internacional:  +57, 57, +57 (300) 123-4567
//   · correos ofuscados:  "juan arroba gmail punto com", "juan (at) x [dot] co"
// Devuelve true si detecta un teléfono o un correo (estándar u ofuscado).
export function contieneContacto(texto) {
  if (!texto) return false
  const t = String(texto).toLowerCase()

  // ── Correo electrónico ──
  // 1) Estándar:  usuario@dominio.tld
  if (/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(t)) return true
  // 2) Ofuscado:  reemplazo de @ por "arroba"/"at" y de . por "punto"/"dot"
  //    (con o sin paréntesis/corchetes). \b evita falsos positivos dentro de
  //    palabras (p. ej. "at" en "comparativamente").
  const atPart  = '(?:@|\\b(?:arroba|at)\\b)'
  const dotPart = '(?:\\.|\\b(?:punto|dot)\\b)'
  const emailOfuscado = new RegExp(
    `[a-z0-9._%+\\-]{2,}\\s*[([]?\\s*${atPart}\\s*[)\\]]?\\s*` +
    `[a-z0-9\\-]{2,}\\s*[([]?\\s*${dotPart}\\s*[)\\]]?\\s*[a-z]{2,}`,
    'i'
  )
  if (emailOfuscado.test(t)) return true

  // ── Teléfono ──
  const SEP = '[\\s.\\-()]*'   // separadores tolerados entre dígitos
  // 1) Internacional con prefijo «+»: el signo + delata un teléfono, así que
  //    basta con 7+ dígitos (atrapa números cortos que no llegarían a 10).
  if (new RegExp(`\\+${SEP}\\d(?:${SEP}\\d){6,14}`).test(t)) return true
  // 2) Celular colombiano: opcional +57/57, luego 3 + 9 dígitos.
  if (new RegExp(`(?:\\+?${SEP}57${SEP})?3(?:${SEP}\\d){9}`).test(t)) return true
  // 3) Cualquier secuencia de 10+ dígitos (fijos 60X, cuentas, cédulas de 10
  //    díg., internacionales sin «+», dígitos espaciados). El umbral 10 deja
  //    pasar montos comunes (1.500.000 = 7 díg., 15.000.000 = 8 díg.) para no
  //    bloquear texto legítimo: es el punto justo entre cubrir y no ser extremo.
  if (new RegExp(`\\d(?:${SEP}\\d){9,}`).test(t)) return true

  return false
}