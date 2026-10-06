import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, getAuthHeaders } from '../lib/supabase'
import { validarCelular, normalizarCelular } from '../lib/validaciones'
import { AREAS_DERECHO } from '../lib/areasDerecho'
import { AREAS_CONTADURIA } from '../lib/areasContaduria'
import LawyerInternalChat from '../components/chat/LawyerInternalChat'
// La firma atiende las consultas como cualquier profesional: mismo panel de
// consultas y mismos pagos, con su id como "profesional asignado".
import LawyerChatDashboard from '../components/chat/LawyerChatDashboard'
import MisPagos from '../components/profile/MisPagos'
import { useProBadges, CampanaPro } from '../components/profile/NotificacionesPro'
import TarjetaPreview from '../components/profile/TarjetaPreview'
// El equipo son fichas informativas que la firma crea y edita aquí.
import MiembroFirmaModal from '../components/profile/MiembroFirmaModal'
// "Ver perfil" de un miembro: la misma ficha con la que la administración
// revisa a un profesional.
import ProfileDetailModal from '../components/admin/ProfileDetailModal'
// Del registro público salen el tratamiento del logo y las opciones de alcance.
import { logoSobreBlanco, OPCIONES_ALCANCE } from '../components/auth/RegisterModal'
// Mismo armazón y mismas piezas que el panel del gestor (riel, cabeceras,
// tarjetas, estados): una firma es otro perfil de la casa, no un mundo aparte.
import g from './ProfileGestorPage.module.css'
import pStyles from './ProfilePage.module.css'
import docStyles from '../components/profile/DocumentosConfianza.module.css'
import reg from '../components/auth/RegisterModal.module.css'
import styles from './ProfileFirmaPage.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const MAX_VIDEO_MB = 200

// ── Iconos SVG (estilo Lucide, currentColor) ──
const ico = (d) => (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>{d}</svg>
)
const IconEquipo  = ico(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>)
// El mismo símbolo de la firma que en el registro: frontón, columnas y escalinata.
const IconFirma   = ico(<><path d="M12 2.6 20.6 7.6H3.4z"/><path d="M5 10.6h14M6.5 10.6v6.3M10.2 10.6v6.3M13.8 10.6v6.3M17.5 10.6v6.3M4.6 16.9h14.8M3 20.6h18"/></>)
const IconChat    = ico(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>)
const IconWallet  = ico(<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>)
const IconChatInterno = ico(<><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></>)
const IconHome    = ico(<><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></>)
const IconLogout  = ico(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></>)
const IconMas     = ico(<path d="M12 5v14M5 12h14"/>)
const IconBasura  = ico(<><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></>)
const IconLapiz   = ico(<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>)

// Mismo orden que el panel de un profesional: primero lo propio (Mi firma),
// después el equipo, y luego consultas, pagos y el chat con la administración.
const SECCIONES = [
  { id: 'perfil',    label: 'Mi firma',              corto: 'Mi firma',     Icon: IconFirma },
  { id: 'equipo',    label: 'Aliados/Colaboradores', corto: 'Equipo',       Icon: IconEquipo },
  { id: 'consultas', label: 'Consultas',             corto: 'Consultas',    Icon: IconChat },
  { id: 'pagos',     label: 'Pagos',                 corto: 'Pagos',        Icon: IconWallet },
  { id: 'interno',   label: 'Chat interno',          corto: 'Chat interno', Icon: IconChatInterno },
]

const DESCRIPCION_MAX = 500
const DESCRIPCION_MIN = 60
const nombreDe = (m) => `${m?.nombre || ''} ${m?.apellido || ''}`.trim() || 'Sin nombre'
const iniciales = (m) => ((m?.nombre?.[0] || '') + (m?.apellido?.[0] || '')).toUpperCase() || '·'
const oficio = (rol) => (rol === 'contador' ? 'Contador' : 'Abogado')
// Para buscar sin que importen tildes ni mayúsculas.
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function ProfileFirmaPage() {
  const { user, profile, loading, signOut } = useAuth()
  const navigate = useNavigate()

  // Dónde se aterriza: en "Mi firma" (la primera, como en los demás paneles),
  // salvo que la firma ya esté aprobada y le falte el Director, que es el
  // paso obligatorio y vive en el equipo. null = todavía no se sabe.
  const [seccion, setSeccion] = useState(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const aprobado = profile?.aprobado === true
  // Contadores del centro de notificaciones (badges del riel + campana): la
  // firma recibe consultas y cobros igual que un profesional.
  const { badges, notis, notisNoLeidas, notiSeenTs, marcarNotisLeidas } =
    useProBadges(user?.id, { activo: aprobado })
  const badgePorSeccion = { consultas: badges.consultas, interno: badges.interno, pagos: badges.pagos }

  // Guard: solo firmas autenticadas (mismo patrón que los demás perfiles).
  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/'); return }
    // Cuenta eliminada con el token todavía vivo: sin perfil (o marcada como
    // eliminada) no hay cuenta.
    if (!profile || profile.cuenta_eliminada_en) { signOut().finally(() => navigate('/')); return }
    if (profile.rol !== 'firma') { navigate('/'); return }
  }, [user, profile, loading, navigate])

  useEffect(() => {
    if (loading || seccion || !user || profile?.rol !== 'firma') return
    if (!aprobado) { setSeccion('perfil'); return }
    let cancel = false
    ;(async () => {
      let hayDirector = true
      try {
        const headers = await getAuthHeaders()
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/firma_miembros?firma_id=eq.${user.id}&cargo=eq.director&select=id&limit=1`,
          { headers }
        )
        const j = await r.json().catch(() => null)
        if (r.ok && Array.isArray(j)) hayDirector = j.length > 0
      } catch { /* sin respuesta: se aterriza en Mi firma */ }
      // Si mientras tanto ya eligió una sección, se respeta.
      if (!cancel) setSeccion(s => s || (hayDirector ? 'perfil' : 'equipo'))
    })()
    return () => { cancel = true }
  }, [loading, seccion, user, profile?.rol, aprobado])

  if (loading) {
    return (
      <div className={g.loading}>
        <span className={g.dot} /><span className={g.dot} /><span className={g.dot} />
      </div>
    )
  }
  if (!user || profile?.rol !== 'firma' || profile?.cuenta_eliminada_en) return null

  return (
    <div className={g.page}>
      <div className={g.shell}>

        {/* ── Riel de navegación (se expande al pasar el mouse) ── */}
        <aside className={g.sidebar}>
          <div className={g.sidebarInner}>
            <div className={g.sideBrand}>
              <span className={g.brandMark}>PB</span>
              <div className={g.brandText}>
                <strong>{profile?.nombre || 'Firma'}</strong>
                <small className={aprobado ? g.badgeOk : g.badgePend}>
                  {aprobado ? 'Aprobada' : 'Pendiente'}
                </small>
              </div>
            </div>

            <nav className={g.sideNav} aria-label="Secciones del panel">
              {SECCIONES.map(({ id, label, corto, Icon }) => {
                const n = aprobado ? (badgePorSeccion[id] || 0) : 0
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${g.navItem} ${styles.navConBadge} ${seccion === id ? g.navItemActive : ''}`}
                    onClick={() => setSeccion(id)}
                    aria-current={seccion === id ? 'page' : undefined}
                    title={n ? `${label} · ${n} sin leer` : label}
                    aria-label={n ? `${label}, ${n} sin leer` : label}
                  >
                    <Icon className={g.navIcon} aria-hidden="true" />
                    <span className={g.navLabel}>{label}</span>
                    <span className={g.navLabelCorto} aria-hidden="true">{corto || label}</span>
                    {n > 0 && <span className={styles.navBadge}>{n > 9 ? '9+' : n}</span>}
                  </button>
                )
              })}
            </nav>

            <div className={g.sideFoot}>
              <button type="button" className={g.navItem} onClick={() => navigate('/')} title="Ir al inicio">
                <IconHome className={g.navIcon} aria-hidden="true" />
                <span className={g.navLabel}>Ir al inicio</span>
              </button>
              <button
                type="button"
                className={`${g.navItem} ${g.logout}`}
                onClick={() => setConfirmLogout(true)}
                title="Cerrar sesión"
              >
                <IconLogout className={g.navIcon} aria-hidden="true" />
                <span className={g.navLabel}>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        <main className={g.content}>
          {aprobado && (
            <CampanaPro
              badges={badges}
              notis={notis}
              notisNoLeidas={notisNoLeidas}
              notiSeenTs={notiSeenTs}
              onMarcarLeidas={marcarNotisLeidas}
              onGoSection={(id) => setSeccion(id)}
            />
          )}

          {seccion === 'equipo' && (
            <SeccionEquipo aprobado={aprobado} firma={profile} userId={user.id} />
          )}

          {seccion === 'consultas' && (
            <section className={g.panel}>
              <div className={g.panelHead}>
                <div>
                  <p className={g.eyebrow}>Las consultas que llegan a la firma</p>
                  <h1 className={g.panelTitle}>Mis <em>consultas</em></h1>
                </div>
              </div>
              {aprobado ? (
                <LawyerChatDashboard lawyerId={user.id} canDownloadFiles={!!profile?.puede_descargar_archivos} />
              ) : (
                <div className={g.cardGlass}>
                  <p className={g.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>
                    Las consultas se habilitan cuando la administración apruebe la firma.
                  </p>
                </div>
              )}
            </section>
          )}

          {seccion === 'pagos' && (
            <section className={g.panel}>
              <div className={g.panelHead}>
                <div>
                  <p className={g.eyebrow}>Cobros a la plataforma por cada consulta</p>
                  <h1 className={g.panelTitle}>Mis <em>pagos</em></h1>
                </div>
              </div>
              <MisPagos userId={user.id} />
            </section>
          )}

          {seccion === 'perfil' && (
            <SeccionFirma aprobado={aprobado} profile={profile} userId={user.id}
              email={user?.email || profile?.email} />
          )}

          {seccion === 'interno' && (
            <section className={g.panel}>
              <div className={g.panelHead}>
                <div>
                  <p className={g.eyebrow}>Canal privado con la administración</p>
                  <h1 className={g.panelTitle}>Chat <em>interno</em></h1>
                </div>
              </div>
              <LawyerInternalChat miId={user?.id} />
            </section>
          )}
        </main>
      </div>

      {confirmLogout && (
        <div className={g.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="logoutTitle" onClick={() => setConfirmLogout(false)}>
          <div className={g.logoutModal} onClick={(e) => e.stopPropagation()}>
            <span className={g.logoutIcon}><IconLogout /></span>
            <h2 id="logoutTitle" className={g.logoutTitle}>¿Cerrar sesión?</h2>
            <p className={g.logoutText}>Saldrás del panel de la firma. Tendrás que iniciar sesión de nuevo para volver a entrar.</p>
            <div className={g.logoutActions}>
              <button type="button" className={g.logoutCancel} onClick={() => setConfirmLogout(false)}>Cancelar</button>
              <button type="button" className={g.logoutConfirm} onClick={async () => { setConfirmLogout(false); await signOut(); navigate('/') }}>Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Recorrido de la firma. El orden es obligatorio (aprobación → Director →
   equipo), así que se muestra como una ruta y no como tres avisos sueltos.
   Desaparece cuando ya hay equipo: deja de decir algo.
   ══════════════════════════════════════════════════════════════════ */
function Recorrido({ aprobado, hayDirector, hayAliados }) {
  const pasos = [
    { label: aprobado ? 'Firma aprobada' : 'Firma en revisión', hecho: aprobado },
    { label: hayDirector ? 'Director registrado' : 'Registrar Director', hecho: hayDirector },
    { label: 'Aliados y colaboradores', hecho: hayAliados },
  ]
  const actual = pasos.findIndex(p => !p.hecho)
  return (
    <div className={styles.ruta}>
      <div
        className={g.stepper}
        role="progressbar"
        aria-valuemin={1} aria-valuemax={pasos.length}
        aria-valuenow={actual === -1 ? pasos.length : actual + 1}
        aria-label={`Recorrido de la firma: ${actual === -1 ? 'completo' : pasos[actual].label}`}
      >
        {pasos.map((p, i) => {
          const state = p.hecho ? 'done' : i === actual ? 'current' : 'todo'
          return (
            <div key={p.label} className={g.step} data-state={state}>
              {i > 0 && <span className={g.stepBar} data-state={pasos[i - 1].hecho ? 'done' : 'todo'} aria-hidden="true" />}
              <span className={g.stepDot} aria-hidden="true">
                {p.hecho ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <span className={g.stepInner} />
                )}
              </span>
              <span className={`${g.stepLabel} ${styles.rutaLabel}`} data-state={state}>{p.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   1. Equipo — Director (obligatorio) + aliados/colaboradores

   Son FICHAS (tabla firma_miembros), no cuentas: la firma las crea, edita y
   borra aquí con su propia sesión (la política "firma administra su equipo").
   El Director solo se edita (lápiz): es obligatorio, así que no se elimina ni
   se "cambia" con un botón aparte; para poner a otra persona se edita su ficha.
   Las consultas, cobros y pagos son de la firma.
   ══════════════════════════════════════════════════════════════════ */
function SeccionEquipo({ aprobado, firma, userId }) {
  const [equipo, setEquipo]       = useState([])
  const [estado, setEstado]       = useState('loading')   // loading | ready | error
  const [formulario, setFormulario] = useState(null)      // { cargo, miembro } | null
  const [confirmar, setConfirmar] = useState(null)        // miembro que se va a eliminar | null
  const [ver, setVer]             = useState(null)        // miembro cuya ficha está abierta | null
  const [ocupado, setOcupado]     = useState(false)
  const [aviso, setAviso]         = useState(null)        // { tipo: 'ok' | 'error', texto }
  const [busca, setBusca]         = useState('')
  const [fOficio, setFOficio]     = useState('')          // '' | 'abogado' | 'contador'

  const cargar = useCallback(async () => {
    if (!userId) return
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/firma_miembros?firma_id=eq.${userId}&select=*&order=creado_en.asc`,
        { headers }
      )
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data)) throw new Error('sin datos')
      setEquipo(data); setEstado('ready')
    } catch {
      setEstado('error')
    }
  }, [userId])

  useEffect(() => { if (aprobado) cargar() }, [aprobado, cargar])

  // Escape cierra el diálogo abierto (si no hay una acción en curso).
  const hayDialogo = !!confirmar
  useEffect(() => {
    if (!hayDialogo) return
    const onKey = (e) => { if (e.key === 'Escape' && !ocupado) setConfirmar(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hayDialogo, ocupado])

  const director    = equipo.find(m => m.cargo === 'director') || null
  const aliados     = equipo.filter(m => m.cargo !== 'director')
  const hayAliados  = aliados.length > 0
  // Las fichas salen en el inicio cuando la firma está aprobada y tiene Director.
  const publicado   = aprobado && !!director

  // ── Filtro de aliados: texto libre + profesión ──
  const q    = sinTildes(busca).trim()
  const qNum = q.replace(/[.\s-]/g, '')
  const hayFiltro = !!(q || fOficio)
  const visibles = aliados.filter(m => {
    if (fOficio && m.rol !== fOficio) return false
    if (!q) return true
    const texto = sinTildes([m.nombre, m.apellido, m.email, m.cedula, m.telefono,
      m.area_derecho, m.ciudad, m.departamento, m.universidad].filter(Boolean).join(' '))
    if (texto.includes(q)) return true
    // "1.020.304.050" o "310 987 6543": se comparan solo los dígitos.
    return /^\d{3,}$/.test(qNum) && `${m.cedula || ''} ${m.telefono || ''}`.replace(/\D/g, ' ').replace(/ +/g, ' ').split(' ').some(n => n.includes(qNum))
  })
  const limpiarFiltro = () => { setBusca(''); setFOficio('') }

  // Escrituras directas sobre firma_miembros (la política las acota a la firma).
  async function rest(metodo, filtro, body) {
    const headers = await getAuthHeaders()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/firma_miembros?${filtro}&firma_id=eq.${userId}`, {
      method: metodo,
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(/firma_miembros_un_director/.test(String(j?.message || '')) ? 'La firma ya tiene Director.' : 'No se pudo completar la acción. Intenta de nuevo.')
    }
  }
  // Los archivos de una ficha viven en las carpetas de la firma: al borrarla se
  // limpian (si falla, no pasa nada: la ficha ya no existe).
  async function borrarArchivos(m) {
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [`${userId}/miembros/${m.id}/tarjeta.pdf`, `${userId}/miembros/${m.id}/tarjeta.png`, `${userId}/miembros/${m.id}/tarjeta.jpg`, `${userId}/miembros/${m.id}/tarjeta.jpeg`, `${userId}/miembros/${m.id}/tarjeta.webp`, `${userId}/miembros/${m.id}/disciplinario.pdf`, `${userId}/miembros/${m.id}/disciplinario.png`, `${userId}/miembros/${m.id}/disciplinario.jpg`, `${userId}/miembros/${m.id}/disciplinario.jpeg`, `${userId}/miembros/${m.id}/disciplinario.webp`] }),
      })
      await fetch(`${SUPABASE_URL}/storage/v1/object/profile-photos`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [`avatars/miembros/${m.id}.jpg`] }),
      })
    } catch { /* best-effort */ }
  }

  async function eliminar() {
    if (!confirmar || ocupado) return
    const m = confirmar
    setOcupado(true); setAviso(null)
    try {
      await rest('DELETE', `id=eq.${m.id}`)
      borrarArchivos(m)
      setAviso({ tipo: 'ok', texto: `Se eliminó la ficha de ${nombreDe(m)}.` })
      await cargar()
    } catch (err) {
      setAviso({ tipo: 'error', texto: err.message })
    } finally {
      setOcupado(false); setConfirmar(null)
    }
  }

  // "Ver perfil": la misma ficha que usa la administración. Los documentos
  // están en las carpetas de la firma, así que ella misma los puede abrir.
  const comoPerfil = (m) => ({ ...m, aprobado: true, firma_id: userId, cargo_firma: m.cargo, esMiembroFirma: true })

  const puedeSumar = aprobado && !!director

  return (
    <section className={g.panel}>
      <div className={g.panelHead}>
        <div>
          <p className={g.eyebrow}>{firma?.nombre || 'Tu firma'}</p>
          <h1 className={g.panelTitle}>Aliados y <em>colaboradores</em></h1>
        </div>
        {puedeSumar && (
          <button type="button" className={styles.btnOro} onClick={() => setFormulario({ cargo: 'aliado', miembro: null })}>
            <IconMas width="16" height="16" aria-hidden="true" />
            Registrar aliado/colaborador
          </button>
        )}
      </div>

      {!(aprobado && director && hayAliados) && (
        <Recorrido aprobado={aprobado} hayDirector={!!director} hayAliados={hayAliados} />
      )}

      {aviso && (
        <p className={aviso.tipo === 'ok' ? g.msgSuccess : g.msgError} role={aviso.tipo === 'ok' ? 'status' : 'alert'} style={{ marginBottom: '1rem' }}>
          {aviso.texto}
        </p>
      )}

      {!aprobado ? (
        <div className={g.cardGlass}>
          <div className={g.estado}>
            <span className={g.estadoIcon} data-tone="wait" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
            </span>
            <p className={g.estadoTitle}>La firma está en revisión</p>
            <p className={g.estadoDesc}>
              La administración está revisando el registro. Cuando la aprueben te avisamos por correo y aquí
              podrás registrar a tu Director y, después, a tus aliados y colaboradores.
            </p>
          </div>
        </div>
      ) : estado === 'loading' ? (
        <div className={g.cardGlass}>
          <p className={g.estadoDesc} style={{ textAlign: 'center', margin: '0 auto' }}>Cargando tu equipo…</p>
        </div>
      ) : estado === 'error' ? (
        <div className={g.cardGlass}>
          <div className={g.estado}>
            <p className={g.estadoTitle}>No pudimos cargar tu equipo</p>
            <p className={g.estadoDesc}>Revisa tu conexión y vuelve a intentar. Si sigue igual, escríbenos por el chat interno.</p>
            <button type="button" className={g.ghostBtn} style={{ alignSelf: 'center' }} onClick={() => { setEstado('loading'); cargar() }}>
              Reintentar
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Director ── */}
          <div className={`${g.cardGlass} ${styles.bloque}`}>
            <div className={g.blockHead}>
              <h2 className={g.blockTitle} style={{ margin: 0 }}>Director</h2>
              <span className={g.blockCount}>Obligatorio · uno por firma</span>
            </div>

            {!director ? (
              <div className={g.estado}>
                <span className={g.estadoIcon} data-tone="empty" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
                  </svg>
                </span>
                <p className={g.estadoTitle}>Falta el Director de la firma</p>
                <p className={g.estadoDesc}>
                  Es el primer paso y es obligatorio. Hasta que el Director esté registrado, la firma no aparece
                  en el inicio ni puede sumar aliados. Es un perfil informativo y las consultas le llegan a la firma.
                </p>
                <button type="button" className={styles.btnOro} style={{ marginTop: 8 }} onClick={() => setFormulario({ cargo: 'director', miembro: null })}>
                  Registrar al Director
                </button>
              </div>
            ) : (
              <Persona m={director} destacado publicado={publicado} onVer={() => setVer(director)}>
                <button type="button" className={styles.btnIcono2} onClick={() => setFormulario({ cargo: 'director', miembro: director })}
                  aria-label={`Editar la ficha de ${nombreDe(director)}`} title="Editar">
                  <IconLapiz aria-hidden="true" />
                </button>
              </Persona>
            )}
          </div>

          {/* ── Aliados / colaboradores ── */}
          <div className={`${g.cardGlass} ${styles.bloque}`}>
            <div className={g.blockHead}>
              <h2 className={g.blockTitle} style={{ margin: 0 }}>Aliados y colaboradores</h2>
              <span className={g.blockCount}>
                {aliados.length === 0 ? 'Sin registros'
                  : hayFiltro ? `${visibles.length} de ${aliados.length}`
                  : `${aliados.length} ${aliados.length === 1 ? 'persona' : 'personas'}`}
              </span>
            </div>

            {!director && (
              <p className={g.lockNote} style={aliados.length ? { marginBottom: '1rem' } : undefined}>
                Podrás registrar aliados y colaboradores cuando el Director de la firma esté registrado.
              </p>
            )}

            {aliados.length === 0 ? (
              director && (
                <div className={g.estado}>
                  <p className={g.estadoTitle}>Aún no has sumado a nadie</p>
                  <p className={g.estadoDesc}>
                    Registra a los abogados y contadores de tu firma. Son perfiles informativos que
                    salen en tu tarjeta del inicio, y las consultas que generen le llegan a la firma.
                  </p>
                  <button type="button" className={styles.btnOro} style={{ marginTop: 8 }} onClick={() => setFormulario({ cargo: 'aliado', miembro: null })}>
                    Registrar aliado/colaborador
                  </button>
                </div>
              )
            ) : (
              <>
                <div className={g.gFilter}>
                  <div className={g.gSearch}>
                    <svg className={g.gSearchIcon} width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                      <circle cx="6.25" cy="6.25" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M9.75 9.75L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <input className={g.gSearchInput} type="text" value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por nombre, cédula o correo"
                      aria-label="Buscar en tu equipo por nombre, cédula, correo o celular" />
                    {busca && (
                      <button type="button" className={g.gClear} onClick={() => setBusca('')} aria-label="Borrar búsqueda">×</button>
                    )}
                  </div>
                  <label className={g.gDateField}>
                    <span>Profesión</span>
                    <select className={g.gDateInput} value={fOficio} onChange={(e) => setFOficio(e.target.value)}>
                      <option value="">Todas</option>
                      <option value="abogado">Abogados</option>
                      <option value="contador">Contadores</option>
                    </select>
                  </label>
                  {hayFiltro && (
                    <button type="button" className={g.gClearAll} onClick={limpiarFiltro}>Limpiar</button>
                  )}
                </div>

                {visibles.length === 0 ? (
                  <p className={styles.sinResultados} role="status">
                    Nadie de tu equipo coincide con ese filtro.
                  </p>
                ) : (
                  <ul className={styles.lista}>
                    {visibles.map(m => (
                      <li key={m.id}>
                        <Persona m={m} publicado={publicado} onVer={() => setVer(m)}>
                          <button type="button" className={styles.btnIcono2} onClick={() => setFormulario({ cargo: 'aliado', miembro: m })}
                            aria-label={`Editar la ficha de ${nombreDe(m)}`} title="Editar">
                            <IconLapiz aria-hidden="true" />
                          </button>
                          <button type="button" className={`${styles.btnIcono2} ${styles.btnPeligro}`} onClick={() => setConfirmar(m)}
                            aria-label={`Eliminar a ${nombreDe(m)}`} title="Eliminar">
                            <IconBasura aria-hidden="true" />
                          </button>
                        </Persona>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </>
      )}

      {formulario && (
        <MiembroFirmaModal
          firmaId={userId}
          cargo={formulario.cargo}
          miembro={formulario.miembro}
          onClose={() => setFormulario(null)}
          onGuardado={() => {
            setAviso({ tipo: 'ok', texto: formulario.miembro ? 'La ficha quedó actualizada.' : `${formulario.cargo === 'director' ? 'El Director' : 'El aliado/colaborador'} quedó registrado.` })
            cargar()
          }}
        />
      )}

      {ver && (
        <ProfileDetailModal profile={comoPerfil(ver)} onClose={() => setVer(null)} />
      )}

      {/* ── Eliminar a alguien del equipo ── */}
      {confirmar && createPortal((
        <div className={pStyles.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="confTitulo"
          onClick={() => { if (!ocupado) setConfirmar(null) }}>
          <div className={pStyles.logoutModal} onClick={(e) => e.stopPropagation()}>
            <span className={pStyles.logoutIcon} aria-hidden="true"><IconBasura /></span>
            <h2 id="confTitulo" className={pStyles.logoutTitle}>¿Eliminar a {nombreDe(confirmar)}?</h2>
            <p className={pStyles.logoutText}>
              Su ficha desaparece de la tarjeta de la firma. No se puede deshacer.
            </p>
            <div className={pStyles.logoutActions}>
              <button type="button" className={pStyles.logoutCancel} disabled={ocupado}
                onClick={() => setConfirmar(null)}>Cancelar</button>
              <button type="button" className={pStyles.logoutConfirm} disabled={ocupado} onClick={eliminar}>
                {ocupado ? 'Un momento…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

    </section>
  )
}

// Fila de una persona del equipo, en tres columnas: quién es (abre su
// ficha) · estado · acciones (`children`).
function Persona({ m, destacado = false, publicado = false, onVer, children }) {
  const lugar = [m.ciudad, m.departamento].filter(Boolean).join(', ')
  return (
    <div className={`${styles.persona} ${destacado ? styles.personaDestacada : ''}`}>
      <button type="button" className={styles.personaVer} onClick={onVer}
        aria-label={`Ver la ficha de ${nombreDe(m)}`}>
        <span className={styles.avatar} aria-hidden="true">
          {m.foto_url
            ? <img src={m.foto_url} alt="" width="56" height="56" loading="lazy" decoding="async" />
            : iniciales(m)}
        </span>
        <span className={styles.personaInfo}>
          <span className={styles.personaNombre}>
            <span className={styles.personaNombreTxt}>{nombreDe(m)}</span>
            <span className={g.histRol} data-rol={m.rol === 'contador' ? 'contador' : undefined}>{oficio(m.rol)}</span>
          </span>
          {(m.area_derecho || lugar) && (
            <span className={styles.personaMeta}>{[m.area_derecho, lugar].filter(Boolean).join(' · ')}</span>
          )}
          {m.email && <span className={styles.personaCorreo}>{m.email}</span>}
        </span>
      </button>
      <span className={styles.personaEstado}>
        <span className={publicado ? g.histBadgeOk : g.histBadgeNeutral}
          title={publicado ? 'Sale en la tarjeta de la firma en el inicio' : 'Saldrá en el inicio cuando la firma esté aprobada y tenga Director'}>
          {publicado ? 'Publicado' : 'Sin publicar'}
        </span>
      </span>
      <span className={styles.personaAccion}>{children}</span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   2. Mi firma — datos públicos, alcance, video, documentos y cuenta
   ══════════════════════════════════════════════════════════════════ */
function SeccionFirma({ aprobado, profile, userId, email }) {
  const { refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()

  const [descripcion, setDescripcion] = useState('')
  const [alcance, setAlcance]         = useState('')
  const [telefono, setTelefono]       = useState('')
  const [direccion, setDireccion]     = useState('')
  const [web, setWeb]                 = useState('')
  const [areas, setAreas]             = useState([])
  const [areaOtraOn, setAreaOtraOn]   = useState(false)
  const [areaOtraTexto, setAreaOtraTexto] = useState('')
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)
  const [error, setError]     = useState(null)
  const [subiendo, setSubiendo] = useState('')   // 'logo' | 'video' | 'camara' | 'banco' | ''
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [entiendo, setEntiendo] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const logoRef = useRef(null)
  const videoRef = useRef(null)

  const TODAS_AREAS = [...AREAS_DERECHO, ...AREAS_CONTADURIA]

  useEffect(() => {
    if (!profile) return
    setDescripcion(profile.descripcion || '')
    setAlcance(profile.alcance_servicio || '')
    setTelefono(profile.telefono || '')
    setDireccion(profile.direccion_oficina || '')
    setWeb(profile.pagina_web || '')
    // Lo guardado que no está en las listas es el texto de "Otro".
    const guardadas = profile.area_derecho ? profile.area_derecho.split(',').map(a => a.trim()).filter(Boolean) : []
    setAreas(guardadas.filter(a => TODAS_AREAS.includes(a) && a !== 'Otro'))
    const libres = guardadas.filter(a => !TODAS_AREAS.includes(a))
    setAreaOtraOn(libres.length > 0)
    setAreaOtraTexto(libres.join(', '))
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const telVal = validarCelular(telefono)
  const toggleArea = (a) => {
    if (a === 'Otro') { setAreaOtraOn(v => !v); if (areaOtraOn) setAreaOtraTexto(''); return }
    setAreas(prev => (prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]))
  }
  const areasFinales = areas.concat(areaOtraOn && areaOtraTexto.trim() ? [areaOtraTexto.trim()] : [])

  async function patch(payload) {
    const headers = await getAuthHeaders()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('No se pudieron guardar los cambios.')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError(null); setMsg(null)
    if (descripcion.trim().length < DESCRIPCION_MIN) {
      setError(`La presentación necesita al menos ${DESCRIPCION_MIN} caracteres. Es lo que los clientes leen en la tarjeta de la firma.`); return
    }
    if (!alcance) { setError('Indica si la firma atiende a nivel nacional, internacional o ambos.'); return }
    if (areaOtraOn && !areaOtraTexto.trim()) { setError('Escribe cuál es esa otra área de trabajo.'); return }
    if (telVal.valid !== true) { setError('El celular debe tener 10 dígitos y empezar por 3.'); return }
    setSaving(true)
    try {
      await patch({
        descripcion: descripcion.trim(),
        alcance_servicio: alcance,
        telefono,
        direccion_oficina: direccion.trim() || null,
        pagina_web: web.trim() || null,
        area_derecho: areasFinales.length ? areasFinales.join(', ') : null,
      })
      await refreshProfile()
      setMsg('Los datos de la firma quedaron actualizados.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function cambiarLogo(e) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    if (!raw.type.startsWith('image/')) { setError('El logo debe ser una imagen.'); return }
    setSubiendo('logo'); setError(null); setMsg(null)
    try {
      const file = await logoSobreBlanco(raw)
      const headers = await getAuthHeaders()
      const path = `avatars/${userId}.jpg`
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/profile-photos/${path}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file,
      })
      if (!res.ok) throw new Error('No se pudo subir el logo.')
      await patch({ foto_url: `${SUPABASE_URL}/storage/v1/object/public/profile-photos/${path}?t=${Date.now()}` })
      await refreshProfile()
      setMsg('Logo actualizado.')
    } catch (err) {
      setError(err.message || 'No se pudo procesar el logo.')
    } finally {
      setSubiendo('')
    }
  }

  // Video de presentación (opcional): mismo bucket y misma ruta que usa un
  // profesional (profile-videos/videos/<uid>), así el inicio lo muestra igual.
  async function cambiarVideo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('video/')) { setError('El archivo debe ser un video.'); return }
    if (file.size / (1024 * 1024) > MAX_VIDEO_MB) { setError(`El video no puede superar ${MAX_VIDEO_MB} MB.`); return }
    setSubiendo('video'); setError(null); setMsg(null)
    try {
      const headers = await getAuthHeaders()
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
      const path = `videos/${userId}.${ext}`
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/profile-videos/${path}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file,
      })
      if (!res.ok) throw new Error(`No se pudo subir el video (error ${res.status}).`)
      await patch({ video_url: `${SUPABASE_URL}/storage/v1/object/public/profile-videos/${path}?t=${Date.now()}` })
      await refreshProfile()
      setMsg('Video de presentación actualizado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo('')
    }
  }
  async function quitarVideo() {
    setSubiendo('video'); setError(null); setMsg(null)
    try {
      await patch({ video_url: null })
      await refreshProfile()
      setMsg('Video retirado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo('')
    }
  }

  // Cámara de comercio y certificado bancario: mismo bucket privado y misma
  // carpeta (<uid>/…) que usan todos los perfiles.
  async function subirDocumento(file, { base, columna, clave }) {
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const permitido = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)
    if (!permitido) { setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setError('El archivo no puede superar 10 MB.'); return }
    setSubiendo(clave); setError(null); setMsg(null)
    try {
      const headers = await getAuthHeaders()
      const path = `${userId}/${base}.${ext}`
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file,
      })
      if (!res.ok) throw new Error(`No se pudo subir el archivo (error ${res.status}).`)
      await patch({ [columna]: path })
      await refreshProfile()
      setMsg('Documento actualizado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo('')
    }
  }

  // Eliminar la cuenta: lo hace el servidor (borra el acceso y el equipo y
  // marca la fila; el historial de consultas y pagos queda en la
  // administración). Al terminar se cierra la sesión.
  async function eliminarCuenta() {
    if (!entiendo || deleting) return
    setDeleting(true); setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'firma_eliminar_cuenta' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'No se pudo eliminar la cuenta. Intenta de nuevo.')
      try { await signOut() } catch { /* el acceso ya no existe */ }
      navigate('/')
    } catch (err) {
      setError(err.message)
      setDeleting(false); setConfirmDelete(false)
    }
  }

  return (
    <section className={pStyles.panel}>
      <div className={pStyles.panelHead}>
        <h1 className={pStyles.panelTitle}>Mi <em>Firma</em></h1>
        <span className={pStyles.status}>
          {aprobado ? '✦ Aprobada' : '◌ Pendiente de aprobación'}
        </span>
      </div>

      <form className={pStyles.form} onSubmit={handleSave}>

        {/* ── Identidad: logo y datos de registro (no se editan aquí) ── */}
        <aside className={g.identityCol}>
          <div className={styles.logoBox}>
            {profile?.foto_url
              ? <img src={profile.foto_url} alt={`Logo de ${profile?.nombre || 'la firma'}`} />
              : <span aria-hidden="true">{(profile?.nombre || 'F').charAt(0).toUpperCase()}</span>}
          </div>
          <button type="button" className="btn-ghost" disabled={subiendo === 'logo'} onClick={() => logoRef.current?.click()}>
            {subiendo === 'logo' ? 'Subiendo…' : profile?.foto_url ? 'Cambiar logo' : 'Subir logo'}
          </button>
          <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={cambiarLogo} />

          <p className={g.identityName}>{profile?.nombre || 'Firma'}</p>
          <span className={aprobado ? g.identityBadgeOk : g.identityBadgePend}>
            {aprobado ? 'Firma aprobada' : 'Pendiente de aprobación'}
          </span>
          <dl className={g.identityList}>
            <div className={g.identityRow}><dt>NIT</dt><dd>{profile?.nit || '—'}</dd></div>
            <div className={g.identityRow}><dt>Correo</dt><dd>{email || '—'}</dd></div>
            <div className={g.identityRow}><dt>Sede</dt><dd>{[profile?.ciudad, profile?.departamento].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
        </aside>

        {/* ── Lo que la firma mantiene al día ── */}
        <div className={g.formMain}>

          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <label className={pStyles.label} htmlFor="firma-desc">
              Presentación
              <span className={pStyles.optional}>Lo primero que lee un cliente</span>
            </label>
            <textarea
              id="firma-desc"
              className={pStyles.input}
              rows={5}
              maxLength={DESCRIPCION_MAX}
              placeholder="Qué hace la firma, a quién atiende y en qué casos tiene más recorrido."
              value={descripcion}
              onChange={e => setDescripcion(e.target.value.slice(0, DESCRIPCION_MAX))}
              style={{ resize: 'vertical', minHeight: 120, lineHeight: 1.6 }}
            />
            <span className={`${pStyles.charCount} ${descripcion.length >= DESCRIPCION_MAX - 20 ? pStyles.charCountWarn : ''}`}>
              {descripcion.length}/{DESCRIPCION_MAX}
            </span>
          </div>

          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <span className={pStyles.label} id="firma-alcance">¿Cómo prestan el servicio?</span>
            <div className={reg.alcance} role="radiogroup" aria-labelledby="firma-alcance">
              {OPCIONES_ALCANCE.map(({ v, t, d }) => (
                <label key={v} className={`${reg.alcanceOp} ${alcance === v ? reg.alcanceOpActiva : ''}`}>
                  <input type="radio" name="firma-alcance" value={v} checked={alcance === v}
                    onChange={() => setAlcance(v)} className={reg.alcanceRadio} />
                  <span className={reg.alcanceTxt}><strong>{t}</strong><span>{d}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <span className={pStyles.label}>
              Áreas de trabajo
              <span className={pStyles.optional}>{areasFinales.length} seleccionada{areasFinales.length === 1 ? '' : 's'}</span>
            </span>
            <div className={reg.areasBox}>
              <span className={reg.areasGrupo}>Derecho</span>
              {AREAS_DERECHO.map(a => (
                <label key={`d-${a}`} className={reg.areaItem}>
                  <input type="checkbox" className={reg.areaCheck} checked={areas.includes(a)} onChange={() => toggleArea(a)} />
                  <span>{a}</span>
                </label>
              ))}
              <span className={reg.areasGrupo}>Contaduría</span>
              {AREAS_CONTADURIA.filter(a => !AREAS_DERECHO.includes(a)).map(a => (
                <label key={`c-${a}`} className={reg.areaItem}>
                  <input type="checkbox" className={reg.areaCheck}
                    checked={a === 'Otro' ? areaOtraOn : areas.includes(a)} onChange={() => toggleArea(a)} />
                  <span>{a}</span>
                </label>
              ))}
            </div>
            {areaOtraOn && (
              <input type="text" className={pStyles.input} style={{ marginTop: '0.6rem' }} maxLength={60}
                placeholder="Escribe esa otra área de trabajo" aria-label="Otra área de trabajo"
                value={areaOtraTexto} onChange={e => setAreaOtraTexto(e.target.value)} />
            )}
          </div>

          <div className={styles.dosCols}>
            <div className={pStyles.field} style={{ marginBottom: 0 }}>
              <label className={pStyles.label} htmlFor="firma-tel">Celular de contacto</label>
              <input id="firma-tel" type="tel" inputMode="numeric" className={pStyles.input} maxLength={10}
                placeholder="3001234567" value={telefono}
                onChange={e => setTelefono(normalizarCelular(e.target.value))} />
            </div>
            <div className={pStyles.field} style={{ marginBottom: 0 }}>
              <label className={pStyles.label} htmlFor="firma-web">
                Página web <span className={pStyles.optional}>(opcional)</span>
              </label>
              <input id="firma-web" type="url" className={pStyles.input} placeholder="https://tufirma.com"
                value={web} onChange={e => setWeb(e.target.value)} />
            </div>
          </div>

          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <label className={pStyles.label} htmlFor="firma-dir">
              Dirección de la oficina <span className={pStyles.optional}>(opcional)</span>
            </label>
            <input id="firma-dir" type="text" className={pStyles.input} placeholder="Cra 7 # 12-34, oficina 501, Bogotá"
              value={direccion} onChange={e => setDireccion(e.target.value)} />
          </div>

          {/* Video de presentación: opcional, sale en la tarjeta de la firma. */}
          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <span className={pStyles.label}>
              Video de presentación
              <span className={pStyles.optional}>(opcional — máx. {MAX_VIDEO_MB} MB)</span>
            </span>
            {profile?.video_url && (
              <video src={profile.video_url} controls preload="metadata" className={pStyles.videoPreview} />
            )}
            <div className={styles.filaBotones}>
              <button type="button" className="btn-ghost" disabled={subiendo === 'video'} onClick={() => videoRef.current?.click()}>
                {subiendo === 'video' ? 'Un momento…' : profile?.video_url ? 'Cambiar video' : 'Subir video'}
              </button>
              {profile?.video_url && (
                <button type="button" className={styles.btnTexto} disabled={subiendo === 'video'} onClick={quitarVideo}>
                  Quitar video
                </button>
              )}
            </div>
            <input ref={videoRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={cambiarVideo} />
          </div>

          {/* Documentos: los mismos que revisó la administración al aprobar. */}
          <div className={pStyles.field} style={{ marginBottom: 0 }}>
            <span className={pStyles.label}>
              Documentos
              <span className={pStyles.optional}>PDF o imagen · máx. 10 MB</span>
            </span>
            <div className={docStyles.grid}>
              <Documento
                label="Cámara de comercio"
                path={profile?.camara_comercio_url}
                subiendo={subiendo === 'camara'}
                onArchivo={(f) => subirDocumento(f, { base: 'camara-comercio', columna: 'camara_comercio_url', clave: 'camara' })}
              />
              <Documento
                label="Certificado bancario"
                path={profile?.certificado_bancario_url}
                subiendo={subiendo === 'banco'}
                onArchivo={(f) => subirDocumento(f, { base: 'certificados/certificado', columna: 'certificado_bancario_url', clave: 'banco' })}
              />
            </div>
          </div>

          {error && <p className={g.msgError} role="alert">{error}</p>}
          {msg   && <p className={g.msgSuccess} role="status">{msg}</p>}

          <div className={g.actionsRow}>
            <button type="submit" className="btn-solid btn-lg" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button type="button" className={pStyles.deleteBtn} onClick={() => { setEntiendo(false); setConfirmDelete(true) }}>
              Eliminar cuenta
            </button>
          </div>
        </div>
      </form>

      {/* Portal a <body>: la tarjeta del formulario lleva backdrop-filter y
          anclaría un position:fixed (mismo motivo que en ProfilePage). */}
      {confirmDelete && createPortal((
        <div className={pStyles.logoutOverlay} role="dialog" aria-modal="true" aria-labelledby="delTitulo"
          onClick={() => { if (!deleting) setConfirmDelete(false) }}>
          <div className={`${pStyles.logoutModal} ${styles.dialogo}`} onClick={(e) => e.stopPropagation()}>
            <span className={pStyles.logoutIcon} aria-hidden="true"><IconBasura /></span>
            <h2 id="delTitulo" className={pStyles.logoutTitle} style={{ textAlign: 'center' }}>¿Eliminar la cuenta de la firma?</h2>
            <p className={pStyles.logoutText}>
              La firma deja de existir en Parada Bridge. Se borra su acceso, su tarjeta sale del inicio y los perfiles de
              su Director y aliados se eliminan. La administración conserva el historial de consultas y pagos
              para sus registros. <strong>No se puede deshacer.</strong>
            </p>
            <label className={styles.entiendo}>
              <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} disabled={deleting} />
              <span>Entiendo que la cuenta se elimina de forma definitiva.</span>
            </label>
            <div className={pStyles.logoutActions}>
              <button type="button" className={pStyles.logoutCancel} disabled={deleting}
                onClick={() => setConfirmDelete(false)}>Cancelar</button>
              <button type="button" className={pStyles.logoutConfirm} disabled={deleting || !entiendo} onClick={eliminarCuenta}>
                {deleting ? 'Eliminando…' : 'Eliminar cuenta'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </section>
  )
}

// Un documento de la firma: vista previa (bucket privado → enlace firmado al
// vuelo) y botón para subirlo o reemplazarlo.
function Documento({ label, path, subiendo, onArchivo }) {
  const inputRef = useRef(null)
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!path) { setUrl(null); return }
    if (/^https?:\/\//.test(path)) { setUrl(path); return }
    let cancel = false
    ;(async () => {
      const { data } = await supabase.storage.from('tarjetas-profesionales').createSignedUrl(path, 3600)
      if (!cancel) setUrl(data?.signedUrl || null)
    })()
    return () => { cancel = true }
  }, [path])

  return (
    <div className={docStyles.doc}>
      <span className={docStyles.label}>{label}</span>
      {path ? (
        url
          ? <TarjetaPreview key={path} displayUrl={url} storagePath={path} label={label} />
          : <div className={docStyles.signing}>Generando enlace seguro…</div>
      ) : (
        <button type="button" className={docStyles.empty} disabled={subiendo} onClick={() => inputRef.current?.click()}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" />
          </svg>
          {subiendo ? 'Subiendo…' : 'Sin archivo'}
        </button>
      )}
      <button type="button" className="btn-ghost" disabled={subiendo} onClick={() => inputRef.current?.click()}>
        {subiendo ? 'Subiendo…' : path ? 'Cambiar archivo' : 'Subir archivo'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onArchivo(f) }}
      />
    </div>
  )
}
