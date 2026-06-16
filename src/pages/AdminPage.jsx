import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'
import SuperAdminChatViewer from '../components/chat/SuperAdminChatViewer'
import CodigosReferencia from '../components/admin/CodigosReferencia'
import MisContratos from '../components/profile/MisContratos'
import AdminInternalChat from '../components/chat/AdminInternalChat'
import ProfileDetailModal from '../components/admin/ProfileDetailModal'
import TarjetaPreview from '../components/profile/TarjetaPreview'
import NotificationBell from '../components/admin/NotificationBell'
import { IconCheck, IconX } from '../components/shared/Icons'

// ── Iconos SVG (estilo Lucide, currentColor) — sin emojis como iconos ──
const IconInbox  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>)
const IconUsers  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>)
const IconChat   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>)
const IconRecover= (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>)
const IconAlert  = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>)
const IconShield = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>)
const IconDoc    = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>)
const IconQRcode = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M21 21v-3h-3"/></svg>)
const IconHome   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>)
const IconLogout = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>)

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
  const [loadingData, setLoadingData]         = useState(true)
  const [alertas, setAlertas]                 = useState([])
  const [chatsCerrados, setChatsCerrados]     = useState([])
  const [abogadoContrato, setAbogadoContrato] = useState(null)
  // Sub-filtro por rol dentro de Solicitudes/Aprobados/Contratos
  const [rolFilter, setRolFilter]             = useState('todos') // 'todos' | 'abogado' | 'contador'
  // Vista detalle del perfil (modal)
  const [previewProfile, setPreviewProfile]   = useState(null)
  // Sala a abrir en el visor (deep-link desde la campanita / correo)
  const [chatRoomToOpen, setChatRoomToOpen]   = useState(null)

  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'superadmin') { navigate('/'); return }
    fetchAll()
    fetchAlertas()
    fetchChatsCerrados()
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
    // Trae abogados y contadores pendientes — el filtro por rol se aplica en cliente
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.false&rol=in.(abogado,contador)&select=*`,
      { headers }
    )
    const data = await res.json()
    setPending(Array.isArray(data) ? data : [])
  }

  async function fetchApproved() {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=in.(abogado,contador)&select=*`,
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
  }

  async function removeApproved(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ aprobado: false }),
    })
    fetchAll()
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
      const roomsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?status=in.(waiting,active)&select=*&order=created_at.desc`,
        { headers }
      )
      const rooms = await roomsRes.json()
      if (!Array.isArray(rooms) || rooms.length === 0) { setAlertas([]); return }
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      // Antes hacíamos 1 + 2N queries (serializadas dentro del for) — con
      // 30+ salas tardaba ~30s. Ahora batcheamos:
      //   1) Una query para TODOS los mensajes recientes de TODAS las salas
      //   2) Filtramos en memoria las salas SIN actividad
      //   3) Una query para los abogados asignados a esas salas inactivas
      // Total: 3 queries en lugar de 1 + 2N.
      const roomIds = rooms.map(r => r.id).join(',')
      const msgsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages?room_id=in.(${roomIds})&created_at=gte.${hace24h}&select=room_id`,
        { headers }
      )
      const msgsAll = await msgsRes.json()
      const conActividad = new Set(
        (Array.isArray(msgsAll) ? msgsAll : []).map(m => m.room_id)
      )
      const inactiveRooms = rooms.filter(r => !conActividad.has(r.id))
      if (inactiveRooms.length === 0) { setAlertas([]); return }

      const inactiveIds = inactiveRooms.map(r => r.id).join(',')
      const lawyersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=in.(${inactiveIds})&select=room_id,lawyer_id`,
        { headers }
      )
      const lawyersAll = await lawyersRes.json()
      const lawyersByRoom = {}
      for (const l of (Array.isArray(lawyersAll) ? lawyersAll : [])) {
        if (!lawyersByRoom[l.room_id]) lawyersByRoom[l.room_id] = []
        lawyersByRoom[l.room_id].push(l.lawyer_id)
      }

      const inactivas = inactiveRooms.map(r => ({
        ...r,
        lawyer_ids: lawyersByRoom[r.id] || [],
      }))
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
      // Una llamada por abogado asignado (típicamente 1-3, no merece batching)
      const results = await Promise.all(
        room.lawyer_ids.map(lawyerId =>
          fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

  // ── Filtrados derivados por rol ───────────────────────────────────────
  const filterByRol = arr => rolFilter === 'todos'
    ? arr
    : arr.filter(p => p.rol === rolFilter)

  const pendingFiltered  = filterByRol(pending)
  const approvedFiltered = filterByRol(approved)

  // Conteos por rol (para los stats)
  const pendingAbogados   = pending.filter(p => p.rol === 'abogado').length
  const pendingContadores = pending.filter(p => p.rol === 'contador').length
  const approvedAbogados   = approved.filter(p => p.rol === 'abogado').length
  const approvedContadores = approved.filter(p => p.rol === 'contador').length

  // Chip-row reutilizable para filtrar Solicitudes/Aprobados/Contratos por rol
  const RolChips = () => (
    <div className={styles.rolChipsRow}>
      <button
        type="button"
        className={`${styles.rolChip} ${rolFilter === 'todos' ? styles.rolChipActive : ''}`}
        onClick={() => setRolFilter('todos')}
      >
        Todos
      </button>
      <button
        type="button"
        className={`${styles.rolChip} ${rolFilter === 'abogado' ? styles.rolChipActive : ''}`}
        onClick={() => setRolFilter('abogado')}
      >
        Abogados
      </button>
      <button
        type="button"
        className={`${styles.rolChip} ${rolFilter === 'contador' ? styles.rolChipActive : ''}`}
        onClick={() => setRolFilter('contador')}
      >
        Contadores
      </button>
    </div>
  )

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
    { key: 'chats',        label: 'Historial chats',                                   Icon: IconChat },
    { key: 'recuperar',    label: 'Recuperar chats',      count: chatsCerrados.length, Icon: IconRecover },
    { key: 'alertas',      label: 'Alertas',              count: alertas.length, alert: true, Icon: IconAlert },
    { key: 'chat_interno', label: 'Chat interno',                                      Icon: IconShield },
    { key: 'contratos',    label: 'Contratos',                                         Icon: IconDoc },
    { key: 'codigos',      label: 'Códigos QR',                                        Icon: IconQRcode },
  ]

  return (
    <div className={styles.page}>
      <div className={styles.shell}>

        {/* ── Riel lateral de navegación (se expande al pasar el mouse) ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarInner}>
            <div className={styles.sideBrand}>
              <span className={styles.brandMark}>AAP</span>
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
                  Abogados y Asociados <em>Parada</em>
                </h1>
              </div>
              <div className={styles.headerActions}>
                <NotificationBell onOpenRoom={handleOpenRoom} />
              </div>
            </div>

        {/* Stats */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statNum}>{pending.length}</span>
            <span className={styles.statLabel}>
              Solicitudes pendientes
              {(pendingAbogados > 0 || pendingContadores > 0) && (
                <span className={styles.statSub}>
                  {pendingAbogados} ab. · {pendingContadores} cont.
                </span>
              )}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{approved.length}</span>
            <span className={styles.statLabel}>
              Profesionales aprobados
              {(approvedAbogados > 0 || approvedContadores > 0) && (
                <span className={styles.statSub}>
                  {approvedAbogados} ab. · {approvedContadores} cont.
                </span>
              )}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{approved.length + pending.length}</span>
            <span className={styles.statLabel}>Total registrados</span>
          </div>
          <div className={`${styles.stat} ${alertas.length > 0 ? styles.statAlert : ''}`}>
            <span className={styles.statNum}>{alertas.length}</span>
            <span className={styles.statLabel}>Alertas inactividad</span>
          </div>
        </div>

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
              <RolChips />
              {pendingFiltered.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>📋</span>
                  <p className={styles.emptyTxt}>
                    No hay solicitudes pendientes
                    {rolFilter !== 'todos' ? ` de ${rolFilter}es` : ''}
                  </p>
                  <p className={styles.emptySub}>Cuando alguien se registre aparecerá aquí</p>
                </div>
              ) : pendingFiltered.map(p => (
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
                      ? <img src={p.foto_url} alt={p.nombre} width="48" height="48" loading="lazy" decoding="async" />
                      : <span>{p.nombre?.[0] || '?'}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>
                      {p.nombre} {p.apellido}
                      <span className={`${styles.cardRolBadge} ${p.rol === 'contador' ? styles.cardRolBadgeContador : styles.cardRolBadgeAbogado}`}>
                        {p.rol === 'contador' ? 'Contador' : 'Abogado'}
                      </span>
                    </h3>
                    <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
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
              ))}
            </div>
          )}

          {/* ── Aprobados ── */}
          {activeTab === 'approved' && (
            <div className={styles.section}>
              <RolChips />
              {approvedFiltered.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>👨‍⚖️</span>
                  <p className={styles.emptyTxt}>
                    No hay {rolFilter === 'contador' ? 'contadores' : rolFilter === 'abogado' ? 'abogados' : 'profesionales'} aprobados aún
                  </p>
                </div>
              ) : approvedFiltered.map(p => (
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
                      ? <img src={p.foto_url} alt={p.nombre} width="48" height="48" loading="lazy" decoding="async" />
                      : <span>{p.nombre?.[0] || '?'}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>
                      {p.nombre} {p.apellido}
                      <span className={`${styles.cardRolBadge} ${p.rol === 'contador' ? styles.cardRolBadgeContador : styles.cardRolBadgeAbogado}`}>
                        {p.rol === 'contador' ? 'Contador' : 'Abogado'}
                      </span>
                    </h3>
                    <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
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
                  </div>
                  <div className={styles.cardActions}>
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
                    <button
                      className={styles.btnReject}
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmAction({
                          title: 'Quitar de la página',
                          message: `${p.nombre} ${p.apellido} dejará de aparecer en el sitio público y no podrá usar su panel. Podrás volver a aprobarlo más adelante. ¿Quitar?`,
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
              ))}
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
              {chatsCerrados.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>💬</span>
                  <p className={styles.emptyTxt}>No hay chats cerrados registrados</p>
                </div>
              ) : chatsCerrados.map(r => (
                <div key={r.id} className={styles.alertaCard}>
                  <span className={styles.alertaIcono}>💬</span>
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
              {alertas.length === 0 ? (
                <div className={styles.alertaOk}>
                  <span>✅</span>
                  <p>Todos los chats activos tienen actividad reciente. ¡Todo en orden!</p>
                </div>
              ) : alertas.map(r => {
                const estado = notifEstado[r.id]
                const sinAbogados = !r.lawyer_ids || r.lawyer_ids.length === 0
                return (
                  <div key={r.id} className={styles.alertaCard}>
                    <span className={styles.alertaIcono}>⚠️</span>
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
                    </div>
                    <div className={styles.alertaActions}>
                      <span className={styles.alertaBadge}>+24h sin actividad</span>
                      {!sinAbogados && (
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
                Selecciona un profesional aprobado para ver o gestionar sus contratos:
              </p>
              <RolChips />
              <div className={styles.abogadoSelector}>
                {approvedFiltered.map(a => (
                  <button
                    key={a.id}
                    className={`${styles.abogadoChip} ${abogadoContrato?.id === a.id ? styles.chipActivo : ''}`}
                    onClick={() => setAbogadoContrato(a)}
                    title={a.rol === 'contador' ? 'Contador' : 'Abogado'}
                  >
                    {a.nombre} {a.apellido}
                    <span className={`${styles.cardRolBadge} ${a.rol === 'contador' ? styles.cardRolBadgeContador : styles.cardRolBadgeAbogado}`}>
                      {a.rol === 'contador' ? 'C' : 'A'}
                    </span>
                  </button>
                ))}
              </div>
              {abogadoContrato ? (
                <MisContratos abogadoId={abogadoContrato.id} isSuperAdmin={true} />
              ) : (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>📂</span>
                  <p className={styles.emptyTxt}>Selecciona un profesional arriba</p>
                  <p className={styles.emptySub}>Sus contratos aparecerán aquí</p>
                </div>
              )}
            </div>
          )}

          {/* ── Códigos QR ── */}
          {activeTab === 'codigos' && (
            <div className={styles.section}>
              <CodigosReferencia />
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
