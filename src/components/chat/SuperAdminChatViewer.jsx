import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import styles from './SuperAdminChatViewer.module.css'
import { IconTrash, IconPaperclip, IconFirma, IconMic } from '../shared/Icons'
import AudioPlayer from './AudioPlayer'
import { downloadChatFile, descargarDesdeUrl, AdjuntoChat, VisorArchivo, ChatImage, ChatLightbox, parseFichas, FichasContacto } from '../../lib/chatFiles'
import { urlFirmada } from '../../lib/firmaService'

// Mensajes de firma electrónica: su `content` es un JSON (t: 'firma' | 'firma_ok').
// Sin parsearlo se mostraba como texto ilegible ("cifrado") en el visor del admin.
function parseFirmaMsg(content) {
  try {
    const o = JSON.parse(content)
    if (o && (o.t === 'firma' || o.t === 'firma_ok')) return o
  } catch { /* no es un mensaje de firma */ }
  return null
}

// Descarga un documento del bucket privado de firmas. Antes abría una pestaña
// con la URL firmada a la vista; ahora el archivo baja al equipo y nada sale
// de la plataforma. `nombre` es con el que se guarda.
async function verDocFirma(path, nombre) {
  if (!path) return false
  try {
    const headers = await getAuthHeaders()
    const url = await urlFirmada(path, headers)
    if (!url) return false
    return await descargarDesdeUrl(url, nombre || path.split('/').pop() || 'documento.pdf')
  } catch { return false }
}

// Icono de verificación estilo Lucide (shield-check), currentColor. Se usa en
// los tres indicadores de "verificación pendiente" (chip de fila, toggle de
// filtro y chip del header) para que sea consistente con el resto de iconos.
function IconVerif({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// Formatea un monto en pesos colombianos, sin decimales (ej: "$120.000").
const copFmt = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
})
function formatCOP(monto) {
  const n = Number(monto)
  return Number.isFinite(n) ? copFmt.format(n) : ''
}

function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
}

// Patrón de cédula tal como aparece en el primer mensaje del cliente:
// "Cédula: 12.345.678" (dígitos con puntos de miles). Capturamos SOLO el número.
const CEDULA_RE = /(C[ée]dula:\s*)(\d{1,3}(?:\.\d{3})+|\d{6,})/gi

// Extrae la cédula cruda (sin puntos) del texto de un mensaje, si aparece.
// Se usa para que la búsqueda por cédula matchee también por el contenido del
// primer mensaje (además del hash de client_cedula).
function extraerCedulaDeTexto(text) {
  if (!text) return null
  const m = String(text).match(/C[ée]dula:\s*(\d{1,3}(?:\.\d{3})+|\d{6,})/i)
  return m ? m[1].replace(/\D/g, '') : null
}

// Renderiza **negrillas** estilo markdown conservando los saltos de línea, y
// resalta el número de cédula con un <mark> tipo resaltador amarillo (encima
// del bold que ya aplica el markdown).
function renderMensaje(text) {
  if (text == null) return text
  // 1) Partimos por bloques **bold**.
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).map((parte, i) => {
    const bold = parte.match(/^\*\*([^*\n]+)\*\*$/)
    const contenido = bold ? bold[1] : parte
    // 2) Dentro de cada bloque, resaltamos la cédula si aparece.
    const nodos = resaltarCedula(contenido, i)
    return bold ? <strong key={i}>{nodos}</strong> : <span key={i}>{nodos}</span>
  })
}

// Devuelve el texto con la cédula (el número) envuelta en <mark> amarillo.
function resaltarCedula(texto, keyPrefix) {
  if (!texto || !/C[ée]dula:/i.test(texto)) return texto
  CEDULA_RE.lastIndex = 0
  const out = []
  let last = 0, m, k = 0
  while ((m = CEDULA_RE.exec(texto)) !== null) {
    if (m.index > last) out.push(texto.slice(last, m.index))
    out.push(m[1]) // "Cédula: "
    out.push(<mark key={`${keyPrefix}-c-${k++}`} className={styles.cedulaMark}>{m[2]}</mark>)
    last = m.index + m[0].length
  }
  if (last === 0) return texto
  if (last < texto.length) out.push(texto.slice(last))
  return out
}

/* Resuelve en UNA query los nombres de todos los profesionales asignados a un
   conjunto de salas (byRoom: { roomId: [{lawyer_id, status}] }). Devuelve un
   mapa id → { nombre, rol } para etiquetar cada tarjeta del sidebar. */
async function resolveProfessionalNames(byRoom, headers, supaUrl) {
  const ids = [...new Set(
    Object.values(byRoom).flat().map(a => a.lawyer_id).filter(Boolean)
  )]
  if (!ids.length) return {}
  const res = await fetch(
    `${supaUrl}/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,nombre,apellido,rol`,
    { headers }
  )
  const profs = await res.json().catch(() => [])
  const map = {}
  if (Array.isArray(profs)) {
    for (const p of profs) {
      map[p.id] = { nombre: `${p.nombre} ${p.apellido || ''}`.trim(), rol: p.rol }
    }
  }
  return map
}

/* Elige el profesional a mostrar: el que está 'active' o, si no, el primero
   asignado. */
function pickProfessional(assigns, nameMap) {
  const chosen = (assigns || []).find(a => a.status === 'active') || (assigns || [])[0]
  return chosen ? (nameMap[chosen.lawyer_id] || null) : null
}

const STATUS_COLOR = { waiting: 'var(--gold)', active: '#4caf50', closed: '#555' }
const STATUS_LABEL = { waiting: 'Esperando', active: 'Activo', closed: 'Cerrado' }

async function hashCedula(cedula) {
  const data = new TextEncoder().encode(cedula.trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function StarDisplay({ rating }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1,2,3,4,5].map(s => (
        <span key={s} style={{
          color: s <= Math.round(rating) ? 'var(--gold)' : 'rgba(109,60,27,0.15)',
          fontSize: '1rem'
        }}>★</span>
      ))}
    </div>
  )
}

const FIELDS = 'id, area_derecho, status, created_at, client_nombre, client_email, client_celular, client_cedula, codigo_referencia, tipo_profesional, pago_confirmado'

export default function SuperAdminChatViewer({ initialRoomId = null }) {
  const [rooms, setRooms]       = useState([])
  const [filtered, setFiltered] = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const openedInitialRef = useRef(false)
  const [messages, setMessages] = useState([])
  const [lawyers, setLawyers]   = useState([])
  const [ratings, setRatings]   = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterArea, setFilterArea]     = useState('')
  const [search, setSearch]             = useState('')
  const [searchInput, setSearchInput]   = useState('')   // lo tecleado; pasa a `search` tras 200 ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200)
    return () => clearTimeout(t)
  }, [searchInput])
  // "Limpiar filtros" vacía `search` desde fuera: el campo debe seguirlo.
  useEffect(() => { if (search === '') setSearchInput('') }, [search])
  const [rolFilter, setRolFilter]       = useState('todos')  // 'todos'|'abogado'|'contador'
  const [verifFilter, setVerifFilter]   = useState('todos')  // 'todos' | 'pendientes' | 'verificadas'
  // Rango de fechas sobre created_at de la sala (YYYY-MM-DD, como los <input type="date">).
  const [desde, setDesde]               = useState('')
  const [hasta, setHasta]               = useState('')
  // Hash SHA-256 de lo que se está escribiendo en el buscador (cuando parece
  // una cédula) para poder matchear contra client_cedula (que está hasheado).
  const [searchHash, setSearchHash]     = useState('')
  // Set de room_id con una verificación pendiente (notificaciones tipo
  // 'verificacion' y atendida=false). Un solo fetch batcheado al cargar salas.
  const [verifRooms, setVerifRooms]     = useState(() => new Set())
  const [searchMode, setSearchMode]     = useState('all')
  const [searchQuery, setSearchQuery]   = useState('')
  const [searching, setSearching]       = useState(false)
  const [searchError, setSearchError]   = useState('')
  // Cobro al profesional (split empresa/gestor) — atado a la verificación.
  const [pago, setPago]             = useState(null)     // fila de pagos_profesional | null
  const [pagoLoading, setPagoLoading] = useState(false)  // cargando estado del cobro
  const [pagoConfirmado, setPagoConfirmado] = useState(false) // luz verde (chat_rooms.pago_confirmado)
  const [pagoGenerando, setPagoGenerando] = useState(false) // POST generar_cobro en curso
  // Modal con el detalle de la consulta (código, partes y desglose del cobro).
  const [detallesOpen, setDetallesOpen] = useState(false)
  const [pagoOk, setPagoOk]         = useState(false)    // toast inline "✓ Cobro generado"
  const [pagoError, setPagoError]   = useState('')       // mensaje de error inline (dismissible)
  // Modal "Definir cobro" + sus campos (total / % empresa / % gestor).
  const [cobroModalOpen, setCobroModalOpen] = useState(false)
  const [cfgTotal,  setCfgTotal]   = useState('')        // Total de la consulta (COP)
  const [cfgPctEmp, setCfgPctEmp]  = useState('')        // % empresa
  const [cfgPctGes, setCfgPctGes]  = useState('')        // % gestor
  // Defaults de plataforma_config (id=1) — se cargan una sola vez.
  const [cfgDefaults, setCfgDefaults] = useState(null)
  // Tabs Chats / PQR
  const [lightbox,        setLightbox]        = useState(null)      // URL imagen ampliada
  // Archivo abierto DENTRO de la plataforma (nunca en otra pestaña).
  const [verArchivo,      setVerArchivo]      = useState(null)
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

  const messagesRef = useRef(null)

  useEffect(() => { loadRooms() }, [])

  // Deep-link: abrir la sala indicada (desde la campanita / correo). La busca
  // en las salas cargadas; si no está, la trae directo. Solo una vez.
  useEffect(() => {
    if (!initialRoomId || openedInitialRef.current) return
    const found = rooms.find(r => r.id === initialRoomId) || filtered.find(r => r.id === initialRoomId)
    if (found) { openedInitialRef.current = true; setActiveRoom(found); return }
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${initialRoomId}&select=*&limit=1`,
          { headers }
        )
        const [room] = await res.json()
        if (!cancel && room) { openedInitialRef.current = true; setActiveRoom(room) }
      } catch { /* no-op */ }
    })()
    return () => { cancel = true }
  }, [initialRoomId, rooms, filtered])

  // Defaults del cobro (plataforma_config id=1): default_total, pct_empresa,
  // comision_gestor_pct. Se leen una vez para prefijar el modal "Definir cobro".
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/plataforma_config?id=eq.1&select=*`,
          { headers }
        )
        const [row] = await res.json().catch(() => [])
        if (!cancelled && row) setCfgDefaults(row)
      } catch { /* si falla, el modal arranca con campos vacíos */ }
    })()
    return () => { cancelled = true }
  }, [SUPABASE_URL])

  // Debounce: cuando el texto del buscador parece una cédula (solo dígitos,
  // ≥6), calculamos su hash SHA-256 para poder cruzarlo con client_cedula.
  useEffect(() => {
    const raw = search.replace(/\D/g, '')
    if (raw.length < 6) { setSearchHash(''); return }
    let cancel = false
    const t = setTimeout(async () => {
      try {
        const h = await hashCedula(raw)
        if (!cancel) setSearchHash(h)
      } catch { if (!cancel) setSearchHash('') }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [search])

  useEffect(() => {
    let list = [...rooms]
    if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus)
    if (filterArea) list = list.filter(r => r.area_derecho?.toLowerCase().includes(filterArea.toLowerCase()))
    // Chips de profesión: filtra por el rol/tipo_profesional de la sala.
    if (rolFilter !== 'todos') {
      list = list.filter(r =>
        (r.tipo_profesional || r._professionalRol) === rolFilter
      )
    }
    // Filtro de verificación: pendientes (verif solicitada y sin pagar) o
    // verificadas (el profesional ya pagó).
    if (verifFilter === 'pendientes') list = list.filter(r => verifRooms.has(r.id) && !r.pago_confirmado)
    else if (verifFilter === 'verificadas') list = list.filter(r => r.pago_confirmado)
    // Rango de fechas: se compara el DIA LOCAL de la sala ('sv' da YYYY-MM-DD),
    // no el ISO en UTC, para que "hoy" signifique hoy en Colombia.
    if (desde || hasta) {
      list = list.filter(r => {
        const dia = r.created_at ? new Date(r.created_at).toLocaleDateString('sv') : ''
        if (!dia) return false
        if (desde && dia < desde) return false
        if (hasta && dia > hasta) return false
        return true
      })
    }
    // Búsqueda unificada en vivo: nombre del cliente, correo, profesional,
    // código, área y cédula. La cédula se guarda hasheada (client_cedula), así
    // que un prefijo no puede compararse contra el hash; pero el número en
    // claro ya viaja en el PRIMER MENSAJE de cada sala ("Cédula: 12.345.678")
    // y loadCedulasCrudas lo deja en _cedulaCruda. Con eso se filtra por
    // prefijo desde el primer dígito, y con 6+ dígitos además se cruza el
    // hash completo (cubre salas antiguas sin esa línea en el mensaje).
    if (search) {
      const s = search.toLowerCase()
      const rawCedula = search.replace(/\D/g, '')  // dígitos que teclea
      list = list.filter(r =>
        r.client_nombre?.toLowerCase().includes(s) ||
        r.client_email?.toLowerCase().includes(s) ||
        r._professionalNombre?.toLowerCase().includes(s) ||
        r.codigo_referencia?.toLowerCase().includes(s) ||
        r.area_derecho?.toLowerCase().includes(s) ||
        (searchHash && r.client_cedula === searchHash) ||
        (rawCedula.length >= 1 && r._cedulaCruda && r._cedulaCruda.includes(rawCedula))
      )
    }
    setFiltered(list)
  }, [rooms, filterStatus, filterArea, search, searchHash, rolFilter, verifFilter, verifRooms, desde, hasta])

  // ¿Hay algún filtro activo? Decide si se ofrece "Limpiar filtros".
  const hayFiltrosChat = !!(search || desde || hasta) ||
    filterStatus !== 'all' || rolFilter !== 'todos' || verifFilter !== 'todos'

  useEffect(() => {
    if (!activeRoom) return
    loadMessages(activeRoom.id)
    loadRoomLawyers(activeRoom.id)
    loadRatings(activeRoom.id)
    const ch = supabase.channel(`admin-room:${activeRoom.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'chat_messages', filter: `room_id=eq.${activeRoom.id}`
      }, p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [activeRoom])

  // Al abrir/cambiar de sala, traemos el estado del cobro de esa consulta y
  // limpiamos los avisos inline del cobro anterior.
  useEffect(() => {
    setPago(null); setPagoOk(false); setPagoError(''); setPagoConfirmado(false)
    setCobroModalOpen(false)
    if (!activeRoom) return
    loadPago(activeRoom.id)
  }, [activeRoom])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  // Lee el cobro (si existe) de la sala y la luz verde (chat_rooms.pago_confirmado).
  // El superadmin puede leer todos los pagos.
  async function loadPago(rid) {
    setPagoLoading(true)
    try {
      const headers = await getAuthHeaders()
      const [pagoRes, roomRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/pagos_profesional?room_id=eq.${rid}&select=id,estado,total_consulta,pct_empresa,pct_gestor,monto_empresa,comision_gestor,monto,pagado_at,gestor_id,codigo&order=created_at.desc`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${rid}&select=pago_confirmado&limit=1`,
          { headers }
        ),
      ])
      const rows = await pagoRes.json().catch(() => [])
      const [roomRow] = await roomRes.json().catch(() => [])
      // Solo actualizamos si seguimos en la misma sala (evita carrera al cambiar rápido).
      setActiveRoom(cur => {
        if (cur?.id === rid) {
          setPago(Array.isArray(rows) && rows.length ? rows[0] : null)
          setPagoConfirmado(!!roomRow?.pago_confirmado)
        }
        return cur
      })
    } catch {
      /* si falla la lectura, dejamos el botón disponible (el backend valida) */
    } finally {
      setPagoLoading(false)
    }
  }

  // Abre el modal "Definir cobro" con los campos prefijados desde
  // plataforma_config (id=1): default_total, pct_empresa, comision_gestor_pct.
  function openCobroModal() {
    if (!activeRoom) return
    const d = cfgDefaults || {}
    setCfgTotal (d.default_total != null ? String(d.default_total) : '')
    setCfgPctEmp(d.pct_empresa   != null ? String(d.pct_empresa)   : '')
    setCfgPctGes(d.comision_gestor_pct != null ? String(d.comision_gestor_pct) : '')
    setPagoError(''); setPagoOk(false)
    setCobroModalOpen(true)
  }

  // ¿La consulta trae gestor? Antes de crear el cobro lo inferimos del código de
  // referencia de la sala; una vez creado, del propio pago (gestor_id / codigo).
  const roomTraeGestor = !!(activeRoom?.codigo_referencia)

  // Genera el cobro con el split (total, %empresa, %gestor) para la sala activa.
  // Guarda contra doble envío y traduce los errores del backend a mensajes claros.
  async function handleGenerarCobro() {
    if (!activeRoom || pagoGenerando) return
    const total = Number(cfgTotal)
    const pctEmp = Number(cfgPctEmp)
    const pctGes = Number(cfgPctGes)
    if (!(total > 0)) { setPagoError('Ingresa un total válido para la consulta.'); return }
    if (!(pctEmp >= 0) || !(pctGes >= 0)) { setPagoError('Los porcentajes no pueden ser negativos.'); return }
    if (pctEmp > 100 || pctGes > 100) { setPagoError('Los porcentajes deben estar entre 0 y 100.'); return }
    setPagoGenerando(true); setPagoOk(false); setPagoError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generar_cobro`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_room_id: activeRoom.id,
          p_total: total,
          p_pct_empresa: pctEmp,
          p_pct_gestor: pctGes,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const code = json?.code
        const msg  = String(json?.message || '')
        let human
        if (code === '23505' || /ya existe un cobro pendiente/i.test(msg)) {
          human = 'Ya existe un cobro pendiente para esta consulta.'
        } else if (code === '42501' || /no autorizado/i.test(msg)) {
          human = 'No autorizado para generar este cobro.'
        } else if (/sin profesional asignado|no tiene profesional asignado/i.test(msg)) {
          human = 'La sala no tiene profesional asignado.'
        } else {
          human = msg || 'No se pudo generar el cobro. Intenta de nuevo.'
        }
        setPagoError(human)
        // Si ya existía un cobro, refrescamos para mostrar su estado.
        if (code === '23505' || /ya existe un cobro pendiente/i.test(msg)) {
          setCobroModalOpen(false)
          loadPago(activeRoom.id)
        }
        return
      }
      // Éxito: cerramos el modal, aviso inline y recarga del estado del cobro.
      setCobroModalOpen(false)
      setPagoOk(true)
      loadPago(activeRoom.id)
      setTimeout(() => setPagoOk(false), 4000)
      // Trazabilidad del gestor: caso exitoso → correo "comisión disponible".
      // Best-effort: si falla el correo, el cobro ya quedó creado.
      try {
        fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
          body: JSON.stringify({ type: 'gestor_trazabilidad', data: { evento: 'cierre', roomId: activeRoom.id } }),
        }).catch(() => {})
      } catch { /* noop */ }
    } catch (err) {
      setPagoError('Error de red al generar el cobro: ' + err.message)
    } finally {
      setPagoGenerando(false)
    }
  }

  async function loadRooms() {
    // Las 300 salas más recientes (antes: TODA la historia sin límite — el
    // payload y el in.() de abajo crecían sin cota y a ~450+ salas la URL
    // rompía el límite del gateway). El histórico completo sigue accesible
    // por la búsqueda avanzada por cédula/profesional.
    const { data } = await supabase
      .from('chat_rooms')
      .select(FIELDS)
      .order('created_at', { ascending: false })
      .limit(300)
    if (!data || data.length === 0) { setRooms([]); return }

    // Antes hacíamos 1 + N queries (N salas × 1 query cada una para sus
    // abogados asignados). Con 50+ salas eso son 50+ requests en paralelo
    // y un round-trip lento. Ahora batcheamos en UNA sola query con IN()
    // y agrupamos en memoria → 2 queries totales.
    const roomIds = data.map(r => r.id)
    const headers = await getAuthHeaders()
    const idsList = roomIds.join(',')
    const assignRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=in.(${idsList})&select=room_id,lawyer_id,status`,
      { headers }
    )
    const allAssignments = await assignRes.json().catch(() => [])
    const byRoom = {}
    for (const a of (Array.isArray(allAssignments) ? allAssignments : [])) {
      if (!byRoom[a.room_id]) byRoom[a.room_id] = []
      byRoom[a.room_id].push({ lawyer_id: a.lawyer_id, status: a.status })
    }
    // Nombres de los profesionales asignados (1 query batched) para etiquetar
    // cada tarjeta del sidebar con el profesional que atiende.
    const nameMap = await resolveProfessionalNames(byRoom, headers, SUPABASE_URL)

    // Cédula cruda del primer mensaje del cliente (que ahora contiene
    // "Cédula: 12.345.678"). 1 query batcheada filtrando por texto para poder
    // buscar por número aunque client_cedula esté hasheado.
    const cedulaByRoom = await loadCedulasCrudas(roomIds, headers)

    const withLawyers = data.map(room => {
      const assigns = byRoom[room.id] || []
      const prof = pickProfessional(assigns, nameMap)
      return {
        ...room,
        chat_room_lawyers: assigns,
        _professionalNombre: prof?.nombre || null,
        _professionalRol:    prof?.rol || null,
        _cedulaCruda:        cedulaByRoom[room.id] || null,
      }
    })
    setRooms(withLawyers)

    // Verificaciones pendientes (una sola query batcheada).
    loadVerificaciones(roomIds, headers)
  }

  // Trae los mensajes del cliente que contienen "Cédula:" para las salas dadas
  // y devuelve { roomId: '12345678' } (número sin puntos). Batcheado en 1 query.
  async function loadCedulasCrudas(roomIds, headers) {
    if (!roomIds.length) return {}
    try {
      const idsList = roomIds.join(',')
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages?room_id=in.(${idsList})&sender_type=eq.client&content=ilike.*C%C3%A9dula:*&select=room_id,content&order=created_at.asc`,
        { headers }
      )
      const rows = await res.json().catch(() => [])
      const map = {}
      for (const m of (Array.isArray(rows) ? rows : [])) {
        if (map[m.room_id]) continue        // primero gana (order asc)
        const c = extraerCedulaDeTexto(m.content)
        if (c) map[m.room_id] = c
      }
      return map
    } catch { return {} }
  }

  // Marca qué salas tienen una verificación pendiente (notificaciones tipo
  // 'verificacion', atendida=false). Superadmin puede SELECT notificaciones.
  async function loadVerificaciones(roomIds, headers) {
    if (!roomIds.length) { setVerifRooms(new Set()); return }
    try {
      const idsList = roomIds.join(',')
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/notificaciones?tipo=eq.verificacion&atendida=eq.false&room_id=in.(${idsList})&select=room_id`,
        { headers }
      )
      const rows = await res.json().catch(() => [])
      const s = new Set()
      for (const n of (Array.isArray(rows) ? rows : [])) {
        if (n.room_id) s.add(n.room_id)
      }
      setVerifRooms(s)
    } catch { /* el badge es informativo; no romper la carga */ }
  }

  async function loadMessages(rid) {
    // Últimos 300 (antes historial completo); en error conserva lo visible.
    const { data } = await supabase
      .from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: false }).limit(300)
    if (Array.isArray(data)) setMessages(data.reverse())
  }

  async function loadRoomLawyers(rid) {
    const { data: assignments } = await supabase
      .from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', rid)
    if (!assignments) return
    const lawyersData = await Promise.all(
      assignments.map(async a => {
        const { data: profile } = await supabase
          .from('profiles').select('nombre, apellido').eq('id', a.lawyer_id).single()
        return { ...a, nombre: profile ? `${profile.nombre} ${profile.apellido}` : 'Abogado' }
      })
    )
    setLawyers(lawyersData)
  }

  async function loadRatings(rid) {
    const { data } = await supabase
      .from('chat_ratings')
      .select('*, profiles(nombre, apellido, foto_url)')
      .eq('room_id', rid)
    setRatings(data || [])
  }

  async function handleAdvancedSearch() {
    if (!searchQuery.trim()) { setSearchError('Ingresa un valor para buscar.'); return }
    setSearching(true); setSearchError(''); setActiveRoom(null); setMessages([]); setRatings([])

    try {
      if (searchMode === 'cedula') {
        const hash = await hashCedula(searchQuery.trim())
        const { data } = await supabase
          .from('chat_rooms').select(FIELDS)
          .eq('client_cedula', hash)
          .order('created_at', { ascending: false })

        if (!data || data.length === 0) {
          setSearchError('No se encontraron chats para esta cédula.')
          setFiltered([])
        } else {
          // Batched: 1 query para todas las asignaciones en lugar de N.
          const headers = await getAuthHeaders()
          const ids = data.map(r => r.id).join(',')
          const assignRes = await fetch(
            `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=in.(${ids})&select=room_id,lawyer_id,status`,
            { headers }
          )
          const allAssign = await assignRes.json().catch(() => [])
          const byRoom = {}
          for (const a of (Array.isArray(allAssign) ? allAssign : [])) {
            if (!byRoom[a.room_id]) byRoom[a.room_id] = []
            byRoom[a.room_id].push({ lawyer_id: a.lawyer_id, status: a.status })
          }
          const nameMap = await resolveProfessionalNames(byRoom, headers, SUPABASE_URL)
          const withLawyers = data.map(room => {
            const assigns = byRoom[room.id] || []
            const prof = pickProfessional(assigns, nameMap)
            return {
              ...room,
              chat_room_lawyers: assigns,
              _professionalNombre: prof?.nombre || null,
              _professionalRol:    prof?.rol || null,
            }
          })
          setFiltered(withLawyers)
        }

      } else if (searchMode === 'abogado') {
        // Antes: 1 + M + M×N queries serializadas (búsqueda → por cada
        // abogado, su lista de asignaciones → por cada asignación, la sala).
        // Con 3 abogados de 10 salas eran 33 round-trips lentísimos.
        // Ahora: 3 queries con IN() + agrupado en memoria.
        const q = searchQuery.trim()
        const enc = encodeURIComponent(q)
        // Credenciales del superadmin: con la anon key, RLS bloquea
        // `chat_room_lawyers` (devuelve 0 filas) y la búsqueda nunca encontraba
        // chats, sin importar el nombre. getAuthHeaders() resuelve el JWT.
        const headers = await getAuthHeaders()

        // 1) Buscar profesionales que matcheen (acepta abogado Y contador
        //    porque tipo_profesional en chat_rooms los maneja a ambos).
        const profRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?rol=in.(abogado,contador)&or=(nombre.ilike.*${enc}*,apellido.ilike.*${enc}*)&select=id,nombre,apellido`,
          { headers }
        )
        const profiles = await profRes.json()

        if (!Array.isArray(profiles) || profiles.length === 0) {
          setSearchError('No se encontró ningún profesional con ese nombre.')
          setFiltered([]); setSearching(false); return
        }

        const lawyerIds = profiles.map(p => p.id)
        const lawyerNameById = Object.fromEntries(
          profiles.map(p => [p.id, `${p.nombre} ${p.apellido || ''}`.trim()])
        )

        // 2) UNA sola query para todas las asignaciones de esos profesionales.
        const assignRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_room_lawyers?lawyer_id=in.(${lawyerIds.join(',')})&select=room_id,lawyer_id`,
          { headers }
        )
        const assignments = await assignRes.json()
        const assignmentList = Array.isArray(assignments) ? assignments : []

        if (assignmentList.length === 0) {
          setSearchError('No se encontraron chats para este profesional.')
          setFiltered([]); setSearching(false); return
        }

        // Primera asignación lawyer→room para etiquetar el nombre en la card.
        const lawyerByRoom = {}
        for (const a of assignmentList) {
          if (!lawyerByRoom[a.room_id]) lawyerByRoom[a.room_id] = a.lawyer_id
        }
        const uniqueRoomIds = Object.keys(lawyerByRoom)

        // 3) UNA sola query para todas las salas únicas.
        const roomsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?id=in.(${uniqueRoomIds.join(',')})&select=${encodeURIComponent(FIELDS)}&order=created_at.desc`,
          { headers }
        )
        const rooms = await roomsRes.json()
        const allRooms = (Array.isArray(rooms) ? rooms : []).map(room => ({
          ...room,
          _professionalNombre: lawyerNameById[lawyerByRoom[room.id]] || 'Profesional',
          chat_room_lawyers: [],
        }))

        if (allRooms.length === 0) setSearchError('No se encontraron chats para este profesional.')
        setFiltered(allRooms)
      }
    } catch (err) {
      setSearchError('Error en la búsqueda: ' + err.message)
    } finally {
      setSearching(false)
    }
  }

  function resetSearch() {
    setSearchMode('all')
    setSearchQuery('')
    setSearchError('')
    setActiveRoom(null)
    setMessages([])
    setRatings([])
    loadRooms()
  }

  async function forceCloseRoom(rid) {
    await supabase.from('chat_rooms').update({ status: 'closed' }).eq('id', rid)
    if (activeRoom?.id === rid) setActiveRoom(r => r ? { ...r, status: 'closed' } : r)
    loadRooms()
  }

  async function deleteMessage(mid) {
    await supabase.from('chat_messages').delete().eq('id', mid)
    setMessages(prev => prev.filter(m => m.id !== mid))
  }

  return (
    <div className={styles.viewer}>

      {/* ── Búsqueda avanzada ── */}
      <div className={styles.searchBox}>
        <p className={styles.searchTitle}>Búsqueda avanzada</p>
        <div className={styles.modeTabs}>
          {[
            { key: 'all',     label: 'Todos los chats' },
            { key: 'cedula',  label: 'Por cédula' },
            { key: 'abogado', label: 'Por profesional' },
          ].map(m => (
            <button
              key={m.key}
              className={searchMode === m.key ? styles.modeTabActive : styles.modeTab}
              onClick={() => { setSearchMode(m.key); setSearchQuery(''); setSearchError('') }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {searchMode !== 'all' && (
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdvancedSearch()}
              placeholder={searchMode === 'cedula'
                ? 'Número de cédula del cliente…'
                : 'Nombre o apellido del abogado o contador…'}
            />
            <button className={styles.searchBtn} onClick={handleAdvancedSearch} disabled={searching}>
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
            <button className={styles.resetBtn} onClick={resetSearch}>✕ Limpiar</button>
          </div>
        )}
        {searchError && <p className={styles.searchError}>{searchError}</p>}
      </div>

      {/* ── Filtro unificado, en dos niveles ──
          Arriba lo que se escribe o se elige (búsqueda, estado, fechas);
          abajo los grupos de botones, cada uno con su etiqueta. Todo en una
          sola fila se veía como una hilera de cápsulas sueltas. */}
      {searchMode === 'all' && (
        <div className={styles.unifiedBar}>
          <div className={styles.filtroFila}>
            <input
              className={styles.searchInput}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre, correo o cédula…"
            />

            <select className={styles.filterSelect} value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="waiting">Esperando</option>
              <option value="active">Activos</option>
              <option value="closed">Cerrados</option>
            </select>

            {/* Rango de fechas de la consulta (por su fecha de creación). */}
            <div className={styles.fechasBox}>
              <label className={styles.fechaCampo}>
                <span>Desde</span>
                <input type="date" className={styles.fechaInput} value={desde}
                  max={hasta || undefined} onChange={e => setDesde(e.target.value)} />
              </label>
              <label className={styles.fechaCampo}>
                <span>Hasta</span>
                <input type="date" className={styles.fechaInput} value={hasta}
                  min={desde || undefined} onChange={e => setHasta(e.target.value)} />
              </label>
            </div>

            {hayFiltrosChat && (
              <button type="button" className={styles.fechaLimpiar}
                onClick={() => {
                  setSearch(''); setDesde(''); setHasta('')
                  setFilterStatus('all'); setRolFilter('todos'); setVerifFilter('todos')
                }}>
                Limpiar filtros
              </button>
            )}
          </div>

          <div className={styles.filtroGrupos}>
            <div className={styles.filtroGrupo}>
              <span className={styles.filtroGrupoLabel}>Profesión</span>
              <div className={styles.rolChips}>
                {[
                  { v: 'todos',    l: 'Todos' },
                  { v: 'abogado',  l: 'Abogados' },
                  { v: 'contador', l: 'Contadores' },
                ].map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    className={rolFilter === opt.v ? styles.rolChipActive : styles.rolChip}
                    onClick={() => setRolFilter(opt.v)}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.filtroGrupo}>
              <span className={styles.filtroGrupoLabel}>Verificación</span>
              <div className={styles.rolChips}>
                <button
                  type="button"
                  className={verifFilter === 'pendientes' ? styles.verifToggleActive : styles.verifToggle}
                  onClick={() => setVerifFilter(v => v === 'pendientes' ? 'todos' : 'pendientes')}
                  aria-pressed={verifFilter === 'pendientes'}
                  title="Mostrar solo consultas con verificación pendiente"
                >
                  <IconVerif size={15} />
                  Pendientes
                  {(() => {
                    const n = rooms.filter(r => verifRooms.has(r.id) && !r.pago_confirmado).length
                    return n > 0 ? <span className={styles.verifCount}>{n}</span> : null
                  })()}
                </button>

                <button
                  type="button"
                  className={verifFilter === 'verificadas' ? styles.verifDoneToggleActive : styles.verifDoneToggle}
                  onClick={() => setVerifFilter(v => v === 'verificadas' ? 'todos' : 'verificadas')}
                  aria-pressed={verifFilter === 'verificadas'}
                  title="Mostrar solo consultas verificadas (el profesional ya pagó)"
                >
                  <IconVerif size={15} />
                  Verificadas
                  {(() => {
                    const n = rooms.filter(r => r.pago_confirmado).length
                    return n > 0 ? <span className={styles.verifCount}>{n}</span> : null
                  })()}
                </button>
              </div>
            </div>

            <button className={styles.refreshBtn} onClick={loadRooms}>↺ Actualizar</button>
          </div>
        </div>
      )}

      {/* ── Estadísticas ── */}
      <div className={styles.stats}>
        {['waiting', 'active', 'closed'].map(s => (
          <div key={s} className={styles.statCard}>
            <p className={styles.statNumber} style={{ color: STATUS_COLOR[s] }}>
              {rooms.filter(r => r.status === s).length}
            </p>
            <p className={styles.statLabel}>{STATUS_LABEL[s]}</p>
          </div>
        ))}
        <div className={styles.statCard}>
          <p className={styles.statNumber} style={{ color: 'var(--gold)' }}>{rooms.length}</p>
          <p className={styles.statLabel}>Total</p>
        </div>
      </div>

      {/* ── Grid ── */}
      {/* gridOpen (con sala activa) controla en móvil mostrar SOLO el chat. */}
      <div className={`${styles.grid} ${activeRoom ? styles.gridOpen : ''}`}>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          {filtered.length === 0 && (
            <p className={styles.sidebarEmpty}>
              {searchMode !== 'all' ? 'Usa el buscador para encontrar chats.' : 'Sin resultados.'}
            </p>
          )}
          {filtered.map(room => {
            // Si el profesional ya pagó, la consulta queda VERIFICADA; deja de
            // estar "pendiente de verificación".
            const paid = !!room.pago_confirmado
            const flagged = verifRooms.has(room.id) && !paid
            return (
            <div key={room.id}
              className={`${activeRoom?.id === room.id
                ? styles.roomRowActive
                : `${styles.roomRow} ${styles['room_' + room.status] || ''}`} ${flagged ? styles.roomRowVerif : ''}`}
              onClick={() => setActiveRoom(room)}
            >
              <div className={styles.roomTop}>
                <p className={styles.roomClientName}>{room.client_nombre || 'Cliente anónimo'}</p>
                <span className={`${styles.roomStatusPill} ${styles['pill_' + room.status] || ''}`}>
                  {STATUS_LABEL[room.status]}
                </span>
              </div>
              {paid ? (
                <span className={styles.verifChipDone} title="Consulta verificada — el profesional ya pagó">
                  <IconVerif size={12} />
                  Verificada
                </span>
              ) : flagged && (
                <span className={styles.verifChip} title="Solicitud de verificación pendiente">
                  <IconVerif size={12} />
                  Verificación
                  <span className={styles.verifChipDot} aria-hidden="true" />
                </span>
              )}
              <p className={styles.roomArea}>{room.area_derecho}</p>
              {room._professionalNombre && (
                <p className={styles.roomProfesional}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  <span className={styles.roomProfNombre}>{room._professionalNombre}</span>
                  {room._professionalRol && (
                    <span className={styles.roomProfRol}>
                      · {room._professionalRol === 'contador' ? 'Contador' : 'Abogado'}
                    </span>
                  )}
                </p>
              )}
              {room.codigo_referencia && (
                <p className={styles.roomCodigo}>{room.codigo_referencia}</p>
              )}
              <p className={styles.roomDate}>
                {new Date(room.created_at).toLocaleString('es-CO', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })}
              </p>
            </div>
            )
          })}
        </div>

        {/* Panel principal */}
        {!activeRoom ? (
          <div className={styles.placeholder}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className={styles.placeholderText}>Selecciona una sala para ver la conversación</p>
          </div>
        ) : (
          <div className={styles.main}>

            {/* Header */}
            <div className={styles.chatHeader}>
              <div>
                {/* Volver a la lista (solo móvil) */}
                <button type="button" className={styles.backBtn}
                  onClick={() => setActiveRoom(null)} aria-label="Volver a la lista de chats">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
                  Volver
                </button>
                <div className={styles.chatTitleRow}>
                  <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
                  {(activeRoom.pago_confirmado || pagoConfirmado) ? (
                    <span className={styles.verifChipHeaderDone} title="Consulta verificada — el profesional ya pagó">
                      <IconVerif size={14} />
                      Verificada
                    </span>
                  ) : verifRooms.has(activeRoom.id) && (
                    <span className={styles.verifChipHeader} title="Solicitud de verificación pendiente">
                      <IconVerif size={14} />
                      Verificación pendiente
                    </span>
                  )}
                </div>
                {activeRoom.client_nombre && (
                  <p className={styles.chatClient}>
                    {activeRoom.client_nombre}
                    {activeRoom.client_email && ` · ${activeRoom.client_email}`}
                  </p>
                )}
                {/* Metadatos en una línea: el código y el profesional no
                    necesitan caja propia, y apilados sumaban dos renglones. */}
                <p className={styles.chatMeta}>
                  {lawyers.length > 0 && (
                    <span className={styles.chatMetaPro}>
                      {lawyers.map(l => l.nombre).join(', ')}
                    </span>
                  )}
                  {activeRoom.codigo_referencia && (
                    <>
                      {lawyers.length > 0 && <span aria-hidden="true"> · </span>}
                      <span className={styles.chatMetaCod}>{activeRoom.codigo_referencia}</span>
                    </>
                  )}
                </p>
              </div>
              <div className={styles.headerActions}>
                {/* ── Cobro al profesional (split empresa/gestor) — atado a la verificación ── */}
                {pagoLoading ? (
                  <span className={styles.cobroLoading}>Verificando cobro…</span>
                ) : pago ? (
                  <div className={styles.cobroResumenWrap}>
                    <div className={styles.cobroChipRow}>
                      {pago.estado === 'pagado' ? (
                        // El propio chip abre el detalle: ya es el elemento que
                        // resume el cobro, así que no hace falta un botón al lado.
                        <button type="button"
                          className={`${styles.cobroChip} ${styles.cobroChipPagado} ${styles.cobroChipBtn}`}
                          onClick={() => setDetallesOpen(true)}
                          aria-haspopup="dialog"
                          title="Ver el detalle de la consulta y el desglose del cobro">
                          <IconVerif size={13} />
                          Pagado · {formatCOP(pago.monto)}
                          {pago.pagado_at && (
                            <span className={styles.cobroChipFecha}>
                              · {new Date(pago.pagado_at).toLocaleDateString('es-CO', {
                                day: '2-digit', month: 'short', year: 'numeric',
                              })}
                            </span>
                          )}
                        </button>
                      ) : (
                        <button type="button"
                          className={`${styles.cobroChip} ${styles.cobroChipPendiente} ${styles.cobroChipBtn}`}
                          onClick={() => setDetallesOpen(true)}
                          aria-haspopup="dialog"
                          title="Ver el detalle de la consulta y el desglose del cobro">
                          Cobro pendiente · {formatCOP(pago.monto)}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${styles.btnCobro} ${verifRooms.has(activeRoom.id) ? styles.btnCobroDestacado : ''}`}
                    onClick={openCobroModal}
                    disabled={pagoGenerando}
                    title={verifRooms.has(activeRoom.id)
                      ? 'Consulta verificada — define el cobro de la consulta'
                      : 'Definir el cobro de la consulta al profesional'}
                  >
                    {pagoOk ? '✓ Cobro generado' : 'Definir cobro'}
                  </button>
                )}
                {/* Aviso de éxito cuando el chip aún no reflejó el nuevo cobro */}
                {pagoOk && !pago && (
                  <span className={styles.cobroSuccess}>✓ Cobro generado</span>
                )}
                {/* Error inline, dismissible */}
                {pagoError && (
                  <span className={styles.cobroError} role="alert">
                    {pagoError}
                    <button
                      type="button"
                      className={styles.cobroErrorClose}
                      onClick={() => setPagoError('')}
                      aria-label="Cerrar aviso"
                    >✕</button>
                  </span>
                )}
                {activeRoom.status !== 'closed' && (
                  <button className={styles.btnForceClose}
                    onClick={() => forceCloseRoom(activeRoom.id)}>
                    Forzar cierre
                  </button>
                )}
              </div>
            </div>

            {/* Mensajes */}
            <div className={styles.messages} ref={messagesRef}>
              {messages.length === 0 && <p className={styles.messagesEmpty}>Sin mensajes.</p>}
              {messages.map(msg => {
                // Fichas de contacto (mensaje de sistema tras confirmarse el
                // pago): tarjeta centrada, no burbuja.
                if (msg.message_type === 'system') {
                  const fichas = parseFichas(msg.content)
                  if (fichas) return <FichasContacto key={msg.id} data={fichas} />
                }
                const isLawyer = msg.sender_type === 'lawyer'
                const isAudio  = msg.message_type === 'audio' && msg.file_url
                const firma    = parseFirmaMsg(msg.content)
                return (
                  <div key={msg.id} className={isLawyer ? styles.msgOuterMine : styles.msgOuterOther}>
                    {!isLawyer && (
                      <button className={styles.deleteBtn}
                        onClick={() => deleteMessage(msg.id)} title="Borrar"><IconTrash size={13} /></button>
                    )}
                    <div className={`${isLawyer ? styles.bubbleMine : styles.bubbleOther} ${isAudio ? styles.bubbleAudio : ''}`}>
                      <p className={styles.msgSender}>
                        {isLawyer ? 'Abogado' : 'Cliente'}
                      </p>
                      {isAudio ? (
                        // "Nota de voz" + el reproductor (que muestra la duración
                        // al cargar los metadatos). mine={true} = skin dorado,
                        // visible sobre fondos claros y oscuros del viewer.
                        <div className={styles.audioMsg}>
                          <span className={styles.audioCaption}>
                            <IconMic size={12} /> Nota de voz
                            {msg.file_size ? <span className={styles.fileSize}> · {formatSize(msg.file_size)}</span> : null}
                          </span>
                          <AudioPlayer src={msg.file_url} mine={true} />
                        </div>
                      ) : firma ? (
                        // Mensaje de firma electrónica: preview de los documentos
                        // (a firmar / firmado / certificado) en vez del JSON crudo.
                        <div className={styles.msgText} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
                            <span style={{ color: '#c9a84c' }}><IconFirma size={15} /></span>
                            {firma.t === 'firma_ok'
                              ? 'Documento firmado por el cliente'
                              : 'Documento enviado para firma'}
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {firma.t === 'firma_ok' ? (
                              <>
                                <button className={styles.fileBtn} onClick={() => verDocFirma(`${firma.solicitudId}/firmado.pdf`, 'documento-firmado.pdf')} title="Descargar el documento firmado">
                                  <IconPaperclip size={14} /> <span className={styles.fileName}>Documento firmado</span>
                                </button>
                                <button className={styles.fileBtn} onClick={() => verDocFirma(`${firma.solicitudId}/certificado.pdf`, 'certificado-de-firma.pdf')} title="Descargar el certificado de firma">
                                  <IconPaperclip size={14} /> <span className={styles.fileName}>Certificado</span>
                                </button>
                                {(firma.origPath || firma.docPath) && (
                                  <button className={styles.fileBtn} onClick={() => verDocFirma(firma.origPath || firma.docPath, 'documento-original.pdf')} title="Descargar el documento original">
                                    <IconPaperclip size={14} /> <span className={styles.fileName}>Original</span>
                                  </button>
                                )}
                              </>
                            ) : (
                              <button className={styles.fileBtn} onClick={() => verDocFirma(firma.docPath || firma.origPath, 'documento-a-firmar.pdf')} title="Descargar el documento a firmar">
                                <IconPaperclip size={14} /> <span className={styles.fileName}>Documento a firmar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : msg.file_url ? (
                        isImage(msg.file_name) ? (
                          <ChatImage
                            src={msg.file_url}
                            alt={msg.file_name || 'imagen'}
                            btnClassName={styles.imgBtn}
                            imgClassName={styles.imgPreview}
                            onOpen={setLightbox}
                          />
                        ) : (
                          <AdjuntoChat
                            src={msg.file_url}
                            nombre={msg.file_name || msg.content || 'Archivo adjunto'}
                            tamano={msg.file_size ? formatSize(msg.file_size) : null}
                            btnClassName={styles.fileBtn}
                            nombreClassName={styles.fileName}
                            tamanoClassName={styles.fileSize}
                            onVer={setVerArchivo}
                          />
                        )
                      ) : (
                        <p className={styles.msgText}>{renderMensaje(msg.content)}</p>
                      )}
                      <p className={isLawyer ? styles.msgMetaMine : styles.msgMetaOther}>
                        {new Date(msg.created_at).toLocaleString('es-CO', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                    {isLawyer && (
                      <button className={styles.deleteBtn}
                        onClick={() => deleteMessage(msg.id)} title="Borrar"><IconTrash size={13} /></button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Calificaciones */}
            {ratings.length > 0 && (
              <div className={styles.ratingsSection}>
                <p className={styles.ratingsSectionTitle}>⭐ Calificaciones</p>
                {ratings.map((r, i) => {
                  const nombre = r.profiles
                    ? `${r.profiles.nombre} ${r.profiles.apellido}`
                    : 'Abogado'
                  return (
                    <div key={i} className={styles.ratingCard}>
                      <div className={styles.ratingTop}>
                        {r.profiles?.foto_url && (
                          <img src={r.profiles.foto_url} alt={nombre}
                            className={styles.ratingAvatar} width="40" height="40" loading="lazy" decoding="async" />
                        )}
                        <div>
                          <p className={styles.ratingLawyer}>{nombre}</p>
                          <StarDisplay rating={r.rating} />
                        </div>
                        <span className={styles.ratingValue}>{r.rating}/5</span>
                      </div>
                      {r.comentario && (
                        <p className={styles.ratingComment}>"{r.comentario}"</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Footer */}
            <div className={styles.chatFooter}>
              <p className={styles.footerText}>
                Modo supervisión — el superadmin no puede escribir en el chat
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal "Definir cobro de la consulta" ──
          Split empresa/gestor con cálculo en vivo. Portal a <body>. */}
      {cobroModalOpen && activeRoom && createPortal(
        (() => {
          const total  = Number(cfgTotal)  || 0
          const pctEmp = Number(cfgPctEmp) || 0
          const pctGes = Number(cfgPctGes) || 0
          const montoEmp = Math.round(total * pctEmp / 100)
          // La comisión del gestor se calcula SOBRE la parte de la empresa
          // (no sobre el total): sale de la tajada de la empresa.
          const montoGes = roomTraeGestor ? Math.round(montoEmp * pctGes / 100) : 0
          const pagaPro  = montoEmp
          const quedaPro = total - montoEmp
          const pctInvalido = pctEmp > 100 || pctGes > 100
          return (
            <div
              className={styles.confirmOverlay}
              onClick={() => !pagoGenerando && setCobroModalOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className={`${styles.confirmModal} ${styles.cobroModal}`}
                onClick={e => e.stopPropagation()}
              >
                <h3 className={styles.confirmTitle}>Definir cobro de la consulta</h3>

                <div className={styles.cobroForm}>
                  <label className={styles.cobroField}>
                    <span className={styles.cobroLabel}>Total de la consulta (COP)</span>
                    <input
                      type="number" min="0" step="1000" inputMode="numeric"
                      className={styles.cobroInput}
                      value={cfgTotal}
                      onChange={e => setCfgTotal(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className={styles.cobroPctRow}>
                    <label className={styles.cobroField}>
                      <span className={styles.cobroLabel}>% empresa</span>
                      <input
                        type="number" min="0" max="100" step="0.1" inputMode="decimal"
                        className={styles.cobroInput}
                        value={cfgPctEmp}
                        onChange={e => setCfgPctEmp(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className={styles.cobroField}>
                      <span className={styles.cobroLabel}>% gestor</span>
                      <input
                        type="number" min="0" max="100" step="0.1" inputMode="decimal"
                        className={styles.cobroInput}
                        value={cfgPctGes}
                        onChange={e => setCfgPctGes(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  </div>
                </div>

                {pctInvalido && (
                  <p className={styles.cobroValidacion}>
                    Los porcentajes deben estar entre 0 y 100.
                  </p>
                )}

                {/* Desglose en vivo */}
                <table className={styles.cobroTabla}>
                  <tbody>
                    <tr>
                      <td className={styles.cobroTd}>Monto empresa ({pctEmp || 0}%)</td>
                      <td className={styles.cobroTdNum}>{formatCOP(montoEmp)}</td>
                    </tr>
                    <tr>
                      <td className={styles.cobroTd}>
                        Monto gestor ({pctGes || 0}% de la parte empresa)
                        {!roomTraeGestor && (
                          <span className={styles.cobroSinGestor}>Solo si la consulta trae gestor</span>
                        )}
                      </td>
                      <td className={styles.cobroTdNum}>{formatCOP(montoGes)}</td>
                    </tr>
                    <tr className={styles.cobroTrPaga}>
                      <td className={styles.cobroTd}>El profesional paga (parte empresa)</td>
                      <td className={styles.cobroTdNum}>{formatCOP(pagaPro)}</td>
                    </tr>
                    <tr>
                      <td className={styles.cobroTd}>El profesional se queda</td>
                      <td className={styles.cobroTdNum}>{formatCOP(quedaPro)}</td>
                    </tr>
                  </tbody>
                </table>

                {!roomTraeGestor ? (
                  <p className={styles.cobroNota}>
                    Esta consulta no proviene de un gestor: el monto gestor será $0.
                  </p>
                ) : (
                  <p className={styles.cobroNota}>
                    La comisión del gestor sale de la parte de la empresa (no se le suma al profesional).
                  </p>
                )}

                {pagoError && (
                  <p className={styles.cobroValidacion} role="alert">{pagoError}</p>
                )}

                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setCobroModalOpen(false)}
                    disabled={pagoGenerando}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className={styles.confirmConfirm}
                    onClick={handleGenerarCobro}
                    disabled={pagoGenerando || pctInvalido || !(total > 0)}
                  >
                    {pagoGenerando ? 'Generando…' : 'Confirmar cobro'}
                  </button>
                </div>
              </div>
            </div>
          )
        })(),
        document.body
      )}

      {/* Detalle de la consulta. Portal a <body>: el panel del admin anima
          con transform y un position:fixed dentro quedaría anclado a él. */}
      {detallesOpen && activeRoom && createPortal(
        <div className={styles.confirmOverlay} onClick={() => setDetallesOpen(false)} role="presentation">
          <div className={styles.confirmModal} onClick={e => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-labelledby="detConsultaTitulo">
            <h3 id="detConsultaTitulo" className={styles.confirmTitle}>Detalle de la consulta</h3>

            <dl className={styles.detGrid}>
              {activeRoom.codigo_referencia && (<>
                <dt className={styles.detDt}>Código de referencia</dt>
                <dd className={styles.detDd}>{activeRoom.codigo_referencia}</dd>
              </>)}
              {lawyers.length > 0 && (<>
                <dt className={styles.detDt}>Profesional</dt>
                <dd className={styles.detDd}>{lawyers.map(l => l.nombre).join(', ')}</dd>
              </>)}
              {activeRoom.client_nombre && (<>
                <dt className={styles.detDt}>Cliente</dt>
                <dd className={styles.detDd}>{activeRoom.client_nombre}</dd>
              </>)}
              {activeRoom.client_email && (<>
                <dt className={styles.detDt}>Correo</dt>
                <dd className={styles.detDd}>{activeRoom.client_email}</dd>
              </>)}
            </dl>

            {pago && (
              <>
                <h4 className={styles.detSubtitulo}>Desglose del cobro</h4>
                    <table className={styles.cobroTabla}>
                      <tbody>
                        <tr>
                          <td className={styles.cobroTd}>Total de la consulta</td>
                          <td className={styles.cobroTdNum}>{formatCOP(pago.total_consulta)}</td>
                        </tr>
                        <tr>
                          <td className={styles.cobroTd}>Empresa ({pago.pct_empresa}%)</td>
                          <td className={styles.cobroTdNum}>{formatCOP(pago.monto_empresa)}</td>
                        </tr>
                        <tr>
                          <td className={styles.cobroTd}>
                            Gestor ({pago.pct_gestor}% de la parte empresa)
                            {!pago.gestor_id && !pago.codigo && (
                              <span className={styles.cobroSinGestor}> · sin gestor</span>
                            )}
                          </td>
                          <td className={styles.cobroTdNum}>{formatCOP(pago.comision_gestor)}</td>
                        </tr>
                        <tr className={styles.cobroTrPaga}>
                          <td className={styles.cobroTd}>El profesional paga</td>
                          <td className={styles.cobroTdNum}>{formatCOP(pago.monto)}</td>
                        </tr>
                      </tbody>
                    </table>
              </>
            )}

            <div className={styles.detAcciones}>
              <button type="button" className={styles.btnDetalles}
                onClick={() => setDetallesOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ChatLightbox src={lightbox} onClose={() => setLightbox(null)} />
      <VisorArchivo archivo={verArchivo} onClose={() => setVerArchivo(null)} />
    </div>
  )
}
