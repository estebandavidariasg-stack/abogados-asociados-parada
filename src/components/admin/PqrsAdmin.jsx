import { useEffect, useState } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
// Reutiliza la hoja de estilos del panel de reseñas: misma tarjeta, mismos
// filtros y mismos estados vacíos, para que los dos paneles se vean igual.
import styles from './ResenasAdmin.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   PqrsAdmin — peticiones, quejas y reclamos que envía el cliente al cerrar
   su consulta (tabla `pqr`). El admin las lee y las marca como atendidas.
   Requiere las políticas SELECT/UPDATE de superadmin sobre `pqr` — ver
   docs/sql/pqr-radicado-2026-09-17.sql.
   ───────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const TIPO_LABEL = { peticion: 'Petición', queja: 'Queja', reclamo: 'Reclamo' }
// Se pagina solo cuando la lista pasa de una página; por debajo no aparece nada.
const POR_PAGINA = 30

// Formato corto: en la cabecera de la tarjeta una fecha larga se parte en dos
// líneas y desalinea los chips de tipo y estado.
const fmt = (ts) => new Date(ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
// Día local en formato YYYY-MM-DD, el mismo que devuelven los <input type="date">.
const soloFecha = (ts) => (ts ? new Date(ts).toLocaleDateString('sv') : '')

export default function PqrsAdmin() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tipo, setTipo]       = useState('todos')      // todos | peticion | queja | reclamo
  const [estado, setEstado]   = useState('pendientes') // pendientes | atendidas | todas
  const [q, setQ]             = useState('')
  const [pagina, setPagina]   = useState(1)
  const [desde, setDesde]     = useState('')           // YYYY-MM-DD
  const [hasta, setHasta]     = useState('')
  const [busy, setBusy]       = useState(null)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pqr?select=*&order=created_at.desc&limit=300`,
          { headers }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancel) setRows(Array.isArray(data) ? data : [])
      } catch {
        if (!cancel) setError('No se pudieron cargar las PQRS. Revisa que la política de lectura del superadmin esté aplicada.')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [])

  // Cambiar cualquier filtro devuelve a la primera página.
  useEffect(() => { setPagina(1) }, [tipo, estado, q, desde, hasta])

  // `leido` es la marca de atendida en la tabla.
  async function marcarAtendida(r, atendida) {
    setBusy(r.id)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pqr?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ leido: atendida }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRows(rs => rs.map(x => (x.id === r.id ? { ...x, leido: atendida } : x)))
    } catch {
      setError('No se pudo actualizar el estado de la PQRS.')
    } finally { setBusy(null) }
  }

  const qn = norm(q.trim())
  const visibles = rows.filter(r => {
    if (tipo !== 'todos' && r.tipo !== tipo) return false
    if (estado === 'pendientes' && r.leido) return false
    if (estado === 'atendidas' && !r.leido) return false
    const dia = soloFecha(r.created_at)
    if (desde && dia < desde) return false
    if (hasta && dia > hasta) return false
    if (!qn) return true
    const hay = `${r.radicado || ''} ${r.client_nombre || ''} ${r.client_email || ''} ${r.codigo_referencia || ''} ${r.mensaje || ''}`
    return norm(hay).includes(qn)
  })
  const hayFiltros  = !!(q || desde || hasta || tipo !== 'todos')
  const totalPags = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const pagSegura = Math.min(pagina, totalPags)
  const enPagina  = visibles.slice((pagSegura - 1) * POR_PAGINA, pagSegura * POR_PAGINA)
  const nPendientes = rows.filter(r => !r.leido).length
  const nAtendidas  = rows.filter(r => r.leido).length

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>PQRS</h3>
          <p className={styles.sub}>
            Peticiones, quejas y reclamos enviados por los clientes al terminar su consulta.
          </p>
        </div>
        <div className={styles.tabs} role="tablist">
          {[
            ['pendientes', `Pendientes (${nPendientes})`],
            ['atendidas', `Atendidas (${nAtendidas})`],
            ['todas', 'Todas'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={estado === k}
              className={`${styles.tab} ${estado === k ? styles.tabOn : ''}`}
              onClick={() => setEstado(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filtroFila}>
          <div className={styles.filtroProf}>
            <span className={styles.searchIcon} aria-hidden="true">⌕</span>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Buscar por radicado, cliente, correo o texto…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar PQRS"
            />
            {q && (
              <button type="button" className={styles.clearBtn} onClick={() => setQ('')} aria-label="Limpiar búsqueda">×</button>
            )}
          </div>

          <div className={styles.fechas}>
            <label className={styles.campoFecha}>
              <span>Desde</span>
              <input type="date" className={styles.dateInput} value={desde}
                max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className={styles.campoFecha}>
              <span>Hasta</span>
              <input type="date" className={styles.dateInput} value={hasta}
                min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </div>

          {hayFiltros && (
            <button type="button" className={styles.btnLimpiar}
              onClick={() => { setQ(''); setDesde(''); setHasta(''); setTipo('todos') }}>
              Limpiar filtros
            </button>
          )}
        </div>

        <div className={styles.grupos}>
          <div className={styles.grupo}>
            <span className={styles.grupoLabel}>Tipo</span>
            <div className={styles.profesionChips} role="tablist" aria-label="Filtrar por tipo">
              {[
                ['todos', 'Todos'],
                ['peticion', 'Peticiones'],
                ['queja', 'Quejas'],
                ['reclamo', 'Reclamos'],
              ].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tipo === k}
                  className={`${styles.profesionChip} ${tipo === k ? styles.profesionChipActive : ''}`}
                  onClick={() => setTipo(k)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <p className={styles.muted}>{error}</p>}

      {loading ? (
        <p className={styles.muted}>Cargando PQRS…</p>
      ) : visibles.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>✉</span>
          <p>{rows.length === 0
            ? 'Aún no hay PQRS registradas.'
            : hayFiltros ? 'Ninguna PQRS coincide con estos filtros.' : 'No hay PQRS en este estado.'}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {enPagina.map(r => (
            <li key={r.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.pqrTipo}>{TIPO_LABEL[r.tipo] || r.tipo}</span>
                <span className={r.leido ? styles.atendida : styles.pendiente}>
                  {r.leido ? 'Atendida' : 'Pendiente'}
                </span>
                <span className={styles.fecha}>{fmt(r.created_at)}</span>
              </div>

              {r.radicado && <p className={styles.radicado}>{r.radicado}</p>}

              <p className={styles.texto}>{r.mensaje}</p>

              <p className={styles.meta}>
                <strong>{r.client_nombre || 'Cliente'}</strong>
                {r.client_email ? ` · ${r.client_email}` : ''}
                {r.codigo_referencia ? ` · ${r.codigo_referencia}` : ''}
              </p>

              <div className={styles.acciones}>
                {r.client_email && (
                  <a
                    className={styles.btnAprobar}
                    href={`mailto:${r.client_email}?subject=${encodeURIComponent(`Respuesta a tu ${(TIPO_LABEL[r.tipo] || 'solicitud').toLowerCase()}${r.radicado ? ` ${r.radicado}` : ''}`)}`}
                    style={{ textDecoration: 'none', textAlign: 'center' }}
                  >
                    Responder por correo
                  </a>
                )}
                {r.leido ? (
                  <button className={styles.btnQuitar} disabled={busy === r.id}
                    onClick={() => marcarAtendida(r, false)}>
                    Marcar pendiente
                  </button>
                ) : (
                  <button className={styles.btnAprobar} disabled={busy === r.id}
                    onClick={() => marcarAtendida(r, true)}>
                    ✓ Marcar atendida
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPags > 1 && (
        <div className={styles.pager}>
          <button type="button" className={styles.pagerBtn}
            onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagSegura <= 1}>
            ← Anterior
          </button>
          <span className={styles.pagerInfo}>
            Página {pagSegura} de {totalPags} · {visibles.length} en total
          </span>
          <button type="button" className={styles.pagerBtn}
            onClick={() => setPagina(p => Math.min(totalPags, p + 1))} disabled={pagSegura >= totalPags}>
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
