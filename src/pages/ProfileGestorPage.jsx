import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useAuth } from '../context/AuthContext'
import { supabase, getAuthHeaders } from '../lib/supabase'
import { getQRUrl, downloadQRCard, chatUrlFor } from '../lib/qrCard'
import styles from './ProfileGestorPage.module.css'
// Reutilizamos el MISMO módulo de estilos del perfil profesional para que el
// formulario "Mi perfil" tenga idéntica tipografía y formato.
import pStyles from './ProfilePage.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// ── Iconos SVG (estilo Lucide, currentColor) — sin emojis como iconos ──
const IconQr       = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M21 21v-3h-3"/></svg>)
const IconChart    = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18"/><path d="M7 15l3-4 3 3 4-6"/></svg>)
const IconWallet   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h14"/><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="M18 12a1 1 0 0 0 0 2h3v-2z"/></svg>)
const IconUser     = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>)
const IconHome     = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>)
const IconLogout   = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>)
const IconDownload = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>)

const SECCIONES = [
  { id: 'perfil',   label: 'Mi perfil',    Icon: IconUser },
  { id: 'codigo',   label: 'Mi código',    Icon: IconQr },
  { id: 'stats',    label: 'Estadísticas', Icon: IconChart },
  { id: 'cobros',   label: 'Cobros',       Icon: IconWallet },
]

const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(n) || 0)

const fmtFecha = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

// Fecha + HORA (coincide con el resto de la app): "22 jul 2026, 3:45 p. m."
const fmtFechaHora = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return '—' }
}

// Solo la hora — para los puntos del stepper (la fecha va aparte).
const fmtHora = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch { return '' }
}

// Primer nombre (para el historial): "Prueba Cobro Prueba" → "Prueba".
const primerNombre = (s) => {
  const t = (s || '').toString().trim()
  if (!t) return ''
  return t.split(/\s+/)[0]
}
const rotularProfesion = (tipo) => (tipo === 'contador' ? 'Contador' : 'Abogado')

const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Rango de fechas [desde, hasta] (YYYY-MM-DD) contra un ISO.
const enRango = (iso, desde, hasta) => {
  if (!desde && !hasta) return true
  if (!iso) return false
  const d = new Date(iso)
  if (desde && d < new Date(`${desde}T00:00:00`)) return false
  if (hasta && d > new Date(`${hasta}T23:59:59`)) return false
  return true
}

// Barra de filtro reutilizable (búsqueda + rango de fechas). Definida a nivel
// de módulo (identidad estable) para que el input no pierda el foco al teclear.
function GestorFilterBar({ query, onQuery, desde, onDesde, hasta, onHasta, placeholder, onClear, hayFiltro }) {
  return (
    <div className={styles.gFilter}>
      <div className={styles.gSearch}>
        <svg className={styles.gSearchIcon} width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <circle cx="6.25" cy="6.25" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.75 9.75L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          className={styles.gSearchInput}
          type="text" value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {query && (
          <button className={styles.gClear} onClick={() => onQuery('')} aria-label="Limpiar búsqueda" type="button">×</button>
        )}
      </div>
      <label className={styles.gDateField}>
        <span>Desde</span>
        <input type="date" className={styles.gDateInput} value={desde} max={hasta || undefined} onChange={(e) => onDesde(e.target.value)} />
      </label>
      <label className={styles.gDateField}>
        <span>Hasta</span>
        <input type="date" className={styles.gDateInput} value={hasta} min={desde || undefined} onChange={(e) => onHasta(e.target.value)} />
      </label>
      {hayFiltro && (
        <button className={styles.gClearAll} onClick={onClear} type="button">Limpiar</button>
      )}
    </div>
  )
}

export default function ProfileGestorPage() {
  const { user, profile, loading, signOut } = useAuth()
  const navigate = useNavigate()

  const [seccion, setSeccion] = useState('perfil')
  const [confirmLogout, setConfirmLogout] = useState(false)

  const [codigo, setCodigo]     = useState(null)   // fila codigos_referencia asignada
  const [cargandoCodigo, setCargandoCodigo] = useState(true)

  const aprobado = profile?.aprobado === true

  // Guard: solo gestores autenticados.
  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'gestor') { navigate('/'); return }
  }, [user, profile, loading, navigate])

  // Carga el código asignado (RLS: el gestor solo ve el suyo → gestor_id = uid).
  useEffect(() => {
    if (loading || !user || profile?.rol !== 'gestor' || profile?.aprobado !== true) {
      setCargandoCodigo(false)
      return
    }
    let cancel = false
    ;(async () => {
      setCargandoCodigo(true)
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/codigos_referencia?gestor_id=eq.${user.id}&select=*&limit=1`,
          { headers }
        )
        const data = await res.json()
        if (!cancel) setCodigo(Array.isArray(data) && data[0] ? data[0] : null)
      } catch { if (!cancel) setCodigo(null) }
      finally { if (!cancel) setCargandoCodigo(false) }
    })()
    return () => { cancel = true }
  }, [user, profile, loading])

  function descargar() {
    if (!codigo) return
    downloadQRCard({
      target: chatUrlFor(codigo.codigo),
      codigo: codigo.codigo,
      nombre: profile?.username ? `@${profile.username}` : 'Gestor',
      apellido: '',
      subtitulo: 'Gestor Autorizado',
      filename: `Tarjeta_PB_${codigo.codigo}.png`,
    })
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
      </div>
    )
  }
  if (!user || profile?.rol !== 'gestor') return null

  return (
    <div className={styles.page}>
      <div className={styles.shell}>

        {/* ── Sidebar de navegación (riel que se expande al pasar el mouse) ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarInner}>
            <div className={styles.sideBrand}>
              <span className={styles.brandMark}>PB</span>
              <div className={styles.brandText}>
                <strong>{profile?.username ? `@${profile.username}` : 'Gestor'}</strong>
                <small className={aprobado ? styles.badgeOk : styles.badgePend}>
                  {aprobado ? 'Aprobado' : 'Pendiente'}
                </small>
              </div>
            </div>

            <nav className={styles.sideNav} aria-label="Secciones del panel">
              {SECCIONES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`${styles.navItem} ${seccion === id ? styles.navItemActive : ''}`}
                  onClick={() => setSeccion(id)}
                  aria-current={seccion === id ? 'page' : undefined}
                  title={label}
                >
                  <Icon className={styles.navIcon} aria-hidden="true" />
                  <span className={styles.navLabel}>{label}</span>
                </button>
              ))}
            </nav>

            <div className={styles.sideFoot}>
              <button type="button" className={styles.navItem} onClick={() => navigate('/')} title="Ir al inicio">
                <IconHome className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>Ir al inicio</span>
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

        {/* ── Contenido por sección ── */}
        <main className={styles.content}>

          {seccion === 'codigo' && (
            <SeccionCodigo
              aprobado={aprobado}
              cargando={cargandoCodigo}
              codigo={codigo}
              username={profile?.username}
              onDescargar={descargar}
            />
          )}

          {seccion === 'stats' && (
            <SeccionEstadisticas aprobado={aprobado} codigo={codigo} />
          )}

          {seccion === 'cobros' && (
            <SeccionCobros aprobado={aprobado} userId={user?.id} />
          )}

          {seccion === 'perfil' && (
            <SeccionPerfil
              aprobado={aprobado}
              profile={profile}
              userId={user?.id}
              email={user?.email || profile?.email}
              onEliminada={async () => { await signOut(); navigate('/') }}
            />
          )}

        </main>
      </div>

      {confirmLogout && (
        <div className={styles.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="logoutTitle" onClick={() => setConfirmLogout(false)}>
          <div className={styles.logoutModal} onClick={(e) => e.stopPropagation()}>
            <span className={styles.logoutIcon}><IconLogout /></span>
            <h2 id="logoutTitle" className={styles.logoutTitle}>¿Cerrar sesión?</h2>
            <p className={styles.logoutText}>Saldrás de tu panel. Tendrás que iniciar sesión de nuevo para volver a entrar.</p>
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

/* ══════════════════════════════════════════════════════════════════
   Estados compartidos (pendiente / sin código) reutilizables
   ══════════════════════════════════════════════════════════════════ */
function EstadoPendiente() {
  return (
    <div className={styles.estado}>
      <span className={styles.estadoIcon} data-tone="wait" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </span>
      <p className={styles.estadoTitle}>Cuenta pendiente de aprobación</p>
      <p className={styles.estadoDesc}>
        El administrador revisará tu registro. Cuando te aprueben, aquí verás tu código,
        tus estadísticas y tus cobros.
      </p>
    </div>
  )
}

function EstadoSinCodigo() {
  return (
    <div className={styles.estado}>
      <span className={styles.estadoIcon} data-tone="empty" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21h.01M21 21v-3h-3" />
        </svg>
      </span>
      <p className={styles.estadoTitle}>Pendiente de asignación</p>
      <p className={styles.estadoDesc}>
        Tu cuenta está aprobada. El administrador aún no te ha asignado un código de referencia.
        Vuelve más tarde o contáctalo.
      </p>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   1. Mi código — QR + descarga
   ══════════════════════════════════════════════════════════════════ */
function SeccionCodigo({ aprobado, cargando, codigo, username, onDescargar }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>Hola{username ? `, @${username}` : ''}</p>
          <h1 className={styles.panelTitle}>Mi <em>Código</em></h1>
        </div>
      </div>

      <div className={styles.cardGlass}>
        {!aprobado ? (
          <EstadoPendiente />
        ) : cargando ? (
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>Cargando tu código…</p>
        ) : !codigo ? (
          <EstadoSinCodigo />
        ) : (
          <div className={styles.qrWrap}>
            <div className={styles.qrBox}>
              <img
                src={getQRUrl(chatUrlFor(codigo.codigo), 360)}
                alt={`Código QR ${codigo.codigo}`}
                className={styles.qrImg}
                width="240" height="240" decoding="async"
              />
            </div>
            <p className={styles.codigo}>{codigo.codigo}</p>
            <p className={styles.qrHint}>
              Comparte este QR. Al escanearlo, el cliente inicia su consulta con tu código ya prellenado.
            </p>
            <button className={styles.downloadBtn} onClick={onDescargar}>
              <IconDownload />
              Descargar tarjeta
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   2. Estadísticas / Trazabilidad — RPC codigo_stats
   ══════════════════════════════════════════════════════════════════ */
function SeccionEstadisticas({ aprobado, codigo }) {
  const [stats, setStats]   = useState(null)
  const [historial, setHistorial] = useState([])   // consultas que usaron el código
  const [estado, setEstado] = useState('idle') // idle | loading | ready | error
  // Filtro del historial (nombre cliente/profesional + rango de fechas).
  const [hQuery, setHQuery] = useState('')
  const [hDesde, setHDesde] = useState('')
  const [hHasta, setHHasta] = useState('')

  useEffect(() => {
    if (!aprobado || !codigo?.codigo) { setEstado('idle'); return }
    let cancel = false
    ;(async () => {
      setEstado('loading')
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/codigo_stats`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_codigo: codigo.codigo }),
        })
        if (!res.ok) throw new Error('rpc')
        const data = await res.json()
        // La función devuelve TABLE → PostgREST responde con un array de una fila.
        const row = Array.isArray(data) ? data[0] : data
        if (!cancel) {
          setStats({
            total:    Number(row?.total    || 0),
            en_curso: Number(row?.en_curso || 0),
            cerradas: Number(row?.cerradas || 0),
            exitos:   Number(row?.exitos   || 0),
            fracasos: Number(row?.fracasos || 0),
          })
          setEstado('ready')
        }

        // Historial detallado (RPC opcional: si aún no está aplicado, degrada sin romper).
        try {
          const hRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/codigo_historial`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_codigo: codigo.codigo }),
          })
          if (hRes.ok) {
            const h = await hRes.json()
            if (!cancel) setHistorial(Array.isArray(h) ? h : [])
          }
        } catch { /* historial opcional */ }
      } catch {
        if (!cancel) setEstado('error')
      }
    })()
    return () => { cancel = true }
  }, [aprobado, codigo])

  const decididos = stats ? stats.exitos + stats.fracasos : 0
  const tasaExito = decididos > 0 ? Math.round((stats.exitos / decididos) * 100) : 0

  const historialFiltrado = historial.filter(h => {
    if (!enRango(h.created_at, hDesde, hHasta)) return false
    const q = norm(hQuery)
    if (!q) return true
    return norm(`${h.client_nombre || ''} ${h.profesional_nombre || ''}`).includes(q)
  })
  const hayFiltroHist = hQuery || hDesde || hHasta

  // Segmentos para la dona: en curso / éxitos / fracasos / otras (cerradas sin resultado, etc.)
  const donutData = stats ? [
    { key: 'exitos',   label: 'Éxitos',   value: stats.exitos,   color: '#1f7a4d' },
    { key: 'fracasos', label: 'Fracasos', value: stats.fracasos, color: '#a23b3b' },
    { key: 'en_curso', label: 'En curso', value: stats.en_curso, color: '#c9a84c' },
    { key: 'otras',    label: 'Sin resultado', value: Math.max(0, stats.total - stats.exitos - stats.fracasos - stats.en_curso), color: '#c8b29f' },
  ].filter(d => d.value > 0) : []

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>Trazabilidad de tu código</p>
          <h1 className={styles.panelTitle}>Tus <em>Estadísticas</em></h1>
        </div>
      </div>

      {!aprobado ? (
        <div className={styles.cardGlass}><EstadoPendiente /></div>
      ) : !codigo ? (
        <div className={styles.cardGlass}><EstadoSinCodigo /></div>
      ) : estado === 'loading' ? (
        <div className={styles.cardGlass}>
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>Calculando…</p>
        </div>
      ) : estado === 'error' ? (
        <div className={styles.cardGlass}>
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>
            No se pudieron cargar las estadísticas. Intenta de nuevo más tarde.
          </p>
        </div>
      ) : stats && stats.total === 0 ? (
        <div className={styles.cardGlass}>
          <div className={styles.estado}>
            <span className={styles.estadoIcon} data-tone="empty" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                <path d="M3 3v18h18" /><path d="M7 15l3-4 3 3 4-6" />
              </svg>
            </span>
            <p className={styles.estadoTitle}>Aún no hay movimiento</p>
            <p className={styles.estadoDesc}>
              Nadie ha usado tu código todavía. Cuando alguien inicie una consulta escaneando tu QR,
              verás aquí el detalle y tu tasa de éxito.
            </p>
          </div>
        </div>
      ) : stats ? (
        <>
          {/* Barra de proporción éxitos vs fracasos */}
          <div className={styles.cardGlass}>
            <div className={styles.ratioHead}>
              <span className={styles.ratioTitle}>Tasa de éxito</span>
              <span className={styles.ratioPct}>{tasaExito}%</span>
            </div>
            <div
              className={styles.ratioBar}
              role="progressbar"
              aria-valuenow={tasaExito}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Tasa de éxito"
            >
              {decididos > 0 ? (
                <>
                  <span className={styles.ratioFillExito} style={{ width: `${tasaExito}%` }} />
                  <span className={styles.ratioFillFracaso} style={{ width: `${100 - tasaExito}%` }} />
                </>
              ) : (
                <span className={styles.ratioEmpty} />
              )}
            </div>
            <div className={styles.ratioLegend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDotExito} /> Éxitos · {stats.exitos}
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDotFracaso} /> Fracasos · {stats.fracasos}
              </span>
              <span className={styles.legendMuted}>
                {decididos === 0
                  ? 'Sin casos cerrados con resultado'
                  : `Sobre ${decididos} caso${decididos === 1 ? '' : 's'} con resultado`}
              </span>
            </div>
          </div>

          {/* Tiles */}
          <div className={styles.statGrid}>
            <StatTile label="Usaron tu código" value={stats.total} tone="gold" />
            <StatTile label="En curso" value={stats.en_curso} tone="navy" />
            <StatTile label="Cerradas" value={stats.cerradas} tone="navy" />
            <StatTile label="Éxitos" value={stats.exitos} tone="ok" />
            <StatTile label="Fracasos" value={stats.fracasos} tone="bad" />
          </div>

          {/* Gráfica (dona) + leyenda del reparto de consultas */}
          {donutData.length > 0 && (
            <div className={styles.cardGlass} style={{ marginTop: '1.25rem' }}>
              <p className={styles.blockTitle}>Reparto de consultas</p>
              <div className={styles.chartRow}>
                <div className={styles.donutBox}>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="label"
                        cx="50%" cy="50%"
                        innerRadius={54}
                        outerRadius={82}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {donutData.map((d) => <Cell key={d.key} fill={d.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} consulta${value === 1 ? '' : 's'}`, name]}
                        contentStyle={{ borderRadius: 10, border: '1px solid rgba(109,60,27,0.1)', fontSize: 13, fontFamily: 'Raleway, sans-serif' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className={styles.donutCenter} aria-hidden="true">
                    <span className={styles.donutCenterNum}>{stats.total}</span>
                    <span className={styles.donutCenterLbl}>{stats.total === 1 ? 'consulta' : 'consultas'}</span>
                  </div>
                </div>
                <ul className={styles.distList}>
                  {donutData.map((d) => {
                    const pct = stats.total ? Math.round((d.value / stats.total) * 100) : 0
                    return (
                      <li key={d.key} className={styles.distRow}>
                        <span className={styles.distHead}>
                          <span className={styles.chartDot} style={{ background: d.color }} aria-hidden="true" />
                          <span className={styles.distLabel}>{d.label}</span>
                          <span className={styles.distVal}>{d.value} · {pct}%</span>
                        </span>
                        <span className={styles.distTrack}>
                          <span className={styles.distFill} style={{ width: `${pct}%`, background: d.color }} />
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}

          {/* Historial de consultas que usaron el código */}
          <div className={styles.cardGlass} style={{ marginTop: '1.25rem' }}>
            <div className={styles.blockHead}>
              <p className={styles.blockTitle} style={{ margin: 0 }}>Historial de consultas</p>
              {historial.length > 0 && (
                <span className={styles.blockCount}>
                  {historialFiltrado.length} de {historial.length}
                </span>
              )}
            </div>

            {historial.length > 0 && (
              <GestorFilterBar
                query={hQuery} onQuery={setHQuery}
                desde={hDesde} onDesde={setHDesde}
                hasta={hHasta} onHasta={setHHasta}
                placeholder="Buscar por cliente o profesional…"
                onClear={() => { setHQuery(''); setHDesde(''); setHHasta('') }}
                hayFiltro={hayFiltroHist}
              />
            )}

            {historial.length === 0 ? (
              <p className={styles.estadoDesc} style={{ margin: 0 }}>
                El detalle por consulta aparecerá aquí a medida que las personas usen tu código.
              </p>
            ) : historialFiltrado.length === 0 ? (
              <p className={styles.estadoDesc} style={{ margin: '0.5rem 0 0' }}>
                Ninguna consulta coincide con el filtro.
              </p>
            ) : (
              <ul className={styles.historialList}>
                {historialFiltrado.map((h) => {
                  const paso =
                    h.status === 'closed' ? 'cerrada'
                    : h.status === 'active' ? 'en_curso'
                    : 'iniciada'
                  return (
                    <li key={h.id} className={styles.histItem}>
                      <div className={styles.histInfo}>
                        <span className={styles.histName}>{primerNombre(h.client_nombre) || 'Cliente'}</span>
                        <span className={styles.histWith}>
                          {h.profesional_nombre ? (
                            <>
                              con {primerNombre(h.profesional_nombre)}
                              <span className={styles.histRol} data-rol={h.tipo_profesional}>
                                {rotularProfesion(h.tipo_profesional)}
                              </span>
                            </>
                          ) : (
                            <>profesional por asignar</>
                          )}
                        </span>
                      </div>
                      <ConsultaProgreso
                        paso={paso}
                        resultado={h.resultado}
                        tiempos={{ iniciada: h.created_at, en_curso: h.activo_at, cerrada: h.cerrada_at }}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className={styles.cardGlass}>
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>Sin datos.</p>
        </div>
      )}
    </section>
  )
}

function StatTile({ label, value, tone }) {
  return (
    <div className={styles.statTile} data-tone={tone}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

// Progreso de una consulta: Iniciada → En curso → Cerrada (+ resultado al cerrar).
// Cada paso muestra su fecha y hora (tiempos), para trazabilidad.
const PASOS_CONSULTA = [
  { key: 'iniciada', label: 'Iniciada', tKey: 'iniciada' },
  { key: 'en_curso', label: 'En curso', tKey: 'en_curso' },
  { key: 'cerrada',  label: 'Cerrada',  tKey: 'cerrada' },
]
function ConsultaProgreso({ paso, resultado, tiempos = {} }) {
  const activo = Math.max(0, PASOS_CONSULTA.findIndex(p => p.key === paso))
  return (
    <div className={styles.histProg}>
      <div
        className={styles.stepper}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={PASOS_CONSULTA.length}
        aria-valuenow={activo + 1}
        aria-label={`Progreso de la consulta: ${PASOS_CONSULTA[activo]?.label}`}
      >
        {PASOS_CONSULTA.map((p, i) => {
          const state = i < activo ? 'done' : i === activo ? 'current' : 'todo'
          const t = tiempos[p.tKey]
          return (
            <div key={p.key} className={styles.step} data-state={state}>
              {i > 0 && <span className={styles.stepBar} data-state={i <= activo ? 'done' : 'todo'} aria-hidden="true" />}
              <span className={styles.stepDot} aria-hidden="true">
                {i < activo ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <span className={styles.stepInner} />
                )}
              </span>
              <span className={styles.stepLabel}>{p.label}</span>
              {t ? (
                <span className={styles.stepWhen}>
                  <span className={styles.stepWhenDate}>{fmtFecha(t)}</span>
                  <span className={styles.stepWhenTime}>{fmtHora(t)}</span>
                </span>
              ) : (
                <span className={styles.stepWhenEmpty}>—</span>
              )}
            </div>
          )
        })}
      </div>
      {paso === 'cerrada' && (
        <span className={
          resultado === 'exito' ? styles.histBadgeOk
          : resultado === 'fracaso' ? styles.histBadgeBad
          : styles.histBadgeNeutral
        }>
          {resultado === 'exito' ? 'Éxito' : resultado === 'fracaso' ? 'Fracaso' : 'Sin resultado'}
        </span>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   3. Cobros — gestor_cobros (RLS: solo los propios).
   El gestor ve sus comisiones ganadas y puede SOLICITAR el pago
   (pendiente → solicitado). El admin luego marca pagado (→ pagado).
   ══════════════════════════════════════════════════════════════════ */

// Pasos del "cupón" de comisión: Disponible → Solicitado → Pagado.
const PASOS_PAGO = [
  { key: 'pendiente',  label: 'Disponible' },
  { key: 'solicitado', label: 'Solicitado' },
  { key: 'pagado',     label: 'Pagado' },
]
const idxEstado = (e) => Math.max(0, PASOS_PAGO.findIndex(p => p.key === e))

// Mini-stepper del recorrido del pago para una comisión.
function PagoProgreso({ estado }) {
  const activo = idxEstado(estado)
  // 'pagado' es el estado FINAL completado → el último paso también va en verde
  // con su chulo (no queda como "en curso" con anillo dorado).
  const terminal = estado === 'pagado'
  return (
    <div
      className={styles.stepper}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={PASOS_PAGO.length}
      aria-valuenow={activo + 1}
      aria-label={`Progreso del pago: ${PASOS_PAGO[activo]?.label}`}
    >
      {PASOS_PAGO.map((p, i) => {
        const done = i < activo || (i === activo && terminal)
        const state = done ? 'done' : i === activo ? 'current' : 'todo'
        return (
          <div key={p.key} className={styles.step} data-state={state}>
            {i > 0 && <span className={styles.stepBar} data-state={i <= activo ? 'done' : 'todo'} aria-hidden="true" />}
            <span className={styles.stepDot} aria-hidden="true">
              {done ? (
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <span className={styles.stepInner} />
              )}
            </span>
            <span className={styles.stepLabel}>{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// Pill de estado con los 3 tonos: ámbar (disponible) / azul (solicitado) / verde (pagado).
function EstadoPill({ estado }) {
  if (estado === 'pagado')     return <span className={styles.pillPagado}>Pagado</span>
  if (estado === 'solicitado') return <span className={styles.pillSolicitado}>Solicitado</span>
  return <span className={styles.pillDisponible}>Disponible</span>
}

function SeccionCobros({ aprobado, userId }) {
  const [cobros, setCobros] = useState([])
  const [estado, setEstado] = useState('loading') // loading | ready | error
  const [pidiendo, setPidiendo] = useState(null)   // id del cobro en proceso de solicitud
  const [aviso, setAviso] = useState(null)         // {tone:'ok'|'error', text}
  // Filtro (código/nota + rango de fechas).
  const [cQuery, setCQuery] = useState('')
  const [cDesde, setCDesde] = useState('')
  const [cHasta, setCHasta] = useState('')

  async function cargar(silencioso = false) {
    if (!aprobado || !userId) { setEstado('ready'); return }
    if (!silencioso) setEstado('loading')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/gestor_cobros?gestor_id=eq.${userId}&select=*&order=created_at.desc`,
        { headers }
      )
      if (!res.ok) throw new Error('fetch')
      const data = await res.json()
      setCobros(Array.isArray(data) ? data : [])
      setEstado('ready')
    } catch {
      setEstado('error')
    }
  }

  useEffect(() => {
    let cancel = false
    ;(async () => { if (!cancel) await cargar() })()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aprobado, userId])

  // Solicita el pago de una comisión propia (pendiente → solicitado).
  async function solicitarPago(cobroId) {
    setPidiendo(cobroId); setAviso(null)
    // Optimista: la fila pasa a "solicitado" al instante.
    setCobros(cs => cs.map(c => c.id === cobroId ? { ...c, estado: 'solicitado' } : c))
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/solicitar_pago_gestor`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_cobro_id: cobroId }),
      })
      if (!res.ok) throw new Error('rpc')
      const ok = await res.json()
      if (ok === false) throw new Error('rechazado')
      setAviso({ tone: 'ok', text: 'Solicitud enviada. El administrador revisará tu pago.' })
      await cargar(true) // refresca fechas reales (solicitado_at)
    } catch {
      // Revertir el optimismo si la RPC falló.
      setCobros(cs => cs.map(c => c.id === cobroId ? { ...c, estado: 'pendiente' } : c))
      setAviso({ tone: 'error', text: 'No se pudo enviar la solicitud. Intenta de nuevo.' })
    } finally {
      setPidiendo(null)
    }
  }

  const totalDisponible = cobros.filter(c => c.estado === 'pendiente').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const totalProceso    = cobros.filter(c => c.estado === 'solicitado').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const totalPagado     = cobros.filter(c => c.estado === 'pagado').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const totalCasos      = cobros.reduce((s, c) => s + (Number(c.casos_exitosos) || 0), 0)

  const cobrosFiltrados = cobros.filter(c => {
    if (!enRango(c.created_at, cDesde, cHasta)) return false
    const q = norm(cQuery)
    if (!q) return true
    return norm(`${c.codigo || ''} ${c.nota || ''}`).includes(q)
  })
  const hayFiltroCobros = cQuery || cDesde || cHasta

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>Comisiones por casos exitosos</p>
          <h1 className={styles.panelTitle}>Mis <em>Cobros</em></h1>
        </div>
      </div>

      {!aprobado ? (
        <div className={styles.cardGlass}><EstadoPendiente /></div>
      ) : estado === 'loading' ? (
        <div className={styles.cardGlass}>
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>Cargando cobros…</p>
        </div>
      ) : estado === 'error' ? (
        <div className={styles.cardGlass}>
          <p className={styles.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>
            No se pudieron cargar tus cobros. Intenta más tarde.
          </p>
        </div>
      ) : (
        <>
          {/* Tiles resumen — numerales tabulares (Raleway) */}
          <div className={styles.statGrid}>
            <div className={styles.statTile} data-tone="gold">
              <span className={styles.moneyValue}>{fmtCOP(totalDisponible)}</span>
              <span className={styles.statLabel}>Disponible para solicitar</span>
            </div>
            <div className={styles.statTile} data-tone="navy">
              <span className={styles.moneyValue}>{fmtCOP(totalProceso)}</span>
              <span className={styles.statLabel}>En proceso</span>
            </div>
            <div className={styles.statTile} data-tone="ok">
              <span className={styles.moneyValue}>{fmtCOP(totalPagado)}</span>
              <span className={styles.statLabel}>Pagado</span>
            </div>
            <div className={styles.statTile} data-tone="navy">
              <span className={styles.numValue}>{totalCasos}</span>
              <span className={styles.statLabel}>Casos exitosos</span>
            </div>
          </div>

          {aviso && (
            <p className={aviso.tone === 'ok' ? styles.msgSuccess : styles.msgError} style={{ marginTop: '1rem' }}>
              {aviso.text}
            </p>
          )}

          {cobros.length === 0 ? (
            <div className={styles.cardGlass} style={{ marginTop: '1.25rem' }}>
              <div className={styles.estado}>
                <span className={styles.estadoIcon} data-tone="empty" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                    <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h14" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /><path d="M18 12a1 1 0 0 0 0 2h3v-2z" />
                  </svg>
                </span>
                <p className={styles.estadoTitle}>Aún no tienes comisiones</p>
                <p className={styles.estadoDesc}>
                  Cuando el administrador registre una comisión por tus casos exitosos, aparecerá aquí.
                  Podrás solicitar su pago con un solo toque y seguir su avance hasta que se acredite.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.cobrosFilterWrap} style={{ marginTop: '1.25rem' }}>
                <GestorFilterBar
                  query={cQuery} onQuery={setCQuery}
                  desde={cDesde} onDesde={setCDesde}
                  hasta={cHasta} onHasta={setCHasta}
                  placeholder="Buscar por código o nota…"
                  onClear={() => { setCQuery(''); setCDesde(''); setCHasta('') }}
                  hayFiltro={hayFiltroCobros}
                />
              </div>

              {cobrosFiltrados.length === 0 ? (
                <p className={styles.estadoDesc} style={{ margin: '1rem 0 0' }}>
                  Ninguna comisión coincide con el filtro.
                </p>
              ) : (
                <div className={styles.cuponList} style={{ marginTop: '1rem' }}>
                  {cobrosFiltrados.map(c => (
                    <article key={c.id} className={styles.cupon} data-estado={c.estado}>
                      {/* Cabecera del cupón: código + monto + estado */}
                      <div className={styles.cuponHead}>
                        <div className={styles.cuponMeta}>
                          <span className={styles.cuponCodigo}>{c.codigo || 'Comisión'}</span>
                          <span className={styles.cuponFecha}>{fmtFechaHora(c.created_at)}</span>
                          {(c.casos_exitosos ?? 0) > 0 && (
                            <span className={styles.cuponCasos}>{c.casos_exitosos} caso{c.casos_exitosos === 1 ? '' : 's'}</span>
                          )}
                        </div>
                        <div className={styles.cuponMontoWrap}>
                          <span className={styles.cuponMonto}>{fmtCOP(c.monto)}</span>
                          <EstadoPill estado={c.estado} />
                        </div>
                      </div>

                      {c.nota && <p className={styles.cuponNota}>{c.nota}</p>}

                      {/* Desglose transparente: cómo se calculó la comisión */}
                      {c.total_consulta != null && (
                        <div className={styles.desglose}>
                          <div className={styles.desItem}>
                            <span className={styles.desLabel}>Total de la consulta</span>
                            <span className={styles.desVal}>{fmtCOP(c.total_consulta)}</span>
                          </div>
                          <div className={styles.desItem}>
                            <span className={styles.desLabel}>
                              Empresa{c.pct_empresa != null ? ` · ${c.pct_empresa}%` : ''}
                            </span>
                            <span className={styles.desVal}>
                              {fmtCOP(c.monto_empresa != null
                                ? c.monto_empresa
                                : (c.total_consulta && c.pct_empresa ? Math.round(c.total_consulta * c.pct_empresa / 100) : 0))}
                            </span>
                          </div>
                          <div className={`${styles.desItem} ${styles.desItemStrong}`}>
                            <span className={styles.desLabel}>
                              Tu comisión{c.pct_gestor != null ? ` · ${c.pct_gestor}%` : ''}
                            </span>
                            <span className={styles.desVal}>{fmtCOP(c.monto)}</span>
                          </div>
                        </div>
                      )}

                      {/* Recorrido del pago */}
                      <PagoProgreso estado={c.estado} />

                      {/* Acción / mensaje según estado (con fecha y hora de cada hito) */}
                      <div className={styles.cuponFoot}>
                        {c.estado === 'pendiente' && (
                          <button
                            type="button"
                            className={styles.solicitarBtn}
                            onClick={() => solicitarPago(c.id)}
                            disabled={pidiendo === c.id}
                          >
                            <IconWallet />
                            {pidiendo === c.id ? 'Enviando…' : 'Solicitar pago'}
                          </button>
                        )}
                        {c.estado === 'solicitado' && (
                          <p className={styles.cuponHint} data-tone="wait">
                            Solicitado el {fmtFechaHora(c.solicitado_at || c.created_at)} — el pago se envía en 24-48h.
                          </p>
                        )}
                        {c.estado === 'pagado' && (
                          <p className={styles.cuponHint} data-tone="ok">
                            Pagado el {fmtFechaHora(c.pagado_at || c.solicitado_at || c.created_at)}.
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   4. Mi perfil — redes + comunidad + certificado bancario
   ══════════════════════════════════════════════════════════════════ */
const REDES = [
  { key: 'instagram', label: 'Instagram',   ph: 'https://instagram.com/tu_usuario' },
  { key: 'linkedin',  label: 'LinkedIn',    ph: 'https://linkedin.com/in/tu_perfil' },
  { key: 'facebook',  label: 'Facebook',    ph: 'https://facebook.com/tu_perfil' },
  { key: 'twitter',   label: 'X / Twitter', ph: 'https://x.com/tu_usuario' },
  { key: 'whatsapp',  label: 'WhatsApp',    ph: 'https://wa.me/57300…' },
  { key: 'tiktok',    label: 'TikTok',      ph: 'https://tiktok.com/@tu_usuario' },
]
const COMUNIDAD_MAX = 500

function SeccionPerfil({ aprobado, profile, userId, email, onEliminada }) {
  const certInputRef = useRef(null)

  const [redes, setRedes] = useState(() => ({
    instagram: '', linkedin: '', facebook: '', twitter: '', whatsapp: '', tiktok: '',
  }))
  const [comunidad, setComunidad] = useState('')
  const [certUrl, setCertUrl]     = useState(null)
  const [certDisplayUrl, setCertDisplayUrl] = useState(null)

  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg]     = useState(null)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleEliminarCuenta() {
    setDeleting(true); setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, { method: 'DELETE', headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onEliminada?.()
    } catch (err) {
      setError('No se pudo eliminar la cuenta: ' + (err.message || err))
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (!profile) return
    setRedes({
      instagram: profile.instagram || '',
      linkedin:  profile.linkedin  || '',
      facebook:  profile.facebook  || '',
      twitter:   profile.twitter   || '',
      whatsapp:  profile.whatsapp  || '',
      tiktok:    profile.tiktok    || '',
    })
    setComunidad(profile.comunidad_descripcion || '')
    setCertUrl(profile.certificado_bancario_url || null)
  }, [profile])

  // Resolver de URL de visualización para el certificado (bucket privado).
  // Puede ser un path "certificados/<uid>.pdf" → signed URL; o una URL legacy.
  useEffect(() => {
    if (!certUrl) { setCertDisplayUrl(null); return }
    if (/^https?:\/\//.test(certUrl)) { setCertDisplayUrl(certUrl); return }
    let cancel = false
    ;(async () => {
      const { data } = await supabase.storage
        .from('tarjetas-profesionales')
        .createSignedUrl(certUrl, 3600)
      if (!cancel && data?.signedUrl) setCertDisplayUrl(data.signedUrl)
    })()
    return () => { cancel = true }
  }, [certUrl])

  async function handleCertChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(file.type)) { setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setError('El archivo no puede superar 10 MB'); return }
    setUploading(true); setError(null); setMsg(null)
    try {
      const headers = await getAuthHeaders()
      const ext  = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
      // Primer segmento = user.id (exigido por la RLS del bucket, igual que la
      // tarjeta profesional) y dentro, la carpeta certificados/ pedida.
      const path = `${userId}/certificados/certificado.${ext}`
      const res  = await fetch(
        `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' },
          body: file,
        }
      )
      if (!res.ok) throw new Error('No se pudo subir el certificado')
      // Guardamos el path (bucket privado). El useEffect lo firma para verlo.
      setCertUrl(path)
      // Persistimos de inmediato para que quede aunque no pulse "Guardar".
      await patchProfile({ certificado_bancario_url: path })
      setMsg('Certificado bancario subido correctamente.')
    } catch (err) {
      setError(err.message || 'Error subiendo el certificado')
    } finally {
      setUploading(false)
    }
  }

  async function patchProfile(payload) {
    const headers = await getAuthHeaders()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('No se pudo guardar el perfil')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(null); setMsg(null)
    try {
      await patchProfile({
        instagram: redes.instagram.trim() || null,
        linkedin:  redes.linkedin.trim()  || null,
        facebook:  redes.facebook.trim()  || null,
        twitter:   redes.twitter.trim()   || null,
        whatsapp:  redes.whatsapp.trim()  || null,
        tiktok:    redes.tiktok.trim()    || null,
        comunidad_descripcion: comunidad.trim() || null,
      })
      setMsg('¡Perfil actualizado correctamente!')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={pStyles.panel}>
      <div className={pStyles.panelHead}>
        <h1 className={pStyles.panelTitle}>Mi <em>Perfil</em></h1>
        <span className={pStyles.status}>
          {aprobado ? '✦ Aprobado' : '◌ Pendiente de aprobación'}
        </span>
      </div>

      <form className={pStyles.form} onSubmit={handleSave}>

        {/* ── Columna izquierda: identidad y datos de registro ── */}
        <aside className={styles.identityCol}>
          <div className={styles.identityAvatar}>{(profile?.username || 'G').charAt(0).toUpperCase()}</div>
          <p className={styles.identityName}>{profile?.username ? `@${profile.username}` : 'Gestor'}</p>
          <span className={aprobado ? styles.identityBadgeOk : styles.identityBadgePend}>
            {aprobado ? 'Cuenta aprobada' : 'Pendiente de aprobación'}
          </span>
          <dl className={styles.identityList}>
            <div className={styles.identityRow}>
              <dt>Correo</dt>
              <dd>{email || '—'}</dd>
            </div>
            <div className={styles.identityRow}>
              <dt>Cédula</dt>
              <dd>{profile?.cedula || '—'}</dd>
            </div>
          </dl>
        </aside>

        {/* ── Columna derecha: formulario editable ── */}
        <div className={styles.formMain}>

          {/* Comunidad */}
          <div className={pStyles.field}>
            <label className={pStyles.label}>
              ¿Manejas alguna comunidad?
              <span className={pStyles.optional}>(fundaciones, asociaciones, líder comunal, colectivos…)</span>
            </label>
            <textarea
              className={pStyles.input}
              rows={4}
              maxLength={COMUNIDAD_MAX}
              placeholder="Cuéntanos tu alcance. Ej: líder comunal, fundación, asociación, colectivo, JAC, cooperativa…"
              value={comunidad}
              onChange={e => setComunidad(e.target.value.slice(0, COMUNIDAD_MAX))}
              style={{ resize: 'vertical', minHeight: 110 }}
            />
            <span className={`${pStyles.charCount} ${comunidad.length >= 480 ? pStyles.charCountWarn : ''}`}>
              {comunidad.length}/{COMUNIDAD_MAX}
            </span>
          </div>

          {/* Redes sociales */}
          <div className={pStyles.field}>
            <label className={pStyles.label}>Redes sociales <span className={pStyles.optional}>(opcional)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {REDES.map(({ key, label, ph }) => (
                <div key={key}>
                  <label className={pStyles.label} style={{ marginBottom: 4 }}>{label}</label>
                  <input
                    type="url"
                    className={pStyles.input}
                    placeholder={ph}
                    value={redes[key]}
                    onChange={e => setRedes(r => ({ ...r, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Certificado bancario — solo cuando está aprobado */}
          <div className={pStyles.field}>
            <label className={pStyles.label}>
              Certificado bancario
              <span className={pStyles.optional}>PDF, PNG, JPG o WEBP · máx. 10 MB</span>
            </label>
            {!aprobado ? (
              <p className={styles.lockNote}>
                Podrás subir tu certificado de cuenta bancaria cuando el administrador apruebe tu cuenta.
                Lo usamos para pagarte tus cobros.
              </p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => certInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Subiendo…' : certUrl ? 'Cambiar certificado' : 'Subir certificado'}
                </button>
                {certUrl && (
                  certDisplayUrl ? (
                    <a className={styles.fileLink} href={certDisplayUrl} target="_blank" rel="noopener noreferrer">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                      </svg>
                      Ver certificado actual
                    </a>
                  ) : (
                    <span className={styles.lockNote}>Generando enlace seguro…</span>
                  )
                )}
                <input
                  ref={certInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleCertChange}
                />
              </div>
            )}
          </div>

          {error && <p className={styles.msgError}>{error}</p>}
          {msg   && <p className={styles.msgSuccess}>{msg}</p>}

          {/* ── Acciones ── */}
          <div className={styles.actionsRow}>
            <button type="submit" className="btn-solid btn-lg" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          {!confirmDelete ? (
            <button type="button" className={pStyles.deleteBtn} onClick={() => setConfirmDelete(true)}>
              Eliminar cuenta
            </button>
          ) : (
            <div className={pStyles.confirmDelete}>
              <span>¿Seguro? Esta acción no se puede deshacer.</span>
              <button type="button" className={pStyles.deleteBtnConfirm} onClick={handleEliminarCuenta} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </div>
          )}
          </div>
        </div>
      </form>
    </section>
  )
}
