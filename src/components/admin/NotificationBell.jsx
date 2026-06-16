import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './NotificationBell.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   Centro de notificaciones del superadmin (campanita del panel admin).

   - Lee `notificaciones` no leídas por REST (RLS: solo superadmin). Poll 30s,
     pausado con la pestaña oculta.
   - Dos tipos de tarjeta: `inactividad` (→ reasignar) y `verificacion`
     (→ ver conversación, vía onOpenRoom).
   - Dropdown y modal van portaleados a <body> para escapar el backdrop-filter
     del panel (si no, position:fixed se ancla al contenedor y queda recortado).
───────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

function fmtHace(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  return `hace ${d}d`
}

function IconBell() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

export default function NotificationBell({ onOpenRoom }) {
  const [open, setOpen]         = useState(false)
  const [items, setItems]       = useState([])
  const [reassign, setReassign] = useState(null)   // notificación en reasignación
  const [coords, setCoords]     = useState(null)   // posición del dropdown (anclado a la campana)
  const wrapRef = useRef(null)
  const dropRef = useRef(null)
  const btnRef  = useRef(null)

  // Mide la campana y posiciona el panel justo debajo, alineado a la derecha.
  // En pantallas angostas lo fijamos al borde derecho (sin importar dónde esté
  // la campana) para que el panel no se salga ni se corte por la izquierda.
  const updateCoords = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const narrow = window.innerWidth <= 560
    setCoords({
      top: r.bottom + 8,
      right: narrow ? 12 : Math.max(8, window.innerWidth - r.right),
    })
  }, [])

  /* ── Cargar no leídas (RLS superadmin) ── */
  const fetchItems = useCallback(async () => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/notificaciones?leido=eq.false&order=created_at.desc&select=*`,
        { headers }
      )
      const data = await res.json()
      if (Array.isArray(data)) setItems(data)
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => {
    fetchItems()
    const id = setInterval(() => { if (!document.hidden) fetchItems() }, 30_000)
    const onVis = () => { if (!document.hidden) fetchItems() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchItems])

  /* ── Cerrar dropdown: click afuera + Escape ── */
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      // El dropdown va portaleado a <body> → fuera de wrapRef; por eso
      // chequeamos también dropRef.
      if (wrapRef.current?.contains(e.target)) return
      if (dropRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /* ── Mantener el panel pegado a la campana al hacer scroll/resize ── */
  useEffect(() => {
    if (!open) return
    updateCoords()
    window.addEventListener('resize', updateCoords)
    window.addEventListener('scroll', updateCoords, true)   // capture: cualquier contenedor scrollable
    return () => {
      window.removeEventListener('resize', updateCoords)
      window.removeEventListener('scroll', updateCoords, true)
    }
  }, [open, updateCoords])

  async function markRead(id) {
    setItems(prev => prev.filter(n => n.id !== id))   // optimista
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ leido: true }),
      })
    } catch { fetchItems() }   // si falla, re-sincroniza
  }

  async function markAll() {
    if (items.length === 0) return
    const ids = items.map(n => n.id)
    setItems([])
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ leido: true }),
      })
    } catch { fetchItems() }
  }

  function verConversacion(n) {
    markRead(n.id)
    setOpen(false)
    onOpenRoom?.(n.room_id)
  }

  const count = items.length

  const dropdown = (
    <div
      className={styles.dropdown}
      role="dialog"
      aria-label="Notificaciones"
      ref={dropRef}
      style={coords ? { top: coords.top, right: coords.right } : undefined}
    >
      <div className={styles.dropHeader}>
        <span className={styles.dropTitle}>Notificaciones</span>
        {count > 0 && (
          <button className={styles.markAll} onClick={markAll}>Marcar todas leídas</button>
        )}
      </div>

      <div className={styles.list}>
        {count === 0 && (
          <div className={styles.empty}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p>No tienes notificaciones pendientes.</p>
          </div>
        )}

        {items.map(n => (
          <div key={n.id} className={styles.card}>
            <div className={`${styles.cardIcon} ${n.tipo === 'inactividad' ? styles.iconWarn : styles.iconReview}`}>
              {n.tipo === 'inactividad' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  <path d="M12 9v4" /><path d="M12 17h.01" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
              )}
            </div>

            <div className={styles.cardBody}>
              <div className={styles.cardTop}>
                <span className={styles.cardTipo}>
                  {n.tipo === 'inactividad' ? 'Inactividad' : 'Verificación'}
                </span>
                <span className={styles.cardTime}>{fmtHace(n.created_at)}</span>
              </div>
              <p className={styles.cardCliente}>
                Cliente: <strong>{n.client_nombre || 'Anónimo'}</strong>
                {n.area ? ` · ${n.area}` : ''}
              </p>
              {n.mensaje && <p className={styles.cardMsg}>{n.mensaje}</p>}

              <div className={styles.cardActions}>
                {n.tipo === 'inactividad' ? (
                  <button className={styles.btnPrimary} onClick={() => setReassign(n)}>
                    Reasignar abogado
                  </button>
                ) : (
                  <button className={styles.btnPrimary} onClick={() => verConversacion(n)}>
                    Ver conversación
                  </button>
                )}
                <button className={styles.btnGhost} onClick={() => markRead(n.id)}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.bell} ${open ? styles.bellOpen : ''}`}
        onClick={() => { if (!open) updateCoords(); setOpen(o => !o) }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Notificaciones, ${count} sin leer` : 'Notificaciones'}
      >
        <IconBell />
        {count > 0 && <span className={styles.badge}>{count > 9 ? '9+' : count}</span>}
      </button>

      {/* Anuncio para lectores de pantalla */}
      <span className={styles.srOnly} aria-live="polite">
        {count > 0 ? `${count} notificaciones sin leer` : ''}
      </span>

      {open && (typeof document !== 'undefined' ? createPortal(dropdown, document.body) : dropdown)}

      {reassign && (
        <ReassignModal
          notif={reassign}
          onClose={() => setReassign(null)}
          onDone={() => {
            setItems(prev => prev.filter(n => n.id !== reassign.id))
            setReassign(null)
          }}
        />
      )}
    </div>
  )
}

/* ── Modal de reasignación (portaleado, focus-trap, picker de abogado) ── */
function ReassignModal({ notif, onClose, onDone }) {
  const [candidates, setCandidates] = useState([])
  const [selected, setSelected]     = useState('')
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const cardRef   = useRef(null)
  const selectRef = useRef(null)

  // Cargar candidatos: abogados del mismo tipo + área, excluyendo al actual.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const rRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${notif.room_id}&select=tipo_profesional&limit=1`,
          { headers }
        )
        const [room] = await rRes.json()
        const rol = room?.tipo_profesional || 'abogado'
        const pRes = await fetch(`/api/professionals?rol=${rol}`)
        const all = pRes.ok ? await pRes.json() : []
        const tokens = (notif.area || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
        let cands = (Array.isArray(all) ? all : []).filter(l => l.id !== notif.lawyer_id)
        const byArea = cands.filter(l => tokens.some(a => (l.area_derecho || '').toLowerCase().includes(a)))
        cands = byArea.length ? byArea : cands   // fallback: todos del tipo
        if (cancel) return
        setCandidates(cands)
        setSelected(cands[0]?.id || '')
      } catch {
        if (!cancel) setError('No se pudieron cargar los abogados disponibles.')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [notif])

  // Foco inicial + trap + Escape.
  useEffect(() => {
    const prevFocus = document.activeElement
    const t = setTimeout(() => selectRef.current?.focus(), 40)
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) { onClose(); return }
      if (e.key !== 'Tab' || !cardRef.current) return
      const focusables = cardRef.current.querySelectorAll(
        'button, select, [href], input, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0], last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prevFocus && prevFocus.focus) prevFocus.focus()   // devolver foco
    }
  }, [submitting, onClose])

  async function confirmar() {
    if (!selected || submitting) return
    setSubmitting(true); setError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/reassign', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roomId: notif.room_id,
          oldLawyerId: notif.lawyer_id || null,
          newLawyerId: selected,
          notifId: notif.id,
        }),
      })
      if (!res.ok) throw new Error()
      onDone()
    } catch {
      setError('No se pudo reasignar. Intenta de nuevo.')
      setSubmitting(false)
    }
  }

  const overlay = (
    <div
      className={styles.modalOverlay}
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reassignTitle"
    >
      <div className={styles.modalCard} onClick={e => e.stopPropagation()} ref={cardRef}>
        <div className={styles.modalIcon}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 3h5v5" /><path d="M21 3l-7 7" />
            <path d="M8 21H3v-5" /><path d="M3 21l7-7" />
          </svg>
        </div>
        <h3 id="reassignTitle" className={styles.modalTitle}>Reasignar a otro profesional</h3>
        <p className={styles.modalText}>
          Cliente <strong>{notif.client_nombre || 'Anónimo'}</strong>
          {notif.area ? ` · ${notif.area}` : ''}. Elige el profesional que
          retomará la consulta; el cliente conserva el historial.
        </p>

        {loading ? (
          <p className={styles.modalLoading}>Cargando disponibles…</p>
        ) : candidates.length === 0 ? (
          <p className={styles.modalEmpty}>No hay otros profesionales disponibles para esta área.</p>
        ) : (
          <div className={styles.field}>
            <label htmlFor="reassignSelect" className={styles.fieldLabel}>Profesional disponible</label>
            <select
              id="reassignSelect"
              ref={selectRef}
              className={styles.select}
              value={selected}
              onChange={e => setSelected(e.target.value)}
              disabled={submitting}
            >
              {candidates.map(c => (
                <option key={c.id} value={c.id}>
                  {`${c.nombre || ''} ${c.apellido || ''}`.trim()}
                  {c.ciudad ? ` — ${c.ciudad}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className={styles.modalError}>{error}</p>}

        <div className={styles.modalActions}>
          <button className={styles.btnCancel} onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            className={styles.btnConfirm}
            onClick={confirmar}
            disabled={submitting || loading || !selected}
          >
            {submitting ? 'Reasignando…' : 'Confirmar reasignación'}
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
