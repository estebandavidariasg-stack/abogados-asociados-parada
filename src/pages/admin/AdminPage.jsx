import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'
import SuperAdminChatViewer from '../../components/SuperAdminChatViewer'

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

  const [activeTab, setActiveTab] = useState('pending')
  const [pending, setPending] = useState([])
  const [approved, setApproved] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [especialidad, setEspecialidad] = useState('')


  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'superadmin') {
      navigate('/')
      return
    }
    fetchAll()
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
      { headers },
    )
    const data = await res.json()
    setPending(Array.isArray(data) ? data : [])
  }

  async function fetchApproved() {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=*`,
      { headers },
    )
    const data = await res.json()
    setApproved(Array.isArray(data) ? data : [])
  }

  async function approveProfile(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ aprobado: true }),
    })
    fetchAll()
  }

  async function rejectProfile(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ aprobado: false }),
    })
    fetchAll()
  }

  async function removeApproved(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ aprobado: false }),
    })
    fetchAll()
  }

  if (loading || loadingData)
    return (
      <div className={styles.loading}>
        <span className={styles.loadingDot} />
      </div>
    )

  return (
    <div className={styles.page}>
      <div className={styles.bgGlow} />
      <div className={styles.goldLine} />

      {/* ── Header ──────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Panel de administración</span>
          <h1 className={styles.title}>
            ABOGADOS Y ASOCIADOS <em>PARADA</em>
          </h1>
        </div>
        <button className="btn-ghost" onClick={() => navigate('/')}>
          ← Volver al sitio
        </button>
      </div>

      {/* ── Stats ───────────────────────────────── */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{pending.length}</span>
          <span className={styles.statLabel}>Solicitudes pendientes</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{approved.length}</span>
          <span className={styles.statLabel}>Abogados aprobados</span>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────── */}
      <div className={styles.tabs}>
        {[
          { key: 'pending', label: `Solicitudes (${pending.length})` },
          { key: 'approved', label: `Aprobados (${approved.length})` },
          { key: 'chats',    label: 'Historial de chats' },  
        ].map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Pendientes ──────────────────────────── */}
      {activeTab === 'pending' && (
        <div className={styles.section}>
          {pending.length === 0 ? (
            <p className={styles.empty}>No hay solicitudes pendientes</p>
          ) : (
            pending.map((p) => (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardPhoto}>
                  {p.foto_url ? (
                    <img src={p.foto_url} alt={p.nombre} />
                  ) : (
                    <span>
                      {p.nombre?.[0] || '?'}
                      {p.apellido?.[0] || ''}
                    </span>
                  )}
                </div>

                <div className={styles.cardInfo}>
                  <h3>
                    {p.nombre} {p.apellido}
                  </h3>
                  <span className={styles.cardMeta}>
                    @{p.username} · {p.email}
                  </span>
                  {p.especialidad && (
                    <span className={styles.cardBadge}>{p.especialidad}</span>
                  )}
                  {p.universidad && (
                    <span className={styles.cardMeta}>{p.universidad}</span>
                  )}
                  {p.ciudad && (
                    <span className={styles.cardMeta}>
                      {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                    </span>
                  )}
                  {p.descripcion && (
                    <p className={styles.cardDesc}>{p.descripcion}</p>
                  )}
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={styles.btnApprove}
                    onClick={() => approveProfile(p.id)}
                  >
                    ✓ Aprobar
                  </button>
                  <button
                    className={styles.btnReject}
                    onClick={() => rejectProfile(p.id)}
                  >
                    ✕ Rechazar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Aprobados ───────────────────────────── */}
      {activeTab === 'approved' && (
        <div className={styles.section}>
          {approved.length === 0 ? (
            <p className={styles.empty}>No hay abogados aprobados aún</p>
          ) : (
            approved.map((p) => (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardPhoto}>
                  {p.foto_url ? (
                    <img src={p.foto_url} alt={p.nombre} />
                  ) : (
                    <span>
                      {p.nombre?.[0] || '?'}
                      {p.apellido?.[0] || ''}
                    </span>
                  )}
                </div>

                <div className={styles.cardInfo}>
                  <h3>{p.nombre} {p.apellido}</h3>
                  <span className={styles.cardMeta}>
                    @{p.username} · {p.email}
                  </span>
                  {p.especialidad && (
                    <span className={styles.cardBadge}>{p.especialidad}</span>
                  )}
                  {p.ciudad && (
                    <span className={styles.cardMeta}>
                      {p.ciudad}{p.departamento ? `, ${p.departamento}` : ''}
                    </span>
                  )}
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={styles.btnReject}
                    onClick={() => removeApproved(p.id)}
                  >
                    Quitar de la página
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Historial de chats ── */}
      {activeTab === 'chats' && (
        <div className={styles.section}>
          <SuperAdminChatViewer />
        </div>
      )}

    </div>
  )
}