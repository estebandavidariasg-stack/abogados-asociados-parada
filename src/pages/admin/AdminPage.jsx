import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'
import SuperAdminChatViewer from '../../components/SuperAdminChatViewer'
import CodigosReferencia from '../../components/CodigosReferencia'
import MisContratos from '../../components/MisContratos'
import AdminInternalChat from '../../components/AdminInternalChat'
import { IconCheck, IconX, IconArrowLeft } from '../../components/Icons'

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

  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'superadmin') { navigate('/'); return }
    fetchAll()
    fetchAlertas()
    fetchChatsCerrados()
  }, [user, profile, loading])

  async function fetchAll() {
    setLoadingData(true)
    await Promise.all([fetchPending(), fetchApproved()])
    setLoadingData(false)
  }

  async function fetchPending() {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.false&rol=eq.abogado&select=*`,
      { headers }
    )
    const data = await res.json()
    setPending(Array.isArray(data) ? data : [])
  }

  async function fetchApproved() {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=*`,
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

  async function fetchAlertas() {
    try {
      const headers = await getAuthHeaders()
      const roomsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?cerrado=eq.false&select=*&order=created_at.desc`,
        { headers }
      )
      const rooms = await roomsRes.json()
      if (!Array.isArray(rooms) || rooms.length === 0) { setAlertas([]); return }
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const inactivas = []
      for (const room of rooms) {
        const msgRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_messages?room_id=eq.${room.id}&created_at=gte.${hace24h}&select=id&limit=1`,
          { headers }
        )
        const msgs = await msgRes.json()
        if (!Array.isArray(msgs) || msgs.length === 0) inactivas.push(room)
      }
      setAlertas(inactivas)
    } catch { setAlertas([]) }
  }

  async function fetchChatsCerrados() {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms?cerrado=eq.true&select=*&order=created_at.desc&limit=50`,
        { headers }
      )
      const data = await res.json()
      setChatsCerrados(Array.isArray(data) ? data : [])
    } catch { setChatsCerrados([]) }
  }

  async function reabrirChat(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ cerrado: false }),
    })
    fetchChatsCerrados()
    fetchAlertas()
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
          <button className={styles.btnBack} onClick={() => navigate('/')}>
            <IconArrowLeft /> Volver al sitio
          </button>
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statNum}>{pending.length}</span>
            <span className={styles.statLabel}>Solicitudes pendientes</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{approved.length}</span>
            <span className={styles.statLabel}>Abogados aprobados</span>
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
              {pending.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>📋</span>
                  <p className={styles.emptyTxt}>No hay solicitudes pendientes</p>
                  <p className={styles.emptySub}>Cuando un abogado se registre aparecerá aquí</p>
                </div>
              ) : pending.map(p => (
                <div key={p.id} className={styles.card}>
                  <div className={styles.cardPhoto}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre} />
                      : <span>{p.nombre?.[0] || '?'}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>{p.nombre} {p.apellido}</h3>
                    <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
                    {p.especialidad && <span className={styles.cardBadge}>{p.especialidad}</span>}
                    {p.universidad  && <span className={styles.cardMeta}>{p.universidad}</span>}
                    {p.ciudad && (
                      <span className={styles.cardMeta}>
                        {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                      </span>
                    )}
                    {p.descripcion && <p className={styles.cardDesc}>{p.descripcion}</p>}
                  </div>
                  <div className={styles.cardActions}>
                    <button className={styles.btnApprove} onClick={() => approveProfile(p.id)}>
                      <IconCheck /> Aprobar
                    </button>
                    <button className={styles.btnReject} onClick={() => rejectProfile(p.id)}>
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
              {approved.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>👨‍⚖️</span>
                  <p className={styles.emptyTxt}>No hay abogados aprobados aún</p>
                </div>
              ) : approved.map(p => (
                <div key={p.id} className={styles.card}>
                  <div className={styles.cardPhoto}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre} />
                      : <span>{p.nombre?.[0] || '?'}{p.apellido?.[0] || ''}</span>
                    }
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>{p.nombre} {p.apellido}</h3>
                    <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
                    {p.especialidad && <span className={styles.cardBadge}>{p.especialidad}</span>}
                    {p.ciudad && (
                      <span className={styles.cardMeta}>
                        {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                      </span>
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    <button className={styles.btnReject} onClick={() => removeApproved(p.id)}>
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
              <SuperAdminChatViewer />
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
              ) : alertas.map(r => (
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
                    </p>
                  </div>
                  <span className={styles.alertaBadge}>+24h sin actividad</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Chat interno ── */}
          {activeTab === 'chat_interno' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Chat interno con abogados</h3>
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
                <h3 className={styles.sectionTitle}>Contratos por abogado</h3>
              </div>
              <p className={styles.contratosHint}>
                Selecciona un abogado aprobado para ver o gestionar sus contratos:
              </p>
              <div className={styles.abogadoSelector}>
                {approved.map(a => (
                  <button
                    key={a.id}
                    className={`${styles.abogadoChip} ${abogadoContrato?.id === a.id ? styles.chipActivo : ''}`}
                    onClick={() => setAbogadoContrato(a)}
                  >
                    {a.nombre} {a.apellido}
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
                  <p className={styles.emptyTxt}>Selecciona un abogado arriba</p>
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
      </div>
    </div>
  )
}