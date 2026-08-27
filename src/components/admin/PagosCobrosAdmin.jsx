import { useEffect, useMemo, useState } from 'react'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import { IconCheck } from '../shared/Icons'
import styles from './PagosCobrosAdmin.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ══════════════════════════════════════════════════════════════════
   Pagos y cobros — panel único del superadmin para el dinero:
     · Pagos de profesionales   (pagos_profesional)
     · Cobros de gestores        (gestor_cobros)
   Cada vista tiene filtros (nombre/cédula, profesión, estado, fecha),
   paginación y selector de resultados por página.
   ══════════════════════════════════════════════════════════════════ */

/* ── Utilidades de formato / normalización ── */
const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(n) || 0)

const fmtFecha = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

// Fecha + HORA exacta (coincide con el resto de la app): "22 jul 2026, 3:45 p. m."
const fmtFechaHora = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return '—' }
}

// Solo la HORA — para resaltar el instante del evento de dinero.
const fmtHora = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch { return '—' }
}

const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const normCedula = (s) => (s || '').toString().replace(/[.\s]/g, '')

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const PER_PAGE_OPTS = [10, 25, 50, 100]

/* ── Iconos locales (stroke Lucide, consistentes con el set del panel) ── */
const IconWallet = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.ico}>
    <rect x="1.75" y="3.5" width="12.5" height="9.25" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.75 6.25h12.5" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="11" cy="9.5" r="1" fill="currentColor" />
  </svg>
)
const IconGestor = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.ico}>
    <circle cx="8" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.75 13.5c0-2.6 2.35-4.25 5.25-4.25s5.25 1.65 5.25 4.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)
const IconSearch = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="none" aria-hidden="true" className={styles.ico}>
    <circle cx="6.25" cy="6.25" r="4.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9.75 9.75L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const IconX = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={styles.ico}>
    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const IconChevL = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.ico}>
    <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconChevR = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.ico}>
    <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/* ─────────────────────────────────────────────────────────────────
   Sub-componentes de módulo (identidad estable → sin perder foco).
   ───────────────────────────────────────────────────────────────── */

// Ventana de páginas: [1, '…', 4, 5, 6, '…', 12]
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out = [1]
  const lo = Math.max(2, current - 1)
  const hi = Math.min(total - 1, current + 1)
  if (lo > 2) out.push('…')
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < total - 1) out.push('…')
  out.push(total)
  return out
}

function Pager({ id = 'pager', page, perPage, total, onPage, onPerPage }) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const cur = Math.min(page, pages)
  const from = total === 0 ? 0 : (cur - 1) * perPage + 1
  const to = Math.min(cur * perPage, total)
  const win = pageWindow(cur, pages)

  return (
    <div className={styles.pager}>
      <div className={styles.perPage}>
        <label htmlFor={`${id}-perpage`} className={styles.perPageLbl}>Resultados por página</label>
        <select
          id={`${id}-perpage`}
          className={styles.perPageSel}
          value={perPage}
          onChange={(e) => onPerPage(Number(e.target.value))}
        >
          {PER_PAGE_OPTS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <span className={styles.pagerInfo}>
        {total === 0 ? 'Sin resultados' : <><strong>{from}–{to}</strong> de {total}</>}
      </span>

      <div className={styles.pagerBtns} role="navigation" aria-label="Paginación">
        <button
          className={styles.pageBtn}
          onClick={() => onPage(cur - 1)}
          disabled={cur <= 1}
          aria-label="Página anterior"
        >
          <IconChevL />
        </button>
        {win.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className={styles.pageGap}>…</span>
          ) : (
            <button
              key={p}
              className={`${styles.pageBtn} ${p === cur ? styles.pageBtnActive : ''}`}
              onClick={() => onPage(p)}
              aria-current={p === cur ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          className={styles.pageBtn}
          onClick={() => onPage(cur + 1)}
          disabled={cur >= pages}
          aria-label="Página siguiente"
        >
          <IconChevR />
        </button>
      </div>
    </div>
  )
}

function EstadoChips({ opciones, value, onChange }) {
  return (
    <div className={styles.chips} role="group" aria-label="Filtrar por estado">
      {opciones.map(({ k, label, n }) => (
        <button
          key={k}
          className={`${styles.chip} ${value === k ? styles.chipActive : ''}`}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
        >
          {label}<span className={styles.chipCount}>{n}</span>
        </button>
      ))}
    </div>
  )
}

function EstadoPill({ estado }) {
  const map = {
    pagado:     [styles.pillOk,   'Pagado'],
    pendiente:  [styles.pillWarn, 'Pendiente'],
    disponible: [styles.pillGold, 'Disponible'],
    solicitado: [styles.pillReq,  'Solicitado'],
  }
  const [cls, label] = map[estado] || [styles.pillMuted, estado || '—']
  return <span className={`${styles.pill} ${cls}`}>{label}</span>
}

/* ══════════════════════════════════════════════════════════════════
   Componente principal
   ══════════════════════════════════════════════════════════════════ */
export default function PagosCobrosAdmin() {
  const [sub, setSub]       = useState('pagos') // 'pagos' | 'cobros' | 'asesorias'
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]       = useState('')

  const [pagos, setPagos]   = useState([])
  const [cobros, setCobros] = useState([])
  const [profes, setProfes] = useState([]) // abogados + contadores
  const [gestores, setGest] = useState([])

  // ── Asesorías (cobro cliente → profesional) + config de comisión ──
  const [asesorias, setAsesorias] = useState([])
  const [config, setConfig]       = useState(null)   // plataforma_config (id=1)
  const [pctEmpresa, setPctEmpresa] = useState('')   // input editable
  const [pctGestor, setPctGestor]   = useState('')
  const [savingCfg, setSavingCfg]   = useState(false)
  const [qA, setQA]         = useState('')
  const [estadoA, setEstadoA] = useState('todos')    // todos|gratuita|pendiente|pagado

  // ── Filtros: Pagos de profesionales ──
  const [qP, setQP]         = useState('')
  const [profFilter, setProfFilter] = useState('todos') // todos|abogado|contador
  const [estadoP, setEstadoP] = useState('todos')       // todos|pagado|pendiente
  const [desdeP, setDesdeP] = useState('')
  const [hastaP, setHastaP] = useState('')
  const [pageP, setPageP]   = useState(1)
  const [perPageP, setPerPageP] = useState(10)

  // ── Filtros: Cobros de gestores ──
  const [qC, setQC]         = useState('')
  const [estadoC, setEstadoC] = useState('todos')       // todos|disponible|solicitado|pagado
  const [desdeC, setDesdeC] = useState('')
  const [hastaC, setHastaC] = useState('')
  const [pageC, setPageC]   = useState(1)
  const [perPageC, setPerPageC] = useState(10)

  useEffect(() => { cargar() }, [])

  // Cualquier cambio de filtro vuelve a la página 1.
  useEffect(() => { setPageP(1) }, [qP, profFilter, estadoP, desdeP, hastaP, perPageP])
  useEffect(() => { setPageC(1) }, [qC, estadoC, desdeC, hastaC, perPageC])

  async function cargar() {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const [pRes, coRes, prRes, gRes, aRes, cfgRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pagos_profesional?select=id,profesional_id,monto,total_consulta,pct_empresa,pct_gestor,estado,comision_gestor,gestor_id,codigo,created_at,pagado_at&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/gestor_cobros?select=*&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?rol=in.(abogado,contador)&select=id,nombre,apellido,cedula,username,email,rol`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?rol=eq.gestor&select=id,nombre,apellido,cedula,username,email`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/pagos_asesoria?select=id,room_id,profesional_id,monto,estado,nota,recibo_num,pago_profesional_id,marcado_cliente_at,confirmado_at,created_at&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/plataforma_config?id=eq.1&select=pct_empresa,comision_gestor_pct,default_total&limit=1`, { headers }),
      ])
      const [p, co, pr, g, a, cfg] = await Promise.all([pRes.json(), coRes.json(), prRes.json(), gRes.json(), aRes.json(), cfgRes.json()])
      setPagos(Array.isArray(p) ? p : [])
      setCobros(Array.isArray(co) ? co : [])
      setProfes(Array.isArray(pr) ? pr : [])
      setGest(Array.isArray(g) ? g : [])
      setAsesorias(Array.isArray(a) ? a : [])
      const c0 = Array.isArray(cfg) && cfg.length ? cfg[0] : null
      setConfig(c0)
      if (c0) { setPctEmpresa(String(c0.pct_empresa ?? '')); setPctGestor(String(c0.comision_gestor_pct ?? '')) }
    } catch { /* noop */ }
    finally { setLoading(false) }
  }

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 2800) }

  // Índices id → perfil.
  const profById = useMemo(() => {
    const m = new Map(); for (const x of profes) m.set(x.id, x); return m
  }, [profes])
  const gestById = useMemo(() => {
    const m = new Map(); for (const x of gestores) m.set(x.id, x); return m
  }, [gestores])

  const nombreDe = (p) =>
    !p ? null
      : (p.nombre || p.apellido ? [p.nombre, p.apellido].filter(Boolean).join(' ') : null) ||
        (p.username ? `@${p.username}` : null) || null

  // Marca una comisión de gestor como pagada (RPC segura → notifica al gestor).
  async function pagarComision(cobroId) {
    setCobros(cs => cs.map(c => c.id === cobroId ? { ...c, estado: 'pagado' } : c))
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pagar_comision_gestor`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_cobro_id: cobroId }),
      })
      if (!res.ok) throw new Error('rpc')
      const ok = await res.json()
      if (ok === false) throw new Error('rechazado')
      flash('Comisión marcada como pagada. Se notificó al gestor.')
      await cargar()
    } catch {
      setCobros(cs => cs.map(c => c.id === cobroId ? { ...c, estado: 'solicitado' } : c))
      flash('No se pudo marcar la comisión como pagada.')
    }
  }

  // Guarda la config de comisión (pct_empresa / pct_gestor) en plataforma_config.
  async function guardarConfig() {
    const pe = Number(pctEmpresa), pg = Number(pctGestor)
    if (Number.isNaN(pe) || pe < 0 || pe > 100) { flash('El % de empresa debe estar entre 0 y 100.'); return }
    if (Number.isNaN(pg) || pg < 0 || pg > 100) { flash('El % de gestor debe estar entre 0 y 100.'); return }
    setSavingCfg(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/plataforma_config?id=eq.1`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ pct_empresa: pe, comision_gestor_pct: pg }),
      })
      if (!res.ok) throw new Error('rpc')
      flash('Porcentajes actualizados.')
      await cargar()
    } catch {
      flash('No se pudieron guardar los porcentajes.')
    } finally {
      setSavingCfg(false)
    }
  }

  // Comisión generada por cada asesoría (vía pago_profesional_id → pagos_profesional).
  const comisionPorPagoProf = useMemo(() => {
    const m = new Map(); for (const p of pagos) m.set(p.id, Number(p.monto) || 0); return m
  }, [pagos])

  // Asesorías enriquecidas + filtradas (búsqueda por nombre/cédula + estado).
  const asesoriasFiltradas = useMemo(() => {
    const q = norm(qA), qc = normCedula(qA)
    return asesorias
      .map(a => {
        const prof = profById.get(a.profesional_id) || null
        return {
          ...a,
          _nombre: nombreDe(prof) || '—',
          _cedula: prof?.cedula || '',
          _rol: prof?.rol || null,
          _comision: a.pago_profesional_id ? (comisionPorPagoProf.get(a.pago_profesional_id) || 0) : 0,
        }
      })
      .filter(a => {
        if (estadoA !== 'todos' && a.estado !== estadoA) return false
        if (q || qc) {
          const enTexto = norm(a._nombre).includes(q)
          const enCedula = qc && normCedula(a._cedula).includes(qc)
          if (!(enTexto || enCedula)) return false
        }
        return true
      })
  }, [asesorias, profById, comisionPorPagoProf, qA, estadoA])

  const resumenA = useMemo(() => {
    let cobrado = 0, comisiones = 0, pend = 0
    for (const a of asesoriasFiltradas) {
      if (a.estado === 'pagado') { cobrado += Number(a.monto) || 0; comisiones += a._comision }
      else if (a.estado === 'pendiente') pend += Number(a.monto) || 0
    }
    return { cobrado, comisiones, pend, count: asesoriasFiltradas.length }
  }, [asesoriasFiltradas])

  // Filtro por rango de fechas (created_at) contra desde/hasta (YYYY-MM-DD).
  const enRango = (iso, desde, hasta) => {
    if (!desde && !hasta) return true
    if (!iso) return false
    const d = new Date(iso)
    if (desde && d < new Date(`${desde}T00:00:00`)) return false
    if (hasta && d > new Date(`${hasta}T23:59:59`)) return false
    return true
  }

  // ── Pagos de profesionales: enriquecer + filtrar ──
  const pagosFiltrados = useMemo(() => {
    const q = norm(qP), qc = normCedula(qP)
    return pagos
      .map(p => {
        const prof = profById.get(p.profesional_id) || null
        return {
          ...p,
          _nombre: nombreDe(prof) || '—',
          _cedula: prof?.cedula || '',
          _rol: prof?.rol || null,
          _gestor: nombreDe(gestById.get(p.gestor_id)) || null,
        }
      })
      .filter(p => {
        if (profFilter !== 'todos' && p._rol !== profFilter) return false
        if (estadoP !== 'todos' && p.estado !== estadoP) return false
        if (!enRango(p.created_at, desdeP, hastaP)) return false
        if (q || qc) {
          const enTexto = norm(`${p._nombre} ${p.codigo || ''}`).includes(q)
          const enCedula = qc && normCedula(p._cedula).includes(qc)
          if (!(enTexto || enCedula)) return false
        }
        return true
      })
  }, [pagos, profById, gestById, qP, profFilter, estadoP, desdeP, hastaP])

  // ── Cobros de gestores: enriquecer + filtrar ──
  const cobrosFiltrados = useMemo(() => {
    const q = norm(qC), qc = normCedula(qC)
    const estadoNorm = (e) => (e === 'pendiente' ? 'disponible' : e) // 'pendiente' se muestra como Disponible
    return cobros
      .map(c => {
        const g = gestById.get(c.gestor_id) || null
        return { ...c, _nombre: nombreDe(g) || '—', _cedula: g?.cedula || '', _estadoUI: estadoNorm(c.estado) }
      })
      .filter(c => {
        if (estadoC !== 'todos' && c._estadoUI !== estadoC) return false
        if (!enRango(c.created_at, desdeC, hastaC)) return false
        if (q || qc) {
          const enTexto = norm(`${c._nombre} ${c.codigo || ''}`).includes(q)
          const enCedula = qc && normCedula(c._cedula).includes(qc)
          if (!(enTexto || enCedula)) return false
        }
        return true
      })
  }, [cobros, gestById, qC, estadoC, desdeC, hastaC])

  // Resúmenes (sobre el conjunto FILTRADO, para que reflejen los filtros activos).
  const resumenP = useMemo(() => {
    let recaudado = 0, pendiente = 0, comisiones = 0
    for (const p of pagosFiltrados) {
      const m = Number(p.monto) || 0
      if (p.estado === 'pagado') { recaudado += m; comisiones += Number(p.comision_gestor) || 0 }
      else pendiente += m
    }
    return { recaudado, pendiente, comisiones, count: pagosFiltrados.length }
  }, [pagosFiltrados])

  const resumenC = useMemo(() => {
    let disponible = 0, solicitado = 0, pagado = 0
    for (const c of cobrosFiltrados) {
      const m = Number(c.monto) || 0
      if (c._estadoUI === 'pagado') pagado += m
      else if (c._estadoUI === 'solicitado') solicitado += m
      else disponible += m
    }
    return { disponible, solicitado, pagado, count: cobrosFiltrados.length }
  }, [cobrosFiltrados])

  // Conteos por estado (para los chips) — sobre todo el dataset enriquecido, sin
  // el filtro de estado, para que el número no cambie al seleccionar un chip.
  const countsP = useMemo(() => {
    const base = pagosFiltradosSinEstado(pagos, profById, gestById, qP, profFilter, desdeP, hastaP, enRango)
    return {
      todos: base.length,
      pagado: base.filter(p => p.estado === 'pagado').length,
      pendiente: base.filter(p => p.estado !== 'pagado').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, profById, gestById, qP, profFilter, desdeP, hastaP])

  const countsC = useMemo(() => {
    const estadoNorm = (e) => (e === 'pendiente' ? 'disponible' : e)
    const base = cobros
      .map(c => ({ ...c, _nombre: nombreDe(gestById.get(c.gestor_id)) || '—', _cedula: gestById.get(c.gestor_id)?.cedula || '', _estadoUI: estadoNorm(c.estado) }))
      .filter(c => {
        if (!enRango(c.created_at, desdeC, hastaC)) return false
        const q = norm(qC), qc = normCedula(qC)
        if (q || qc) {
          const enTexto = norm(`${c._nombre} ${c.codigo || ''}`).includes(q)
          const enCedula = qc && normCedula(c._cedula).includes(qc)
          if (!(enTexto || enCedula)) return false
        }
        return true
      })
    return {
      todos: base.length,
      disponible: base.filter(c => c._estadoUI === 'disponible').length,
      solicitado: base.filter(c => c._estadoUI === 'solicitado').length,
      pagado: base.filter(c => c._estadoUI === 'pagado').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobros, gestById, qC, desdeC, hastaC])

  const profCounts = useMemo(() => {
    // Sobre el dataset filtrado sin el filtro de profesión.
    const base = pagos
      .map(p => ({ ...p, _rol: (profById.get(p.profesional_id) || {}).rol || null }))
      .filter(p => {
        if (estadoP !== 'todos' && p.estado !== estadoP) return false
        if (!enRango(p.created_at, desdeP, hastaP)) return false
        return true
      })
    return {
      todos: base.length,
      abogado: base.filter(p => p._rol === 'abogado').length,
      contador: base.filter(p => p._rol === 'contador').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, profById, estadoP, desdeP, hastaP])

  // Paginación (slice).
  const pagosPage = useMemo(() => {
    const start = (pageP - 1) * perPageP
    return pagosFiltrados.slice(start, start + perPageP)
  }, [pagosFiltrados, pageP, perPageP])

  const cobrosPage = useMemo(() => {
    const start = (pageC - 1) * perPageC
    return cobrosFiltrados.slice(start, start + perPageC)
  }, [cobrosFiltrados, pageC, perPageC])

  // Presets de fecha.
  function preset(setDesde, setHasta, tipo) {
    const hoy = new Date()
    if (tipo === 'todo') { setDesde(''); setHasta(''); return }
    const d = new Date(hoy)
    if (tipo === '7') d.setDate(hoy.getDate() - 6)
    else if (tipo === '30') d.setDate(hoy.getDate() - 29)
    setDesde(ymd(d)); setHasta(ymd(hoy))
  }

  const hayFiltrosP = qP || profFilter !== 'todos' || estadoP !== 'todos' || desdeP || hastaP
  const hayFiltrosC = qC || estadoC !== 'todos' || desdeC || hastaC

  if (loading) return <p className={styles.loading}>Cargando pagos y cobros…</p>

  return (
    <div className={styles.screen}>
      {/* Sub-pestañas */}
      <div className={styles.subTabs} role="tablist" aria-label="Pagos y cobros">
        <button
          role="tab" aria-selected={sub === 'pagos'}
          className={`${styles.subTab} ${sub === 'pagos' ? styles.subTabActive : ''}`}
          onClick={() => setSub('pagos')}
        >
          <IconWallet /> Pagos de profesionales
          <span className={styles.subTabBadge}>{pagos.length}</span>
        </button>
        <button
          role="tab" aria-selected={sub === 'cobros'}
          className={`${styles.subTab} ${sub === 'cobros' ? styles.subTabActive : ''}`}
          onClick={() => setSub('cobros')}
        >
          <IconGestor /> Cobros de gestores
          <span className={styles.subTabBadge}>{cobros.length}</span>
        </button>
        <button
          role="tab" aria-selected={sub === 'asesorias'}
          className={`${styles.subTab} ${sub === 'asesorias' ? styles.subTabActive : ''}`}
          onClick={() => setSub('asesorias')}
        >
          <IconWallet /> Asesorías (cobro al cliente)
          <span className={styles.subTabBadge}>{asesorias.length}</span>
        </button>
      </div>

      {msg && <p className={styles.msgOk}>{msg}</p>}

      {/* ═══════════════ PAGOS DE PROFESIONALES ═══════════════ */}
      {sub === 'pagos' && (
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <h2 className={styles.title}>Pagos de profesionales</h2>
              <p className={styles.sub}>
                Lo que cada profesional paga a la plataforma por su consulta verificada, con la
                comisión que se genera para el gestor.
              </p>
            </div>
            <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
          </header>

          {/* Resumen */}
          <div className={styles.tiles}>
            <div className={styles.tile} data-tone="ok">
              <span className={styles.tileVal}>{fmtCOP(resumenP.recaudado)}</span>
              <span className={styles.tileLbl}>Recaudado</span>
            </div>
            <div className={styles.tile} data-tone="gold">
              <span className={styles.tileVal}>{fmtCOP(resumenP.pendiente)}</span>
              <span className={styles.tileLbl}>Pendiente</span>
            </div>
            <div className={styles.tile} data-tone="navy">
              <span className={styles.tileVal}>{fmtCOP(resumenP.comisiones)}</span>
              <span className={styles.tileLbl}>Comisiones a gestores</span>
            </div>
            <div className={styles.tile} data-tone="navy">
              <span className={styles.tileVal}>{resumenP.count}</span>
              <span className={styles.tileLbl}>Pagos (filtro)</span>
            </div>
          </div>

          {/* Filtros */}
          <div className={styles.toolbar}>
            <div className={styles.filterRow}>
              <div className={styles.filterBar}>
                <span className={styles.searchIcon}><IconSearch /></span>
                <input
                  className={styles.searchInput}
                  type="text" value={qP}
                  onChange={(e) => setQP(e.target.value)}
                  placeholder="Buscar por nombre, cédula o código…"
                  aria-label="Buscar pagos por nombre, cédula o código"
                />
                {qP && (
                  <button className={styles.searchClear} onClick={() => setQP('')} aria-label="Limpiar búsqueda"><IconX /></button>
                )}
              </div>

              <div className={styles.dateGroup}>
                <div className={styles.presets}>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeP, setHastaP, 'todo')}>Todo</button>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeP, setHastaP, '30')}>30 días</button>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeP, setHastaP, '7')}>7 días</button>
                </div>
                <label className={styles.dateField}>
                  <span>Desde</span>
                  <input type="date" className={styles.dateInput} value={desdeP} max={hastaP || undefined} onChange={(e) => setDesdeP(e.target.value)} />
                </label>
                <label className={styles.dateField}>
                  <span>Hasta</span>
                  <input type="date" className={styles.dateInput} value={hastaP} min={desdeP || undefined} onChange={(e) => setHastaP(e.target.value)} />
                </label>
              </div>
            </div>

            <div className={styles.chipRow}>
              <EstadoChips
                opciones={[
                  { k: 'todos', label: 'Todas', n: profCounts.todos },
                  { k: 'abogado', label: 'Abogados', n: profCounts.abogado },
                  { k: 'contador', label: 'Contadores', n: profCounts.contador },
                ]}
                value={profFilter}
                onChange={setProfFilter}
              />
              <span className={styles.chipDivider} aria-hidden="true" />
              <EstadoChips
                opciones={[
                  { k: 'todos', label: 'Todos', n: countsP.todos },
                  { k: 'pagado', label: 'Pagados', n: countsP.pagado },
                  { k: 'pendiente', label: 'Pendientes', n: countsP.pendiente },
                ]}
                value={estadoP}
                onChange={setEstadoP}
              />
              {hayFiltrosP && (
                <button
                  className={styles.clearAll}
                  onClick={() => { setQP(''); setProfFilter('todos'); setEstadoP('todos'); setDesdeP(''); setHastaP('') }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          {/* Tabla */}
          {pagosFiltrados.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTxt}>{pagos.length === 0 ? 'Aún no hay pagos de profesionales' : 'Ningún pago coincide con los filtros'}</p>
              <p className={styles.emptySub}>{pagos.length === 0 ? 'Cuando un profesional pague su consulta verificada, aparecerá aquí.' : 'Ajusta la búsqueda, la profesión, el estado o el rango de fechas.'}</p>
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Profesional</th>
                      <th>Cédula</th>
                      <th>Profesión</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Comisión gestor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagosPage.map(p => (
                      <tr key={p.id}>
                        <td className={styles.fechaCell}>
                          <span className={styles.fechaMain}>{fmtFechaHora(p.created_at)}</span>
                          {p.estado === 'pagado' && p.pagado_at && (
                            <span className={styles.fechaHito}>
                              Pagado: <time className={styles.horaTag}>{fmtHora(p.pagado_at)}</time>
                            </span>
                          )}
                        </td>
                        <td className={styles.strong}>{p._nombre}</td>
                        <td className={styles.num}>{p._cedula || '—'}</td>
                        <td>
                          {p._rol
                            ? <span className={p._rol === 'contador' ? styles.badgeCont : styles.badgeAbog}>{p._rol === 'contador' ? 'Contador' : 'Abogado'}</span>
                            : <span className={styles.muted}>—</span>}
                        </td>
                        <td className={styles.num}>{fmtCOP(p.monto)}</td>
                        <td><EstadoPill estado={p.estado === 'pagado' ? 'pagado' : 'pendiente'} /></td>
                        <td className={styles.num}>
                          {Number(p.comision_gestor) > 0 ? (
                            <>
                              {fmtCOP(p.comision_gestor)}
                              {p._gestor && <span className={styles.gestorTag}>{p._gestor}</span>}
                            </>
                          ) : <span className={styles.muted}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager id="pagos" page={pageP} perPage={perPageP} total={pagosFiltrados.length} onPage={setPageP} onPerPage={setPerPageP} />
            </>
          )}
        </section>
      )}

      {/* ═══════════════ COBROS DE GESTORES ═══════════════ */}
      {sub === 'cobros' && (
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <h2 className={styles.title}>Cobros de gestores</h2>
              <p className={styles.sub}>
                Comisiones que se generan para cada gestor por sus casos exitosos. Las solicitudes de
                pago suben al inicio para que las atiendas primero.
              </p>
            </div>
            <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
          </header>

          {/* Resumen */}
          <div className={styles.tiles}>
            <div className={styles.tile} data-tone="gold">
              <span className={styles.tileVal}>{fmtCOP(resumenC.disponible)}</span>
              <span className={styles.tileLbl}>Disponibles</span>
            </div>
            <div className={styles.tile} data-tone="req">
              <span className={styles.tileVal}>{fmtCOP(resumenC.solicitado)}</span>
              <span className={styles.tileLbl}>Solicitadas</span>
            </div>
            <div className={styles.tile} data-tone="ok">
              <span className={styles.tileVal}>{fmtCOP(resumenC.pagado)}</span>
              <span className={styles.tileLbl}>Pagadas</span>
            </div>
            <div className={styles.tile} data-tone="navy">
              <span className={styles.tileVal}>{resumenC.count}</span>
              <span className={styles.tileLbl}>Comisiones (filtro)</span>
            </div>
          </div>

          {/* Filtros */}
          <div className={styles.toolbar}>
            <div className={styles.filterRow}>
              <div className={styles.filterBar}>
                <span className={styles.searchIcon}><IconSearch /></span>
                <input
                  className={styles.searchInput}
                  type="text" value={qC}
                  onChange={(e) => setQC(e.target.value)}
                  placeholder="Buscar por nombre, cédula o código…"
                  aria-label="Buscar cobros por nombre, cédula o código"
                />
                {qC && (
                  <button className={styles.searchClear} onClick={() => setQC('')} aria-label="Limpiar búsqueda"><IconX /></button>
                )}
              </div>

              <div className={styles.dateGroup}>
                <div className={styles.presets}>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeC, setHastaC, 'todo')}>Todo</button>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeC, setHastaC, '30')}>30 días</button>
                  <button className={styles.presetBtn} onClick={() => preset(setDesdeC, setHastaC, '7')}>7 días</button>
                </div>
                <label className={styles.dateField}>
                  <span>Desde</span>
                  <input type="date" className={styles.dateInput} value={desdeC} max={hastaC || undefined} onChange={(e) => setDesdeC(e.target.value)} />
                </label>
                <label className={styles.dateField}>
                  <span>Hasta</span>
                  <input type="date" className={styles.dateInput} value={hastaC} min={desdeC || undefined} onChange={(e) => setHastaC(e.target.value)} />
                </label>
              </div>
            </div>

            <div className={styles.chipRow}>
              <EstadoChips
                opciones={[
                  { k: 'todos', label: 'Todos', n: countsC.todos },
                  { k: 'disponible', label: 'Disponibles', n: countsC.disponible },
                  { k: 'solicitado', label: 'Solicitadas', n: countsC.solicitado },
                  { k: 'pagado', label: 'Pagadas', n: countsC.pagado },
                ]}
                value={estadoC}
                onChange={setEstadoC}
              />
              {hayFiltrosC && (
                <button
                  className={styles.clearAll}
                  onClick={() => { setQC(''); setEstadoC('todos'); setDesdeC(''); setHastaC('') }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          {/* Tabla */}
          {cobrosFiltrados.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTxt}>{cobros.length === 0 ? 'Aún no hay comisiones de gestores' : 'Ninguna comisión coincide con los filtros'}</p>
              <p className={styles.emptySub}>{cobros.length === 0 ? 'Cuando un caso exitoso genere comisión, aparecerá aquí.' : 'Ajusta la búsqueda, el estado o el rango de fechas.'}</p>
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Gestor</th>
                      <th>Cédula</th>
                      <th>Código</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobrosPage.map(c => (
                      <tr key={c.id} className={c._estadoUI === 'solicitado' ? styles.rowSolic : undefined}>
                        <td className={styles.fechaCell}>
                          <span className={styles.fechaMain}>{fmtFechaHora(c.created_at)}</span>
                          {c.solicitado_at && (c._estadoUI === 'solicitado' || c._estadoUI === 'pagado') && (
                            <span className={styles.fechaHito}>
                              Solicitado: <time className={styles.horaTag}>{fmtHora(c.solicitado_at)}</time>
                            </span>
                          )}
                          {c._estadoUI === 'pagado' && c.pagado_at && (
                            <span className={styles.fechaHito}>
                              Pagado: <time className={styles.horaTag}>{fmtHora(c.pagado_at)}</time>
                            </span>
                          )}
                        </td>
                        <td className={styles.strong}>{c._nombre}</td>
                        <td className={styles.num}>{c._cedula || '—'}</td>
                        <td className={styles.num}>{c.codigo || '—'}</td>
                        <td className={styles.num}>{fmtCOP(c.monto)}</td>
                        <td><EstadoPill estado={c._estadoUI} /></td>
                        <td>
                          {c._estadoUI === 'solicitado' ? (
                            <button className={styles.payBtn} onClick={() => pagarComision(c.id)}>
                              <IconCheck /> Marcar pagado
                            </button>
                          ) : (
                            <span className={styles.muted}>{c._estadoUI === 'pagado' ? '—' : 'Sin solicitar'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager id="cobros" page={pageC} perPage={perPageC} total={cobrosFiltrados.length} onPage={setPageC} onPerPage={setPerPageC} />
            </>
          )}
        </section>
      )}

      {/* ═══════════════ ASESORÍAS (cobro al cliente) ═══════════════ */}
      {sub === 'asesorias' && (
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <h2 className={styles.title}>Asesorías cobradas al cliente</h2>
              <p className={styles.sub}>
                Lo que cada profesional le cobra al cliente por la asesoría (pago directo
                y manual). Tú solo defines los porcentajes de la comisión que el profesional
                le paga a la empresa.
              </p>
            </div>
            <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
          </header>

          {/* Config de comisión */}
          <div className={styles.toolbar} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            <div className={styles.dateField} style={{ maxWidth: 160 }}>
              <span>% Empresa (comisión)</span>
              <input type="number" min="0" max="100" className={styles.dateInput}
                value={pctEmpresa} onChange={e => setPctEmpresa(e.target.value)} />
            </div>
            <div className={styles.dateField} style={{ maxWidth: 160 }}>
              <span>% Gestor</span>
              <input type="number" min="0" max="100" className={styles.dateInput}
                value={pctGestor} onChange={e => setPctGestor(e.target.value)} />
            </div>
            <button className={styles.payBtn} onClick={guardarConfig} disabled={savingCfg}>
              {savingCfg ? 'Guardando…' : 'Guardar porcentajes'}
            </button>
            <p className={styles.sub} style={{ margin: 0, flexBasis: '100%' }}>
              Al confirmarse una asesoría, el profesional debe pagar a la empresa el
              <strong> {pctEmpresa || '—'}%</strong> de lo cobrado (más {pctGestor || '—'}% si hay gestor).
            </p>
          </div>

          {/* Resumen */}
          <div className={styles.tiles}>
            <div className={styles.tile} data-tone="ok">
              <span className={styles.tileVal}>{fmtCOP(resumenA.cobrado)}</span>
              <span className={styles.tileLbl}>Cobrado al cliente (pagadas)</span>
            </div>
            <div className={styles.tile} data-tone="gold">
              <span className={styles.tileVal}>{fmtCOP(resumenA.pend)}</span>
              <span className={styles.tileLbl}>Pendiente de pago</span>
            </div>
            <div className={styles.tile} data-tone="navy">
              <span className={styles.tileVal}>{fmtCOP(resumenA.comisiones)}</span>
              <span className={styles.tileLbl}>Comisión generada a empresa</span>
            </div>
            <div className={styles.tile} data-tone="navy">
              <span className={styles.tileVal}>{resumenA.count}</span>
              <span className={styles.tileLbl}>Asesorías (filtro)</span>
            </div>
          </div>

          {/* Filtros */}
          <div className={styles.toolbar}>
            <div className={styles.filterRow}>
              <div className={styles.filterBar}>
                <span className={styles.searchIcon}><IconSearch /></span>
                <input
                  className={styles.searchInput}
                  type="text" value={qA}
                  onChange={(e) => setQA(e.target.value)}
                  placeholder="Buscar por nombre o cédula…"
                  aria-label="Buscar asesorías por nombre o cédula"
                />
                {qA && (
                  <button className={styles.searchClear} onClick={() => setQA('')} aria-label="Limpiar búsqueda"><IconX /></button>
                )}
              </div>
            </div>
            <div className={styles.chipRow}>
              <EstadoChips
                opciones={[
                  { k: 'todos', label: 'Todas', n: asesorias.length },
                  { k: 'pagado', label: 'Pagadas', n: asesorias.filter(a => a.estado === 'pagado').length },
                  { k: 'pendiente', label: 'Pendientes', n: asesorias.filter(a => a.estado === 'pendiente').length },
                  { k: 'gratuita', label: 'Gratuitas', n: asesorias.filter(a => a.estado === 'gratuita').length },
                ]}
                value={estadoA}
                onChange={setEstadoA}
              />
            </div>
          </div>

          {/* Tabla */}
          {asesoriasFiltradas.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTxt}>{asesorias.length === 0 ? 'Aún no hay asesorías cobradas' : 'Ninguna asesoría coincide con los filtros'}</p>
              <p className={styles.emptySub}>{asesorias.length === 0 ? 'Cuando un profesional cobre una asesoría, aparecerá aquí.' : 'Ajusta la búsqueda o el estado.'}</p>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Profesional</th>
                    <th>Cédula</th>
                    <th>Cobrado al cliente</th>
                    <th>Estado</th>
                    <th>Comisión a empresa</th>
                    <th>Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {asesoriasFiltradas.map(a => (
                    <tr key={a.id}>
                      <td className={styles.fechaCell}>
                        <span className={styles.fechaMain}>{fmtFechaHora(a.created_at)}</span>
                        {a.estado === 'pagado' && a.confirmado_at && (
                          <span className={styles.fechaHito}>
                            Pagada: <time className={styles.horaTag}>{fmtHora(a.confirmado_at)}</time>
                          </span>
                        )}
                      </td>
                      <td className={styles.strong}>{a._nombre}</td>
                      <td className={styles.num}>{a._cedula || '—'}</td>
                      <td className={styles.num}>{a.estado === 'gratuita' ? 'Gratuita' : fmtCOP(a.monto)}</td>
                      <td>{a.estado === 'gratuita'
                        ? <span className={styles.muted}>Gratuita</span>
                        : <EstadoPill estado={a.estado === 'pagado' ? 'pagado' : 'pendiente'} />}</td>
                      <td className={styles.num}>{a._comision > 0 ? fmtCOP(a._comision) : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.num}>{a.recibo_num || <span className={styles.muted}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/* Helper de conteo de estado para pagos (sin el filtro de estado). */
function pagosFiltradosSinEstado(pagos, profById, gestById, qP, profFilter, desdeP, hastaP, enRango) {
  const q = norm(qP), qc = normCedula(qP)
  return pagos
    .map(p => {
      const prof = profById.get(p.profesional_id) || null
      const nombre = prof ? ((prof.nombre || prof.apellido ? [prof.nombre, prof.apellido].filter(Boolean).join(' ') : null) || (prof.username ? `@${prof.username}` : '—')) : '—'
      return { ...p, _nombre: nombre, _cedula: prof?.cedula || '', _rol: prof?.rol || null }
    })
    .filter(p => {
      if (profFilter !== 'todos' && p._rol !== profFilter) return false
      if (!enRango(p.created_at, desdeP, hastaP)) return false
      if (q || qc) {
        const enTexto = norm(`${p._nombre} ${p.codigo || ''}`).includes(q)
        const enCedula = qc && normCedula(p._cedula).includes(qc)
        if (!(enTexto || enCedula)) return false
      }
      return true
    })
}
