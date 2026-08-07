/* ─────────────────────────────────────────────────────────────────────────
   proyectosLey.js — capa de datos del "Debate ciudadano de proyectos de ley".

   NO usa funciones serverless (el proyecto ya está en el límite de 12 de Vercel
   Hobby): lee/escribe por REST directo contra Supabase con RLS. El público usa
   la anon key; el admin usa getAuthHeaders() (token de superadmin).

   Confidencialidad: la cédula viaja/se guarda solo como hash SHA-256 (con una
   sal fija de la app). Sirve para impedir el doble voto — un voto por persona
   y por ámbito (proyecto completo o cada artículo).
   ───────────────────────────────────────────────────────────────────────── */
import { getAuthHeaders } from './supabase'

const URL = import.meta.env.VITE_SUPABASE_URL || ''
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const anonHeaders = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}` })

// Sal fija (no secreta): eleva el costo de una tabla arcoíris sobre cédulas de
// 8-10 dígitos. La determinación (mismo hash para misma cédula) es lo único
// que necesita el UNIQUE index; no requiere secreto del servidor.
const SALT = 'aap-proyectos-ley-v1'

export async function hashCedula(cedula) {
  const data = new TextEncoder().encode(SALT + ':' + String(cedula).trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ── Postura del voto ("Apoya") ─────────────────────────────────────────── */
export const APOYA = [
  { key: 'a_favor',  label: 'A favor',  color: '#2e7d5b' },
  { key: 'en_contra', label: 'En contra', color: '#b4442f' },
  { key: 'neutral',  label: 'Neutral',  color: '#C9A84C' },
]
export const apoyaMeta = (k) => APOYA.find(a => a.key === k) || { key: k, label: k, color: '#8a4e26' }

export const OBS_MAX = 500

/* ═══════════════════════════════════════════════════════════════════════════
   MODO DEMOSTRACIÓN — se activa con ?demo=1 en la URL (persiste en
   localStorage; ?demo=0 lo apaga). Simula el backend en el navegador para
   probar TODO el flujo (votar completo/articulado, bloqueo de doble voto,
   torta de resultados) SIN Supabase ni el SQL aplicado. En producción normal
   (sin la bandera) nada de esto se ejecuta.
   ═══════════════════════════════════════════════════════════════════════════ */
export const esDemo = () => { try { return localStorage.getItem('pl_demo') === '1' } catch { return false } }

const DEMO_PROYECTOS = [
  { id: 'demo-1', nombre: 'Reforma al Código de Comercio', numero: 'Proyecto de Ley 145 de 2026',
    descripcion: 'Moderniza el régimen societario, reconoce la firma electrónica en actos mercantiles y simplifica la constitución de empresas.',
    fecha_radicacion: '2026-07-15', permite_articulado: true, publicado: true, orden: 0 },
  { id: 'demo-2', nombre: 'Ley de Teletrabajo Rural', numero: 'Proyecto de Ley 201 de 2026',
    descripcion: 'Crea incentivos para el trabajo remoto en municipios apartados y garantiza conectividad como servicio esencial.',
    fecha_radicacion: '2026-06-02', permite_articulado: false, publicado: true, orden: 1 },
]
const DEMO_ARTICULOS = {
  'demo-1': [
    { id: 'demo-1-a1', proyecto_id: 'demo-1', numero: 1, titulo: 'Objeto', contenido: 'La presente ley moderniza el Código de Comercio y adapta sus disposiciones a la economía digital.', orden: 0 },
    { id: 'demo-1-a2', proyecto_id: 'demo-1', numero: 2, titulo: 'Firma electrónica', contenido: 'Se reconoce plena validez a la firma electrónica en los actos y contratos mercantiles.', orden: 1 },
    { id: 'demo-1-a3', proyecto_id: 'demo-1', numero: 3, titulo: 'Constitución simplificada', contenido: 'La creación de sociedades podrá hacerse en línea en un término máximo de 24 horas.', orden: 2 },
  ],
  'demo-2': [],
}
const leerDemoVotos = () => { try { return JSON.parse(localStorage.getItem('pl_demo_votos') || '[]') } catch { return [] } }
const escribirDemoVotos = (v) => localStorage.setItem('pl_demo_votos', JSON.stringify(v))
// Siembra los votos de ejemplo una sola vez, SIN pisar votos ya emitidos por
// quien prueba (los agrega). Se llama al activar el modo demo, antes de votar.
function sembrarDemo() {
  if (localStorage.getItem('pl_demo_seed') === '1') return
  let t = Date.parse('2026-08-01T09:00:00Z')
  const s = (proyecto_id, articulo_id, apoya, departamento, municipio, observaciones = null) => {
    t += 3600000 + Math.floor(Math.random() * 6) * 3600000
    return { proyecto_id, articulo_id, apoya, departamento, municipio, observaciones,
      cedula_hash: 'seed-' + Math.random().toString(36).slice(2), created_at: new Date(t).toISOString() }
  }
  const seed = [
    s('demo-1', null, 'a_favor', 'Antioquia', 'Medellín', 'Excelente que por fin se reconozca la firma electrónica; agiliza todo para las pymes.'),
    s('demo-1', null, 'a_favor', 'Antioquia', 'Envigado', 'Muy necesario para modernizar el país. Apoyo la reforma completa.'),
    s('demo-1', null, 'en_contra', 'Cundinamarca', 'Bogotá D.C.', 'Me preocupa que la constitución en 24 horas debilite los controles contra el lavado de activos.'),
    s('demo-1', null, 'neutral', 'Valle del Cauca', 'Cali', 'Buena intención, pero falta claridad sobre cómo se implementará en municipios pequeños.'),
    s('demo-1', null, 'a_favor', 'Cundinamarca', 'Bogotá D.C.', 'Reduce trámites y costos para emprender. Ojalá avance rápido en el Congreso.'),
    s('demo-1', null, 'en_contra', 'Antioquia', 'Medellín', 'Debería incluir un régimen de transición para las sociedades ya constituidas.'),
    s('demo-1', null, 'a_favor', 'Valle del Cauca', 'Palmira', 'Buen paso hacia la formalización empresarial en las regiones.'),
    s('demo-1', null, 'neutral', 'Santander', 'Bucaramanga', 'Depende mucho de la reglamentación posterior. Hay que ver la letra menuda.'),
    s('demo-1', null, 'en_contra', 'Cundinamarca', 'Soacha', 'Falta articular esto con la DIAN y las cámaras de comercio.'),
    s('demo-1', null, 'a_favor', 'Antioquia', 'Bello', 'Como contador, celebro la firma electrónica en actos mercantiles.'),
    s('demo-1', 'demo-1-a2', 'a_favor', 'Antioquia', 'Medellín', 'El artículo 2 sobre firma electrónica es el más importante de toda la reforma.'),
    s('demo-1', 'demo-1-a2', 'a_favor', 'Valle del Cauca', 'Cali', 'Alinea a Colombia con estándares internacionales de firma digital.'),
    s('demo-1', 'demo-1-a2', 'en_contra', 'Cundinamarca', 'Bogotá D.C.', 'Falta precisar qué entidad certificará la validez de la firma.'),
    s('demo-1', 'demo-1-a2', 'neutral', 'Santander', 'Bucaramanga', 'De acuerdo en principio, pero ¿qué pasa con quien no tiene medios digitales?'),
    s('demo-1', 'demo-1-a3', 'neutral', 'Antioquia', 'Medellín', 'La constitución en línea es útil, pero 24 horas puede ser muy poco para verificar identidad.'),
    s('demo-1', 'demo-1-a3', 'en_contra', 'Cundinamarca', 'Bogotá D.C.', 'Ese plazo tan corto abre la puerta a empresas fachada.'),
    s('demo-2', null, 'a_favor', 'Antioquia', 'Medellín', 'El teletrabajo rural puede frenar la migración a las ciudades. Ojalá se apruebe.'),
    s('demo-2', null, 'a_favor', 'Cundinamarca', 'Bogotá D.C.', 'Excelente para descentralizar el empleo formal.'),
    s('demo-2', null, 'en_contra', 'Valle del Cauca', 'Cali', 'Sin garantía real de conectividad, la ley se queda en el papel.'),
    s('demo-2', null, 'neutral', 'Santander', 'Bucaramanga', 'Buena idea, pero primero hay que llevar internet a esas zonas.'),
  ]
  escribirDemoVotos([...leerDemoVotos(), ...seed])
  localStorage.setItem('pl_demo_seed', '1')
}

// Activación del modo demo (?demo=1 / ?demo=0). Al encender, siembra de una
// vez para que la torta ya tenga datos antes de la primera interacción.
try {
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('demo')
    if (q === '1') { localStorage.setItem('pl_demo', '1'); sembrarDemo() }
    if (q === '0') { localStorage.removeItem('pl_demo'); localStorage.removeItem('pl_demo_seed'); localStorage.removeItem('pl_demo_votos') }
  }
} catch { /* sin window */ }

const norm = (a) => a == null ? '' : a
function demoResumen(proyectoId) {
  const map = new Map()
  for (const v of leerDemoVotos().filter(v => v.proyecto_id === proyectoId)) {
    const key = [norm(v.articulo_id), norm(v.departamento), norm(v.municipio), v.apoya].join('|')
    const cur = map.get(key) || { proyecto_id: proyectoId, articulo_id: v.articulo_id || null, departamento: v.departamento, municipio: v.municipio, apoya: v.apoya, total: 0 }
    cur.total++; map.set(key, cur)
  }
  return Array.from(map.values())
}
function demoComentarios(proyectoId) {
  return leerDemoVotos()
    .filter(v => v.proyecto_id === proyectoId && v.observaciones && String(v.observaciones).trim())
    .map((v, i) => ({ id: 'c' + i, proyecto_id: v.proyecto_id, articulo_id: v.articulo_id || null,
      apoya: v.apoya, observaciones: v.observaciones, departamento: v.departamento, municipio: v.municipio, created_at: v.created_at }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

/* ── Lecturas públicas ──────────────────────────────────────────────────── */
// Lectura REST tolerante a fallos de red: cualquier error (DNS, timeout, !ok)
// devuelve [] para que la UI muestre el estado vacío en vez de colgarse.
async function getLista(path) {
  try {
    const res = await fetch(`${URL}/rest/v1/${path}`, { headers: anonHeaders() })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

// Llama una función RPC (SECURITY DEFINER) y devuelve su array. Los agregados y
// comentarios públicos ya NO salen de vistas (evita el "Security Definer View"
// del linter): salen de funciones que exponen solo datos sin PII.
async function rpcLista(fn, body, headers) {
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...(headers || anonHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export function fetchProyectosPublicos() {
  if (esDemo()) return Promise.resolve(DEMO_PROYECTOS.filter(p => p.publicado))
  return getLista('proyectos_ley?select=*&publicado=eq.true&order=orden.asc,fecha_radicacion.desc')
}

export function fetchArticulos(proyectoId) {
  if (esDemo()) return Promise.resolve(DEMO_ARTICULOS[proyectoId] || [])
  return getLista(`articulos_proyecto?select=*&proyecto_id=eq.${proyectoId}&order=orden.asc,numero.asc`)
}

// Agregados públicos (sin PII) para las gráficas. Devuelve filas:
// { proyecto_id, articulo_id, departamento, municipio, apoya, total }
export function fetchResumen(proyectoId) {
  if (esDemo()) return Promise.resolve(demoResumen(proyectoId))
  return rpcLista('pl_resumen', { p_proyecto: proyectoId })
}

// Comentarios públicos ANÓNIMOS (postura + observación + ubicación + fecha,
// sin datos personales). Alimenta la sección "Opiniones de la ciudadanía".
export function fetchComentarios(proyectoId) {
  if (esDemo()) return Promise.resolve(demoComentarios(proyectoId))
  return rpcLista('pl_comentarios', { p_proyecto: proyectoId })
}

/* ── Verificación del votante por correo (OTP) ──────────────────────────── */
// Reutiliza las funciones serverless existentes (tipo 'voto'): NO agrega
// funciones. En modo demo simula el envío y acepta el código DEMO_CODIGO.
export const DEMO_CODIGO = '000000'

// Se pone en true cuando NO hay backend real detrás (modo demo, o `npm run dev`
// sin las funciones serverless de Vercel): el paso de código se simula y se
// acepta DEMO_CODIGO. En producción SIEMPRE es false → correo real obligatorio.
let _otpSimulado = false
export const otpSimulado = () => _otpSimulado || esDemo()

export async function enviarCodigo(email) {
  // Demo o desarrollo local (Vite NO ejecuta las funciones /api): se simula el
  // envío y se acepta el código DEMO_CODIGO. En producción (Vercel) esto nunca
  // ocurre (import.meta.env.DEV = false) → se envía el correo real.
  if (esDemo() || import.meta.env.DEV) { _otpSimulado = true; return { ok: true, demo: true } }
  try {
    const res = await fetch('/api/send-verification-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tipoRegistro: 'voto' }),
    })
    if (res.ok) { _otpSimulado = false; return { ok: true } }
    // En desarrollo local (Vite, sin /api) la ruta no existe → simular para
    // poder probar el flujo. NUNCA ocurre en producción (import.meta.env.DEV=false).
    if (import.meta.env.DEV && (res.status === 404 || res.status === 405)) {
      _otpSimulado = true; return { ok: true, demo: true }
    }
    const data = await res.json().catch(() => null)
    if (res.status === 429) return { ok: false, error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }
    return { ok: false, error: data?.error || 'No se pudo enviar el código. Intenta de nuevo.' }
  } catch {
    if (import.meta.env.DEV) { _otpSimulado = true; return { ok: true, demo: true } }
    return { ok: false, error: 'No hay conexión para enviar el código.' }
  }
}

export async function verificarCodigo(email, code) {
  if (otpSimulado() || import.meta.env.DEV) return { ok: String(code).trim() === DEMO_CODIGO }
  try {
    const res = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (res.ok) return { ok: true }
    if (import.meta.env.DEV && (res.status === 404 || res.status === 405)) {
      return { ok: String(code).trim() === DEMO_CODIGO }
    }
    const data = await res.json().catch(() => null)
    return { ok: false, error: data?.error || 'Código inválido o expirado' }
  } catch {
    if (import.meta.env.DEV) return { ok: String(code).trim() === DEMO_CODIGO }
    return { ok: false, error: 'No hay conexión para verificar el código.' }
  }
}

/* ── Emitir voto(s) ─────────────────────────────────────────────────────── */
// filas: array de objetos listos para insertar. Devuelve:
//   { ok:true } | { ok:false, code:'duplicado' } | { ok:false, code:'error', msg }
export async function emitirVotos(filas) {
  // Modo demo: simula el UNIQUE index (un voto por persona y ámbito). Si
  // cualquier fila choca con un voto existente, se rechaza el lote completo
  // (igual que el INSERT atómico real → 409), sin insertar nada.
  if (esDemo()) {
    const votos = leerDemoVotos()
    const existe = (f) => votos.some(v =>
      v.proyecto_id === f.proyecto_id &&
      v.cedula_hash === f.cedula_hash &&
      norm(v.articulo_id) === norm(f.articulo_id))
    if (filas.some(existe)) return { ok: false, code: 'duplicado' }
    const stamp = new Date().toISOString()
    escribirDemoVotos([...votos, ...filas.map(f => ({ ...f, created_at: f.created_at || stamp }))])
    return { ok: true }
  }
  try {
    const res = await fetch(`${URL}/rest/v1/votos_proyecto`, {
      method: 'POST',
      headers: { ...anonHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(filas),
    })
    if (res.ok) return { ok: true }
    let body = null
    try { body = await res.json() } catch { /* sin cuerpo */ }
    if (res.status === 409 || body?.code === '23505') return { ok: false, code: 'duplicado' }
    return { ok: false, code: 'error', msg: body?.message || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, code: 'error', msg: err.message }
  }
}

/* ── Admin (superadmin) ─────────────────────────────────────────────────── */
export async function fetchProyectosAdmin() {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${URL}/rest/v1/proyectos_ley?select=*&order=orden.asc,created_at.desc`,
      { headers }
    )
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function crearProyecto(payload) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${URL}/rest/v1/proyectos_ley`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  return res.ok ? (Array.isArray(data) ? data[0] : data) : null
}

export async function actualizarProyecto(id, payload) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${URL}/rest/v1/proyectos_ley?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  })
  return res.ok
}

export async function eliminarProyecto(id) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${URL}/rest/v1/proyectos_ley?id=eq.${id}`, { method: 'DELETE', headers })
  return res.ok
}

export async function reemplazarArticulos(proyectoId, articulos) {
  const headers = await getAuthHeaders()
  // Borra los actuales y reinserta (el editor del admin es la fuente de verdad).
  await fetch(`${URL}/rest/v1/articulos_proyecto?proyecto_id=eq.${proyectoId}`, { method: 'DELETE', headers })
  const filas = articulos
    .map((a, i) => ({
      proyecto_id: proyectoId,
      numero: a.numero != null && a.numero !== '' ? Number(a.numero) : i + 1,
      titulo: a.titulo?.trim() || null,
      contenido: a.contenido?.trim() || null,
      orden: i,
    }))
    .filter(a => a.titulo || a.contenido)
  if (!filas.length) return true
  const res = await fetch(`${URL}/rest/v1/articulos_proyecto`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(filas),
  })
  return res.ok
}

// Detalle completo (con PII) — solo superadmin lo puede leer (RLS).
export async function fetchVotosDetalle(proyectoId) {
  try {
    const headers = await getAuthHeaders()
    // Detalle CON PII → solo superadmin, vía función SECURITY DEFINER.
    return await rpcLista('pl_votos_detalle', { p_proyecto: proyectoId }, headers)
  } catch { return [] }
}

/* ── Utilidades de reporte (CSV, cliente) ───────────────────────────────── */
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCSV(headers, rows) {
  // BOM para que Excel abra UTF-8 con tildes correctamente.
  const linea = (arr) => arr.map(csvCell).join(',')
  return '﻿' + [linea(headers), ...rows.map(linea)].join('\r\n')
}
export function descargarArchivo(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([contenido], { type: tipo })
  const url  = window.URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export const fmtFecha = (d) => {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return String(d) }
}
