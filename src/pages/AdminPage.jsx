import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'
import SuperAdminChatViewer from '../components/chat/SuperAdminChatViewer'
import CodigosReferencia from '../components/admin/CodigosReferencia'
import MisContratos from '../components/profile/MisContratos'
import AdminInternalChat from '../components/chat/AdminInternalChat'
import ProfileDetailModal from '../components/admin/ProfileDetailModal'
import NotificationBell from '../components/admin/NotificationBell'
import { IconCheck, IconX, IconArrowLeft } from '../components/shared/Icons'

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
  const { user, profile, loading } = useAuth()
  const navigate = useNavigate()

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
    fetchAll()
  }

  async function rejectProfile(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ aprobado: false }),
    })
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
    { key: 'pending',      label: 'Solicitudes',         count: pending.length },
    { key: 'approved',     label: 'Aprobados',            count: approved.length },
    { key: 'chats',        label: 'Historial chats' },
    { key: 'recuperar',    label: 'Recuperar chats',      count: chatsCerrados.length },
    { key: 'alertas',      label: 'Alertas',              count: alertas.length, alert: true },
    { key: 'chat_interno', label: 'Chat interno' },
    { key: 'contratos',    label: 'Contratos' },
    { key: 'codigos',      label: 'Códigos QR' },
  ]

  return (
    <div className={styles.page}>

      {/* ── Contenedor principal (glass card) ── */}
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
            <button className={styles.btnBack} onClick={() => navigate('/')}>
              <IconArrowLeft /> Volver al sitio
            </button>
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

        {/* Tabs */}
        <div className={styles.tabsWrap}>
          <div className={styles.tabs}>
            {TABS.map(t => (
              <button
                key={t.key}
                className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={`${styles.tabBadge} ${t.alert ? styles.tabBadgeAlert : ''}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido de cada tab */}
        <div className={styles.tabContent}>

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
                      <a
                        href={p.tarjeta_archivo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className={styles.cardTarjetaLink}
                      >
                        📎 Ver tarjeta profesional
                      </a>
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
                      <a
                        href={p.tarjeta_archivo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className={styles.cardTarjetaLink}
                      >
                        📎 Ver tarjeta profesional
                      </a>
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
                      onClick={e => { e.stopPropagation(); removeApproved(p.id) }}
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
                  <button className={styles.btnReabrir} onClick={() => reabrirChat(r.id)}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <span className={styles.alertaBadge}>+24h sin actividad</span>
                      {!sinAbogados && (
                        <button
                          className={styles.btnRefresh}
                          onClick={() => notificarInactividad(r)}
                          disabled={estado === 'sending' || estado === 'sent'}
                          style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                        >
                          {estado === 'sending' ? 'Enviando...'
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
              <div className={styles.darkWrap}>
                <AdminInternalChat miId={user?.id} />
              </div>
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
                <div className={styles.contratosWrap}>
                  <MisContratos abogadoId={abogadoContrato.id} isSuperAdmin={true} />
                </div>
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
              <div className={styles.darkWrap}>
                <CodigosReferencia />
              </div>
            </div>
          )}

        </div>

        {/* ── Modal de detalle de perfil (Solicitudes / Aprobados) ── */}
        {previewProfile && (
          <ProfileDetailModal
            profile={previewProfile}
            onClose={() => setPreviewProfile(null)}
          />
        )}
      </div>
    </div>
  )
}
