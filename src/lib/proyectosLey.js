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
    fecha_radicacion: '2026-07-15', permite_articulado: true, publicado: true, orden: 0,
    enlace_documento: 'https://www.camara.gov.co/reforma-codigo-comercio',
    estado_resultado: null, resultado_fecha: null, resultado_notas: null },
  { id: 'demo-2', nombre: 'Ley de Teletrabajo Rural', numero: 'Proyecto de Ley 201 de 2026',
    descripcion: 'Crea incentivos para el trabajo remoto en municipios apartados y garantiza conectividad como servicio esencial.',
    fecha_radicacion: '2026-06-02', permite_articulado: false, publicado: true, orden: 1,
    enlace_documento: null, estado_resultado: null, resultado_fecha: null, resultado_notas: null },
  { id: 'demo-3', nombre: 'Ley de Educación Digital', numero: 'Proyecto de Ley 233 de 2026',
    descripcion: 'Garantiza conectividad y dispositivos en colegios públicos e incorpora la alfabetización digital al currículo escolar.',
    fecha_radicacion: '2026-05-10', permite_articulado: false, publicado: true, orden: 2,
    enlace_documento: 'https://www.senado.gov.co/ley-educacion-digital',
    estado_resultado: 'aprobado', resultado_fecha: '2026-08-06',
    resultado_notas: 'El proyecto fue aprobado en segundo debate y pasa a sanción presidencial. Gracias por tu participación.' },
]
const DEMO_ARTICULOS = {
  'demo-1': [
    { id: 'demo-1-a1', proyecto_id: 'demo-1', numero: 1, titulo: 'Objeto', contenido: 'La presente ley moderniza el Código de Comercio y adapta sus disposiciones a la economía digital.', orden: 0 },
    { id: 'demo-1-a2', proyecto_id: 'demo-1', numero: 2, titulo: 'Firma electrónica', contenido: 'Se reconoce plena validez a la firma electrónica en los actos y contratos mercantiles.', orden: 1 },
    { id: 'demo-1-a3', proyecto_id: 'demo-1', numero: 3, titulo: 'Constitución simplificada', contenido: 'La creación de sociedades podrá hacerse en línea en un término máximo de 24 horas.', orden: 2 },
  ],
  'demo-2': [],
  'demo-3': [],
}

/* Datos sintéticos para poblar la demo (cientos de votos: torta, filtros por
   departamento/localidad, comentarios con nombre). Bogotá D.C. va como su
   propio "departamento" con sus LOCALIDADES (no bajo Cundinamarca). */
const DEMO_NOMBRES = [
  'María Camila Rodríguez', 'Juan David Gómez', 'Laura Valentina Martínez', 'Andrés Felipe Torres',
  'Daniela Alejandra Ramírez', 'Santiago Herrera', 'Valeria Muñoz', 'Sebastián Castro',
  'Isabella Vargas', 'Mateo Jiménez', 'Sofía Restrepo', 'Nicolás Rojas', 'Gabriela Ospina',
  'Samuel Cárdenas', 'Mariana Quintero', 'Emmanuel Salazar', 'Antonia Peña', 'David Mendoza',
  'Luciana Arango', 'Tomás Cortés', 'Manuela Giraldo', 'Alejandro Suárez', 'Camila Andrea Núñez',
  'Diego Fernando Ríos', 'Paula Ospina', 'Carlos Andrés Bernal', 'Natalia Beltrán', 'Julián Acosta',
  'Sara Montoya', 'Felipe Cárdenas', 'Ana Sofía Delgado', 'Ricardo Pineda', 'Verónica Lozano',
  'Óscar Iván Guzmán', 'Catalina Ríos', 'Miguel Ángel Parra', 'Juliana Correa', 'Esteban Villalba',
]
const DEMO_LUGARES = [
  ['Antioquia', 'Medellín'], ['Antioquia', 'Envigado'], ['Antioquia', 'Bello'], ['Antioquia', 'Itagüí'],
  ['Valle del Cauca', 'Cali'], ['Valle del Cauca', 'Palmira'], ['Valle del Cauca', 'Buga'],
  ['Bogotá D.C.', 'Suba'], ['Bogotá D.C.', 'Kennedy'], ['Bogotá D.C.', 'Chapinero'],
  ['Bogotá D.C.', 'Usaquén'], ['Bogotá D.C.', 'Engativá'], ['Bogotá D.C.', 'Bosa'],
  ['Bogotá D.C.', 'Teusaquillo'], ['Bogotá D.C.', 'Ciudad Bolívar'], ['Bogotá D.C.', 'Fontibón'],
  ['Santander', 'Bucaramanga'], ['Santander', 'Floridablanca'], ['Atlántico', 'Barranquilla'],
  ['Atlántico', 'Soledad'], ['Nariño', 'Pasto'], ['Cundinamarca', 'Soacha'], ['Cundinamarca', 'Zipaquirá'],
  ['Cundinamarca', 'Chía'], ['Bolívar', 'Cartagena de Indias'], ['Caldas', 'Manizales'],
  ['Risaralda', 'Pereira'], ['Boyacá', 'Tunja'],
]
const DEMO_POSTURAS = ['a_favor', 'a_favor', 'a_favor', 'en_contra', 'en_contra', 'neutral']
const DEMO_OBS = [
  'Me parece una iniciativa necesaria para el país; ojalá avance en el Congreso.',
  'Tengo dudas sobre cómo se financiará y se implementará en las regiones.',
  'Buen paso, pero falta claridad en la reglamentación posterior.',
  'No estoy de acuerdo: creo que abre la puerta a abusos que no se controlan bien.',
  'Como ciudadano, celebro que por fin se debata este tema abiertamente.',
  'Depende mucho de la letra menuda; habría que revisar cada artículo con cuidado.',
]
// Genera `n` votos de un ámbito (articuloId null = proyecto completo) partiendo
// de un offset para que las cédulas/hashes no colisionen entre ámbitos.
function genVotos(proyecto_id, articulo_id, n, offset, tBase) {
  const filas = []
  for (let i = 0; i < n; i++) {
    const idx = offset + i
    const [departamento, municipio] = DEMO_LUGARES[idx % DEMO_LUGARES.length]
    const apoya = DEMO_POSTURAS[idx % DEMO_POSTURAS.length]
    const nombre = DEMO_NOMBRES[idx % DEMO_NOMBRES.length]
    const observaciones = idx % 5 < 2 ? DEMO_OBS[idx % DEMO_OBS.length] : null
    filas.push({
      proyecto_id, articulo_id, apoya, departamento, municipio, observaciones,
      nombre, cedula: String(1000000000 + idx * 7919).slice(0, 10),
      cedula_hash: 'seed-' + proyecto_id + '-' + (articulo_id || 'full') + '-' + idx,
      created_at: new Date(tBase + idx * 5400000).toISOString(),
    })
  }
  return filas
}
const leerDemoVotos = () => { try { return JSON.parse(localStorage.getItem('pl_demo_votos') || '[]') } catch { return [] } }
const escribirDemoVotos = (v) => localStorage.setItem('pl_demo_votos', JSON.stringify(v))
// Siembra los votos de ejemplo una sola vez, SIN pisar votos ya emitidos por
// quien prueba (los agrega). Se llama al activar el modo demo, antes de votar.
function sembrarDemo() {
  if (localStorage.getItem('pl_demo_seed') === '2') return
  let n = 0
  // Comentarios curados (con nombre) atados al contenido real del articulado —
  // se leen mejor que los sintéticos. Bogotá va como su propio departamento.
  const s = (proyecto_id, articulo_id, apoya, nombre, departamento, municipio, observaciones = null) => {
    n++
    return { proyecto_id, articulo_id, apoya, nombre, departamento, municipio, observaciones,
      cedula: String(1032000000 + n * 131).slice(0, 10),
      cedula_hash: 'seed-cur-' + n,
      created_at: new Date(Date.parse('2026-08-01T09:00:00Z') + n * 4200000).toISOString() }
  }
  const curados = [
    s('demo-1', null, 'a_favor', 'María Camila Rodríguez', 'Antioquia', 'Medellín', 'Excelente que por fin se reconozca la firma electrónica; agiliza todo para las pymes.'),
    s('demo-1', null, 'a_favor', 'Juan David Gómez', 'Antioquia', 'Envigado', 'Muy necesario para modernizar el país. Apoyo la reforma completa.'),
    s('demo-1', null, 'en_contra', 'Laura Valentina Martínez', 'Bogotá D.C.', 'Chapinero', 'Me preocupa que la constitución en 24 horas debilite los controles contra el lavado de activos.'),
    s('demo-1', null, 'neutral', 'Andrés Felipe Torres', 'Valle del Cauca', 'Cali', 'Buena intención, pero falta claridad sobre cómo se implementará en municipios pequeños.'),
    s('demo-1', null, 'a_favor', 'Daniela Alejandra Ramírez', 'Bogotá D.C.', 'Suba', 'Reduce trámites y costos para emprender. Ojalá avance rápido en el Congreso.'),
    s('demo-1', null, 'en_contra', 'Santiago Herrera', 'Antioquia', 'Medellín', 'Debería incluir un régimen de transición para las sociedades ya constituidas.'),
    s('demo-1', null, 'a_favor', 'Valeria Muñoz', 'Valle del Cauca', 'Palmira', 'Buen paso hacia la formalización empresarial en las regiones.'),
    s('demo-1', 'demo-1-a2', 'a_favor', 'Isabella Vargas', 'Antioquia', 'Medellín', 'El artículo 2 sobre firma electrónica es el más importante de toda la reforma.'),
    s('demo-1', 'demo-1-a2', 'a_favor', 'Mateo Jiménez', 'Valle del Cauca', 'Cali', 'Alinea a Colombia con estándares internacionales de firma digital.'),
    s('demo-1', 'demo-1-a2', 'en_contra', 'Sofía Restrepo', 'Bogotá D.C.', 'Kennedy', 'Falta precisar qué entidad certificará la validez de la firma.'),
    s('demo-1', 'demo-1-a3', 'neutral', 'Nicolás Rojas', 'Antioquia', 'Medellín', 'La constitución en línea es útil, pero 24 horas puede ser muy poco para verificar identidad.'),
    s('demo-1', 'demo-1-a3', 'en_contra', 'Gabriela Ospina', 'Bogotá D.C.', 'Usaquén', 'Ese plazo tan corto abre la puerta a empresas fachada.'),
    s('demo-2', null, 'a_favor', 'Samuel Cárdenas', 'Antioquia', 'Medellín', 'El teletrabajo rural puede frenar la migración a las ciudades. Ojalá se apruebe.'),
    s('demo-2', null, 'a_favor', 'Mariana Quintero', 'Bogotá D.C.', 'Engativá', 'Excelente para descentralizar el empleo formal.'),
    s('demo-2', null, 'en_contra', 'Emmanuel Salazar', 'Valle del Cauca', 'Cali', 'Sin garantía real de conectividad, la ley se queda en el papel.'),
  ]
  // Volumen: cientos de votos sintéticos para probar torta, filtros y descargas.
  const T = Date.parse('2026-07-20T08:00:00Z')
  const bulk = [
    ...genVotos('demo-1', null, 96, 0, T),
    ...genVotos('demo-1', 'demo-1-a1', 22, 200, T),
    ...genVotos('demo-1', 'demo-1-a2', 26, 400, T),
    ...genVotos('demo-1', 'demo-1-a3', 20, 600, T),
    ...genVotos('demo-2', null, 64, 800, T),
    ...genVotos('demo-3', null, 48, 1000, T),
  ]
  escribirDemoVotos([...leerDemoVotos(), ...curados, ...bulk])
  localStorage.setItem('pl_demo_seed', '2')
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
// id ESTABLE por comentario (para que reacciones/respuestas/reportes persistan):
// deriva del hash de cédula + ámbito, únicos en la semilla demo.
const demoComId = (v) => 'dc-' + (v.cedula_hash || 'x') + '-' + (v.articulo_id || 'full')
function demoComentarios(proyectoId) {
  return leerDemoVotos()
    .filter(v => v.proyecto_id === proyectoId && v.observaciones && String(v.observaciones).trim())
    .map(v => ({ id: demoComId(v), proyecto_id: v.proyecto_id, articulo_id: v.articulo_id || null,
      apoya: v.apoya, observaciones: v.observaciones, nombre: v.nombre || null,
      departamento: v.departamento, municipio: v.municipio, created_at: v.created_at }))
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

/* ═══════════════════════════════════════════════════════════════════════════
   CAPA SOCIAL DE COMENTARIOS — acuerdo/desacuerdo, respuestas, reportes.
   Backend: RPCs SECURITY DEFINER (ver proyectos-ley-comentarios-social-*.sql).
   En modo demo se simula todo en localStorage.
   ═══════════════════════════════════════════════════════════════════════════ */

// Identidad anónima del navegante (no es prueba de identidad; solo evita el
// doble clic y permite alternar la reacción). El VOTO sí exige OTP aparte.
export function anonId() {
  try {
    let id = localStorage.getItem('pl_anon')
    if (!id) {
      id = (crypto?.randomUUID?.() || ('a' + Math.random().toString(36).slice(2) + Date.now().toString(36)))
      localStorage.setItem('pl_anon', id)
    }
    return id
  } catch { return 'anon' }
}

// Espejo local de MIS reacciones (qué marqué en este navegador) → resalta el
// botón activo aunque los conteos vengan del servidor.
const leerMis   = () => { try { return JSON.parse(localStorage.getItem('pl_mis_reacc') || '{}') } catch { return {} } }
const escribirMis = (m) => { try { localStorage.setItem('pl_mis_reacc', JSON.stringify(m)) } catch { /* */ } }
export const miReaccion = (comId) => leerMis()[comId] || null

// ── Stores demo ─────────────────────────────────────────────────────────────
const dGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
const dSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* */ } }
const D_REACC = 'pl_demo_reacc', D_RESP = 'pl_demo_resp', D_REPORT = 'pl_demo_report', D_MOD = 'pl_demo_mod'

// Siembra social del demo: da a cada comentario likes/desacuerdos y algunas
// respuestas (determinista por id, para que se vea "vivo"). No pisa las
// reacciones/respuestas ya existentes del que prueba.
const _hashN = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }
const D_RESP_TXT = [
  'Coincido con lo que planteas.',
  'No lo había visto así, buen punto.',
  'Habría que ver cómo se financia en las regiones.',
  'Apoyo esta postura; ojalá avance en el Congreso.',
  'Tengo mis dudas, pero es un debate necesario.',
  'Justo lo que necesitaba el país. Bien por el debate.',
]
function sembrarSocial() {
  try {
    if (localStorage.getItem('pl_demo_social_seed') === '2') return
    const reacc = dGet(D_REACC), resp = dGet(D_RESP)
    const votos = leerDemoVotos().filter(v => v.observaciones && String(v.observaciones).trim())
    for (const v of votos) {
      const id = demoComId(v)
      if (!reacc[id]) {
        const nl = 3 + (_hashN(id) % 40)     // 3..42 de acuerdo
        const nd = _hashN(id + 'd') % 11      // 0..10 en desacuerdo
        const r = {}
        for (let i = 0; i < nl; i++) r['sl-' + id + '-' + i] = 'like'
        for (let i = 0; i < nd; i++) r['sd-' + id + '-' + i] = 'dislike'
        reacc[id] = r
      }
      if (!resp[id]) {
        const nr = _hashN(id + 'r') % 3       // 0..2 respuestas
        if (nr > 0) {
          const arr = []
          for (let i = 0; i < nr; i++) {
            arr.push({
              id: 'sr-' + id + '-' + i,
              nombre: DEMO_NOMBRES[_hashN(id + 'n' + i) % DEMO_NOMBRES.length],
              texto: D_RESP_TXT[_hashN(id + 't' + i) % D_RESP_TXT.length],
              created_at: new Date(Date.parse('2026-08-06T09:00:00Z') + (_hashN(id + i) % 900000) * 1000).toISOString(),
            })
          }
          resp[id] = arr
        }
      }
    }
    dSet(D_REACC, reacc); dSet(D_RESP, resp)
    localStorage.setItem('pl_demo_social_seed', '2')
  } catch { /* */ }
}

// Comentarios enriquecidos (conteos) ordenados por acuerdos desc.
export async function fetchComentariosExt(proyectoId) {
  if (esDemo()) {
    sembrarSocial()
    const mod = dGet(D_MOD)
    const reacc = dGet(D_REACC), resp = dGet(D_RESP), rep = dGet(D_REPORT)
    return demoComentarios(proyectoId)
      .filter(c => !mod[c.id])
      .map(c => {
        const r = reacc[c.id] || {}
        const vals = Object.values(r)
        return {
          ...c,
          likes: vals.filter(t => t === 'like').length,
          dislikes: vals.filter(t => t === 'dislike').length,
          respuestas: (resp[c.id] || []).length,
          reportes: (rep[c.id] || []).length,
        }
      })
      .sort((a, b) => (b.likes - a.likes) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  const rows = await rpcLista('pl_comentarios_ext', { p_proyecto: proyectoId })
  if (rows.length) return rows
  // Fallback: si la migración social aún no se aplicó (o el proyecto no tiene
  // comentarios), cae a pl_comentarios → los comentarios siguen apareciendo
  // (sin conteos) en vez de desaparecer. Deploy seguro sin importar el orden.
  return rpcLista('pl_comentarios', { p_proyecto: proyectoId })
}

// Respuestas del proyecto (se agrupan por voto_id en el componente).
export async function fetchRespuestas(proyectoId) {
  if (esDemo()) {
    sembrarSocial()
    const resp = dGet(D_RESP)
    return Object.entries(resp).flatMap(([voto_id, arr]) =>
      (arr || []).map(r => ({ ...r, voto_id })))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  }
  return rpcLista('pl_respuestas', { p_proyecto: proyectoId })
}

// Reaccionar (toggle). Devuelve { ok, likes, dislikes, mine }.
export async function reaccionarComentario(comId, tipo) {
  const mis = leerMis()
  const prev = mis[comId] || null
  const nuevo = prev === tipo ? null : tipo   // toggle off si repite
  if (nuevo) mis[comId] = nuevo; else delete mis[comId]
  escribirMis(mis)

  if (esDemo()) {
    const reacc = dGet(D_REACC); const id = anonId()
    const r = reacc[comId] || {}
    if (nuevo) r[id] = nuevo; else delete r[id]
    reacc[comId] = r; dSet(D_REACC, reacc)
    const vals = Object.values(r)
    return { ok: true, likes: vals.filter(t => t === 'like').length, dislikes: vals.filter(t => t === 'dislike').length, mine: nuevo }
  }
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/pl_reaccionar`, {
      method: 'POST', headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_voto_id: comId, p_anon: anonId(), p_tipo: tipo }),
    })
    const b = await res.json().catch(() => null)
    if (res.ok && b?.ok) return { ok: true, likes: b.likes, dislikes: b.dislikes, mine: b.mine || null }
    return { ok: false }
  } catch { return { ok: false } }
}

// Responder. Devuelve { ok, id }.
export async function responderComentario(comId, nombre, texto) {
  const t = (texto || '').trim()
  if (!t) return { ok: false, msg: 'Escribe una respuesta.' }
  if (esDemo()) {
    const resp = dGet(D_RESP)
    const arr = resp[comId] || []
    const id = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    arr.push({ id, nombre: (nombre || '').trim() || null, texto: t.slice(0, 500), created_at: new Date().toISOString() })
    resp[comId] = arr; dSet(D_RESP, resp)
    return { ok: true, id }
  }
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/pl_responder`, {
      method: 'POST', headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_voto_id: comId, p_nombre: nombre || null, p_texto: t, p_anon: anonId() }),
    })
    const b = await res.json().catch(() => null)
    return res.ok && b?.ok ? { ok: true, id: b.id } : { ok: false, msg: b?.msg }
  } catch { return { ok: false } }
}

// Reportar. Devuelve { ok }.
export async function reportarComentario(comId, motivo) {
  if (esDemo()) {
    const rep = dGet(D_REPORT); const id = anonId()
    const arr = rep[comId] || []
    if (!arr.some(x => x.anonId === id)) arr.push({ anonId: id, motivo: (motivo || '').trim() || null })
    rep[comId] = arr; dSet(D_REPORT, rep)
    return { ok: true }
  }
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/pl_reportar`, {
      method: 'POST', headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_voto_id: comId, p_motivo: motivo || null, p_anon: anonId() }),
    })
    const b = await res.json().catch(() => null)
    return res.ok && b?.ok ? { ok: true } : { ok: false }
  } catch { return { ok: false } }
}

// Moderar (superadmin): borra el texto, conserva el voto. Devuelve { ok }.
export async function moderarComentario(comId) {
  if (esDemo()) {
    const mod = dGet(D_MOD); mod[comId] = true; dSet(D_MOD, mod)
    return { ok: true }
  }
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${URL}/rest/v1/rpc/pl_moderar_comentario`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_voto_id: comId }),
    })
    const b = await res.json().catch(() => null)
    return res.ok && b?.ok ? { ok: true } : { ok: false }
  } catch { return { ok: false } }
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

/* ── Emitir voto(s) ─────────────────────────────────────────────────────────
   SEGURIDAD (2026-08-10): el voto ya NO se inserta directo con la anon key.
   Se emite por la función SECURITY DEFINER `pl_emitir_votos`, que:
     · exige un OTP 'voto' verificado (used=true) para el correo en <15 min,
     · hashea la cédula con una sal SECRETA del servidor (no en el navegador),
     · inserta de forma atómica y deduplica por el UNIQUE.
   El INSERT anónimo directo sobre votos_proyecto queda revocado en la BD.
   Ver docs/sql/proyectos-ley-voto-seguro-2026-08-10.sql.

   Args: (filas, identidad). `filas` son las filas armadas por el formulario;
   `identidad` aporta el correo verificado y la cédula en claro (dígitos).
   Devuelve: {ok:true} | {ok:false, code:'duplicado'} |
             {ok:false, code:'otp'} | {ok:false, code:'error', msg} */
export async function emitirVotos(filas, identidad) {
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
  // Cuerpo para el RPC: la cédula/correo van en los parámetros top-level (una
  // sola vez); cada voto lleva solo su ámbito y campos públicos. El hash de
  // cédula lo calcula el servidor → aquí NO se envía cedula_hash.
  const p_votos = filas.map(f => ({
    proyecto_id: f.proyecto_id,
    articulo_id: f.articulo_id ?? null,
    apoya: f.apoya,
    observaciones: f.observaciones ?? null,
    departamento: f.departamento ?? null,
    municipio: f.municipio ?? null,
    nombre: f.nombre ?? null,
    celular: f.celular ?? null,
  }))
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/pl_emitir_votos`, {
      method: 'POST',
      headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_correo: identidad?.correo || '',
        p_cedula: identidad?.cedulaNum || '',
        p_votos,
      }),
    })
    let body = null
    try { body = await res.json() } catch { /* sin cuerpo */ }
    if (res.ok && body && typeof body === 'object') {
      if (body.ok) return { ok: true }
      if (body.code === 'duplicado') return { ok: false, code: 'duplicado' }
      if (body.code === 'otp') return { ok: false, code: 'otp' }
      return { ok: false, code: 'error', msg: body.msg || 'No se pudo registrar el voto.' }
    }
    if (res.status === 409) return { ok: false, code: 'duplicado' }
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
  if (esDemo()) return Promise.resolve(leerDemoVotos().filter(v => v.proyecto_id === proyectoId))
  try {
    const headers = await getAuthHeaders()
    // Detalle CON PII → solo superadmin, vía función SECURITY DEFINER.
    return await rpcLista('pl_votos_detalle', { p_proyecto: proyectoId }, headers)
  } catch { return [] }
}

/* ── Notificación del resultado a los votantes ──────────────────────────────
   Un voto por persona (cedula_hash), pero una persona puede tener varios votos
   (proyecto completo + artículos). Para el correo elegimos UN voto por persona:
   se prefiere el del proyecto completo; entre iguales, el más reciente. Solo se
   incluyen votantes con correo válido. */
export function construirVotantes(votosDetalle) {
  const porPersona = new Map()
  for (const v of votosDetalle || []) {
    const k = v.cedula_hash || (v.nombre + '|' + v.correo)
    const prev = porPersona.get(k)
    const completo = v.articulo_id == null
    if (!prev) { porPersona.set(k, v); continue }
    const prevCompleto = prev.articulo_id == null
    const masReciente = new Date(v.created_at || 0) > new Date(prev.created_at || 0)
    if ((completo && !prevCompleto) || (completo === prevCompleto && masReciente)) {
      porPersona.set(k, v)
    }
  }
  return Array.from(porPersona.values())
    .filter(v => v.correo && String(v.correo).includes('@'))
    .map(v => ({
      correo: v.correo,
      nombre: v.nombre || 'Ciudadano/a',
      cedula: v.cedula || '',
      voto: apoyaMeta(v.apoya).label,
      fecha: v.created_at,
    }))
}

// Envía el resultado (aprobado/rechazado) a los votantes por correo, en lotes
// (para no exceder el tiempo de una función serverless). Devuelve el acumulado
// { ok, sent, failed }. `onProgress(hechos, total)` alimenta la barra de avance.
// En demo / dev local (Vite no ejecuta /api) simula el envío para poder probar.
export async function notificarResultadoVotantes({ proyecto, recipients, pdf, onProgress }) {
  const total = recipients.length
  if (esDemo() || import.meta.env.DEV) {
    for (let i = 0; i < total; i += 30) onProgress?.(Math.min(i + 30, total), total)
    onProgress?.(total, total)
    return { ok: true, sent: total, failed: 0, demo: true }
  }
  const headers = await getAuthHeaders()
  const LOTE = 30
  let sent = 0, failed = 0
  for (let i = 0; i < total; i += LOTE) {
    const lote = recipients.slice(i, i + LOTE)
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'proyecto_resultado', proyecto, pdf, recipients: lote }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data) { sent += data.sent || 0; failed += data.failed || (lote.length - (data.sent || 0)) }
      else { failed += lote.length }
    } catch { failed += lote.length }
    onProgress?.(Math.min(i + LOTE, total), total)
  }
  return { ok: failed === 0, sent, failed }
}

/* ── Utilidades de reporte (CSV, cliente) ───────────────────────────────── */
const csvCell = (v) => {
  let s = v == null ? '' : String(v)
  // Anti CSV/fórmula injection: una celda que empieza por = + - @ (o tab/CR) la
  // interpretan Excel/LibreOffice como fórmula (=HYPERLINK/=WEBSERVICE/DDE),
  // capaz de exfiltrar PII de celdas vecinas o ejecutar comandos al abrir el
  // reporte. Se antepone un apóstrofo para neutralizarla y se fuerza el
  // entrecomillado. Aplica a TODOS los export CSV (voto detallado, etc.).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n;=+\-@\t\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
