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

const ROL_LABEL = { abogado: 'Abogado', contador: 'Contador', gestor: 'Gestor', superadmin: 'Admin' }
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function ResenasAdmin() {
  const [rows, setRows] = useState([])
  const [profs, setProfs] = useState({}) // id → { nombre, apellido, rol, cedula }
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('recibidas') // recibidas | home | todas
  const [q, setQ] = useState('') // filtro por profesional (nombre o cédula)
  const [profesion, setProfesion] = useState('todos') // todos | abogado | contador
  const [busy, setBusy] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const [resR, resP] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/resenas?texto=not.is.null&select=*,professional_id&order=created_at.desc&limit=200`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/profiles?rol=in.(abogado,contador,gestor)&select=id,nombre,apellido,rol,cedula`,
          { headers }
        ),
      ])
      const data = await resR.json()
      setRows(Array.isArray(data) ? data : [])
      const pData = await resP.json()
      const map = {}
      if (Array.isArray(pData)) for (const p of pData) map[p.id] = p
      setProfs(map)
    } catch { setRows([]); setProfs({}) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const profNombre = useCallback((id) => {
    const p = id ? profs[id] : null
    if (!p) return ''
    return [p.nombre, p.apellido].filter(Boolean).join(' ')
  }, [profs])

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

  const qn = norm(q.trim())
  const visibles = rows.filter((r) => {
    const porTab = filtro === 'home' ? r.aprobado : filtro === 'recibidas' ? !r.aprobado : true
    if (!porTab) return false
    const p = r.professional_id ? profs[r.professional_id] : null
    // Filtro por profesión: excluye reseñas sin profesional resuelto cuando hay una profesión específica
    if (profesion !== 'todos') {
      if (!p || p.rol !== profesion) return false
    }
    if (!qn) return true
    // Con filtro de profesional (texto) activo, se excluyen reseñas sin professional_id
    if (!p) return false
    const hay = `${p.nombre || ''} ${p.apellido || ''} ${p.cedula || ''}`
    return norm(hay).includes(qn)
  })
  const nRecibidas = rows.filter((r) => !r.aprobado).length
  const nHome = rows.filter((r) => r.aprobado).length

  // Profesionales que efectivamente tienen reseñas (para el datalist de sugerencias)
  const conResenas = Array.from(new Set(rows.map((r) => r.professional_id).filter(Boolean)))
    .map((id) => profs[id])
    .filter(Boolean)
    .sort((a, b) => profNombre(a.id).localeCompare(profNombre(b.id), 'es'))

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

      <div className={styles.filterBar}>
        <div className={styles.profesionChips} role="tablist" aria-label="Filtrar por profesión">
          {[
            ['todos', 'Todos'],
            ['abogado', 'Abogados'],
            ['contador', 'Contadores'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={profesion === k}
              className={`${styles.profesionChip} ${profesion === k ? styles.profesionChipActive : ''}`}
              onClick={() => setProfesion(k)}>{label}</button>
          ))}
        </div>

        <div className={styles.filtroProf}>
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Buscar por profesional (nombre o cédula)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            list="resenas-prof-sugerencias"
            aria-label="Buscar reseñas por profesional"
          />
          <datalist id="resenas-prof-sugerencias">
            {conResenas.map((p) => (
              <option key={p.id} value={profNombre(p.id)} />
            ))}
          </datalist>
          {q && (
            <button type="button" className={styles.clearBtn} onClick={() => setQ('')} aria-label="Limpiar búsqueda">×</button>
          )}
        </div>
      </div>

      {loading ? (
        <p className={styles.muted}>Cargando reseñas…</p>
      ) : visibles.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>★</span>
          <p>{qn || profesion !== 'todos'
            ? 'No hay reseñas que coincidan con estos filtros.'
            : filtro === 'home' ? 'Aún no hay reseñas publicadas en el home.' : 'No hay reseñas por revisar.'}</p>
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
              {r.red_social && (
                <a
                  className={styles.redSocial}
                  href={r.red_social}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={r.red_social}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Red social
                </a>
              )}
              <p className={styles.prof}>
                {r.professional_id && profs[r.professional_id] ? (
                  <>
                    <span className={styles.profLabel}>Sobre</span>
                    <span className={styles.profNombre}>{profNombre(r.professional_id)}</span>
                    <span className={styles.rolBadge}>
                      {ROL_LABEL[profs[r.professional_id].rol] || profs[r.professional_id].rol}
                    </span>
                  </>
                ) : (
                  <span className={styles.profNone}>Profesional no especificado</span>
                )}
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
