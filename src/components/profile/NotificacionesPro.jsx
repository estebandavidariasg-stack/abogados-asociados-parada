/* ────────────────────────────────────────────────────────────────────────
   Centro de notificaciones del PROFESIONAL (abogado y contador).

   Dos piezas, usadas por ProfilePage y ProfileContadorPage:

   · useProBadges(userId)  → contadores en vivo para los badges del riel:
       consultas : mensajes de clientes sin leer (chat_seen_ de los dashboards)
       interno   : DMs del admin sin leer (mensajes_internos.leido)
       pagos     : pagos a la plataforma pendientes (pagos_profesional)
       notis     : filas de `notificaciones` del profesional (pago/inactividad…)
     Sondeo cada 30s, pausado con la pestaña oculta (mismo patrón que la
     campana del admin). "Leído" de la campana es LOCAL (localStorage
     noti_seen_<uid>), igual que el visto de consultas: el profesional no
     escribe en `notificaciones` (esa tabla la gestiona el admin).

   · <CampanaPro>          → campana flotante con panel: accesos con contador
     a Consultas / Chat interno / Pagos + el historial de avisos del admin
     (cobro definido, luz verde, consulta inactiva…).

   Requiere en Supabase la política de SELECT para el profesional
   (docs/sql/notificaciones-profesional-2026-08-31.sql); sin ella la campana
   degrada a solo los contadores locales, sin romper.
──────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './NotificacionesPro.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(n) || 0)

// "hace 5 min" / "hace 2 h" / "ayer" / fecha corta
function haceCuanto(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

// Texto e ícono por tipo de notificación (fallback si mensaje viene vacío).
const TIPO_INFO = {
  pago:        { label: 'Pago',      fallback: 'Novedad en un pago de plataforma.' },
  cobro:       { label: 'Cobro',     fallback: 'Novedad en un cobro.' },
  inactividad: { label: 'Atención',  fallback: 'Tienes una consulta sin atender hace más de 24h.' },
  verificacion:{ label: 'Revisión',  fallback: 'Solicitud de revisión registrada.' },
  reasignacion_obligatoria: { label: 'Reasignación', fallback: 'Una consulta tuya entró a reasignación por inactividad.' },
}

/* ── Hook de contadores ──────────────────────────────────────────────── */
export function useProBadges(userId, { activo = true } = {}) {
  const [badges, setBadges] = useState({ consultas: 0, interno: 0, pagos: 0 })
  const [notis, setNotis]   = useState([])
  const [notiSeenTs, setNotiSeenTs] = useState(() =>
    Number(localStorage.getItem(userId ? `noti_seen_${userId}` : '') || 0)
  )
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!userId || inFlight.current) return
    inFlight.current = true
    try {
      const headers = await getAuthHeaders()
      const get = async (pathQuery) => {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, { headers })
        if (!r.ok) return null
        const j = await r.json()
        return Array.isArray(j) ? j : null
      }

      // Pagos pendientes + DMs sin leer + salas del profesional, en paralelo.
      const [pagos, dms, asigns] = await Promise.all([
        get(`pagos_profesional?profesional_id=eq.${userId}&estado=eq.pendiente&select=id`),
        get(`mensajes_internos?to_id=eq.${userId}&leido=eq.false&select=id`),
        get(`chat_room_lawyers?lawyer_id=eq.${userId}&select=room_id`),
      ])

      // Mensajes de clientes sin leer: solo salas abiertas, comparados contra
      // el "visto" local de los dashboards (chat_seen_<uid>) — misma semántica
      // que el badge por sala del dashboard. Se acota a los 500 mensajes más
      // recientes para no cargar historiales completos.
      let consultas = 0
      const roomIds = (asigns || []).map(a => a.room_id).filter(Boolean)
      if (roomIds.length) {
        const abiertas = await get(
          `chat_rooms?id=in.(${roomIds.join(',')})&status=in.(waiting,active)&select=id`
        )
        const ids = (abiertas || []).map(r => r.id)
        if (ids.length) {
          const msgs = await get(
            `chat_messages?room_id=in.(${ids.join(',')})` +
            `&select=room_id,sender_type,created_at&order=created_at.desc&limit=500`
          )
          let seen = {}
          try { seen = JSON.parse(localStorage.getItem(`chat_seen_${userId}`) || '{}') } catch { /* noop */ }
          // Igual que el dashboard: cuenta mensajes del cliente posteriores a
          // max(última respuesta del profesional, último visto local).
          const ultimaRespuesta = {}
          for (const m of (msgs || [])) {
            if (m.sender_type !== 'client') {
              const t = new Date(m.created_at).getTime()
              if (!ultimaRespuesta[m.room_id] || t > ultimaRespuesta[m.room_id]) ultimaRespuesta[m.room_id] = t
            }
          }
          consultas = (msgs || []).filter(m => {
            if (m.sender_type !== 'client') return false
            const corte = Math.max(
              ultimaRespuesta[m.room_id] || 0,
              seen[m.room_id] ? new Date(seen[m.room_id]).getTime() : 0
            )
            return new Date(m.created_at).getTime() > corte
          }).length
        }
      }

      setBadges({
        consultas,
        interno: (dms || []).length,
        pagos:   (pagos || []).length,
      })

      // Avisos PROPIOS del profesional (requiere la política de SELECT).
      // Solo tipos de sus funciones (pagos/cobros de sus consultas): las filas
      // de gestión del admin (inactividad, verificación, reasignación, reportes)
      // también llevan lawyer_id, así que se excluyen por tipo. Además se
      // descartan los avisos "espejo" dirigidos al admin ("Un profesional …").
      const filas = await get(
        `notificaciones?lawyer_id=eq.${userId}` +
        `&tipo=in.(pago)` +
        `&mensaje=not.ilike.${encodeURIComponent('Un profesional*')}` +
        `&select=id,tipo,mensaje,monto,created_at&order=created_at.desc&limit=30`
      )
      setNotis(filas || [])
    } catch { /* siguiente sondeo */ }
    finally { inFlight.current = false }
  }, [userId])

  useEffect(() => {
    if (!userId || !activo) return
    refresh()
    const t = setInterval(() => { if (!document.hidden) refresh() }, 30_000)
    const onVisible = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [userId, activo, refresh])

  const notisNoLeidas = notis.filter(n => new Date(n.created_at).getTime() > notiSeenTs).length

  const marcarNotisLeidas = useCallback(() => {
    const ts = Date.now()
    if (userId) localStorage.setItem(`noti_seen_${userId}`, String(ts))
    setNotiSeenTs(ts)
  }, [userId])

  return { badges, notis, notisNoLeidas, notiSeenTs, marcarNotisLeidas, refresh }
}

/* ── Campana en la cabecera del contenido (como en el panel del admin) ── */
//  Vive EN EL FLUJO de la página: una barra alineada a la derecha, encima de
//  la sección activa — empuja el contenido en vez de taparlo. El dropdown se
//  monta por portal (position fixed) anclado bajo el botón.
export function CampanaPro({ badges, notis, notisNoLeidas, notiSeenTs, onMarcarLeidas, onGoSection }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 60, width: 370 })
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const total = badges.consultas + badges.interno + badges.pagos + notisNoLeidas

  function toggle() {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    const w = Math.min(370, window.innerWidth - 28)
    // Alineado al borde derecho del botón, desplegado hacia abajo.
    let left = (r?.right ?? window.innerWidth - 14) - w
    if (left < 14) left = 14
    const top = Math.min((r?.bottom ?? 60) + 10, window.innerHeight - 220)
    setPos({ left, top, width: w })
    setOpen(true)
  }

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const accesos = [
    { id: 'consultas', label: 'Mensajes de clientes', hint: 'Consultas',   n: badges.consultas },
    { id: 'interno',   label: 'Mensajes del administrador', hint: 'Chat interno', n: badges.interno },
    { id: 'pagos',     label: 'Pagos de plataforma pendientes', hint: 'Pagos', n: badges.pagos },
  ].filter(a => a.n > 0)

  return (
    <div className={styles.notiBar}>
      <button
        ref={btnRef}
        type="button"
        className={styles.bellBtn}
        onClick={toggle}
        aria-expanded={open}
        aria-label={total > 0 ? `Notificaciones: ${total} sin leer` : 'Notificaciones'}
        title={total > 0 ? `Notificaciones · ${total} sin leer` : 'Notificaciones'}
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {total > 0 && <span className={styles.bellBadge}>{total > 9 ? '9+' : total}</span>}
      </button>

      {open && createPortal(
        <div
          className={styles.panel}
          ref={panelRef}
          role="dialog"
          aria-label="Panel de notificaciones"
          style={{ left: pos.left, top: pos.top, width: pos.width }}
        >
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Notificaciones</span>
            {notisNoLeidas > 0 && (
              <button type="button" className={styles.markRead} onClick={onMarcarLeidas}>
                Marcar leídas
              </button>
            )}
          </div>

          {/* Accesos con contador a las secciones con novedades */}
          {accesos.length > 0 && (
            <div className={styles.quickList}>
              {accesos.map(a => (
                <button
                  key={a.id}
                  type="button"
                  className={styles.quickItem}
                  onClick={() => { setOpen(false); onGoSection?.(a.id) }}
                >
                  <span className={styles.quickCount}>{a.n > 9 ? '9+' : a.n}</span>
                  <span className={styles.quickLabel}>{a.label}</span>
                  <span className={styles.quickGo}>Ir a {a.hint} →</span>
                </button>
              ))}
            </div>
          )}

          {/* Avisos del administrador (pagos, inactividad, reasignación…) */}
          <div className={styles.feed}>
            {notis.length === 0 && accesos.length === 0 && (
              <p className={styles.empty}>Estás al día. Aquí verás tus avisos de pagos, consultas sin atender y novedades del administrador.</p>
            )}
            {notis.map(n => {
              const info = TIPO_INFO[n.tipo] || { label: 'Aviso', fallback: 'Novedad en tu cuenta.' }
              const sinLeer = new Date(n.created_at).getTime() > notiSeenTs
              return (
                <div key={n.id} className={styles.item} data-unread={sinLeer || undefined}>
                  <span className={styles.itemDot} data-tipo={n.tipo} aria-hidden="true" />
                  <div className={styles.itemBody}>
                    <span className={styles.itemTipo}>{info.label}</span>
                    <p className={styles.itemMsg}>
                      {n.mensaje || info.fallback}
                      {Number(n.monto) > 0 && <strong> · {fmtCOP(n.monto)}</strong>}
                    </p>
                    <span className={styles.itemWhen}>{haceCuanto(n.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
