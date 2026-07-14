import { useEffect, useState, useCallback } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './ResenasAdmin.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   ResenasAdmin — panel superadmin para moderar las reseñas de la web.
   Ver recibidas, aprobar (→ aparecen en el home), quitar del home, eliminar.
   Lee/escribe por REST; la RLS restringe estas operaciones a superadmin.
   ───────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

function Estrellas({ n = 0 }) {
  return (
    <span className={styles.stars} aria-label={`${n} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? styles.starOn : styles.starOff}>★</span>
      ))}
    </span>
  )
}

const fmt = (ts) => new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

export default function ResenasAdmin() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('recibidas') // recibidas | home | todas
  const [busy, setBusy] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/resenas?texto=not.is.null&select=*&order=created_at.desc&limit=200`,
        { headers }
      )
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch { setRows([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function setAprobado(r, aprobado) {
    setBusy(r.id)
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/rest/v1/resenas?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ aprobado, estado: aprobado ? 'aprobada' : 'recibida' }),
      })
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, aprobado, estado: aprobado ? 'aprobada' : 'recibida' } : x)))
    } finally { setBusy(null) }
  }

  async function eliminar(r) {
    if (!window.confirm('¿Eliminar esta reseña? No se puede deshacer.')) return
    setBusy(r.id)
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/rest/v1/resenas?id=eq.${r.id}`, { method: 'DELETE', headers })
      setRows((rs) => rs.filter((x) => x.id !== r.id))
    } finally { setBusy(null) }
  }

  const visibles = rows.filter((r) =>
    filtro === 'home' ? r.aprobado : filtro === 'recibidas' ? !r.aprobado : true
  )
  const nRecibidas = rows.filter((r) => !r.aprobado).length
  const nHome = rows.filter((r) => r.aprobado).length

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>Reseñas de la página</h3>
          <p className={styles.sub}>Aprueba las que quieres mostrar en el inicio, o elimínalas.</p>
        </div>
        <div className={styles.tabs} role="tablist">
          {[
            ['recibidas', `Por revisar (${nRecibidas})`],
            ['home', `En el home (${nHome})`],
            ['todas', 'Todas'],
          ].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filtro === k}
              className={`${styles.tab} ${filtro === k ? styles.tabOn : ''}`}
              onClick={() => setFiltro(k)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className={styles.muted}>Cargando reseñas…</p>
      ) : visibles.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>★</span>
          <p>{filtro === 'home' ? 'Aún no hay reseñas publicadas en el home.' : 'No hay reseñas por revisar.'}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {visibles.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.cardTop}>
                <Estrellas n={r.rating} />
                {r.aprobado && <span className={styles.badge}>En el home</span>}
                <span className={styles.fecha}>{fmt(r.created_at)}</span>
              </div>
              {r.texto && <p className={styles.texto}>“{r.texto}”</p>}
              <p className={styles.meta}>
                <strong>{r.nombre || 'Anónimo'}</strong>{r.correo ? ` · ${r.correo}` : ''}
              </p>
              <div className={styles.acciones}>
                {r.aprobado ? (
                  <button className={styles.btnQuitar} disabled={busy === r.id} onClick={() => setAprobado(r, false)}>
                    Quitar del home
                  </button>
                ) : (
                  <button className={styles.btnAprobar} disabled={busy === r.id} onClick={() => setAprobado(r, true)}>
                    ✓ Aprobar y mostrar
                  </button>
                )}
                <button className={styles.btnEliminar} disabled={busy === r.id} onClick={() => eliminar(r)}>
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
