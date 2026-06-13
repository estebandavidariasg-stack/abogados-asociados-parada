// src/components/chat/SolicitudesAbiertas.jsx
// Notificaciones de "solicitudes abiertas" (modelo claim tipo Uber/DiDi).
// Aparecen como tarjetas apiladas arriba a la derecha, cada una con un anillo
// cronómetro: el profesional puede TOMAR o DESCARTAR, y si no hace nada la
// tarjeta desaparece sola tras VIDA_S segundos. El claim es atómico server-side
// (api/tomar-solicitud.js): el primero gana, el resto recibe 409. La lista se
// mantiene fresca por realtime sobre chat_rooms (+ respaldo cada 30 s).
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './SolicitudesAbiertas.module.css'

const VIDA_S = 15        // segundos que vive una tarjeta antes de auto-descartarse
const MAX_VISIBLES = 4   // cuántas tarjetas se muestran a la vez

function hace(ts) {
  if (!ts) return ''
  const min = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

const R = 15
const CIRC = 2 * Math.PI * R

function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return ((partes[0][0] || '') + (partes[1]?.[0] || '')).toUpperCase()
}

// ── Tarjeta individual con cronómetro propio ───────────────────────────────
function TarjetaSolicitud({ s, tomando, onTomar, onDescartar, onExpirar }) {
  const [seg, setSeg] = useState(VIDA_S)
  useEffect(() => {
    const t = setInterval(() => {
      setSeg(prev => {
        if (prev <= 1) { clearInterval(t); onExpirar(s.id); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [s.id, onExpirar])

  const urgente = seg <= 10

  return (
    <motion.div
      className={styles.card}
      layout
      initial={{ opacity: 0, x: 60, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <div className={styles.cardTop}>
        <span className={styles.tag}><span className={styles.tagDot} />Nueva solicitud</span>
        <span
          className={`${styles.timer} ${urgente ? styles.timerUrge : ''}`}
          style={{ '--circ': CIRC, animationDuration: `${VIDA_S}s` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 36 36" width="36" height="36">
            <circle className={styles.timerTrack} cx="18" cy="18" r={R} />
            <circle className={styles.timerProg} cx="18" cy="18" r={R} style={{ strokeDasharray: CIRC }} />
          </svg>
          <span className={styles.timerNum}>{seg}</span>
        </span>
      </div>

      <p className={styles.area}>{s.area_derecho || 'Consulta general'}</p>
      {s.resumen && <p className={styles.resumen}>{s.resumen}</p>}

      <div className={styles.metaRow}>
        <span className={styles.avatar}>{iniciales(s.client_nombre)}</span>
        <span className={styles.metaText}>
          <span className={styles.cliente}>{s.client_nombre || 'Anónimo'}</span>
          <span className={styles.tiempo}>Publicada {hace(s.created_at)}</span>
        </span>
      </div>

      <div className={styles.acciones}>
        <button className={styles.descartar} onClick={() => onDescartar(s.id)}>Descartar</button>
        <button className={styles.tomar} onClick={() => onTomar(s.id)} disabled={tomando === s.id}>
          {tomando === s.id ? 'Tomando…' : 'Tomar caso'}
        </button>
      </div>
    </motion.div>
  )
}

// Props:
//  tipoProfesional: 'abogado' | 'contador'
//  onTomada(roomId): el padre refresca su lista de salas y abre el chat
export default function SolicitudesAbiertas({ tipoProfesional = 'abogado', onTomada }) {
  const [solicitudes, setSolicitudes] = useState([])
  const [tomando, setTomando] = useState(null)
  const [aviso, setAviso] = useState(null)
  const descartadas = useRef(new Set())      // ids ya descartados/expirados esta sesión
  const refetchTimer = useRef(null)
  const avisoTimer = useRef(null)

  const fetchOpen = useCallback(async () => {
    try {
      const headers = await getAuthHeaders()
      // Endpoint service-role: trae las salas open + un resumen corto del caso
      // (extraído del primer mensaje), aunque la RLS no deje al profesional
      // leer salas que aún no tomó.
      const res = await fetch('/api/solicitudes-abiertas', { headers })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      const rows = Array.isArray(data?.solicitudes) ? data.solicitudes : []
      const filtradas = rows.filter(r => !descartadas.current.has(r.id))
      setSolicitudes(filtradas)
    } catch { /* silencio: respaldo por polling */ }
  }, [tipoProfesional])

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current)
    refetchTimer.current = setTimeout(fetchOpen, 400)
  }, [fetchOpen])

  useEffect(() => {
    fetchOpen()
    const ch = supabase.channel(`open:${tipoProfesional}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, scheduleRefetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms' }, scheduleRefetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_rooms' }, scheduleRefetch)
      .subscribe()
    const poll = setInterval(() => { if (!document.hidden) fetchOpen() }, 30000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
    }
  }, [tipoProfesional, fetchOpen, scheduleRefetch])

  function mostrarAviso(msg) {
    setAviso(msg)
    if (avisoTimer.current) clearTimeout(avisoTimer.current)
    avisoTimer.current = setTimeout(() => setAviso(null), 3500)
  }

  function quitar(roomId) {
    descartadas.current.add(roomId)
    setSolicitudes(prev => prev.filter(s => s.id !== roomId))
  }

  const onExpirar = useCallback((roomId) => {
    descartadas.current.add(roomId)
    setSolicitudes(prev => prev.filter(s => s.id !== roomId))
  }, [])

  async function tomar(roomId) {
    if (tomando) return
    setTomando(roomId)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/tomar-solicitud', {
        method: 'POST', headers, body: JSON.stringify({ roomId }),
      })
      if (res.status === 409) {
        quitar(roomId)
        mostrarAviso('Esa consulta ya fue tomada por otro profesional.')
      } else if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        mostrarAviso(d?.mensaje || d?.error || 'No se pudo tomar la consulta.')
      } else {
        quitar(roomId)
        mostrarAviso('¡Tomaste la consulta! Ya está en tus chats.')
        onTomada?.(roomId)
      }
    } catch {
      mostrarAviso('Error de red. Intenta de nuevo.')
    } finally {
      setTomando(null)
    }
  }

  const visibles = solicitudes.slice(0, MAX_VISIBLES)
  const extra = solicitudes.length - visibles.length

  if (visibles.length === 0 && !aviso) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className={styles.stack} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {visibles.map(s => (
          <TarjetaSolicitud
            key={s.id}
            s={s}
            tomando={tomando}
            onTomar={tomar}
            onDescartar={quitar}
            onExpirar={onExpirar}
          />
        ))}
        {extra > 0 && (
          <motion.div
            key="extra"
            className={styles.extra}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            +{extra} solicitud{extra === 1 ? '' : 'es'} más en espera
          </motion.div>
        )}
        {aviso && (
          <motion.div
            key="aviso"
            className={styles.aviso}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {aviso}
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
