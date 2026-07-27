import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { supabase, getAuthHeaders } from '../../lib/supabase'

// Modal de ubicar firma â†’ PDF (lazy: pdf.js solo baja al usarlo).
const UbicarFirma = lazy(() => import('../firma/UbicarFirma'))
import { contieneContacto } from '../../lib/validaciones'
import styles from './LawyerChatDashboard.module.css'
import AudioPlayer from './AudioPlayer'
import { ChatImage, openChatFile } from '../../lib/chatFiles'
import { IconPaperclip, IconMic, IconFirma } from '../shared/Icons'
import { pedirIA } from '../../lib/aiClient'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import Markdown from '../shared/Markdown'
import EnviarAFirmar from '../firma/EnviarAFirmar'
import { firmantesPendientes } from '../../lib/firmaService'

// Parseo seguro de los payloads JSON de los mensajes de firma.
function parseFirma(content) {
  try { const o = JSON.parse(content); return o?.t === 'firma' ? o : null } catch { return null }
}
function parseFirmaOk(content) {
  try { const o = JSON.parse(content); return o?.t === 'firma_ok' ? o : null } catch { return null }
}
// Texto de vista previa del Ãºltimo mensaje en el sidebar (evita mostrar el JSON
// crudo de los mensajes de firma).
function previewMsg(m) {
  if (m?.message_type === 'firma') return 'Documento para firmar'
  if (m?.message_type === 'firma_ok') return 'Documento firmado'
  return m?.content || ''
}

// Detecta si el archivo es imagen para renderizar preview inline (WhatsApp style).
function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
}

// Renderiza **negrillas** estilo markdown conservando los saltos de lÃ­nea.
function renderMensaje(text) {
  if (text == null) return text
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).map((parte, i) => {
    const m = parte.match(/^\*\*([^*\n]+)\*\*$/)
    return m ? <strong key={i}>{m[1]}</strong> : parte
  })
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Formatear fecha para el sidebar
   Â· Si es hoy â†’ solo hora "14:32"
   Â· Si es ayer â†’ "Ayer"
   Â· Si es esta semana â†’ "lun", "mar"â€¦
   Â· Si es mÃ¡s antiguo â†’ "12 ene"
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function fmtSidebar(ts) {
  if (!ts) return ''
  const d   = new Date(ts)
  const now = new Date()
  const diffMs   = now - d
  const diffDays = Math.floor(diffMs / 86400000)

  const mismaFecha = (a, b) =>
    a.getDate()     === b.getDate()   &&
    a.getMonth()    === b.getMonth()  &&
    a.getFullYear() === b.getFullYear()

  if (mismaFecha(d, now)) {
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }
  const ayer = new Date(now); ayer.setDate(ayer.getDate() - 1)
  if (mismaFecha(d, ayer)) return 'Ayer'
  if (diffDays < 7) {
    return d.toLocaleDateString('es-CO', { weekday: 'short' })
  }
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function fmtHora(ts) {
  return new Date(ts).toLocaleString('es-CO', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const STATUS_LABEL = { waiting: 'En espera', active: 'Activo', closed: 'Cerrado' }
const STATUS_COLOR = { waiting: '#e6a817', active: '#4caf50', closed: '#666' }

// Normaliza texto para bÃºsqueda: sin tildes, minÃºsculas. AsÃ­ "MarÃ­a" matchea
// con "maria" y "PeÃ±a" con "pena".
function normaliza(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Ãcono de lupa (buscador) â€” reutiliza el lenguaje visual del panel admin.
function IconLupa() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/* â”€â”€ Mapa de "Ãºltima vez visto" por sala (estilo WhatsApp) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Persistido en localStorage por usuario. Sin columna `seen_at` en la BD,
   asÃ­ que cada navegador lleva su propio estado â€” basta para el caso de uso
   (un abogado revisando sus chats). Si en el futuro se necesita sync entre
   dispositivos, migrar a tabla en Supabase.
   markSeen sÃ³lo avanza, nunca retrocede: evita que un fetch viejo pise un
   mark mÃ¡s reciente cuando llegan datos fuera de orden. */
function readSeen(uid) {
  if (!uid) return {}
  try { return JSON.parse(localStorage.getItem(`chat_seen_${uid}`) || '{}') }
  catch { return {} }
}
function markSeen(uid, roomId, ts) {
  if (!uid || !roomId) return
  const key = `chat_seen_${uid}`
  let map = {}
  try { map = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
  const newTs = ts || new Date().toISOString()
  if (!map[roomId] || new Date(newTs) > new Date(map[roomId])) {
    map[roomId] = newTs
    try { localStorage.setItem(key, JSON.stringify(map)) } catch {}
  }
}

export default function LawyerChatDashboard({ lawyerId, canDownloadFiles = false }) {
  const prefersReducedMotion = useReducedMotion()
  const [rooms,       setRooms]       = useState([])
  const [activeRoom,  setActiveRoom]  = useState(null)
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [sending,     setSending]     = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [closing,     setClosing]     = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmVerificar, setConfirmVerificar] = useState(false)
  const [sendingVerificar, setSendingVerificar] = useState(false)
  const [contactoBlocked, setContactoBlocked] = useState(false)
  const [canDownload, setCanDownload] = useState(canDownloadFiles)
  // Salas a las que ya se les solicitÃ³ revisiÃ³n en esta sesiÃ³n. No hay
  // columna en BD para persistirlo, asÃ­ que es estado por-navegador: basta
  // para evitar reenvÃ­os accidentales y mostrar el tag "RevisiÃ³n solicitada".
  const [verifiedRooms, setVerifiedRooms] = useState(() => new Set())
  const [rating,      setRating]      = useState(0)
  const [showRating,  setShowRating]  = useState(false)
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [iaResultado, setIaResultado] = useState(null)
  const [iaCargando, setIaCargando]   = useState(false)
  const [iaTipo, setIaTipo]           = useState('resumen')
  const [iaCopiado, setIaCopiado]     = useState(false)

  // â”€â”€ Filtros del sidebar (bÃºsqueda por nombre + rango de fechas) â”€â”€
  // Estado en el componente padre â†’ los inputs se renderizan inline y no
  // pierden el foco al teclear (no se remontan).
  const [buscar,      setBuscar]      = useState('')
  const [fechaDesde,  setFechaDesde]  = useState('')
  const [fechaHasta,  setFechaHasta]  = useState('')

  const fileRef   = useRef(null)
  const mensajesRef = useRef(null)
  const lastCountRef = useRef(0)
  const pollRooms = useRef(null)

  // â”€â”€ Voz â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [recording, setRecording]           = useState(false)
  const [recordingTime, setRecordingTime]   = useState(0)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // â”€â”€ Toast visual (reemplaza alert() del navegador al click de archivo) â”€â”€
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Al desmontar con una grabaciÃ³n activa: libera el micrÃ³fono y el timer.
  // Sin esto el indicador de mic del navegador quedaba encendido y el interval
  // seguÃ­a corriendo si el profesional navegaba a mitad de grabaciÃ³n.
  useEffect(() => () => {
    clearInterval(recordingTimerRef.current)
    const r = mediaRecorderRef.current
    if (r && r.state !== 'inactive') {
      r.onstop = null   // evita disparar la subida de un audio parcial
      try { r.stream.getTracks().forEach(t => t.stop()); r.stop() } catch (_) { /* noop */ }
    }
  }, [])

  // Polling del permiso de descarga â€” se actualiza sin recargar si el admin lo cambia
  useEffect(() => {
    if (!lawyerId) return
    async function fetchPermiso() {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${lawyerId}&select=puede_descargar_archivos`,
          { headers }
        )
        const [data] = await res.json()
        if (data) setCanDownload(!!data.puede_descargar_archivos)
      } catch { /* silencioso */ }
    }
    fetchPermiso()
    // Pausar el polling cuando la pestaÃ±a estÃ¡ oculta: no malgastar queries
    // contra la BD si el profesional no estÃ¡ mirando.
    const interval = setInterval(() => { if (!document.hidden) fetchPermiso() }, 60_000)
    return () => clearInterval(interval)
  }, [lawyerId])

  // â”€â”€ Lightbox para imÃ¡genes (click en thumbnail = abrir fullscreen) â”€â”€
  const [lightbox, setLightbox] = useState(null)
  const [firmaOpen, setFirmaOpen] = useState(false)
  const [adjuntarMenu, setAdjuntarMenu] = useState(false)  // menÃº del clip
  const [dragging, setDragging] = useState(false)          // arrastrar-soltar
  const [ubicarFirma, setUbicarFirma] = useState(null)     // payload firma_ok para ubicar

  // Genera y descarga el certificado de firma (PDF) al vuelo desde la traza.
  async function descargarCertificado(solicitudId) {
    try {
      const headers = await getAuthHeaders()
      const filas = await firmantesPendientes(solicitudId, headers)
      const { generarCertificadoPdf } = await import('../../lib/firmaPdf')
      const bytes = await generarCertificadoPdf({
        solicitudId,
        docHash: filas.find(f => f.doc_hash)?.doc_hash || '',
        firmantes: filas.map(f => ({ nombre: f.nombre, cedula: f.cedula, correo: f.correo, rol: f.rol_firma, firmado_at: f.firmado_at, ip: f.ip, user_agent: f.user_agent })),
      })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'certificado-de-firma.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { setToast('No se pudo generar el certificado.') }
  }

  // Publica en el hilo el mensaje de firma para que el cliente lo firme.
  async function publicarFirma(sol, filas, docPath) {
    const cliente = filas.find(f => f.rol_firma === 'cliente') || filas[0]
    const payload = JSON.stringify({
      t: 'firma', solicitudId: sol.id, docPath,
      firmanteId: cliente?.id, correo: cliente?.correo,
    })
    try {
      const headers = await getAuthHeaders()
      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: activeRoom.id,
          sender_type: 'lawyer',
          content: payload,
          message_type: 'firma',
        }),
      })
      setToast('Documento enviado al cliente para firmar.')
    } catch {
      setToast('No se pudo enviar el documento a firma.')
    }
  }
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  // â”€â”€ Cerrar modales de confirmaciÃ³n con Escape â”€â”€
  useEffect(() => {
    if (!confirmClose && !confirmVerificar && !showRating && !contactoBlocked) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (sendingVerificar || closing) return   // no cerrar a media peticiÃ³n
      setConfirmClose(false)
      setConfirmVerificar(false)
      setShowRating(false)
      setRating(0)
      setContactoBlocked(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmClose, confirmVerificar, showRating, contactoBlocked, sendingVerificar, closing])

  /* â”€â”€ Cargar salas â”€â”€ */
  const fetchRooms = useCallback(async () => {
    if (!lawyerId) return
    try {
    const headers = await getAuthHeaders()

    // 1. Obtener IDs de salas asignadas al abogado
    const aRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers?lawyer_id=eq.${lawyerId}&select=room_id,status`,
      { headers }
    )
    const assignments = await aRes.json()
    // Respuesta de error (401 en el borde del refresh, 5xx): conservar el
    // sidebar actual en vez de vaciarlo â€” solo un [] legÃ­timo lo limpia.
    if (!Array.isArray(assignments)) { setLoadingRooms(false); return }
    if (assignments.length === 0) {
      setRooms([])
      setLoadingRooms(false)
      return
    }

    // 2. Obtener datos de esas salas â€” orden descendente por created_at.
    //    Las asignaciones nunca se podan, asÃ­ que el in.() se trocea en lotes
    //    de 150 ids (una URL con cientos de UUIDs supera el lÃ­mite del gateway
    //    y el fetch falla entero) y el sidebar se acota a las 200 salas mÃ¡s
    //    recientes â€” las mÃ¡s antiguas siguen en el Historial del admin.
    const allIds = assignments.map(a => a.room_id)
    const idLotes = []
    for (let i = 0; i < allIds.length; i += 150) idLotes.push(allIds.slice(i, i + 150))
    const chunkResults = await Promise.all(idLotes.map(async ids => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_rooms` +
        `?id=in.(${ids.join(',')})&select=*&order=created_at.desc&limit=200`,
        { headers }
      )
      return r.json()
    }))
    if (chunkResults.some(c => !Array.isArray(c))) { setLoadingRooms(false); return }
    // El cap de 200 NUNCA debe ocultar una sala abierta: se conservan TODAS
    // las waiting/active (el trabajo abierto de un profesional estÃ¡ acotado
    // por naturaleza) y se completa con las cerradas mÃ¡s recientes.
    const flat = chunkResults.flat()
    const abiertas = flat.filter(r => r.status !== 'closed')
    const cerradas = flat.filter(r => r.status === 'closed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    const roomData = [...abiertas, ...cerradas].slice(0, Math.max(200, abiertas.length))

    // 3. Ãšltimos 50 mensajes por sala â€” uno solo bastaba para mostrar la
    //    preview, pero tambiÃ©n necesitamos contar cuÃ¡ntos del cliente quedaron
    //    sin respuesta. Recorremos desc desde el Ãºltimo; paramos al ver un
    //    mensaje del abogado y lo previo es el "unread" (mensajes que llegaron
    //    desde la Ãºltima vez que respondÃ­). 50 cubre la gran mayorÃ­a de salas
    //    sin disparar latencia por payload.
    const seenMap    = readSeen(lawyerId)
    const lastMsgMap = {}
    const unreadMap  = {}
    // UNA sola query con los mensajes recientes de TODAS las salas. Antes era
    // 1 query por sala â†’ N+1 disparado cada 6s. Agrupamos en memoria y
    // aplicamos el mismo algoritmo de no-leÃ­dos por sala. El tope global de
    // 1000 cubre de sobra la actividad reciente; una sala muy vieja sin
    // mensajes dentro de ese tope queda sin preview pero igual se lista.
    const recentIds = roomData.map(r => r.id).join(',')
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages` +
      `?room_id=in.(${recentIds})&order=created_at.desc&limit=1000` +
      `&select=room_id,content,created_at,sender_type,message_type`,
      { headers }
    )
    const allMsgs = await mRes.json()
    if (Array.isArray(allMsgs)) {
      const byRoom = {}
      for (const m of allMsgs) {
        if (!byRoom[m.room_id]) byRoom[m.room_id] = []
        byRoom[m.room_id].push(m)   // preserva el orden desc global
      }
      for (const room of roomData) {
        const msgs = byRoom[room.id]
        if (!msgs || msgs.length === 0) continue
        lastMsgMap[room.id] = msgs[0]
        // Cuenta msgs del cliente posteriores al Ãºltimo "visto"; el break en
        // 'lawyer' resetea el contador (cualquier respuesta nuestra lo limpia).
        const seenAt = seenMap[room.id] ? new Date(seenMap[room.id]).getTime() : 0
        let unread = 0
        for (const m of msgs) {
          if (m.sender_type === 'lawyer') break
          if (m.sender_type === 'client' && new Date(m.created_at).getTime() > seenAt) {
            unread++
          }
        }
        unreadMap[room.id] = unread
      }
    }

    // 4. Mezclar estado de asignaciÃ³n con datos de sala
    const enriched = roomData.map(room => {
      const assignment = assignments.find(a => a.room_id === room.id)
      return {
        ...room,
        my_status:    assignment?.status || 'invited',
        lastMsg:      lastMsgMap[room.id] || null,
        unreadCount:  unreadMap[room.id] || 0,
      }
    })

    // Orden puro por Ãºltima actividad (mensaje mÃ¡s reciente, o creaciÃ³n si
    // aÃºn no hay mensajes). Sin agrupar por status â€” antes "waiting" caÃ­a
    // debajo de todas las activas y obligaba a hacer scroll.
    enriched.sort((a, b) => {
      const ta = new Date(a.lastMsg?.created_at || a.created_at).getTime()
      const tb = new Date(b.lastMsg?.created_at || b.created_at).getTime()
      return tb - ta
    })

    setRooms(enriched)
    setLoadingRooms(false)
    } catch (_) {
      // Red caÃ­da a mitad del poll: conserva el sidebar visible; el prÃ³ximo
      // tick (20s) o el visibilitychange reintentan.
      setLoadingRooms(false)
    }
  }, [lawyerId])

  useEffect(() => {
    fetchRooms()
    // Sidebar por poll (lento, pausado con la pestaÃ±a oculta) + refresco al
    // volver. La sala ABIERTA se actualiza al instante por Realtime; las demÃ¡s
    // (preview/badge) refrescan cada 20s â€” basta para chats que no miras.
    pollRooms.current = setInterval(() => { if (!document.hidden) fetchRooms() }, 20000)
    const onVisible = () => { if (!document.hidden) fetchRooms() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(pollRooms.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchRooms])

  /* â”€â”€ Cargar mensajes de la sala activa â”€â”€ */
  const activeRoomIdRef = useRef(null)
  const fetchMessages = useCallback(async () => {
    const rid = activeRoomIdRef.current
    if (!rid) return
    try {
      const headers = await getAuthHeaders()
      // Ãšltimos 300 en vez del historial completo: en salas largas/reabiertas
      // el historial entero se re-transferÃ­a tras cada envÃ­o. El Ã­ndice
      // (room_id, created_at) sirve el desc+limit directo.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages?room_id=eq.${rid}&order=created_at.desc&limit=300&select=*`,
        { headers }
      )
      const data = await res.json()
      // Respuesta tardÃ­a de una sala que ya no estÃ¡ abierta (cambio rÃ¡pido de
      // sala): descartar para no pintar mensajes bajo el encabezado equivocado.
      if (activeRoomIdRef.current !== rid) return
      if (Array.isArray(data)) setMessages(data.reverse())
    } catch (_) { /* red caÃ­da: conserva lo visible; realtime/visibilitychange resincronizan */ }
  }, [])

  useEffect(() => {
    const rid = activeRoom?.id
    activeRoomIdRef.current = rid || null
    if (!rid) return
    fetchMessages()   // historial al abrir la sala
    // Realtime: mensajes nuevos de ESTA sala (reemplaza el poll de 3s). Una
    // sola suscripciÃ³n y solo mientras hay un chat abierto â†’ barata en cupo
    // de Realtime. El status de la sala (cierre) tambiÃ©n llega al instante.
    // Deps por ID (no por objeto): los UPDATE de chat_rooms mutan el objeto
    // activeRoom pero no deben destruir/recrear el WebSocket.
    let first = true
    const ch = supabase.channel(`lcd:${rid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${rid}` },
        p => {
          setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new])
          // Aviso flotante: el cliente terminÃ³ de firmar el documento.
          if (p.new.message_type === 'firma_ok' && p.new.sender_type === 'client') {
            setToast('âœ… El cliente firmÃ³ el documento')
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms', filter: `id=eq.${rid}` },
        p => setActiveRoom(prev => (prev && prev.id === p.new.id) ? { ...prev, ...p.new } : prev))
      .subscribe(st => {
        // Tras una reconexiÃ³n automÃ¡tica del WS, re-sincroniza lo perdido
        // durante el corte (fetchMessages deduplica por id).
        if (st === 'SUBSCRIBED') {
          if (first) { first = false; return }
          fetchMessages()
        }
      })
    // Red de seguridad ante hipos del WS: re-sincroniza al volver a la pestaÃ±a.
    const onVisible = () => { if (!document.hidden) fetchMessages() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeRoom?.id, fetchMessages])

  /* â”€â”€ Scroll al fondo SOLO cuando el conteo cambia (no en cada poll) â”€â”€ */
  useEffect(() => {
    if (messages.length === lastCountRef.current) return
    lastCountRef.current = messages.length
    const c = mensajesRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [messages])

  /* â”€â”€ Reset de contador al cambiar de sala â”€â”€ */
  useEffect(() => {
    lastCountRef.current = 0
  }, [activeRoom?.id])

  /* â”€â”€ MantÃ©n el "visto" al dÃ­a mientras la sala estÃ¡ abierta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     Si llegan mensajes nuevos por polling mientras estÃ¡s dentro, avanzan el
     timestamp visto. Al cambiar a otra sala y volver, el badge sigue en 0.
     Solo se "incrementa" cuando entren mensajes ya con la sala cerrada. */
  useEffect(() => {
    if (!activeRoom || messages.length === 0) return
    const latest = messages[messages.length - 1]
    if (latest) markSeen(lawyerId, activeRoom.id, latest.created_at)
  }, [messages, activeRoom?.id, lawyerId])

  /* â”€â”€ Seleccionar sala y marcar como activo si estaba en espera â”€â”€ */
  async function selectRoom(room) {
    // Marca como visto inmediatamente â€” el badge de "no leÃ­dos" desaparece
    // al abrir y NO vuelve hasta que llegue un mensaje nuevo (como WhatsApp).
    // Usamos el timestamp del Ãºltimo msg conocido si lo tenemos; el effect
    // sobre `messages` lo refinarÃ¡ con el timestamp real mÃ¡s reciente.
    markSeen(lawyerId, room.id, room.lastMsg?.created_at)
    setRooms(prev => prev.map(r => r.id === room.id ? { ...r, unreadCount: 0 } : r))

    setActiveRoom(room)
    setConfirmClose(false)
    setConfirmVerificar(false)
    setShowRating(false)
    setRating(0)

    if (room.my_status === 'invited' || room.status === 'waiting') {
      const headers = await getAuthHeaders()
      // Marcar abogado como activo en la sala
      await fetch(
        `${SUPABASE_URL}/rest/v1/chat_room_lawyers?room_id=eq.${room.id}&lawyer_id=eq.${lawyerId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        }
      )
      // Marcar sala como activa
      if (room.status === 'waiting') {
        await fetch(
          `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${room.id}`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
          }
        )
      }
      fetchRooms()
    }
  }

  /* â”€â”€ Enviar mensaje â”€â”€ */
  async function enviar() {
    if (!input.trim() || sending || !activeRoom) return
    // â”€â”€ Bloqueo de datos de contacto (telÃ©fono / correo) â”€â”€
    if (contieneContacto(input.trim())) { setContactoBlocked(true); return }
    setSending(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          room_id:     activeRoom.id,
          sender_type: 'lawyer',
          content:     input.trim(),
          message_type: 'text',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Solo limpiar tras confirmar el insert â€” si fallÃ³, el texto se conserva
      // para reintentar (antes se perdÃ­a en silencio).
      setInput('')
      fetchMessages()
    } catch (_) {
      setToast('No se pudo enviar el mensaje. Revisa tu conexiÃ³n e intenta de nuevo.')
    } finally {
      // Sin esto, un fallo de red dejaba el botÃ³n Enviar bloqueado para siempre.
      setSending(false)
    }
  }

  /* â”€â”€ Subir archivo â”€â”€ */
  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (file) await subirArchivo(file)
    if (e.target) e.target.value = ''
  }

  // Sube un archivo al chat (reutilizado por el input y por arrastrar-soltar).
  async function subirArchivo(file) {
    if (!file || !activeRoom) return
    setUploading(true)
    try {
      const headers = await getAuthHeaders()
      const path = `chats/${activeRoom.id}/${Date.now()}_${file.name}`
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/chat-files/${path}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': file.type,
            'x-upsert': 'true',
          },
          body: file,
        }
      )
      if (!upRes.ok) throw new Error('Error subiendo archivo')

      // Generar URL firmada (7 dÃ­as)
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/chat-files/${path}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 604800 }),
        }
      )
      const signData = await signRes.json()
      const fileUrl  = `${SUPABASE_URL}/storage/v1${signData.signedURL}`

      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          room_id:      activeRoom.id,
          sender_type:  'lawyer',
          content:      file.name,
          message_type: 'file',
          file_url:     fileUrl,
          file_name:    file.name,
          file_size:    file.size,
        }),
      })
      fetchMessages()
    } catch (err) {
      alert('Error subiendo archivo: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  /* â”€â”€ GrabaciÃ³n de voz (click toggle, igual que ChatSection) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function fixAudioDuration(blob) {
    return new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        try { URL.revokeObjectURL(audio.src) } catch {}
        resolve(blob)
      }
      // Firefox a veces no dispara `timeupdate` tras el seek a 1e101 â€” timeout
      // para no colgar el flujo de subida.
      const timer = setTimeout(finish, 1500)

      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.src = URL.createObjectURL(blob)
      audio.onloadedmetadata = () => {
        if (audio.duration === Infinity || isNaN(audio.duration)) {
          audio.currentTime = 1e101
          audio.ontimeupdate = () => {
            audio.ontimeupdate = null
            audio.currentTime = 0
            clearTimeout(timer)
            finish()
          }
        } else {
          clearTimeout(timer)
          finish()
        }
      }
      audio.onerror = () => { clearTimeout(timer); finish() }
    })
  }

  async function startRecording() {
    if (!activeRoom) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const actualType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: actualType })
        if (blob.size > 0) {
          const fixedBlob = await fixAudioDuration(blob)
          await uploadAudio(fixedBlob, actualType)
        }
      }
      recorder.start(100)
      setRecording(true)
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      alert('No se pudo acceder al micrÃ³fono: ' + err.message)
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    clearInterval(recordingTimerRef.current)
    setRecording(false)
    setRecordingTime(0)
  }

  async function uploadAudio(blob, mimeType = 'audio/webm') {
    if (!activeRoom) return
    setUploadingAudio(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `chats/${activeRoom.id}/audio_${Date.now()}.${ext}`

      // Content-Type "limpio" â€” Firefox rechaza reproducir si lo guardamos
      // con `audio/webm;codecs=opus` aunque el blob sÃ­ sea opus.
      const cleanMime = mimeType.split(';')[0] || 'audio/webm'

      // 1) Upload con JWT del usuario autenticado
      const upHeaders = await getAuthHeaders()
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
        method: 'POST',
        headers: { ...upHeaders, 'Content-Type': cleanMime, 'x-upsert': 'true' },
        body: blob,
      })
      if (!upRes.ok) {
        const detail = await upRes.text().catch(() => '')
        console.error('Error subiendo audio:', upRes.status, detail)
        return
      }

      // 2) Insertar mensaje guardando el PATH (no signed URL).
      //    AudioPlayer firma on-demand al reproducir â†’ audio nunca expira.
      const insHeaders = await getAuthHeaders()
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST',
        headers: { ...insHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          room_id:      activeRoom.id,
          sender_type:  'lawyer',
          content:      'Mensaje de voz',
          message_type: 'audio',
          file_url:     path,
          file_name:    `voz_${Date.now()}.${ext}`,
          file_size:    blob.size,
        }),
      })
      if (!insRes.ok) {
        const detail = await insRes.text().catch(() => '')
        console.error('Error insertando mensaje de audio:', insRes.status, detail)
        return
      }
      await fetchMessages()
    } catch (err) {
      console.error('Error en uploadAudio:', err)
    } finally {
      setUploadingAudio(false)
    }
  }

  /* â”€â”€ Cerrar sala (abogado) â”€â”€ */
  async function closeRoom() {
    if (!activeRoom || closing) return
    setClosing(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${activeRoom.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Guardar calificaciÃ³n si la dio â€” best-effort: su fallo no debe
      // bloquear el cierre ya confirmado.
      if (rating > 0) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/chat_ratings`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              room_id:   activeRoom.id,
              lawyer_id: lawyerId,
              rating,
            }),
          })
        } catch (_) { /* noop */ }
      }

      // Programar el correo de reseÃ±a de la web (~5 min despuÃ©s, vÃ­a pg_cron) â€”
      // best-effort: si falla, no bloquea el cierre. Requiere el correo del
      // cliente (capturado en el formulario de la consulta).
      if (activeRoom.client_email) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/resenas`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              room_id: activeRoom.id,
              token: (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
              nombre: activeRoom.client_nombre || null,
              correo: activeRoom.client_email,
              rol: 'Cliente',
              professional_id: lawyerId,
            }),
          })
        } catch (_) { /* noop */ }
      }

      setShowRating(false)
      setActiveRoom(null)
      fetchRooms()
    } catch (_) {
      setToast('No se pudo cerrar la consulta. Revisa tu conexiÃ³n e intenta de nuevo.')
    } finally {
      // Sin esto, un fallo de red dejaba el botÃ³n atascado en "Cerrandoâ€¦".
      setClosing(false)
    }
  }

  /* â”€â”€ Verificar: notificar al administrador para revisiÃ³n de proceso â”€â”€
     Inserta un mensaje en el canal interno (mensajes_internos) dirigido al
     superadmin. Reutiliza la infraestructura del chat interno: el admin lo
     verÃ¡ en AdminInternalChat como un mensaje del abogado. */
  async function enviarVerificacion() {
    if (!activeRoom || sendingVerificar) return
    setSendingVerificar(true)
    try {
      // Endpoint seguro: valida server-side que soy el abogado asignado,
      // registra la notificaciÃ³n para la campanita del admin, deja el mensaje
      // en el chat interno y envÃ­a el correo. Ver api/verify-request.js.
      const headers = await getAuthHeaders()
      const res = await fetch('/api/verify-request', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roomId:       activeRoom.id,
          clientNombre: activeRoom.client_nombre || 'AnÃ³nimo',
          area:         activeRoom.area_derecho || 'Consulta',
        }),
      })
      if (!res.ok) throw new Error('verify-request failed')

      setVerifiedRooms(prev => new Set(prev).add(activeRoom.id))
      setToast('Solicitud de revisiÃ³n enviada al administrador.')
    } catch (err) {
      setToast('No se pudo enviar la solicitud. Intenta de nuevo.')
    } finally {
      setSendingVerificar(false)
      setConfirmVerificar(false)
    }
  }

  async function pedirResumenIA(tipo) {
    if (!activeRoom || iaCargando) return
    setIaTipo(tipo); setIaCopiado(false); setIaCargando(true); setIaResultado(null)
    const transcripcion = (messages || [])
      .map(m => `${m.sender_type === 'client' ? 'Cliente' : 'Profesional'}: ${m.content || ''}`)
      .join('\n')
    const instruccion = tipo === 'analisis'
      ? `Analiza este caso para el profesional (Ã¡rea, hechos, pretensiÃ³n, riesgos, prÃ³ximos pasos).\n\nTranscripciÃ³n:\n${transcripcion}`
      : `Resume esta consulta para el profesional en pocas lÃ­neas (Ã¡rea, hechos clave y quÃ© busca el cliente).\n\nTranscripciÃ³n:\n${transcripcion}`
    const { Authorization } = await getAuthHeaders()
    const { ok, data } = await pedirIA(
      { modo: 'abogado', mensajes: [{ role: 'user', content: instruccion }], roomId: activeRoom.id, accion: tipo },
      { authHeader: Authorization }
    )
    setIaResultado(ok && data?.reply ? data.reply : (data?.mensaje || 'El asistente no estÃ¡ disponible ahora.'))
    setIaCargando(false)
  }

  const hasVideos = activeRoom && messages.some(m => m.message_type === 'video_call')

  // Luz verde: el pago de la consulta habilita descargas y datos de contacto,
  // ademÃ¡s del permiso global por polÃ­ticas (profiles.puede_descargar_archivos).
  const pagoConfirmado = !!activeRoom?.pago_confirmado
  const puedeDescargarSala = canDownload || pagoConfirmado

  // â”€â”€ Filtrado en cliente sobre las salas ya cargadas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Nombre (sin tildes/case-insensitive) + rango de fechas por Ãºltima actividad
  // (o creaciÃ³n si aÃºn no hay mensajes) â€” el mismo timestamp que ordena la lista.
  const buscarNorm = normaliza(buscar)
  const desdeTs = fechaDesde ? new Date(`${fechaDesde}T00:00:00`).getTime() : null
  const hastaTs = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`).getTime() : null
  const filtroActivo = !!(buscar.trim() || fechaDesde || fechaHasta)
  const filteredRooms = rooms.filter(room => {
    if (buscarNorm && !normaliza(room.client_nombre).includes(buscarNorm)) return false
    if (desdeTs || hastaTs) {
      const ts = new Date(room.lastMsg?.created_at || room.created_at).getTime()
      if (desdeTs && ts < desdeTs) return false
      if (hastaTs && ts > hastaTs) return false
    }
    return true
  })

  return (
    <div className={`${styles.dashboard} ${activeRoom ? styles.dashboardChatOpen : ''}`}>

      {/* â”€â”€ Sidebar de salas â”€â”€ */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarTitle}>Consultas activas</p>
          <p className={styles.sidebarSub}>Ordenadas por actividad reciente</p>
        </div>

        {/* â”€â”€ Barra de filtros: buscar por cliente + rango de fechas â”€â”€ */}
        <div className={styles.filterBar}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}><IconLupa /></span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Buscar por clienteâ€¦"
              value={buscar}
              onChange={e => setBuscar(e.target.value)}
              aria-label="Buscar consulta por nombre del cliente"
            />
            {buscar && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setBuscar('')}
                aria-label="Limpiar bÃºsqueda"
              >âœ•</button>
            )}
          </div>
          <div className={styles.dateRow}>
            <label className={styles.dateField}>
              <span>Desde</span>
              <input
                className={styles.dateInput}
                type="date"
                value={fechaDesde}
                max={fechaHasta || undefined}
                onChange={e => setFechaDesde(e.target.value)}
              />
            </label>
            <label className={styles.dateField}>
              <span>Hasta</span>
              <input
                className={styles.dateInput}
                type="date"
                value={fechaHasta}
                min={fechaDesde || undefined}
                onChange={e => setFechaHasta(e.target.value)}
              />
            </label>
            {filtroActivo && (
              <button
                type="button"
                className={styles.clearAll}
                onClick={() => { setBuscar(''); setFechaDesde(''); setFechaHasta('') }}
              >Limpiar</button>
            )}
          </div>
        </div>

        <div>
          {loadingRooms && <p className={styles.empty}>Cargandoâ€¦</p>}
          {!loadingRooms && rooms.length === 0 && (
            <p className={styles.sinSalas}>No tienes consultas asignadas aÃºn.</p>
          )}
          {!loadingRooms && rooms.length > 0 && filteredRooms.length === 0 && (
            <p className={styles.sinSalas}>Ninguna consulta coincide con el filtro.</p>
          )}

          {filteredRooms.map(room => {
            const isActive = activeRoom?.id === room.id
            const lastTs   = room.lastMsg?.created_at || room.created_at
            // Ocultamos el badge mientras la sala estÃ¡ abierta â€” sigue
            // siendo el conteo correcto, pero distrae al estar viendo el
            // chat. Se resetearÃ¡ naturalmente al responder.
            const showUnread = room.unreadCount > 0 && !isActive

            return (
              <button
                key={room.id}
                className={`${styles.roomRow} ${isActive ? styles.roomRowActive : ''} ${room.status === 'closed' ? styles.itemClosed : ''}`}
                onClick={() => selectRoom(room)}
              >
                {/* Ãcono de Ã¡rea */}
                <div className={styles.itemIcon}>âš–</div>

                <div className={styles.itemInfo}>
                  {/* Fila superior: NOMBRE del cliente + hora Ãºltimo mensaje */}
                  <div className={styles.itemRow}>
                    <span className={styles.itemNombre}>{room.client_nombre || 'AnÃ³nimo'}</span>
                    <span className={styles.itemFecha}>{fmtSidebar(lastTs)}</span>
                  </div>

                  {/* Fila media: Ãºltimo mensaje + badge unread + estado */}
                  <div className={styles.itemRow}>
                    <span className={styles.itemUltimo}>
                      {room.lastMsg
                        ? room.lastMsg.sender_type === 'lawyer'
                          ? `TÃº: ${previewMsg(room.lastMsg)}`
                          : previewMsg(room.lastMsg)
                        : 'Nueva consulta'}
                    </span>
                    <span className={styles.itemRight}>
                      {showUnread && (
                        <span className={styles.unreadBadge} title={`${room.unreadCount} mensaje${room.unreadCount === 1 ? '' : 's'} sin responder`}>
                          {room.unreadCount > 99 ? '99+' : room.unreadCount}
                        </span>
                      )}
                      <span
                        className={styles.itemEstado}
                        style={{ color: STATUS_COLOR[room.status] || '#888' }}
                      >
                        {STATUS_LABEL[room.status] || room.status}
                      </span>
                    </span>
                  </div>

                  {/* Fila inferior: Ã¡rea + fecha de inicio */}
                  <div className={styles.itemInicio}>
                    {room.area_derecho || 'Consulta'} Â· Inicio {fmtSidebar(room.created_at)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* â”€â”€ Ãrea de chat â”€â”€ */}
      <div className={styles.main}>
        {!activeRoom ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderIcon}>âš–</span>
            <p className={styles.placeholderText}>Selecciona una consulta para responder</p>
            <p className={styles.placeholderSub}>Los chats aparecen ordenados por mÃ¡s reciente</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={styles.chatHeader}>
              <div className={styles.chatMeta}>
                <button
                  type="button"
                  className={styles.btnBackMobile}
                  onClick={() => setActiveRoom(null)}
                  aria-label="Volver a la lista de consultas"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Volver
                </button>
                <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
                <p className={styles.chatSubtitle}>
                  Cliente Â· {activeRoom.client_nombre || 'AnÃ³nimo'}
                  {activeRoom.ciudad ? ` Â· ${activeRoom.ciudad}` : ''}
                  {activeRoom.created_at && (
                    <span> Â· Inicio: {fmtHora(activeRoom.created_at)}</span>
                  )}
                </p>
              </div>

              {/* Acciones del header â€” solo cuando NO estÃ¡ el panel rating activo */}
              {activeRoom.status !== 'closed' && !showRating && (
                <div className={styles.headerActions}>
                  {verifiedRooms.has(activeRoom.id)
                    ? <span className={styles.verificadoTag}>âœ“ RevisiÃ³n solicitada</span>
                    : <button
                        className={styles.btnVerificar}
                        onClick={() => setConfirmVerificar(true)}
                        title="Notificar al administrador para revisiÃ³n de proceso"
                      >
                        Verificar
                      </button>}
                  <button type="button" className={styles.btnVerificar} disabled={iaCargando} onClick={() => pedirResumenIA('resumen')}>
                    {iaCargando ? 'âœ¨ Generandoâ€¦' : 'âœ¨ Resumir con IA'}
                  </button>
                  <button type="button" className={styles.btnVerificar} disabled={iaCargando} onClick={() => pedirResumenIA('analisis')}>
                    âœ¨ Analizar caso
                  </button>
                  <button className={styles.btnClose} onClick={() => setConfirmClose(true)}>
                    Finalizar consulta
                  </button>
                </div>
              )}
            </div>

            {/* Luz verde â€” pago confirmado habilita datos de contacto y descargas */}
            {pagoConfirmado && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                role="status"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  background: 'linear-gradient(135deg, #f2f8f3 0%, #fbfdf9 100%)',
                  borderTop: '1px solid rgba(46,125,76,0.2)',
                  borderBottom: '1px solid rgba(46,125,76,0.2)',
                  color: '#1f5e3c',
                  fontSize: '0.86rem',
                  lineHeight: 1.35,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #2e9e5f 0%, #256a45 100%)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                    flexShrink: 0,
                    boxShadow: '0 0 0 3px rgba(201,168,76,0.28)',
                  }}
                >âœ“</span>
                <span>
                  <strong style={{ color: '#6d3c1b' }}>Luz verde Â·</strong> Pago confirmado â€”
                  datos de contacto y descarga de archivos habilitados.
                </span>
              </motion.div>
            )}

            {/* Sala cerrada â€” banner */}
            {activeRoom.status === 'closed' && (
              <div className={styles.closedBanner}>
                Consulta finalizada Â· Solo lectura
              </div>
            )}

            <AnimatePresence>
              {(iaCargando || iaResultado) && (
                  <motion.aside
                    initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                    transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    role="dialog" aria-label="Resultado de IA Parada Precise"
                    style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 92vw)', background: '#fff', zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(109,60,27,0.25)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', background: 'linear-gradient(135deg,#6b3d15,#6d3c1b)', color: '#fff' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#f2d580' }}>IA Parada Precise</span>
                        <strong style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.2rem', fontWeight: 600 }}>
                          {iaTipo === 'analisis' ? 'AnÃ¡lisis del caso' : 'Resumen de la consulta'}
                        </strong>
                      </div>
                      <button type="button" onClick={() => setIaResultado(null)} disabled={iaCargando} aria-label="Cerrar"
                        style={{ background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 8, cursor: iaCargando ? 'not-allowed' : 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>âœ•</button>
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
                      {iaCargando ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#89796b', fontSize: 13 }}>
                          {[0, 1, 2].map(i => (
                            <motion.span key={i}
                              style={{ width: 8, height: 8, borderRadius: '50%', background: '#c0ac9a', display: 'inline-block' }}
                              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                            />
                          ))}
                          <span style={{ marginLeft: 6 }}>Generandoâ€¦</span>
                        </div>
                      ) : <Markdown>{iaResultado}</Markdown>}
                    </div>
                    {!iaCargando && iaResultado && (
                      <div style={{ padding: '12px 18px', borderTop: '1px solid #f2e9e1', display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(iaResultado); setIaCopiado(true); setTimeout(() => setIaCopiado(false), 1600) }}
                          style={{ background: 'linear-gradient(135deg,#f2d580,#c9a84c 55%,#9a7a2c)', color: '#6d3c1b', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                          {iaCopiado ? 'Copiado âœ“' : 'Copiar'}
                        </button>
                      </div>
                    )}
                  </motion.aside>
              )}
            </AnimatePresence>

            {/* Mensajes */}
            <div
              className={styles.messages}
              ref={mensajesRef}
              onDragOver={(e) => { if (activeRoom.status === 'closed') return; e.preventDefault(); if (!dragging) setDragging(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
              onDrop={(e) => {
                e.preventDefault(); setDragging(false)
                const f = e.dataTransfer?.files?.[0]
                if (f && activeRoom.status !== 'closed') subirArchivo(f)
              }}
            >
              {dragging && (
                <div className={styles.dropOverlay} aria-hidden="true">
                  <div className={styles.dropInner}>
                    <IconPaperclip size={26} />
                    <span>Suelta el archivo para enviarlo</span>
                  </div>
                </div>
              )}
              {messages.length === 0 && (
                <p className={styles.messagesEmpty}>
                  No hay mensajes aÃºn. Saluda al cliente para iniciar.
                </p>
              )}
              {messages.map((m, i) => {
                const esMio = m.sender_type === 'lawyer'
                const isAudio = m.message_type === 'audio' && m.file_url
                const isFirstClientMsg = i === 0 && m.sender_type === 'client' && !isAudio
                const isImageMsg = !isAudio && (m.message_type === 'file' || m.file_url) && isImage(m.file_name)
                return (
                  <div
                    key={m.id}
                    className={esMio ? styles.msgRowMine : styles.msgRowOther}
                  >
                    <div className={`${esMio ? styles.bubbleMine : styles.bubbleOther} ${isAudio ? styles.bubbleAudio : ''} ${isFirstClientMsg ? styles.bubbleFirst : ''} ${isImageMsg ? styles.bubbleImg : ''}`}>
                      {isAudio ? (
                        // Color por rol: profesional (esMio) â†’ player navy (theme light);
                        // cliente â†’ player dorado (theme dark).
                        <AudioPlayer src={m.file_url} mine={true} theme={esMio ? 'light' : 'dark'} />
                      ) : (m.message_type === 'file' || m.file_url) ? (
                        isImage(m.file_name) ? (
                          <ChatImage
                            src={m.file_url}
                            alt={m.file_name || 'imagen'}
                            btnClassName={styles.imgBtn}
                            imgClassName={styles.imgPreview}
                            onOpen={setLightbox}
                            onBlocked={(e) => {
                              e.preventDefault()
                              setToast('Por polÃ­ticas de privacidad no puedes guardar esta imagen.')
                            }}
                          />
                        ) : (
                          <button
                            className={styles.fileBtn}
                            onClick={() => puedeDescargarSala
                              ? openChatFile(m.file_url)
                              : setToast('Por polÃ­ticas de privacidad no puedes descargar este archivo.')
                            }
                            title={puedeDescargarSala ? 'Descargar archivo' : 'Archivo bloqueado por polÃ­ticas de privacidad'}
                          >
                            <IconPaperclip size={16} />
                            <span className={styles.fileName}>{m.file_name}</span>
                            {m.file_size && <span className={styles.fileSize}>{formatSize(m.file_size)}</span>}
                          </button>
                        )
                      ) : m.message_type === 'firma' ? (
                        <span className={styles.firmaMsg}>
                          <span className={styles.firmaIcon}><IconFirma size={16} /></span>
                          <span className={`${styles.msgText} ${styles.firmaBody}`}>
                            <strong>Documento enviado para firma</strong>
                            <span className={styles.firmaSub}>El cliente lo firmarÃ¡ desde el chat.</span>
                          </span>
                        </span>
                      ) : m.message_type === 'firma_ok' ? (
                        <span className={styles.firmaMsg}>
                          <span className={styles.firmaIcon}><IconFirma size={16} /></span>
                          <span className={`${styles.msgText} ${styles.firmaBody}`}>
                            <strong>El cliente firmÃ³ el documento</strong>
                            <span className={styles.firmaDlRow}>
                              <button className={styles.firmaDlBtn} onClick={() => setUbicarFirma(parseFirmaOk(m.content))}>
                                <IconFirma size={13} /> Ubicar firma y descargar PDF
                              </button>
                              <button className={styles.firmaDlBtnAlt} onClick={() => descargarCertificado(parseFirmaOk(m.content)?.solicitudId)}>
                                â¬‡ Certificado (PDF)
                              </button>
                            </span>
                          </span>
                        </span>
                      ) : (
                        <p className={styles.msgText}>{renderMensaje(m.content)}</p>
                      )}
                      <p className={esMio ? styles.msgMetaMine : styles.msgMetaOther}>
                        {esMio ? 'TÃº' : 'Cliente'} Â· {fmtHora(m.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Input â€” solo si la sala estÃ¡ abierta */}
            {activeRoom.status !== 'closed' && (
              <div className={styles.inputBar}>
                <div className={styles.attachWrap}>
                  <button
                    className={styles.attachBtn}
                    onClick={() => setAdjuntarMenu(v => !v)}
                    disabled={uploading}
                    title="Adjuntar"
                    aria-haspopup="menu"
                    aria-expanded={adjuntarMenu}
                  >
                    {uploading ? 'â€¦' : <IconPaperclip size={15} />}
                  </button>
                  {adjuntarMenu && (
                    <>
                      <div className={styles.attachBackdrop} onClick={() => setAdjuntarMenu(false)} />
                      <div className={styles.attachMenu} role="menu">
                        <button role="menuitem" onClick={() => { setAdjuntarMenu(false); fileRef.current?.click() }}>
                          <IconPaperclip size={15} />
                          <span><strong>Enviar archivo</strong><small>Solo para ver</small></span>
                        </button>
                        <button role="menuitem" onClick={() => { setAdjuntarMenu(false); setFirmaOpen(true) }}>
                          <IconFirma size={15} />
                          <span><strong>Enviar para firmar</strong><small>El cliente firma en el chat</small></span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={handleFile}
                />
                <button
                  className={recording ? styles.recordingBtn : styles.attachBtn}
                  onClick={recording ? stopRecording : startRecording}
                  disabled={uploadingAudio}
                  title={recording ? `Detener (${recordingTime}s)` : 'Grabar mensaje de voz'}
                >
                  {recording
                    ? <><span className={styles.recordDot}/>{recordingTime}s</>
                    : <IconMic size={15} />}
                </button>
                <input
                  className={styles.chatInput}
                  type="text"
                  placeholder="Responde al clienteâ€¦"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
                />
                <button
                  className={styles.sendBtn}
                  onClick={enviar}
                  disabled={sending || !input.trim()}
                >
                  Enviar
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* â”€â”€ Modal: ubicar la firma y descargar PDF â”€â”€ */}
      {ubicarFirma && (
        <Suspense fallback={null}>
          <UbicarFirma
            origPath={ubicarFirma.origPath}
            firmaPath={ubicarFirma.firmaPath}
            pie={ubicarFirma.pie}
            filename="documento-firmado.pdf"
            onClose={() => setUbicarFirma(null)}
          />
        </Suspense>
      )}

      {/* â”€â”€ Modal: enviar documento a firmar (chat) â”€â”€ */}
      {firmaOpen && activeRoom && (
        <EnviarAFirmar
          modo="chat"
          roomId={activeRoom.id}
          abogadoId={activeRoom.id}
          cliente={{
            nombre: activeRoom.client_nombre,
            correo: activeRoom.client_email,
            telefono: activeRoom.client_celular,
          }}
          onClose={() => setFirmaOpen(false)}
          afterCreate={publicarFirma}
        />
      )}

      {/* â”€â”€ Modal: datos de contacto bloqueados â”€â”€ */}
      {contactoBlocked && (
        <div
          className={styles.modalOverlay}
          onClick={() => setContactoBlocked(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modalContactoTitle"
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIconRed}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M5.6 5.6 18.4 18.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 id="modalContactoTitle" className={styles.modalTitle}>No puedes compartir datos de contacto</h3>
            <p className={styles.modalText}>
              Por seguridad, no estÃ¡ permitido enviar nÃºmeros de telÃ©fono ni correos
              electrÃ³nicos dentro del chat. ContinÃºa la conversaciÃ³n sin compartir
              datos de contacto.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btnConfirmDanger} onClick={() => setContactoBlocked(false)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Modal: confirmar envÃ­o de notificaciÃ³n de revisiÃ³n â”€â”€ */}
      {confirmVerificar && (
        <div
          className={styles.modalOverlay}
          onClick={() => !sendingVerificar && setConfirmVerificar(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modalVerificarTitle"
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIconGold}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5l-8-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 id="modalVerificarTitle" className={styles.modalTitle}>Enviar notificaciÃ³n de revisiÃ³n</h3>
            <p className={styles.modalText}>
              Â¿Seguro que deseas enviar al administrador una notificaciÃ³n para que
              revise este proceso? QuedarÃ¡ registrada en el canal interno.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.btnCancel}
                onClick={() => setConfirmVerificar(false)}
                disabled={sendingVerificar}
              >
                Cancelar
              </button>
              <button
                className={styles.btnConfirmGold}
                onClick={enviarVerificacion}
                disabled={sendingVerificar}
              >
                {sendingVerificar ? 'Enviandoâ€¦' : 'SÃ­, enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Modal: finalizar consulta (paso 1 confirmar â†’ paso 2 calificar) â”€â”€ */}
      {(confirmClose || showRating) && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (closing) return
            setConfirmClose(false)
            setShowRating(false)
            setRating(0)
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modalCloseTitle"
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            {!showRating ? (
              /* Paso 1 â€” confirmar la finalizaciÃ³n */
              <>
                <div className={styles.modalIconRed}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 9v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 id="modalCloseTitle" className={styles.modalTitle}>Finalizar consulta</h3>
                <p className={styles.modalText}>
                  Â¿Seguro que deseas finalizar esta consulta? El cliente ya no podrÃ¡
                  enviar mÃ¡s mensajes. A continuaciÃ³n podrÃ¡s calificar la atenciÃ³n.
                </p>
                <div className={styles.modalActions}>
                  <button className={styles.btnCancel} onClick={() => setConfirmClose(false)}>
                    Cancelar
                  </button>
                  <button
                    className={styles.btnConfirmDanger}
                    onClick={() => { setConfirmClose(false); setShowRating(true) }}
                  >
                    SÃ­, finalizar
                  </button>
                </div>
              </>
            ) : (
              /* Paso 2 â€” calificar y cerrar */
              <>
                <div className={styles.modalIconGold}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 id="modalCloseTitle" className={styles.modalTitle}>Califica esta consulta</h3>
                <p className={styles.modalText}>
                  Antes de cerrar, califica la atenciÃ³n brindada en el chat (opcional).
                </p>
                <div className={styles.modalStars}>
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      className={`${styles.star} ${rating >= n ? styles.starOn : ''}`}
                      onClick={() => setRating(n)}
                      aria-label={`${n} estrella${n === 1 ? '' : 's'}`}
                    >â˜…</button>
                  ))}
                </div>
                <div className={styles.modalActions}>
                  <button
                    className={styles.btnCancel}
                    onClick={() => { setShowRating(false); setRating(0); setConfirmClose(false) }}
                    disabled={closing}
                  >
                    Cancelar
                  </button>
                  <button
                    className={styles.btnConfirmDanger}
                    onClick={closeRoom}
                    disabled={closing}
                  >
                    {closing ? 'Cerrandoâ€¦' : 'Confirmar cierre'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast} role="status" onClick={() => setToast(null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 1a4 4 0 0 0-4 4v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V5a4 4 0 0 0-4-4Zm-2 7V5a2 2 0 1 1 4 0v3h-4Z" fill="currentColor"/>
          </svg>
          <span>{toast}</span>
        </div>
      )}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Vista de imagen">
          <img
            src={lightbox}
            alt=""
            className={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            draggable="false"
          />
          <button
            className={styles.lightboxClose}
            onClick={() => setLightbox(null)}
            aria-label="Cerrar"
            type="button"
          >Ã—</button>
        </div>
      )}
    </div>
  )
}
