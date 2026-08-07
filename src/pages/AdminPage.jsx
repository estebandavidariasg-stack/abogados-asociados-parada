import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'
import SuperAdminChatViewer from '../components/chat/SuperAdminChatViewer'
import GestoresAdmin from '../components/admin/GestoresAdmin'
import PagosCobrosAdmin from '../components/admin/PagosCobrosAdmin'
import MisContratos from '../components/profile/MisContratos'
import AdminInternalChat from '../components/chat/AdminInternalChat'
import ProfileDetailModal from '../components/admin/ProfileDetailModal'
import TarjetaPreview from '../components/profile/TarjetaPreview'
import NotificationBell from '../components/admin/NotificationBell'
import ResenasAdmin from '../components/admin/ResenasAdmin'
import ProyectosLeyAdmin from '../components/admin/ProyectosLeyAdmin'
import AdminStats from '../components/admin/AdminStats'
import { IconCheck, IconX } from '../components/shared/Icons'

// ── Iconos SVG (estilo Lucide, currentColor) — sin emojis como iconos ──
const IconInbox  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>)
const IconUsers  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>)
const IconChat   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>)
const IconRecover= (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>)
const IconAlert  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>)
const IconShield = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>)
const IconDoc    = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>)
const IconStar   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>)
const IconHome   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>)
const IconLogout = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>)
const IconGestor = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M12 11v0"/></svg>)
const IconWallet = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>)
const IconLey    = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
  }
}

export default function AdminPage() {
  const { user, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [confirmLogout, setConfirmLogout] = useState(false)
  // Diálogo de confirmación reutilizable: { title, message, confirmLabel, toneClass, onConfirm }
  const [confirmAction, setConfirmAction] = useState(null)

  const [activeTab, setActiveTab]             = useState('pending')
  const [pending, setPending]                 = useState([])
  const [approved, setApproved]               = useState([])
  const [gestores, setGestores]               = useState([])   // para el badge de la pestaña Gestores
  const [loadingData, setLoadingData]         = useState(true)
  const [alertas, setAlertas]                 = useState([])
  const [chatsCerrados, setChatsCerrados]     = useState([])
  const [allRooms, setAllRooms]               = useState([])   // para stats/gráfica
  const [extraCounts, setExtraCounts]         = useState({})   // contratos/firmas/reseñas/códigos
  const [abogadoContrato, setAbogadoContrato] = useState(null)
  // Sub-filtro por rol dentro de Solicitudes/Aprobados/Contratos
  const [rolFilter, setRolFilter]             = useState('todos') // 'todos' | 'abogado' | 'contador' | 'gestor'
  // Búsqueda instantánea por nombre / cédula (compartida por las listas de personas)
  const [personSearch, setPersonSearch]       = useState('')
  // Filtro de SALAS (Recuperar / Alertas): chip de profesión + búsqueda instantánea.
  // Cada pestaña tiene su propio estado para que no se pisen entre sí.
  const [recuperarTipo, setRecuperarTipo]     = useState('todos') // 'todos'|'abogado'|'contador'
  const [recuperarSearch, setRecuperarSearch] = useState('')
  const [alertasTipo, setAlertasTipo]         = useState('todos')
  const [alertasSearch, setAlertasSearch]     = useState('')
  // Vista detalle del perfil (modal)
  const [previewProfile, setPreviewProfile]   = useState(null)
  // Sala a abrir en el visor (deep-link desde la campanita / correo)
  const [chatRoomToOpen, setChatRoomToOpen]   = useState(null)
  // Reasignación forzada (barrera 4h): sala elegida + estado del modal
  const [reasignarRoom, setReasignarRoom]     = useState(null)   // room + escalation info

  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'superadmin') { navigate('/'); return }
    fetchAll()
    fetchAlertas()
    fetchChatsCerrados()
    fetchRooms()
    fetchExtraCounts()
    fetchGestores()
  }, [user, profile, loading])

  // Deep-link: /admin?tab=chats&room=<id> (desde el correo de verificación).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    const room = params.get('room')
    if (tab === 'chats') setActiveTab('chats')
    if (room) setChatRoomToOpen(room)
  }, [])

  // Abrir una conversación desde la campanita (ya estamos en /admin).
  function handleOpenRoom(roomId) {
    setActiveTab('chats')
    setChatRoomToOpen(roomId)
  }

  async function fetchAll() {
    setLoadingData(true)
    await Promise.all([fetchPending(), fetchApproved()])
    setLoadingData(false)
  }

  async function fetchPending() {
    const headers = await getAuthHeaders()
    // Trae abogados, contadores y gestores pendientes — el filtro por rol se
    // aplica en cliente. Los gestores entran aquí para aprobarse/rechazarse
    // igual que los profesionales (misma bandera `aprobado`).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.false&rol=in.(abogado,contador,gestor)&select=*`,
      { headers }
    )
    const data = await res.json()
    setPending(Array.isArray(data) ? data : [])
  }

  // Lista de gestores para el badge de la pestaña Gestores (solo id/aprobado).
  async function fetchGestores() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?rol=eq.gestor&select=id,aprobado`,
        { headers }
      )
      const data = await res.json()
      setGestores(Array.isArray(data) ? data : [])
    } catch { setGestores([]) }
  }

  async function fetchApproved() {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=in.(abogado,contador,gestor)&select=*`,
      { headers }
    )
    const data = await res.json()
    setApproved(Array.isArray(data) ? data : [])
  }

  async function approveProfile(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ aprobado: true }),
    })
    // Avisar al profesional por correo (best-effort: no bloquea la aprobación).
    // El endpoint valida superadmin con este mismo token.
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'account_approved', data: { lawyerId: id } }),
      })
    } catch { /* el correo es secundario; la aprobación ya quedó */ }
    fetchAll()
    fetchGestores()
  }

  async function rejectProfile(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ aprobado: false }),
    })
    // Avisar al profesional (best-effort; el endpoint valida superadmin).
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'account_rejected', data: { lawyerId: id } }),
      })
    } catch { /* el correo es secundario */ }
    fetchAll()
    fetchGestores()
  }

  async function removeApproved(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ aprobado: false }),
    })
    fetchAll()
    fetchGestores()
  }

  async function toggleDescargaArchivos(id, current) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ puede_descargar_archivos: !current }),
    })
    setApproved(prev => prev.map(p => p.id === id ? { ...p, puede_descargar_archivos: !current } : p))
  }

  async function fetchAlertas() {
    try {
      const headers = await getAuthHeaders()
      // chat_rooms.status: 'waiting' | 'active' | 'closed' (NO existe `cerrado`).
      // Las alertas son chats abiertos (no closed) sin actividad +24h.
      // Limit explícito: sin él PostgREST trunca en max-rows en silencio.
      // En paralelo: salas abiertas + notificaciones de reasignación
      // obligatoria (barrera de 4h superada) aún sin atender.
      const [roomsRes, notifRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?status=in.(waiting,active)&select=*&order=created_at.desc&limit=1000`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/notificaciones?tipo=eq.reasignacion_obligatoria&atendida=eq.false&select=id,room_id&order=created_at.desc&limit=1000`,
          { headers }
        ).catch(() => null),
      ])
      const rooms = await roomsRes.json()
      // Notificación de escalada por sala (para el botón "Reasignar ahora").
      const notifByRoom = {}
      try {
        const notifs = notifRes ? await notifRes.json() : []
        if (Array.isArray(notifs)) {
          for (const n of notifs) {
            if (n.room_id && !notifByRoom[n.room_id]) notifByRoom[n.room_id] = n.id
          }
        }
      } catch { /* sin notificaciones de escalada */ }
      if (!Array.isArray(rooms) || rooms.length === 0) { setAlertas([]); return }
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      // Antes hacíamos 1 + 2N queries (serializadas dentro del for) — con
      // 30+ salas tardaba ~30s. Ahora batcheamos:
      //   1) Una query para TODOS los mensajes recientes de TODAS las salas
      //   2) Filtramos en memoria las salas SIN actividad
      //   3) Una query para los abogados asignados a esas salas inactivas
      // Total: 3 queries en lugar de 1 + 2N. Los in.() van troceados en lotes
      // de 150 ids: con cientos de salas abiertas la URL supera el límite del
      // gateway y la request entera falla.
      const enLotes = async (tabla, ids, resto, tam = 150) => {
        const out = []
        for (let i = 0; i < ids.length; i += tam) {
          const lote = ids.slice(i, i + tam)
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/${tabla}?room_id=in.(${lote.join(',')})${resto}&limit=1000`,
            { headers }
          )
          const rows = await r.json().catch(() => null)
          if (Array.isArray(rows)) out.push(...rows)
        }
        return out
      }

      // Mensajes en lotes de 50 salas: con el limit=1000 por lote, 50 salas
      // dejan margen holgado (≥20 msgs/sala/24h) y evitan que una sala CON
      // actividad quede fuera del corte y aparezca como falsa alerta.
      const msgsAll = await enLotes('chat_messages', rooms.map(r => r.id), `&created_at=gte.${hace24h}&select=room_id`, 50)
      const conActividad = new Set(msgsAll.map(m => m.room_id))
      // Una sala entra a la lista si lleva +24h sin actividad O si tiene la
      // barrera de 4h superada (reasignacion_forzada / notificación de escalada)
      // — así una sala escalada nunca desaparece de la vista aunque cambie algo.
      const esEscalada = (r) => !!r.reasignacion_forzada || !!notifByRoom[r.id]
      const inactiveRooms = rooms.filter(r => !conActividad.has(r.id) || esEscalada(r))
      if (inactiveRooms.length === 0) { setAlertas([]); return }

      const lawyersAll = await enLotes('chat_room_lawyers', inactiveRooms.map(r => r.id), '&select=room_id,lawyer_id')
      const lawyersByRoom = {}
      for (const l of lawyersAll) {
        if (!lawyersByRoom[l.room_id]) lawyersByRoom[l.room_id] = []
        lawyersByRoom[l.room_id].push(l.lawyer_id)
      }

      const inactivas = inactiveRooms.map(r => ({
        ...r,
        lawyer_ids: lawyersByRoom[r.id] || [],
        escalada:   esEscalada(r),
        notifId:    notifByRoom[r.id] || null,
      }))
      // Las salas escaladas (barrera 4h superada) van SIEMPRE arriba para que
      // el admin no las pase por alto.
      inactivas.sort((a, b) => (b.escalada === true) - (a.escalada === true))
      setAlertas(inactivas)
    } catch (err) {
      console.error('[fetchAlertas] error:', err)
      setAlertas([])
    }
  }

  async function fetchChatsCerrados() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?status=eq.closed&select=*&order=created_at.desc&limit=50`,
        { headers }
      )
      const data = await res.json()
      setChatsCerrados(Array.isArray(data) ? data : [])
    } catch { setChatsCerrados([]) }
  }

  // Todas las salas (solo created_at/status) para las tarjetas y la gráfica.
  async function fetchRooms() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?select=created_at,status,tipo_profesional&order=created_at.desc&limit=2000`,
        { headers }
      )
      const data = await res.json()
      setAllRooms(Array.isArray(data) ? data : [])
    } catch { setAllRooms([]) }
  }

  // Conteos por tabla (count=exact + Range 0-0: no trae filas, solo el total).
  async function fetchExtraCounts() {
    const headers = await getAuthHeaders()
    const contar = async (path) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
          headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
        })
        const total = parseInt((res.headers.get('content-range') || '').split('/')[1], 10)
        return Number.isFinite(total) ? total : 0
      } catch { return 0 }
    }
    const [contratos, firmas, resenasTotal, resenasAprob, codigos, codigosActivos] = await Promise.all([
      contar('contratos?select=id'),
      contar('firmas_solicitudes?select=id&estado=eq.firmado'),
      contar('resenas?select=id'),
      contar('resenas?select=id&aprobado=eq.true'),
      contar('codigos_referencia?select=id'),
      contar('codigos_referencia?select=id&activo=eq.true'),
    ])
    setExtraCounts({ contratos, firmas, resenasTotal, resenasAprob, codigos, codigosActivos })
  }

  async function reabrirChat(id) {
    const headers = await getAuthHeaders()
    // Reabrir = volver a 'waiting' para que un profesional pueda retomarla.
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'waiting' }),
    })
    fetchChatsCerrados()
    fetchAlertas()
  }

  // ── Notificar a los abogados asignados de un chat inactivo ──────────────
  // Llama a /api/notify type=chat_inactivity (resuelve emails server-side).
  // Estado local para feedback visual: 'idle' | 'sending' | 'sent' | 'error'
  const [notifEstado, setNotifEstado] = useState({}) // roomId → estado

  async function notificarInactividad(room) {
    if (!room.lawyer_ids || room.lawyer_ids.length === 0) {
      setNotifEstado(s => ({ ...s, [room.id]: 'no-lawyers' }))
      return
    }
    setNotifEstado(s => ({ ...s, [room.id]: 'sending' }))
    try {
      // El endpoint exige superadmin → mandamos el token del admin autenticado.
      const authHeaders = await getAuthHeaders()
      // Una llamada por abogado asignado (típicamente 1-3, no merece batching)
      const results = await Promise.all(
        room.lawyer_ids.map(lawyerId =>
          fetch('/api/notify', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              type: 'chat_inactivity',
              recipientRole: 'lawyer',
              codigoReferencia: room.codigo_referencia || null,
              data: {
                lawyerId,
                roomId:        room.id,
                clientNombre:  room.client_nombre || 'Cliente',
                area:          room.area_derecho  || '',
                createdAt:     room.created_at,
              },
            }),
          })
        )
      )
      const allOk = results.every(r => r.ok)
      setNotifEstado(s => ({ ...s, [room.id]: allOk ? 'sent' : 'error' }))
    } catch (err) {
      console.error('[notificarInactividad] error:', err)
      setNotifEstado(s => ({ ...s, [room.id]: 'error' }))
    }
  }

  // ── Filtrado unificado por rol + búsqueda (nombre / cédula) ───────────
  // Normaliza cédulas quitando puntos y espacios para comparar.
  const soloDigitos = s => (s || '').toString().replace(/[.\s]/g, '')
  const coincidePersona = (p) => {
    const q = personSearch.trim().toLowerCase()
    if (!q) return true
    const qDigits = soloDigitos(q)
    const campos = [p.nombre, p.apellido, p.username, p.email]
      .filter(Boolean).map(x => x.toLowerCase())
    if (campos.some(c => c.includes(q))) return true
    // Cédula: comparar sin puntos/espacios (permite buscar "1.234" o "1234").
    if (qDigits && soloDigitos(p.cedula).includes(qDigits)) return true
    return false
  }
  // Filtra por rol (incluye 'gestor') + texto instantáneo. `roles` restringe
  // qué roles admite la lista (p. ej. Contratos = abogado/contador).
  const filtrarPersonas = (arr, roles = null) => arr.filter(p => {
    if (roles && !roles.includes(p.rol)) return false
    if (rolFilter !== 'todos' && p.rol !== rolFilter) return false
    return coincidePersona(p)
  })

  const pendingFiltered  = filtrarPersonas(pending)
  const approvedFiltered = filtrarPersonas(approved)
  // Contratos: solo profesionales con contratos (abogado / contador).
  const contratosFiltered = filtrarPersonas(approved, ['abogado', 'contador'])

  // Barra de filtro reutilizable: chips de rol + búsqueda instantánea. Una sola
  // definición reusada en Solicitudes, Aprobados y Contratos. `roles` limita las
  // chips visibles (Contratos oculta "Gestores"); `placeholder` es opcional.
  const PersonFilterBar = ({ roles = ['abogado', 'contador', 'gestor'], placeholder = 'Buscar por nombre o cédula…' }) => (
    <div className={styles.filterBar}>
      <div className={styles.rolChipsRow}>
        <button
          type="button"
          className={`${styles.rolChip} ${rolFilter === 'todos' ? styles.rolChipActive : ''}`}
          onClick={() => setRolFilter('todos')}
        >
          Todos
        </button>
        {roles.includes('abogado') && (
          <button
            type="button"
            className={`${styles.rolChip} ${rolFilter === 'abogado' ? styles.rolChipActive : ''}`}
            onClick={() => setRolFilter('abogado')}
          >
            Abogados
          </button>
        )}
        {roles.includes('contador') && (
          <button
            type="button"
            className={`${styles.rolChip} ${rolFilter === 'contador' ? styles.rolChipActive : ''}`}
            onClick={() => setRolFilter('contador')}
          >
            Contadores
          </button>
        )}
        {roles.includes('gestor') && (
          <button
            type="button"
            className={`${styles.rolChip} ${rolFilter === 'gestor' ? styles.rolChipActive : ''}`}
            onClick={() => setRolFilter('gestor')}
          >
            Gestores
          </button>
        )}
      </div>
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="search"
          className={styles.searchInput}
          value={personSearch}
          onChange={e => setPersonSearch(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar por nombre o cédula"
        />
        {personSearch && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setPersonSearch('')}
            aria-label="Limpiar búsqueda"
            title="Limpiar"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )

  // ── Filtro de SALAS (Recuperar / Alertas) ────────────────────────────
  // Barra reutilizable idéntica a PersonFilterBar: chips de profesión
  // [Todos | Abogados | Contadores] filtrando por `tipo_profesional`, más una
  // búsqueda instantánea (sin botón) sobre cliente / código / área / cédula.
  // Recibe su estado por props para que cada pestaña mantenga el suyo.
  const RoomFilterBar = ({
    tipo, setTipo, search, setSearch,
    placeholder = 'Buscar por cliente, cédula o código…',
  }) => (
    <div className={styles.filterBar}>
      <div className={styles.rolChipsRow}>
        <button
          type="button"
          className={`${styles.rolChip} ${tipo === 'todos' ? styles.rolChipActive : ''}`}
          onClick={() => setTipo('todos')}
        >
          Todos
        </button>
        <button
          type="button"
          className={`${styles.rolChip} ${tipo === 'abogado' ? styles.rolChipActive : ''}`}
          onClick={() => setTipo('abogado')}
        >
          Abogados
        </button>
        <button
          type="button"
          className={`${styles.rolChip} ${tipo === 'contador' ? styles.rolChipActive : ''}`}
          onClick={() => setTipo('contador')}
        >
          Contadores
        </button>
      </div>
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="search"
          className={styles.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar por cliente, cédula o código"
        />
        {search && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setSearch('')}
            aria-label="Limpiar búsqueda"
            title="Limpiar"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )

  // Filtra una lista de salas por profesión + texto instantáneo. El texto matchea
  // contra client_nombre / codigo_referencia / area_derecho (y, opcionalmente, la
  // cédula: los datos guardan client_cedula como hash SHA-256, así que sólo
  // coincide si el usuario pega el hash completo — priorizamos nombre/código/área).
  const coincideSala = (r, q) => {
    const s = (q || '').trim().toLowerCase()
    if (!s) return true
    const campos = [r.client_nombre, r.codigo_referencia, r.area_derecho, r.client_email]
      .filter(Boolean).map(x => x.toString().toLowerCase())
    if (campos.some(c => c.includes(s))) return true
    // Cédula hasheada: coincidencia exacta opcional (poco común, pero soportada).
    if (r.client_cedula && r.client_cedula.toString().toLowerCase().includes(s)) return true
    return false
  }
  const filtrarSalas = (arr, tipo, search) => (arr || []).filter(r => {
    if (tipo !== 'todos' && (r.tipo_profesional || 'abogado') !== tipo) return false
    return coincideSala(r, search)
  })

  // Listas de salas filtradas. `filtrarSalas` preserva el orden de entrada, así
  // que las alertas escaladas (ya ordenadas primero en fetchAlertas) siguen arriba.
  const recuperarFiltrados = filtrarSalas(chatsCerrados, recuperarTipo, recuperarSearch)
  const alertasFiltradas   = filtrarSalas(alertas, alertasTipo, alertasSearch)

  // Enlaces sociales de un perfil (usado en tarjetas de gestor). Solo renderiza
  // los que existan; guarda campos ausentes.
  const PersonSocialLinks = ({ p }) => {
    const redes = [
      ['Instagram', p.instagram],
      ['LinkedIn',  p.linkedin],
      ['Facebook',  p.facebook],
      ['TikTok',    p.tiktok],
    ].filter(([, url]) => !!url)
    const cert = p.certificado_bancario_url
    if (redes.length === 0 && !cert) return null
    return (
      <div className={styles.socialRow}>
        {redes.map(([label, url]) => (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.socialLink}
            onClick={e => e.stopPropagation()}
          >
            {label}
          </a>
        ))}
        {cert && (
          <a
            href={cert}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cardTarjetaLink}
            onClick={e => e.stopPropagation()}
          >
            Certificado bancario
          </a>
        )}
      </div>
    )
  }

  // Etiqueta legible del rol para el badge de las tarjetas.
  const rolLabel = (rol) => rol === 'contador' ? 'Contador' : rol === 'gestor' ? 'Gestor' : 'Abogado'
  const rolBadgeClass = (rol) => rol === 'contador'
    ? styles.cardRolBadgeContador
    : rol === 'gestor'
    ? styles.cardRolBadgeGestor
    : styles.cardRolBadgeAbogado

  // ── Reasignación forzada (barrera 4h) ─────────────────────────────────
  // Candidatos de la MISMA profesión con solape de área; POST a /api/reassign.
  const [reasignCandidatos, setReasignCandidatos] = useState([])  // {p, matchArea}
  const [reasignElegido, setReasignElegido]       = useState('')  // newLawyerId
  const [reasignEstado, setReasignEstado]         = useState('idle') // idle|loading|sending|error
  const [reasignError, setReasignError]           = useState('')

  // Tokeniza area_derecho por comas (minúsculas, sin vacíos).
  const tokensArea = (s) => (s || '')
    .split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

  async function abrirReasignar(room) {
    setReasignarRoom(room)
    setReasignElegido('')
    setReasignError('')
    setReasignEstado('loading')
    setReasignCandidatos([])
    try {
      const headers = await getAuthHeaders()
      const tipo = room.tipo_profesional || 'abogado'
      // Todos los aprobados de la MISMA profesión que la sala.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${tipo}&select=id,nombre,apellido,area_derecho,username&order=nombre.asc&limit=500`,
        { headers }
      )
      const data = await res.json()
      const asignados = new Set(room.lawyer_ids || [])
      const disponibles = (Array.isArray(data) ? data : []).filter(p => !asignados.has(p.id))
      const roomTokens = tokensArea(room.area_derecho)
      // matchArea: algún token del área de la sala aparece (substring) en el área
      // del profesional, o viceversa.
      const conMatch = disponibles.map(p => {
        const pTokens = tokensArea(p.area_derecho)
        const match = roomTokens.length === 0 ? false : roomTokens.some(rt =>
          pTokens.some(pt => pt.includes(rt) || rt.includes(pt))
        )
        return { p, matchArea: match }
      })
      // Si hay coincidencias de área, mostramos primero esas; si no, caemos a
      // todos los de la profesión (marcados "otra área").
      const hayMatch = conMatch.some(c => c.matchArea)
      const ordenados = hayMatch
        ? [...conMatch].sort((a, b) => (b.matchArea === true) - (a.matchArea === true))
        : conMatch
      setReasignCandidatos(ordenados)
      setReasignEstado('idle')
    } catch (err) {
      console.error('[abrirReasignar] error:', err)
      setReasignEstado('error')
      setReasignError('No se pudieron cargar los profesionales disponibles.')
    }
  }

  async function confirmarReasignar() {
    if (!reasignarRoom || !reasignElegido) return
    setReasignEstado('sending')
    setReasignError('')
    try {
      const headers = await getAuthHeaders()
      const oldLawyerId = (reasignarRoom.lawyer_ids && reasignarRoom.lawyer_ids[0]) || null
      const res = await fetch('/api/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({
          roomId:      reasignarRoom.id,
          oldLawyerId,
          newLawyerId: reasignElegido,
          notifId:     reasignarRoom.notifId || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Superficie del error de profesión (400) del backend.
        setReasignError(data?.error || 'No se pudo reasignar la consulta.')
        setReasignEstado('error')
        return
      }
      setReasignarRoom(null)
      setReasignEstado('idle')
      fetchAlertas()
    } catch (err) {
      console.error('[confirmarReasignar] error:', err)
      setReasignError('Error de red al reasignar. Intenta de nuevo.')
      setReasignEstado('error')
    }
  }

  if (loading || loadingData)
    return (
      <div className={styles.loading}>
        <div className={styles.loadingInner}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </div>
    )

  const TABS = [
    { key: 'pending',      label: 'Solicitudes',         count: pending.length,       Icon: IconInbox },
    { key: 'approved',     label: 'Aprobados',            count: approved.length,      Icon: IconUsers },
    { key: 'gestores',     label: 'Gestores',             count: gestores.filter(g => !g.aprobado).length, Icon: IconGestor },
    { key: 'pagos',        label: 'Pagos y cobros',                                    Icon: IconWallet },
    { key: 'chats',        label: 'Historial chats',                                   Icon: IconChat },
    { key: 'recuperar',    label: 'Recuperar chats',      count: chatsCerrados.length, Icon: IconRecover },
    { key: 'alertas',      label: 'Alertas',              count: alertas.length, alert: true, Icon: IconAlert },
    { key: 'chat_interno', label: 'Chat interno',                                      Icon: IconShield },
    { key: 'contratos',    label: 'Contratos',                                         Icon: IconDoc },
    { key: 'resenas',      label: 'Reseñas',                                           Icon: IconStar },
    { key: 'proyectos',    label: 'Proyectos de ley',                                  Icon: IconLey },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.shell}>

        {/* ── Riel lateral de navegación (se expande al pasar el mouse) ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarInner}>
            <div className={styles.sideBrand}>
              <span className={styles.brandMark}>PB</span>
              <div className={styles.brandText}>
                <strong>Administración</strong>
                <small className={styles.brandRole}>Superadmin</small>
              </div>
            </div>

            <nav className={styles.sideNav} aria-label="Secciones del panel">
              {TABS.map(({ key, label, count, alert, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.navItem} ${activeTab === key ? styles.navItemActive : ''}`}
                  onClick={() => setActiveTab(key)}
                  aria-current={activeTab === key ? 'page' : undefined}
                  title={label}
                >
                  <Icon className={styles.navIcon} aria-hidden="true" />
                  <span className={styles.navLabel}>{label}</span>
                  {count > 0 && (
                    <span className={`${styles.navBadge} ${alert ? styles.navBadgeAlert : ''}`}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className={styles.sideFoot}>
              <button type="button" className={styles.navItem} onClick={() => navigate('/')} title="Volver al inicio">
                <IconHome className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>Volver al inicio</span>
              </button>
              <button
                type="button"
                className={`${styles.navItem} ${styles.logout}`}
                onClick={() => setConfirmLogout(true)}
                title="Cerrar sesión"
              >
                <IconLogout className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ── Contenido (glass card) ── */}
        <main className={styles.content}>
          <div className={styles.pageInner}>

            {/* Header */}
            <div className={styles.header}>
              <div className={styles.headerText}>
                <span className={styles.eyebrow}>Panel de administración</span>
                <h1 className={styles.title}>
                  Parada <em>Bridge</em>
                </h1>
              </div>
              <div className={styles.headerActions}>
                {/* Campana "$" (pagos y cobros) a la izquierda; campana de alertas
                    a la derecha. Ambas van portaleadas/fijas: sus dropdowns se
                    anclan a su propio botón, así que no se solapan. */}
                <NotificationBell modo="dinero" />
                <NotificationBell modo="alertas" onOpenRoom={handleOpenRoom} />
              </div>
            </div>

        {/* Stats contextuales por sección + gráfica histórica */}
        <AdminStats
          activeTab={activeTab}
          pending={pending}
          approved={approved}
          alertas={alertas}
          chatsCerrados={chatsCerrados}
          allRooms={allRooms}
          extra={extraCounts}
        />

        {/* Contenido de la sección activa (transición framer-motion) */}
        <div className={styles.tabContent}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >

          {/* ── Solicitudes pendientes ── */}
          {activeTab === 'pending' && (
            <div className={styles.section}>
              {PersonFilterBar({})}
              {pendingFiltered.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconInbox width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>
                    No hay solicitudes pendientes
                    {rolFilter === 'gestor' ? ' de gestores'
                      : rolFilter !== 'todos' ? ` de ${rolFilter}es` : ''}
                    {personSearch.trim() ? ` para "${personSearch.trim()}"` : ''}
                  </p>
                  <p className={styles.emptySub}>Cuando alguien se registre aparecerá aquí</p>
                </div>
              ) : pendingFiltered.map(p => {
                const esGestor = p.rol === 'gestor'
                return (
                <div
                  key={p.id}
                  className={styles.card}
                  onClick={() => setPreviewProfile(p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewProfile(p) } }}
                  title="Click para ver perfil completo"
                >
                  <div className={styles.cardPhoto}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre || p.username} width="48" height="48" loading="lazy" decoding="async" />
                      : <span>{(p.nombre?.[0] || p.username?.[0] || '?')}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>
                      {(p.nombre || p.apellido) ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : `@${p.username || 'gestor'}`}
                      <span className={`${styles.cardRolBadge} ${rolBadgeClass(p.rol)}`}>
                        {rolLabel(p.rol)}
                      </span>
                    </h3>
                    <span className={styles.cardMeta}>@{p.username || '—'} · {p.email}</span>
                    {p.cedula && <span className={styles.cardMeta}>CC {p.cedula}</span>}
                    {esGestor ? (
                      <>
                        {p.comunidad_descripcion && <p className={styles.cardDesc}>{p.comunidad_descripcion}</p>}
                        <PersonSocialLinks p={p} />
                      </>
                    ) : (
                      <>
                        {p.area_derecho && <span className={styles.cardBadge}>{p.area_derecho}</span>}
                        {p.universidad  && <span className={styles.cardMeta}>{p.universidad}</span>}
                        {p.ciudad && (
                          <span className={styles.cardMeta}>
                            {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                          </span>
                        )}
                        {p.tarjeta_archivo_url && (
                          <TarjetaPreview
                            rawPath={p.tarjeta_archivo_url}
                            storagePath={p.tarjeta_archivo_url}
                            compact
                          />
                        )}
                        {p.descripcion && <p className={styles.cardDesc}>{p.descripcion}</p>}
                      </>
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.btnApprove}
                      onClick={e => { e.stopPropagation(); approveProfile(p.id) }}
                    >
                      <IconCheck /> Aprobar
                    </button>
                    <button
                      className={styles.btnReject}
                      onClick={e => { e.stopPropagation(); rejectProfile(p.id) }}
                    >
                      <IconX /> Rechazar
                    </button>
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* ── Aprobados ── */}
          {activeTab === 'approved' && (
            <div className={styles.section}>
              {PersonFilterBar({})}
              {approvedFiltered.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconUsers width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>
                    No hay {rolFilter === 'contador' ? 'contadores' : rolFilter === 'abogado' ? 'abogados' : rolFilter === 'gestor' ? 'gestores' : 'profesionales'} aprobados
                    {personSearch.trim() ? ` para "${personSearch.trim()}"` : ' aún'}
                  </p>
                </div>
              ) : approvedFiltered.map(p => {
                const esGestor = p.rol === 'gestor'
                return (
                <div
                  key={p.id}
                  className={styles.card}
                  onClick={() => setPreviewProfile(p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewProfile(p) } }}
                  title="Click para ver perfil completo"
                >
                  <div className={styles.cardPhoto}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre || p.username} width="48" height="48" loading="lazy" decoding="async" />
                      : <span>{(p.nombre?.[0] || p.username?.[0] || '?')}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>
                      {(p.nombre || p.apellido) ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : `@${p.username || 'gestor'}`}
                      <span className={`${styles.cardRolBadge} ${rolBadgeClass(p.rol)}`}>
                        {rolLabel(p.rol)}
                      </span>
                    </h3>
                    <span className={styles.cardMeta}>@{p.username || '—'} · {p.email}</span>
                    {p.cedula && <span className={styles.cardMeta}>CC {p.cedula}</span>}
                    {esGestor ? (
                      <>
                        {p.comunidad_descripcion && <p className={styles.cardDesc}>{p.comunidad_descripcion}</p>}
                        <PersonSocialLinks p={p} />
                      </>
                    ) : (
                      <>
                        {p.area_derecho && <span className={styles.cardBadge}>{p.area_derecho}</span>}
                        {p.ciudad && (
                          <span className={styles.cardMeta}>
                            {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                          </span>
                        )}
                        {p.tarjeta_archivo_url && (
                          <TarjetaPreview
                            rawPath={p.tarjeta_archivo_url}
                            storagePath={p.tarjeta_archivo_url}
                            compact
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    {!esGestor && (
                      <button
                        type="button"
                        className={`${styles.toggleDescarga} ${p.puede_descargar_archivos ? styles.toggleDescargaOn : ''}`}
                        onClick={e => { e.stopPropagation(); toggleDescargaArchivos(p.id, p.puede_descargar_archivos) }}
                        title={p.puede_descargar_archivos ? 'Deshabilitar descarga de archivos' : 'Habilitar descarga de archivos'}
                        aria-pressed={!!p.puede_descargar_archivos}
                      >
                        <span className={styles.toggleDescargaTrack}>
                          <span className={styles.toggleDescargaThumb} />
                        </span>
                        <span className={styles.toggleDescargaLabel}>
                          Descargar archivos
                        </span>
                      </button>
                    )}
                    <button
                      className={styles.btnReject}
                      onClick={e => {
                        e.stopPropagation()
                        const quien = (p.nombre || p.apellido) ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : `@${p.username || 'este usuario'}`
                        setConfirmAction({
                          title: 'Quitar de la página',
                          message: `${quien} dejará de aparecer en el sitio público y no podrá usar su panel. Podrás volver a aprobarlo más adelante. ¿Quitar?`,
                          confirmLabel: 'Quitar',
                          toneClass: 'cfOkDanger',
                          onConfirm: () => removeApproved(p.id),
                        })
                      }}
                    >
                      <IconX /> Quitar de la página
                    </button>
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* ── Historial de chats ── */}
          {activeTab === 'chats' && (
            <div className={styles.section}>
              <SuperAdminChatViewer initialRoomId={chatRoomToOpen} />
            </div>
          )}

          {/* ── Recuperar chats cerrados ── */}
          {activeTab === 'recuperar' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Chats cerrados — Recuperar sesión</h3>
                <button className={styles.btnRefresh} onClick={fetchChatsCerrados}>↻ Actualizar</button>
              </div>
              {RoomFilterBar({
                tipo: recuperarTipo, setTipo: setRecuperarTipo,
                search: recuperarSearch, setSearch: setRecuperarSearch,
              })}
              {chatsCerrados.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconChat width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>No hay chats cerrados registrados</p>
                </div>
              ) : recuperarFiltrados.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconChat width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>
                    Ningún chat cerrado coincide con el filtro
                    {recuperarSearch.trim() ? ` "${recuperarSearch.trim()}"` : ''}
                  </p>
                </div>
              ) : recuperarFiltrados.map(r => (
                <div key={r.id} className={styles.alertaCard}>
                  <span className={styles.alertaIcono} style={{ color: '#c9a84c' }}><IconChat width={22} height={22} /></span>
                  <div className={styles.alertaInfo}>
                    <p className={styles.alertaNombre}>
                      {r.client_nombre || 'Cliente'}
                      {r.codigo_referencia && (
                        <span className={styles.codigoRef}>{r.codigo_referencia}</span>
                      )}
                    </p>
                    <p className={styles.alertaMeta}>
                      {r.client_email || '—'}{r.client_celular ? ` · ${r.client_celular}` : ''}
                    </p>
                    <p className={styles.alertaFecha}>
                      Cerrado: {new Date(r.created_at).toLocaleDateString('es-CO', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </p>
                  </div>
                  <button
                    className={styles.btnReabrir}
                    onClick={() => setConfirmAction({
                      title: 'Reabrir chat',
                      message: `La conversación de ${r.client_nombre || 'el cliente'} volverá a estado "en espera" para que un profesional la retome. ¿Reabrir?`,
                      confirmLabel: 'Reabrir',
                      toneClass: 'cfOkGold',
                      onConfirm: () => reabrirChat(r.id),
                    })}
                  >
                    ↩ Reabrir
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Alertas de inactividad ── */}
          {activeTab === 'alertas' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Chats sin actividad · +24 horas</h3>
                <button className={styles.btnRefresh} onClick={fetchAlertas}>↻ Actualizar</button>
              </div>
              {RoomFilterBar({
                tipo: alertasTipo, setTipo: setAlertasTipo,
                search: alertasSearch, setSearch: setAlertasSearch,
              })}
              {alertas.length === 0 ? (
                <div className={styles.alertaOk}>
                  <span style={{ color: '#2f855a', display: 'inline-flex' }}><IconCheck size={20} /></span>
                  <p>Todos los chats activos tienen actividad reciente. ¡Todo en orden!</p>
                </div>
              ) : alertasFiltradas.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconAlert width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>
                    Ninguna alerta coincide con el filtro
                    {alertasSearch.trim() ? ` "${alertasSearch.trim()}"` : ''}
                  </p>
                </div>
              ) : alertasFiltradas.map(r => {
                const estado = notifEstado[r.id]
                const sinAbogados = !r.lawyer_ids || r.lawyer_ids.length === 0
                const escalada = !!r.escalada
                return (
                  <div key={r.id} className={`${styles.alertaCard} ${escalada ? styles.alertaCardEscalada : ''}`}>
                    <span className={styles.alertaIcono} style={{ color: '#c0392b' }}><IconAlert width={22} height={22} /></span>
                    <div className={styles.alertaInfo}>
                      <p className={styles.alertaNombre}>
                        {r.client_nombre || 'Cliente'}
                        {r.codigo_referencia && (
                          <span className={styles.codigoRef}>{r.codigo_referencia}</span>
                        )}
                      </p>
                      <p className={styles.alertaMeta}>
                        {r.client_email || ''}{r.client_celular ? ` · ${r.client_celular}` : ''}
                      </p>
                      <p className={styles.alertaFecha}>
                        Creado: {new Date(r.created_at).toLocaleDateString('es-CO', {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                        {' · '}
                        {sinAbogados
                          ? 'Sin profesional asignado'
                          : `${r.lawyer_ids.length} profesional${r.lawyer_ids.length > 1 ? 'es' : ''} asignado${r.lawyer_ids.length > 1 ? 's' : ''}`}
                      </p>
                      {escalada && (
                        <p className={styles.alertaEscaladaMsg}>
                          El profesional fue notificado y no respondió en 4 horas.
                          Debes reasignar la consulta ahora.
                        </p>
                      )}
                    </div>
                    <div className={styles.alertaActions}>
                      {escalada
                        ? <span className={styles.alertaBadgeEscalada}>Reasignación obligatoria — barrera de 4h superada</span>
                        : <span className={styles.alertaBadge}>+24h sin actividad</span>}
                      {escalada ? (
                        <button
                          className={styles.btnReasignar}
                          onClick={() => abrirReasignar(r)}
                        >
                          ⇄ Reasignar ahora
                        </button>
                      ) : !sinAbogados && (
                        <button
                          className={`${styles.btnNotificar} ${estado === 'sent' ? styles.btnNotificarDone : ''}`}
                          onClick={() => {
                            if (estado === 'sending' || estado === 'sent') return
                            setConfirmAction({
                              title: 'Notificar al profesional',
                              message: `Se enviará un correo a ${r.lawyer_ids.length} profesional${r.lawyer_ids.length > 1 ? 'es' : ''} asignado${r.lawyer_ids.length > 1 ? 's' : ''} avisando de la inactividad de esta consulta. ¿Enviar la notificación?`,
                              confirmLabel: 'Enviar notificación',
                              toneClass: 'cfOkNavy',
                              onConfirm: () => notificarInactividad(r),
                            })
                          }}
                          disabled={estado === 'sending' || estado === 'sent'}
                        >
                          {estado === 'sending' ? 'Enviando…'
                            : estado === 'sent'  ? '✓ Notificado'
                            : estado === 'error' ? '✗ Reintentar'
                            : '✉ Notificar profesional'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Chat interno ── */}
          {activeTab === 'chat_interno' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Chat interno con profesionales</h3>
              </div>
              <AdminInternalChat miId={user?.id} />
            </div>
          )}

          {/* ── Contratos ── */}
          {activeTab === 'contratos' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Contratos por profesional</h3>
              </div>
              <p className={styles.contratosHint}>
                Busca un profesional por nombre o cédula para ver o gestionar sus contratos:
              </p>
              {/* Contratos solo aplican a abogados/contadores → sin chip Gestores.
                  La selección es guiada por búsqueda: no hay nube fija de cápsulas. */}
              {PersonFilterBar({ roles: ['abogado', 'contador'] })}

              {/* Profesional seleccionado: chip destacado con "×" para deseleccionar */}
              {abogadoContrato && (
                <div className={styles.contratoSelectedRow}>
                  <span className={styles.contratoSelectedLabel}>Viendo contratos de</span>
                  <span className={styles.contratoSelectedChip}>
                    {(abogadoContrato.nombre || abogadoContrato.apellido)
                      ? `${abogadoContrato.nombre || ''} ${abogadoContrato.apellido || ''}`.trim()
                      : `@${abogadoContrato.username || '—'}`}
                    <span className={`${styles.cardRolBadge} ${abogadoContrato.rol === 'contador' ? styles.cardRolBadgeContador : styles.cardRolBadgeAbogado}`}>
                      {abogadoContrato.rol === 'contador' ? 'C' : 'A'}
                    </span>
                    <button
                      type="button"
                      className={styles.contratoSelectedClear}
                      onClick={() => setAbogadoContrato(null)}
                      aria-label="Quitar profesional seleccionado"
                      title="Quitar selección"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}

              {/* Resultados de búsqueda: lista vertical legible, solo al escribir.
                  Cada fila = avatar/inicial + nombre + badge de rol + afordancia
                  "Ver contratos →". Cap 12 con nota "mostrando N de M". */}
              {personSearch.trim() && (
                <div className={styles.contratoResults}>
                  {contratosFiltered.length === 0 ? (
                    <p className={styles.contratosHint} style={{ margin: 0 }}>
                      Ningún profesional coincide con "{personSearch.trim()}".
                    </p>
                  ) : (
                    <>
                      <ul className={styles.contratoResultList} role="listbox" aria-label="Profesionales encontrados">
                        {contratosFiltered.slice(0, 12).map(a => {
                          const nombre = (a.nombre || a.apellido)
                            ? `${a.nombre || ''} ${a.apellido || ''}`.trim()
                            : `@${a.username || '—'}`
                          const inicial = (a.nombre?.[0] || a.username?.[0] || '?').toUpperCase()
                            + (a.apellido?.[0] || '').toUpperCase()
                          const esContador = a.rol === 'contador'
                          const activo = abogadoContrato?.id === a.id
                          return (
                            <li key={a.id} role="option" aria-selected={activo}>
                              <button
                                type="button"
                                className={`${styles.contratoResultRow} ${activo ? styles.contratoResultRowActive : ''}`}
                                onClick={() => setAbogadoContrato(a)}
                              >
                                <span
                                  className={`${styles.contratoResultAvatar} ${esContador ? styles.contratoResultAvatarContador : ''}`}
                                  aria-hidden="true"
                                >
                                  {a.foto_url
                                    ? <img src={a.foto_url} alt="" width="36" height="36" loading="lazy" decoding="async" />
                                    : inicial}
                                </span>
                                <span className={styles.contratoResultMain}>
                                  <span className={styles.contratoResultName}>{nombre}</span>
                                  <span className={styles.contratoResultMeta}>
                                    @{a.username || '—'}{a.cedula ? ` · CC ${a.cedula}` : ''}
                                  </span>
                                </span>
                                <span className={`${styles.cardRolBadge} ${esContador ? styles.cardRolBadgeContador : styles.cardRolBadgeAbogado}`}>
                                  {esContador ? 'Contador' : 'Abogado'}
                                </span>
                                <span className={styles.contratoResultGo} aria-hidden="true">
                                  {activo ? 'Seleccionado' : 'Ver contratos'}
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                      {contratosFiltered.length > 12 && (
                        <p className={styles.contratoResultCount}>
                          Mostrando 12 de {contratosFiltered.length}. Afina la búsqueda para ver más.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {abogadoContrato ? (
                <MisContratos abogadoId={abogadoContrato.id} isSuperAdmin={true} />
              ) : !personSearch.trim() ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} style={{ color: '#c9a84c' }}><IconDoc width={40} height={40} /></span>
                  <p className={styles.emptyTxt}>Busca un profesional por nombre o cédula</p>
                  <p className={styles.emptySub}>Sus contratos aparecerán aquí</p>
                </div>
              ) : null}
            </div>
          )}

          {/* ── Reseñas ── */}
          {activeTab === 'resenas' && (
            <div className={styles.section}>
              <ResenasAdmin />
            </div>
          )}

          {/* ── Proyectos de ley (debate ciudadano) ── */}
          {activeTab === 'proyectos' && (
            <div className={styles.section}>
              <ProyectosLeyAdmin />
            </div>
          )}

          {/* ── Gestores (incluye gestión de códigos de referencia QR) ── */}
          {activeTab === 'gestores' && (
            <div className={styles.section}>
              <GestoresAdmin onChange={fetchGestores} />
            </div>
          )}

          {/* ── Pagos y cobros (pagos de profesionales + comisiones de gestores) ── */}
          {activeTab === 'pagos' && (
            <div className={styles.section}>
              <PagosCobrosAdmin />
            </div>
          )}

            </motion.div>
          </AnimatePresence>
        </div>

          </div>
        </main>
      </div>

      {/* ── Modal de detalle de perfil (Solicitudes / Aprobados) ── */}
      {previewProfile && (
        <ProfileDetailModal
          profile={previewProfile}
          onClose={() => setPreviewProfile(null)}
        />
      )}

      {/* ── Modal de reasignación forzada (barrera 4h superada) ── */}
      {reasignarRoom && (
        <div
          className={styles.logoutOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reasignTitle"
          onClick={() => { if (reasignEstado !== 'sending') setReasignarRoom(null) }}
        >
          <div className={`${styles.logoutModal} ${styles.reasignModal}`} onClick={e => e.stopPropagation()}>
            <span className={styles.reasignBadge}>Reasignación obligatoria</span>
            <h2 id="reasignTitle" className={styles.logoutTitle}>Reasignar consulta</h2>
            <p className={styles.logoutText}>
              El profesional asignado no respondió tras la barrera de 4 horas.
              Elige un {reasignarRoom.tipo_profesional === 'contador' ? 'contador' : 'abogado'} disponible
              para retomar la consulta de <strong>{reasignarRoom.client_nombre || 'el cliente'}</strong>.
            </p>

            {reasignEstado === 'loading' ? (
              <p className={styles.reasignInfo}>Cargando profesionales disponibles…</p>
            ) : reasignCandidatos.length === 0 ? (
              <p className={styles.reasignInfo}>
                No hay otros profesionales aprobados de esta profesión disponibles.
              </p>
            ) : (
              <div className={styles.reasignList} role="radiogroup" aria-label="Profesionales disponibles">
                {reasignCandidatos.map(({ p, matchArea }) => (
                  <label
                    key={p.id}
                    className={`${styles.reasignOpt} ${reasignElegido === p.id ? styles.reasignOptActive : ''}`}
                  >
                    <input
                      type="radio"
                      name="reasignPro"
                      value={p.id}
                      checked={reasignElegido === p.id}
                      onChange={() => setReasignElegido(p.id)}
                    />
                    <span className={styles.reasignOptBody}>
                      <span className={styles.reasignOptName}>
                        {(p.nombre || p.apellido) ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : `@${p.username || '—'}`}
                      </span>
                      <span className={styles.reasignOptArea}>
                        {p.area_derecho || 'Sin área declarada'}
                        {matchArea
                          ? <span className={styles.reasignMatch}>coincide área</span>
                          : <span className={styles.reasignOtra}>otra área</span>}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {reasignError && <p className={styles.reasignError}>{reasignError}</p>}

            <div className={styles.logoutActions}>
              <button
                type="button"
                className={styles.logoutCancel}
                onClick={() => setReasignarRoom(null)}
                disabled={reasignEstado === 'sending'}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`${styles.cfOk} ${styles.cfOkNavy}`}
                onClick={confirmarReasignar}
                disabled={!reasignElegido || reasignEstado === 'sending' || reasignEstado === 'loading'}
              >
                {reasignEstado === 'sending' ? 'Reasignando…' : 'Reasignar ahora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación reutilizable (quitar / reabrir / notificar) ── */}
      {confirmAction && (
        <div className={styles.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="cfTitle" onClick={() => setConfirmAction(null)}>
          <div className={styles.logoutModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="cfTitle" className={styles.logoutTitle}>{confirmAction.title}</h2>
            <p className={styles.logoutText}>{confirmAction.message}</p>
            <div className={styles.logoutActions}>
              <button type="button" className={styles.logoutCancel} onClick={() => setConfirmAction(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={`${styles.cfOk} ${styles[confirmAction.toneClass] || ''}`}
                onClick={async () => {
                  const fn = confirmAction.onConfirm
                  setConfirmAction(null)
                  if (fn) await fn()
                }}
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación de cierre de sesión ── */}
      {confirmLogout && (
        <div className={styles.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="logoutTitle" onClick={() => setConfirmLogout(false)}>
          <div className={styles.logoutModal} onClick={(e) => e.stopPropagation()}>
            <span className={styles.logoutIcon}><IconLogout /></span>
            <h2 id="logoutTitle" className={styles.logoutTitle}>¿Cerrar sesión?</h2>
            <p className={styles.logoutText}>Saldrás del panel de administración. Tendrás que iniciar sesión de nuevo para volver a entrar.</p>
            <div className={styles.logoutActions}>
              <button type="button" className={styles.logoutCancel} onClick={() => setConfirmLogout(false)}>Cancelar</button>
              <button type="button" className={styles.logoutConfirm} onClick={async () => { setConfirmLogout(false); await signOut(); navigate('/') }}>Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
