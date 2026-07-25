import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import { IconCheck, IconX, IconQR } from '../shared/Icons'
import SocialLinks from '../profile/SocialLinks'
import CodigosReferencia from './CodigosReferencia'
import styles from './GestoresAdmin.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ── Iconos locales (mismo estilo stroke Lucide del set compartido) ── */
const IconUsers = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <circle cx="5.75" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.5 13.5c0-2.35 1.9-3.75 4.25-3.75S10 11.15 10 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M10.75 3.1a2.5 2.5 0 010 4.8M11.75 9.9c1.75.35 2.75 1.65 2.75 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)
const IconSearch = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="none" aria-hidden="true"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <circle cx="6.25" cy="6.25" r="4.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9.75 9.75L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

// Normaliza cédula/texto para búsqueda (sin puntos, espacios ni tildes, minúsculas).
const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const normCedula = (s) => (s || '').toString().replace(/[.\s]/g, '')

const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(n) || 0)

const fmtFecha = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

// Estados de una sala que cuentan como "en curso".
const EN_CURSO = new Set(['waiting', 'active', 'open'])

export default function GestoresAdmin({ onChange }) {
  const [gestores, setGestores]   = useState([])
  const [codigos, setCodigos]     = useState([])   // códigos de comisionista/gestor (no plataforma)
  const [rooms, setRooms]         = useState([])    // chat_rooms con código (para trazabilidad)
  const [cobros, setCobros]       = useState([])    // gestor_cobros
  const [meId, setMeId]           = useState(null)  // id del superadmin (created_by)
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')
  const [expanded, setExpanded]   = useState(null)  // id del gestor expandido

  // ── Sub-pestañas + filtros instantáneos ──
  const [sub, setSub]             = useState('gestores') // 'codigos' | 'gestores'
  const [qGestor, setQGestor]     = useState('')         // filtro gestores
  const [estadoFilter, setEstadoFilter] = useState('todos') // 'todos'|'aprobados'|'pendientes'
  const [qCodigo, setQCodigo]     = useState('')         // filtro códigos

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      // id del superadmin actual (para gestor_cobros.created_by)
      try {
        const s = await supabase.auth.getSession()
        setMeId(s?.data?.session?.user?.id || s?.session?.user?.id || null)
      } catch { /* noop */ }

      const [gRes, cRes, rRes, coRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?rol=eq.gestor&select=*&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?es_plataforma=eq.false&select=id,codigo,gestor_id,nombre,apellido&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?codigo_referencia=not.is.null&select=id,codigo_referencia,status,resultado,client_nombre,created_at&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/gestor_cobros?select=*&order=created_at.desc`, { headers }),
      ])
      const g  = await gRes.json()
      const c  = await cRes.json()
      const r  = await rRes.json()
      const co = await coRes.json()
      setGestores(Array.isArray(g) ? g : [])
      setCodigos(Array.isArray(c) ? c : [])
      setRooms(Array.isArray(r) ? r : [])
      setCobros(Array.isArray(co) ? co : [])
    } catch { /* noop */ }
    finally { setLoading(false) }
  }

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 2800) }

  async function setAprobado(id, valor) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ aprobado: valor }),
    })
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: valor ? 'account_approved' : 'account_rejected', data: { lawyerId: id } }),
      })
    } catch { /* secundario */ }
    flash(valor ? 'Gestor aprobado.' : 'Gestor rechazado.')
    await cargar(); onChange?.()
  }

  // Asigna (o quita) un código de referencia a un gestor. Un gestor tiene a lo
  // sumo un código; asignar uno nuevo libera el anterior automáticamente.
  async function asignarCodigo(gestorId, codigoId) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?gestor_id=eq.${gestorId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ gestor_id: null }),
    })
    if (codigoId) {
      await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?id=eq.${codigoId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ gestor_id: gestorId }),
      })
    }
    flash(codigoId ? 'Código asignado.' : 'Código liberado.')
    await cargar()
  }

  // Marca el resultado de una consulta cerrada (éxito/fracaso) — alimenta las stats.
  async function marcarResultado(roomId, resultado) {
    const headers = await getAuthHeaders()
    // Optimista: refleja el cambio local para que las stats se recalculen al instante.
    setRooms(rs => rs.map(r => r.id === roomId ? { ...r, resultado } : r))
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${roomId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ resultado, resultado_at: new Date().toISOString() }),
    })
    flash(resultado === 'exito' ? 'Marcado como éxito.' : 'Marcado como fracaso.')
  }

  // Inserta un cobro acumulado para el gestor (estado pendiente).
  async function guardarCobro({ gestorId, codigo, casos, monto, nota }) {
    const headers = await getAuthHeaders()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gestor_cobros`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        gestor_id: gestorId,
        codigo: codigo || null,
        casos_exitosos: Number(casos) || 0,
        monto: Number(monto) || 0,
        nota: nota?.trim() || null,
        estado: 'pendiente',
        created_by: meId || null,
      }),
    })
    if (!res.ok) { flash('No se pudo guardar el cobro.'); return false }

    // Notifica en la campana del admin (mejor esfuerzo: no bloquea ni revierte
    // el cobro si la política RLS aún no está aplicada o el insert falla).
    try {
      const gestor = gestores.find(g => g.id === gestorId)
      const nombreGestor =
        (gestor?.username ? `@${gestor.username}` : null) ||
        [gestor?.nombre, gestor?.apellido].filter(Boolean).join(' ') ||
        'gestor'
      await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          tipo: 'cobro',
          gestor_id: gestorId,
          monto: Number(monto) || 0,
          client_nombre: nombreGestor,
          area: codigo || null,
          mensaje: `Cobro registrado: ${Number(casos) || 0} caso(s) exitoso(s) del gestor ${nombreGestor}.`,
        }),
      })
    } catch (e) {
      console.warn('No se pudo crear la notificación de cobro (se ignora):', e)
    }

    flash('Cobro guardado.')
    await cargar()
    return true
  }

  async function marcarPagado(cobroId) {
    const headers = await getAuthHeaders()
    setCobros(cs => cs.map(c => c.id === cobroId ? { ...c, estado: 'pagado' } : c))
    await fetch(`${SUPABASE_URL}/rest/v1/gestor_cobros?id=eq.${cobroId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ estado: 'pagado' }),
    })
    flash('Cobro marcado como pagado.')
  }

  const codigoDeGestor = (gid) => codigos.find(c => c.gestor_id === gid) || null

  // Índice de salas por código (para trazabilidad rápida).
  const roomsPorCodigo = useMemo(() => {
    const m = new Map()
    for (const r of rooms) {
      const k = r.codigo_referencia
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }, [rooms])

  const cobrosDeGestor = (gid) => cobros.filter(c => c.gestor_id === gid)

  if (loading) return <p className={styles.empty}>Cargando gestores…</p>

  const pendientes = gestores.filter(g => !g.aprobado)

  // ── Filtro instantáneo de gestores (nombre, apellido, usuario, correo, cédula) ──
  const qG = norm(qGestor)
  const qCed = normCedula(qGestor)
  const gestoresFiltrados = gestores.filter(g => {
    if (estadoFilter === 'aprobados' && !g.aprobado) return false
    if (estadoFilter === 'pendientes' && g.aprobado) return false
    if (!qG) return true
    const enTexto = [g.username, g.nombre, g.apellido, g.email]
      .some(v => norm(v).includes(qG))
    const enCedula = qCed && normCedula(g.cedula).includes(qCed)
    return enTexto || enCedula
  })

  // ── Filtro instantáneo de códigos (código o nombre del comisionista) ──
  const qC = norm(qCodigo)
  const codigosFiltrados = codigos.filter(c => {
    if (!qC) return true
    return [c.codigo, c.nombre, c.apellido].some(v => norm(v).includes(qC))
  })

  return (
    <div className={styles.screen}>

      {/* ═══ Control de sub-pestañas segmentado ═══ */}
      <div className={styles.subTabs} role="tablist" aria-label="Secciones de gestores">
        <button
          role="tab"
          aria-selected={sub === 'codigos'}
          className={`${styles.subTab} ${sub === 'codigos' ? styles.subTabActive : ''}`}
          onClick={() => setSub('codigos')}
        >
          <IconQR /> Códigos
          <span className={styles.subTabBadge}>{codigos.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={sub === 'gestores'}
          className={`${styles.subTab} ${sub === 'gestores' ? styles.subTabActive : ''}`}
          onClick={() => setSub('gestores')}
        >
          <IconUsers /> Gestores
          <span className={styles.subTabBadge}>{gestores.length}</span>
        </button>
      </div>

      {/* ═══ Sub-pestaña: Códigos de referencia (oficial + comisionistas) ═══ */}
      {sub === 'codigos' && (
        <section className={styles.section}>
          {/* El propio <CodigosReferencia/> ya renderiza su título
              "CÓDIGOS DE REFERENCIA"; aquí sólo aportamos el eyebrow de la
              plataforma y una descripción de contexto (sin duplicar el título). */}
          <header className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Plataforma · Comisionistas</span>
            <p className={styles.sectionSub}>
              El código oficial de la plataforma y los códigos QR de comisionistas. Los códigos que
              crees aquí luego se asignan a un gestor en la pestaña <strong>Gestores</strong>.
            </p>
          </header>

          {/* Filtro instantáneo (resumen de códigos a nivel de este panel) */}
          <div className={styles.filterBar}>
            <span className={styles.searchIcon}><IconSearch /></span>
            <input
              className={styles.searchInput}
              type="text"
              value={qCodigo}
              onChange={e => setQCodigo(e.target.value)}
              placeholder="Buscar código o nombre…"
              aria-label="Buscar código o nombre"
            />
            {qCodigo && (
              <button className={styles.searchClear} onClick={() => setQCodigo('')} aria-label="Limpiar búsqueda">
                <IconX />
              </button>
            )}
          </div>

          {/* Resumen filtrable de códigos de comisionistas (la gestión completa vive en el módulo de abajo) */}
          {qCodigo.trim() !== '' && (
            <div className={styles.codeSummary}>
              {codigosFiltrados.length === 0 ? (
                <p className={styles.summaryEmpty}>Ningún código coincide con «{qCodigo}».</p>
              ) : (
                <>
                  <p className={styles.summaryHead}>
                    {codigosFiltrados.length} de {codigos.length} código{codigos.length === 1 ? '' : 's'} coincide{codigosFiltrados.length === 1 ? '' : 'n'}
                  </p>
                  <ul className={styles.summaryList}>
                    {codigosFiltrados.map(c => (
                      <li key={c.id} className={styles.summaryItem}>
                        <span className={`${styles.summaryCode} ${styles.mono}`}>{c.codigo}</span>
                        <span className={styles.summaryName}>
                          {[c.nombre, c.apellido].filter(Boolean).join(' ') || <em className={styles.muted}>Sin nombre</em>}
                        </span>
                        {c.gestor_id && <span className={styles.summaryAssigned}>Asignado</span>}
                      </li>
                    ))}
                  </ul>
                  <p className={styles.summaryHint}>
                    Usa el módulo de abajo para ver el QR, descargar o editar cada código.
                  </p>
                </>
              )}
            </div>
          )}

          <div className={styles.codesHost}>
            <CodigosReferencia />
          </div>
        </section>
      )}

      {/* ═══ Sub-pestaña: Gestores ═══ */}
      {sub === 'gestores' && (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <div className={styles.sectionHeadRow}>
              <div>
                <span className={styles.sectionKicker}>Gestores</span>
                <h2 className={styles.sectionTitle}>Gestores registrados</h2>
                <p className={styles.sectionSub}>
                  Aprueba registros, asígnales un código, revisa su trazabilidad y registra sus cobros.
                </p>
              </div>
              <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
            </div>
            {pendientes.length > 0 && (
              <span className={styles.pendPill}>{pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'} de aprobación</span>
            )}
          </header>

          {/* Filtro instantáneo + chips de estado */}
          <div className={styles.filterRow}>
            <div className={styles.filterBar}>
              <span className={styles.searchIcon}><IconSearch /></span>
              <input
                className={styles.searchInput}
                type="text"
                value={qGestor}
                onChange={e => setQGestor(e.target.value)}
                placeholder="Buscar por nombre o cédula…"
                aria-label="Buscar por nombre o cédula"
              />
              {qGestor && (
                <button className={styles.searchClear} onClick={() => setQGestor('')} aria-label="Limpiar búsqueda">
                  <IconX />
                </button>
              )}
            </div>
            <div className={styles.statusChips} role="group" aria-label="Filtrar por estado">
              {[
                { k: 'todos', label: 'Todos', n: gestores.length },
                { k: 'aprobados', label: 'Aprobados', n: gestores.length - pendientes.length },
                { k: 'pendientes', label: 'Pendientes', n: pendientes.length },
              ].map(({ k, label, n }) => (
                <button
                  key={k}
                  className={`${styles.statusChip} ${estadoFilter === k ? styles.statusChipActive : ''}`}
                  onClick={() => setEstadoFilter(k)}
                  aria-pressed={estadoFilter === k}
                >
                  {label} <span className={styles.chipCount}>{n}</span>
                </button>
              ))}
            </div>
          </div>

          {msg && <p className={styles.msgOk}>{msg}</p>}

          {gestores.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyTxt}>No hay gestores registrados aún</p>
              <p className={styles.emptySub}>Cuando alguien se registre como gestor aparecerá aquí</p>
            </div>
          ) : gestoresFiltrados.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyTxt}>Ningún gestor coincide con el filtro</p>
              <p className={styles.emptySub}>Ajusta la búsqueda o el estado seleccionado</p>
            </div>
          ) : (
            <div className={styles.list}>
              {gestoresFiltrados.map(g => {
                const asignado = codigoDeGestor(g.id)
                const codeStr  = asignado?.codigo || null
                const gRooms   = codeStr ? (roomsPorCodigo.get(codeStr) || []) : []
                const usage    = gRooms.length
                return (
                  <GestorCard
                    key={g.id}
                    gestor={g}
                    asignado={asignado}
                    codigos={codigos}
                    usage={usage}
                    rooms={gRooms}
                    cobros={cobrosDeGestor(g.id)}
                    onToggle={() => setExpanded(g.id)}
                    onAprobar={setAprobado}
                    onAsignar={asignarCodigo}
                    onMarcarResultado={marcarResultado}
                    onGuardarCobro={guardarCobro}
                    onMarcarPagado={marcarPagado}
                  />
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Modal de detalle del gestor (perfil + trazabilidad + cobros) */}
      {(() => {
        if (!expanded) return null
        const g = gestores.find(x => x.id === expanded)
        if (!g || !g.aprobado) return null
        const asignado = codigoDeGestor(g.id)
        const codeStr = asignado?.codigo || null
        const gRooms = codeStr ? (roomsPorCodigo.get(codeStr) || []) : []
        return (
          <GestorDetalleModal
            gestor={g}
            codeStr={codeStr}
            usage={gRooms.length}
            rooms={gRooms}
            cobros={cobrosDeGestor(g.id)}
            onClose={() => setExpanded(null)}
            onMarcarResultado={marcarResultado}
            onGuardarCobro={guardarCobro}
            onMarcarPagado={marcarPagado}
            onAprobar={setAprobado}
          />
        )
      })()}

    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Tarjeta de gestor — cabecera + panel expandible (stats + cobros)
   ══════════════════════════════════════════════════════════════════ */
function GestorCard({
  gestor: g, asignado, codigos, usage, rooms, cobros,
  onToggle, onAprobar, onAsignar, onMarcarResultado, onGuardarCobro, onMarcarPagado,
}) {
  const codeStr = asignado?.codigo || null

  return (
    <div className={styles.card}>
      {/* Cabecera */}
      <div className={styles.cardTop}>
        <div className={styles.info}>
          <div className={styles.avatar}>{(g.username?.[0] || 'G').toUpperCase()}</div>
          <div className={styles.details}>
            <p className={styles.nombre}>
              @{g.username || '—'}
              <span className={`${styles.estado} ${g.aprobado ? styles.estadoOk : styles.estadoWait}`}>
                {g.aprobado ? 'Aprobado' : 'Pendiente'}
              </span>
            </p>
            <p className={styles.meta}>{g.email}{g.cedula ? ` · CC ${g.cedula}` : ''}</p>
            <div className={styles.tagRow}>
              {codeStr ? (
                <span className={styles.asignadoTag}>Código <strong>{codeStr}</strong></span>
              ) : (
                <span className={styles.noCodeTag}>Sin código asignado</span>
              )}
              {codeStr && (
                <span className={styles.usageTag}>
                  {usage} {usage === 1 ? 'persona usó el código' : 'personas usaron el código'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          {!g.aprobado ? (
            <>
              <button className={styles.btnApprove} onClick={() => onAprobar(g.id, true)}>
                <IconCheck /> Aprobar
              </button>
              <button className={styles.btnReject} onClick={() => onAprobar(g.id, false)}>
                <IconX /> Rechazar
              </button>
            </>
          ) : (
            <>
              <div className={styles.assignRow}>
                <label className={styles.assignLabel}>Código</label>
                <select
                  className={styles.select}
                  value={asignado?.id || ''}
                  onChange={e => onAsignar(g.id, e.target.value)}
                >
                  <option value="">— Sin asignar —</option>
                  {codigos
                    .filter(c => !c.gestor_id || c.gestor_id === g.id)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.codigo}{(c.nombre || c.apellido) ? ` (${[c.nombre, c.apellido].filter(Boolean).join(' ')})` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <button
                className={styles.btnExpand}
                onClick={onToggle}
                aria-haspopup="dialog"
              >
                Ver detalle
                <span className={styles.chevR} aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Modal de detalle del gestor (perfil + trazabilidad + cobros) ── */
function GestorDetalleModal({
  gestor: g, codeStr, usage, rooms, cobros,
  onClose, onMarcarResultado, onGuardarCobro, onMarcarPagado, onAprobar,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return createPortal(
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle del gestor @${g.username || ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHead}>
          <div className={styles.modalHeadInfo}>
            <div className={styles.modalAvatar}>{(g.username?.[0] || 'G').toUpperCase()}</div>
            <div>
              <p className={styles.modalTitle}>@{g.username || '—'}</p>
              <p className={styles.modalSub}>
                {codeStr ? <>Código <strong>{codeStr}</strong></> : 'Sin código asignado'}
              </p>
            </div>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">
            <IconX />
          </button>
        </header>

        <div className={styles.modalBody}>
          <PerfilGestor gestor={g} />
          {codeStr ? (
            <>
              <Trazabilidad codigo={codeStr} usage={usage} rooms={rooms} onMarcarResultado={onMarcarResultado} />
              <Cobros gestor={g} codigo={codeStr} rooms={rooms} cobros={cobros}
                onGuardarCobro={onGuardarCobro} onMarcarPagado={onMarcarPagado} />
            </>
          ) : (
            <div className={styles.noteBox}>
              Asigna un código a este gestor para ver su trazabilidad y registrar cobros.
            </div>
          )}
        </div>

        <footer className={styles.modalFoot}>
          <button className={styles.btnReject} onClick={() => { onAprobar(g.id, false); onClose() }}>
            <IconX /> Quitar aprobación
          </button>
          <button className={styles.modalDone} onClick={onClose}>Cerrar</button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

/* ── Perfil: comunidad + redes + certificado bancario ── */
function PerfilGestor({ gestor: g }) {
  const [certUrl, setCertUrl] = useState(null)
  const raw = g.certificado_bancario_url

  useEffect(() => {
    if (!raw) { setCertUrl(null); return }
    if (/^https?:\/\//.test(raw)) { setCertUrl(raw); return }
    let cancel = false
    ;(async () => {
      const { data } = await supabase.storage
        .from('tarjetas-profesionales')
        .createSignedUrl(raw, 3600)
      if (!cancel && data?.signedUrl) setCertUrl(data.signedUrl)
    })()
    return () => { cancel = true }
  }, [raw])

  const hasSocial = ['instagram', 'linkedin', 'facebook', 'twitter', 'whatsapp', 'tiktok'].some(k => g[k])

  return (
    <div className={styles.block}>
      <p className={styles.blockTitle}>Perfil del gestor</p>
      <div className={styles.perfilGrid}>
        <div className={styles.perfilItem}>
          <span className={styles.perfilLabel}>Comunidad que maneja</span>
          <span className={styles.perfilValue}>
            {g.comunidad_descripcion?.trim() || <em className={styles.muted}>No especificada</em>}
          </span>
        </div>
        <div className={styles.perfilItem}>
          <span className={styles.perfilLabel}>Certificado bancario</span>
          <span className={styles.perfilValue}>
            {!raw ? (
              <em className={styles.muted}>No cargado</em>
            ) : certUrl ? (
              <a className={styles.certLink} href={certUrl} target="_blank" rel="noopener noreferrer">
                Ver certificado
              </a>
            ) : (
              <em className={styles.muted}>Generando enlace…</em>
            )}
          </span>
        </div>
        <div className={`${styles.perfilItem} ${styles.perfilFull}`}>
          <span className={styles.perfilLabel}>Redes sociales</span>
          {hasSocial ? <SocialLinks profile={g} size="sm" /> : <em className={styles.muted}>Ninguna</em>}
        </div>
      </div>
    </div>
  )
}

/* ── Trazabilidad: barra de éxito + tiles + marcado de resultado ── */
function Trazabilidad({ codigo, usage, rooms, onMarcarResultado }) {
  const stats = useMemo(() => {
    let en_curso = 0, cerradas = 0, exitos = 0, fracasos = 0
    for (const r of rooms) {
      if (EN_CURSO.has(r.status)) en_curso++
      if (r.status === 'closed') cerradas++
      if (r.resultado === 'exito') exitos++
      if (r.resultado === 'fracaso') fracasos++
    }
    return { total: usage, en_curso, cerradas, exitos, fracasos }
  }, [rooms, usage])

  const decididos = stats.exitos + stats.fracasos
  const tasaExito = decididos > 0 ? Math.round((stats.exitos / decididos) * 100) : 0

  // Salas cerradas sin resultado (o con resultado) para marcar.
  const cerradasList = rooms.filter(r => r.status === 'closed')

  return (
    <div className={styles.block}>
      <p className={styles.blockTitle}>Trazabilidad del código <strong className={styles.mono}>{codigo}</strong></p>

      {/* Barra de éxito */}
      <div className={styles.ratioHead}>
        <span className={styles.ratioTitle}>Tasa de éxito</span>
        <span className={styles.ratioPct}>{tasaExito}%</span>
      </div>
      <div className={styles.ratioBar} role="progressbar" aria-valuenow={tasaExito} aria-valuemin={0} aria-valuemax={100}>
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
        <span className={styles.legendItem}><span className={styles.dotExito} /> Éxitos · {stats.exitos}</span>
        <span className={styles.legendItem}><span className={styles.dotFracaso} /> Fracasos · {stats.fracasos}</span>
        <span className={styles.legendMuted}>
          {decididos === 0 ? 'Sin casos con resultado' : `Sobre ${decididos} caso${decididos === 1 ? '' : 's'} con resultado`}
        </span>
      </div>

      {/* Tiles */}
      <div className={styles.statGrid}>
        <Tile label="Usaron el código" value={stats.total} tone="gold" />
        <Tile label="En curso" value={stats.en_curso} tone="navy" />
        <Tile label="Cerradas" value={stats.cerradas} tone="navy" />
        <Tile label="Éxitos" value={stats.exitos} tone="ok" />
        <Tile label="Fracasos" value={stats.fracasos} tone="bad" />
      </div>

      {/* Marcar resultado de consultas cerradas */}
      <p className={styles.subBlockTitle}>Marcar resultado de consultas cerradas</p>
      {cerradasList.length === 0 ? (
        <p className={styles.muted} style={{ fontSize: '0.82rem' }}>
          Aún no hay consultas cerradas para este código.
        </p>
      ) : (
        <ul className={styles.resList}>
          {cerradasList.map(r => (
            <li key={r.id} className={styles.resItem}>
              <div className={styles.resInfo}>
                <span className={styles.resName}>{r.client_nombre || 'Consulta'}</span>
                <span className={styles.resDate}>{fmtFecha(r.created_at)}</span>
              </div>
              <div className={styles.resBtns}>
                <button
                  className={`${styles.resBtn} ${styles.resExito} ${r.resultado === 'exito' ? styles.resActive : ''}`}
                  onClick={() => onMarcarResultado(r.id, 'exito')}
                >
                  <IconCheck /> Éxito
                </button>
                <button
                  className={`${styles.resBtn} ${styles.resFracaso} ${r.resultado === 'fracaso' ? styles.resActive : ''}`}
                  onClick={() => onMarcarResultado(r.id, 'fracaso')}
                >
                  <IconX /> Fracaso
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Tile({ label, value, tone }) {
  return (
    <div className={styles.tile} data-tone={tone}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  )
}

/* ── Cobros: form + historial ── */
function Cobros({ gestor: g, codigo, rooms, cobros, onGuardarCobro, onMarcarPagado }) {
  const exitos = useMemo(() => rooms.filter(r => r.resultado === 'exito').length, [rooms])

  const [casos, setCasos] = useState(String(exitos))
  const [monto, setMonto] = useState('')
  const [nota, setNota]   = useState('')
  const [saving, setSaving] = useState(false)

  // Prefill casos con los éxitos actuales cuando cambian.
  useEffect(() => { setCasos(String(exitos)) }, [exitos])

  const totalAcum = cobros.reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const totalPend = cobros.filter(c => c.estado !== 'pagado').reduce((s, c) => s + (Number(c.monto) || 0), 0)

  async function submit(e) {
    e.preventDefault()
    if (!(Number(monto) > 0)) return
    setSaving(true)
    const ok = await onGuardarCobro({
      gestorId: g.id, codigo, casos, monto, nota,
    })
    if (ok) { setMonto(''); setNota('') }
    setSaving(false)
  }

  return (
    <div className={styles.block}>
      <p className={styles.blockTitle}>Cobros</p>

      <div className={styles.cobroSummary}>
        <div className={styles.cobroStat}>
          <span className={styles.cobroStatVal}>{fmtCOP(totalAcum)}</span>
          <span className={styles.cobroStatLbl}>Total acumulado</span>
        </div>
        <div className={styles.cobroStat}>
          <span className={styles.cobroStatVal}>{fmtCOP(totalPend)}</span>
          <span className={styles.cobroStatLbl}>Pendiente por pagar</span>
        </div>
        <div className={styles.cobroStat}>
          <span className={styles.cobroStatVal}>{exitos}</span>
          <span className={styles.cobroStatLbl}>Éxitos (casos)</span>
        </div>
      </div>

      {/* Form: guardar cobro */}
      <form className={styles.cobroForm} onSubmit={submit}>
        <div className={styles.cobroField}>
          <label className={styles.cobroLabel}>Casos exitosos</label>
          <input
            className={styles.cobroInput}
            type="number" min="0"
            value={casos}
            onChange={e => setCasos(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className={styles.cobroField}>
          <label className={styles.cobroLabel}>Monto (COP)</label>
          <input
            className={styles.cobroInput}
            type="number" min="0" inputMode="numeric"
            placeholder="0"
            value={monto}
            onChange={e => setMonto(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className={`${styles.cobroField} ${styles.cobroNota}`}>
          <label className={styles.cobroLabel}>Nota (opcional)</label>
          <input
            className={styles.cobroInput}
            type="text"
            placeholder="Ej: pago mes de julio"
            value={nota}
            onChange={e => setNota(e.target.value)}
          />
        </div>
        <button className={styles.cobroSave} type="submit" disabled={saving || !(Number(monto) > 0)}>
          {saving ? 'Guardando…' : 'Guardar cobro'}
        </button>
      </form>
      {monto !== '' && Number(monto) > 0 && (
        <p className={styles.cobroPreview}>Se registrará un cobro de <strong>{fmtCOP(monto)}</strong> por {Number(casos) || 0} caso(s) exitoso(s).</p>
      )}

      {/* Historial */}
      {cobros.length > 0 && (
        <div className={styles.cobroTableWrap}>
          <table className={styles.cobroTable}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th className={styles.tRight}>Casos</th>
                <th className={styles.tRight}>Monto</th>
                <th>Estado</th>
                <th>Nota</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cobros.map(c => (
                <tr key={c.id}>
                  <td>{fmtFecha(c.created_at)}</td>
                  <td className={styles.tRight}>{c.casos_exitosos ?? 0}</td>
                  <td className={`${styles.tRight} ${styles.mono}`}>{fmtCOP(c.monto)}</td>
                  <td>
                    <span className={c.estado === 'pagado' ? styles.chipPagado : styles.chipPendiente}>
                      {c.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                    </span>
                  </td>
                  <td className={styles.tNota}>{c.nota || '—'}</td>
                  <td className={styles.tRight}>
                    {c.estado !== 'pagado' && (
                      <button className={styles.pagarBtn} onClick={() => onMarcarPagado(c.id)}>
                        Marcar pagado
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
