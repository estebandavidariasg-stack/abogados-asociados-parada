import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import styles from './SuperAdminChatViewer.module.css'
import { IconTrash, IconPaperclip, IconFirma } from '../shared/Icons'
import AudioPlayer from './AudioPlayer'
import { openChatFile, ChatImage, ChatLightbox } from '../../lib/chatFiles'
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

// Abre un documento del bucket privado de firmas en pestaña nueva. Abrimos la
// ventana de forma síncrona (antes del await) para no dispararla en los popups.
async function verDocFirma(path) {
  if (!path) return
  const win = window.open('', '_blank')
  try {
    const headers = await getAuthHeaders()
    const url = await urlFirmada(path, headers)
    if (url && win) win.location = url
    else if (win) win.close()
  } catch { if (win) win.close() }
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
          color: s <= Math.round(rating) ? 'var(--gold)' : 'rgba(13,45,94,0.15)',
          fontSize: '1rem'
        }}>★</span>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Sub-componente PqrPanel — toda la lógica de PQR encapsulada aquí.
   Recibe onUnreadChange para que el badge del toggle padre se sincronice
   sin un fetch separado.
───────────────────────────────────────────────────────────────────────── */
const PQR_TIPOS = {
  peticion: { label: 'Petición', color: '#3a78d4', bg: 'rgba(58,120,212,0.10)' },
  queja:    { label: 'Queja',    color: '#d68c2a', bg: 'rgba(214,140,42,0.10)' },
  reclamo:  { label: 'Reclamo',  color: '#c0392b', bg: 'rgba(192,57,43,0.10)' },
}
const PQR_PAGE_SIZE = 20

function PqrPanel({ onUnreadChange }) {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const [items,    setItems]    = useState([])
  const [filter,   setFilter]   = useState('todos')        // todos|peticion|queja|reclamo
  const [page,     setPage]     = useState(1)              // página actual
  const [hasMore,  setHasMore]  = useState(false)
  const [selected, setSelected] = useState(null)           // PQR seleccionada (modal/panel)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  async function fetchPage(targetPage = 1, append = false) {
    setLoading(true); setError('')
    try {
      const headers = await getAuthHeaders()
      const filterClause = filter === 'todos' ? '' : `&tipo=eq.${filter}`
      // Pedimos 1 extra para saber si hay más
      const limit  = PQR_PAGE_SIZE + 1
      const offset = (targetPage - 1) * PQR_PAGE_SIZE
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pqr?select=*&order=created_at.desc&limit=${limit}&offset=${offset}${filterClause}`,
        { headers }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const more = data.length > PQR_PAGE_SIZE
      const visible = more ? data.slice(0, PQR_PAGE_SIZE) : data
      setItems(prev => append ? [...prev, ...visible] : visible)
      setHasMore(more)
      setPage(targetPage)
    } catch (err) {
      setError('No se pudo cargar la lista de PQR: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchUnreadCount() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pqr?leido=eq.false&select=id`,
        { headers: { ...headers, Prefer: 'count=exact' } }
      )
      const range = res.headers.get('content-range') // ej: "0-19/42"
      const total = range ? parseInt(range.split('/')[1] || '0', 10) : 0
      onUnreadChange?.(Number.isFinite(total) ? total : 0)
    } catch { /* no-op */ }
  }

  // Recargar cuando cambia el filtro o al montar
  useEffect(() => { fetchPage(1, false) /* eslint-disable-next-line */ }, [filter])
  useEffect(() => { fetchUnreadCount() /* eslint-disable-next-line */ }, [])

  async function markRead(id) {
    const item = items.find(p => p.id === id)
    if (!item || item.leido) return
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pqr?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ leido: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Actualizar estado local sin refetch
      setItems(prev => prev.map(p => p.id === id ? { ...p, leido: true } : p))
      if (selected?.id === id) setSelected(s => ({ ...s, leido: true }))
      fetchUnreadCount()
    } catch (err) {
      alert('No se pudo marcar como leído: ' + err.message)
    }
  }

  async function deletePqr(id) {
    if (!window.confirm('¿Eliminar esta PQR? Esta acción no se puede deshacer.')) return
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pqr?id=eq.${id}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setItems(prev => prev.filter(p => p.id !== id))
      if (selected?.id === id) setSelected(null)
      fetchUnreadCount()
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message)
    }
  }

  function fmtFecha(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className={styles.pqrSection}>
      {/* Filtros por tipo */}
      <div className={styles.pqrFilters}>
        {[
          { v: 'todos',    l: 'Todos' },
          { v: 'peticion', l: 'Petición' },
          { v: 'queja',    l: 'Queja' },
          { v: 'reclamo',  l: 'Reclamo' },
        ].map(opt => (
          <button
            key={opt.v}
            className={filter === opt.v ? styles.pqrFilterActive : styles.pqrFilter}
            onClick={() => setFilter(opt.v)}
          >
            {opt.l}
          </button>
        ))}
        <button
          className={styles.pqrRefresh}
          onClick={() => { fetchPage(1, false); fetchUnreadCount() }}
          title="Actualizar"
        >
          ↺ Actualizar
        </button>
      </div>

      {error && <p className={styles.pqrErrorTxt}>{error}</p>}

      <div className={styles.pqrLayout}>
        {/* Lista */}
        <div className={styles.pqrList}>
          {loading && items.length === 0 && (
            <p className={styles.pqrEmpty}>Cargando…</p>
          )}
          {!loading && items.length === 0 && (
            <p className={styles.pqrEmpty}>No hay PQR en este filtro.</p>
          )}
          {items.map(p => {
            const tipo = PQR_TIPOS[p.tipo] || { label: p.tipo, color: '#666', bg: '#eee' }
            const isActive = selected?.id === p.id
            return (
              <button
                key={p.id}
                className={`${styles.pqrCardItem} ${isActive ? styles.pqrCardItemActive : ''} ${!p.leido ? styles.pqrCardItemUnread : ''}`}
                onClick={() => setSelected(p)}
              >
                <div className={styles.pqrCardTop}>
                  <span
                    className={styles.pqrTipoBadge}
                    style={{ color: tipo.color, background: tipo.bg, borderColor: tipo.color }}
                  >
                    {tipo.label}
                  </span>
                  {!p.leido && <span className={styles.pqrDotUnread} title="No leído" />}
                </div>
                <p className={styles.pqrCardName}>
                  {p.client_nombre || 'Cliente anónimo'}
                </p>
                <p className={styles.pqrCardPreview}>
                  {(p.mensaje || '').slice(0, 90)}{(p.mensaje || '').length > 90 ? '…' : ''}
                </p>
                <p className={styles.pqrCardDate}>{fmtFecha(p.created_at)}</p>
              </button>
            )
          })}

          {hasMore && !loading && (
            <button
              className={styles.pqrLoadMore}
              onClick={() => fetchPage(page + 1, true)}
            >
              Cargar más
            </button>
          )}
        </div>

        {/* Detalle */}
        {selected && (
          <div className={styles.pqrDetail}>
            <div className={styles.pqrDetailHeader}>
              <span
                className={styles.pqrTipoBadge}
                style={{
                  color: (PQR_TIPOS[selected.tipo] || {}).color || '#666',
                  background: (PQR_TIPOS[selected.tipo] || {}).bg || '#eee',
                  borderColor: (PQR_TIPOS[selected.tipo] || {}).color || '#666',
                }}
              >
                {(PQR_TIPOS[selected.tipo] || {}).label || selected.tipo}
              </span>
              <button
                className={styles.pqrDetailClose}
                onClick={() => setSelected(null)}
                aria-label="Cerrar detalle"
              >
                ✕
              </button>
            </div>

            <dl className={styles.pqrDetailMeta}>
              <dt>Nombre</dt>
              <dd>{selected.client_nombre || '—'}</dd>
              <dt>Email</dt>
              <dd>{selected.client_email || '—'}</dd>
              <dt>Código de referencia</dt>
              <dd>{selected.codigo_referencia || '—'}</dd>
              <dt>Fecha</dt>
              <dd>{fmtFecha(selected.created_at)}</dd>
              <dt>Estado</dt>
              <dd>{selected.leido ? 'Leído' : 'No leído'}</dd>
            </dl>

            <div className={styles.pqrDetailMessage}>
              <p className={styles.pqrDetailMessageLabel}>Mensaje</p>
              <p className={styles.pqrDetailMessageText}>{selected.mensaje}</p>
            </div>

            <div className={styles.pqrDetailActions}>
              {!selected.leido && (
                <button
                  className={styles.pqrBtnPrimary}
                  onClick={() => markRead(selected.id)}
                >
                  Marcar como leído
                </button>
              )}
              <button
                className={styles.pqrBtnDanger}
                onClick={() => deletePqr(selected.id)}
              >
                Eliminar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const FIELDS = 'id, area_derecho, status, created_at, client_nombre, client_email, client_celular, client_cedula, codigo_referencia, tipo_profesional'

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
  const [rolFilter, setRolFilter]       = useState('todos')  // 'todos'|'abogado'|'contador'
  const [soloVerif, setSoloVerif]       = useState(false)    // filtro "Solo verificación"
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
  // Envío de fichas de contacto
  const [sending, setSending]       = useState(false)
  const [sendStatus, setSendStatus] = useState('idle') // 'idle' | 'success' | 'error'
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Tabs Chats / PQR
  const [view,            setView]            = useState('chats')   // 'chats' | 'pqr'
  const [pqrUnreadCount,  setPqrUnreadCount]  = useState(0)
  const [lightbox,        setLightbox]        = useState(null)      // URL imagen ampliada
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

  // Conteo inicial de PQR no leídos para mostrar el badge en el toggle
  // antes de que el admin abra la pestaña.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pqr?leido=eq.false&select=id`,
          { headers: { ...headers, Prefer: 'count=exact' } }
        )
        const range = res.headers.get('content-range')
        const total = range ? parseInt(range.split('/')[1] || '0', 10) : 0
        if (!cancelled) setPqrUnreadCount(Number.isFinite(total) ? total : 0)
      } catch { /* silencio: el badge solo es informativo */ }
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
    // Solo salas con verificación pendiente.
    if (soloVerif) list = list.filter(r => verifRooms.has(r.id))
    // Búsqueda unificada instantánea: nombre del cliente, nombre del
    // profesional asignado, código de referencia, área, y cédula (por hash
    // O por el número crudo que aparece en el primer mensaje / cache).
    if (search) {
      const s = search.toLowerCase()
      const rawCedula = search.replace(/\D/g, '')  // dígitos que teclea
      list = list.filter(r =>
        r.client_nombre?.toLowerCase().includes(s) ||
        r._professionalNombre?.toLowerCase().includes(s) ||
        r.codigo_referencia?.toLowerCase().includes(s) ||
        r.area_derecho?.toLowerCase().includes(s) ||
        // cédula por hash (client_cedula está hasheado)
        (searchHash && r.client_cedula === searchHash) ||
        // cédula por número crudo detectado en el primer mensaje
        (rawCedula.length >= 6 && r._cedulaCruda && r._cedulaCruda.includes(rawCedula))
      )
    }
    setFiltered(list)
  }, [rooms, filterStatus, filterArea, search, searchHash, rolFilter, soloVerif, verifRooms])

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

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

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

  // Abre el modal de confirmación. Validación previa para evitar abrir el
  // modal cuando seguro no se va a poder enviar.
  function openSendConfirm() {
    if (!activeRoom) return
    if (!lawyers.length || !activeRoom.client_email) {
      setSendStatus('error')
      return
    }
    setSendStatus('idle')
    setConfirmOpen(true)
  }

  async function handleSendContactCards() {
    if (!activeRoom) return
    setConfirmOpen(false)

    // Re-validación defensiva (por si algo cambió mientras estaba abierto el modal)
    if (!lawyers.length || !activeRoom.client_email) {
      setSendStatus('error')
      return
    }

    // Preferimos el abogado con status 'active'; si no, el primero asignado
    const target = lawyers.find(l => l.status === 'active') || lawyers[0]

    setSending(true)
    setSendStatus('idle')

    try {
      const headers = await getAuthHeaders()

      // Datos completos del abogado (email + telefono)
      const lawyerRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${target.lawyer_id}&select=nombre,apellido,email,telefono`,
        { headers }
      )
      const profiles = await lawyerRes.json()
      const lawyerProfile = Array.isArray(profiles) ? profiles[0] : null
      if (!lawyerProfile?.email) throw new Error('Abogado sin email')

      // Consolidado en /api/notify (type: 'contact_card') para no superar el
      // límite de 12 Serverless Functions del plan Hobby de Vercel.
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'contact_card',
          // profiles.telefono se mapea a celular del contrato API
          lawyerData: {
            nombre:   lawyerProfile.nombre,
            apellido: lawyerProfile.apellido,
            email:    lawyerProfile.email,
            celular:  lawyerProfile.telefono || '',
          },
          clientData: {
            nombre:  activeRoom.client_nombre   || '',
            email:   activeRoom.client_email    || '',
            celular: activeRoom.client_celular  || '',
          },
          codigoReferencia: activeRoom.codigo_referencia || '',
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error || 'send failed')

      setSendStatus('success')
      // Reset solo si seguimos en 'success' (no pisar otro estado posterior)
      setTimeout(() => setSendStatus(s => (s === 'success' ? 'idle' : s)), 3000)
    } catch {
      setSendStatus('error')
    } finally {
      setSending(false)
    }
  }

  async function deleteMessage(mid) {
    await supabase.from('chat_messages').delete().eq('id', mid)
    setMessages(prev => prev.filter(m => m.id !== mid))
  }

  return (
    <div className={styles.viewer}>

      {/* ── Tabs principales: Chats / PQR ── */}
      <div className={styles.pqrTabs}>
        <button
          type="button"
          className={view === 'chats' ? styles.pqrTabActive : styles.pqrTab}
          onClick={() => setView('chats')}
        >
          Chats
        </button>
        <button
          type="button"
          className={view === 'pqr' ? styles.pqrTabActive : styles.pqrTab}
          onClick={() => setView('pqr')}
        >
          PQR
          {pqrUnreadCount > 0 && (
            <span className={styles.pqrUnreadBadge}>{pqrUnreadCount}</span>
          )}
        </button>
      </div>

      {view === 'pqr' && (
        <PqrPanel onUnreadChange={setPqrUnreadCount} />
      )}

      {view === 'chats' && (<>

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

      {/* ── Filtro unificado (chips de profesión + búsqueda instantánea) ── */}
      {searchMode === 'all' && (
        <div className={styles.unifiedBar}>
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

          <input
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o cédula…"
          />

          <select className={styles.filterSelect} value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="waiting">Esperando</option>
            <option value="active">Activos</option>
            <option value="closed">Cerrados</option>
          </select>

          <button
            type="button"
            className={soloVerif ? styles.verifToggleActive : styles.verifToggle}
            onClick={() => setSoloVerif(v => !v)}
            aria-pressed={soloVerif}
            title="Mostrar solo chats con verificación pendiente"
          >
            <IconVerif size={15} />
            Solo verificación
            {verifRooms.size > 0 && (
              <span className={styles.verifCount}>{verifRooms.size}</span>
            )}
          </button>

          <button className={styles.refreshBtn} onClick={loadRooms}>↺ Actualizar</button>
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
            const flagged = verifRooms.has(room.id)
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
              {flagged && (
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
                  {verifRooms.has(activeRoom.id) && (
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
                {/* ← NUEVO: código de referencia en header */}
                {activeRoom.codigo_referencia && (
                  <div className={styles.codigoRef}>
                    <span className={styles.codigoRefLabel}>Código de referencia:</span>
                    <span className={styles.codigoRefValue}>{activeRoom.codigo_referencia}</span>
                  </div>
                )}
                <div className={styles.lawyerTags}>
                  {lawyers.map(l => (
                    <span key={l.lawyer_id} className={styles.lawyerTag}
                      style={{ color: l.status === 'active' ? '#4caf50' : '#888' }}>
                      {l.nombre}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.headerActions}>
                <button
                  type="button"
                  className={`${styles.btnSendCard} ${sendStatus === 'success' ? styles.btnSendCardSuccess : ''} ${sendStatus === 'error' ? styles.btnSendCardError : ''}`}
                  onClick={openSendConfirm}
                  disabled={sending || !lawyers.length || !activeRoom.client_email}
                  title={
                    !lawyers.length
                      ? 'No hay abogado asignado todavía'
                      : !activeRoom.client_email
                        ? 'Este chat no tiene email del cliente'
                        : 'Enviar ficha de contacto a cliente y abogado'
                  }
                >
                  {sending
                    ? 'Enviando...'
                    : sendStatus === 'success'
                      ? '✅ Enviadas'
                      : sendStatus === 'error'
                        ? '❌ Error — reintentar'
                        : 'Enviar Fichas de Contacto'}
                </button>
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
                        // mine={true} = skin dorado del AudioPlayer (visible
                        // sobre fondos claros y oscuros del viewer del admin)
                        <AudioPlayer src={msg.file_url} mine={true} />
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
                                <button className={styles.fileBtn} onClick={() => verDocFirma(`${firma.solicitudId}/firmado.pdf`)} title="Ver documento firmado">
                                  <IconPaperclip size={14} /> <span className={styles.fileName}>Documento firmado</span>
                                </button>
                                <button className={styles.fileBtn} onClick={() => verDocFirma(`${firma.solicitudId}/certificado.pdf`)} title="Ver certificado de firma">
                                  <IconPaperclip size={14} /> <span className={styles.fileName}>Certificado</span>
                                </button>
                                {(firma.origPath || firma.docPath) && (
                                  <button className={styles.fileBtn} onClick={() => verDocFirma(firma.origPath || firma.docPath)} title="Ver documento original">
                                    <IconPaperclip size={14} /> <span className={styles.fileName}>Original</span>
                                  </button>
                                )}
                              </>
                            ) : (
                              <button className={styles.fileBtn} onClick={() => verDocFirma(firma.docPath || firma.origPath)} title="Ver documento a firmar">
                                <IconPaperclip size={14} /> <span className={styles.fileName}>Ver documento a firmar</span>
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
                          <button className={styles.fileBtn}
                            onClick={() => openChatFile(msg.file_url)}
                            title={msg.file_name}>
                            <IconPaperclip size={16} />
                            <span className={styles.fileName}>{msg.file_name}</span>
                            <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                          </button>
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

      {/* ── Modal de confirmación: Enviar fichas de contacto ──
          Portal a <body>: así el position:fixed se ancla al viewport y no a
          un ancestro con transform/backdrop-filter (queda fijo y centrado). */}
      {confirmOpen && createPortal(
        <div
          className={styles.confirmOverlay}
          onClick={() => !sending && setConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.confirmModal}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={styles.confirmTitle}>Enviar fichas de contacto</h3>
            <p className={styles.confirmText}>
              ¿Enviar ficha de contacto a ambas partes?<br />
              El cliente recibirá los datos del abogado y viceversa.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.confirmConfirm}
                onClick={handleSendContactCards}
                disabled={sending}
              >
                {sending ? 'Enviando…' : 'Enviar fichas'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      </>)}

      <ChatLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
