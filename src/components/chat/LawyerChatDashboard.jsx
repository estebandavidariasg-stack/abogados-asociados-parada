import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import { contieneContacto } from '../../lib/validaciones'
import styles from './LawyerChatDashboard.module.css'
import AudioPlayer from './AudioPlayer'
import { ChatImage, openChatFile } from '../../lib/chatFiles'
import { IconPaperclip, IconMic } from '../shared/Icons'

// Detecta si el archivo es imagen para renderizar preview inline (WhatsApp style).
function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
}

// Renderiza **negrillas** estilo markdown conservando los saltos de línea.
function renderMensaje(text) {
  if (text == null) return text
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).map((parte, i) => {
    const m = parte.match(/^\*\*([^*\n]+)\*\*$/)
    return m ? <strong key={i}>{m[1]}</strong> : parte
  })
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/* ─────────────────────────────────────────────
   Formatear fecha para el sidebar
   · Si es hoy → solo hora "14:32"
   · Si es ayer → "Ayer"
   · Si es esta semana → "lun", "mar"…
   · Si es más antiguo → "12 ene"
───────────────────────────────────────────── */
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

/* ── Mapa de "última vez visto" por sala (estilo WhatsApp) ──────────────────
   Persistido en localStorage por usuario. Sin columna `seen_at` en la BD,
   así que cada navegador lleva su propio estado — basta para el caso de uso
   (un abogado revisando sus chats). Si en el futuro se necesita sync entre
   dispositivos, migrar a tabla en Supabase.
   markSeen sólo avanza, nunca retrocede: evita que un fetch viejo pise un
   mark más reciente cuando llegan datos fuera de orden. */
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
  // Salas a las que ya se les solicitó revisión en esta sesión. No hay
  // columna en BD para persistirlo, así que es estado por-navegador: basta
  // para evitar reenvíos accidentales y mostrar el tag "Revisión solicitada".
  const [verifiedRooms, setVerifiedRooms] = useState(() => new Set())
  const [rating,      setRating]      = useState(0)
  const [showRating,  setShowRating]  = useState(false)
  const [loadingRooms, setLoadingRooms] = useState(true)

  const fileRef   = useRef(null)
  const mensajesRef = useRef(null)
  const lastCountRef = useRef(0)
  const pollRooms = useRef(null)

  // ── Voz ──────────────────────────────────────────────────────────────────
  const [recording, setRecording]           = useState(false)
  const [recordingTime, setRecordingTime]   = useState(0)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // ── Toast visual (reemplaza alert() del navegador al click de archivo) ──
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Polling del permiso de descarga — se actualiza sin recargar si el admin lo cambia
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
    // Pausar el polling cuando la pestaña está oculta: no malgastar queries
    // contra la BD si el profesional no está mirando.
    const interval = setInterval(() => { if (!document.hidden) fetchPermiso() }, 60_000)
    return () => clearInterval(interval)
  }, [lawyerId])

  // ── Lightbox para imágenes (click en thumbnail = abrir fullscreen) ──
  const [lightbox, setLightbox] = useState(null)
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  // ── Cerrar modales de confirmación con Escape ──
  useEffect(() => {
    if (!confirmClose && !confirmVerificar && !showRating && !contactoBlocked) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (sendingVerificar || closing) return   // no cerrar a media petición
      setConfirmClose(false)
      setConfirmVerificar(false)
      setShowRating(false)
      setRating(0)
      setContactoBlocked(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmClose, confirmVerificar, showRating, contactoBlocked, sendingVerificar, closing])

  /* ── Cargar salas ── */
  const fetchRooms = useCallback(async () => {
    if (!lawyerId) return
    const headers = await getAuthHeaders()

    // 1. Obtener IDs de salas asignadas al abogado
    const aRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_room_lawyers?lawyer_id=eq.${lawyerId}&select=room_id,status`,
      { headers }
    )
    const assignments = await aRes.json()
    if (!Array.isArray(assignments) || assignments.length === 0) {
      setRooms([])
      setLoadingRooms(false)
      return
    }

    const roomIds = assignments.map(a => a.room_id).join(',')

    // 2. Obtener datos de esas salas — orden descendente por created_at
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms` +
      `?id=in.(${roomIds})&select=*&order=created_at.desc`,
      { headers }
    )
    const roomData = await rRes.json()

    if (!Array.isArray(roomData)) { setLoadingRooms(false); return }

    // 3. Últimos 50 mensajes por sala — uno solo bastaba para mostrar la
    //    preview, pero también necesitamos contar cuántos del cliente quedaron
    //    sin respuesta. Recorremos desc desde el último; paramos al ver un
    //    mensaje del abogado y lo previo es el "unread" (mensajes que llegaron
    //    desde la última vez que respondí). 50 cubre la gran mayoría de salas
    //    sin disparar latencia por payload.
    const seenMap    = readSeen(lawyerId)
    const lastMsgMap = {}
    const unreadMap  = {}
    // UNA sola query con los mensajes recientes de TODAS las salas. Antes era
    // 1 query por sala → N+1 disparado cada 6s. Agrupamos en memoria y
    // aplicamos el mismo algoritmo de no-leídos por sala. El tope global de
    // 1000 cubre de sobra la actividad reciente; una sala muy vieja sin
    // mensajes dentro de ese tope queda sin preview pero igual se lista.
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages` +
      `?room_id=in.(${roomIds})&order=created_at.desc&limit=1000` +
      `&select=room_id,content,created_at,sender_type`,
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
        // Cuenta msgs del cliente posteriores al último "visto"; el break en
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

    // 4. Mezclar estado de asignación con datos de sala
    const enriched = roomData.map(room => {
      const assignment = assignments.find(a => a.room_id === room.id)
      return {
        ...room,
        my_status:    assignment?.status || 'invited',
        lastMsg:      lastMsgMap[room.id] || null,
        unreadCount:  unreadMap[room.id] || 0,
      }
    })

    // Orden puro por última actividad (mensaje más reciente, o creación si
    // aún no hay mensajes). Sin agrupar por status — antes "waiting" caía
    // debajo de todas las activas y obligaba a hacer scroll.
    enriched.sort((a, b) => {
      const ta = new Date(a.lastMsg?.created_at || a.created_at).getTime()
      const tb = new Date(b.lastMsg?.created_at || b.created_at).getTime()
      return tb - ta
    })

    setRooms(enriched)
    setLoadingRooms(false)
  }, [lawyerId])

  useEffect(() => {
    fetchRooms()
    // Sidebar por poll (lento, pausado con la pestaña oculta) + refresco al
    // volver. La sala ABIERTA se actualiza al instante por Realtime; las demás
    // (preview/badge) refrescan cada 20s — basta para chats que no miras.
    pollRooms.current = setInterval(() => { if (!document.hidden) fetchRooms() }, 20000)
    const onVisible = () => { if (!document.hidden) fetchRooms() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(pollRooms.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchRooms])

  /* ── Cargar mensajes de la sala activa ── */
  const fetchMessages = useCallback(async () => {
    if (!activeRoom) return
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?room_id=eq.${activeRoom.id}&order=created_at.asc&select=*`,
      { headers }
    )
    const data = await res.json()
    setMessages(Array.isArray(data) ? data : [])
  }, [activeRoom])

  useEffect(() => {
    if (!activeRoom) return
    fetchMessages()   // historial al abrir la sala
    // Realtime: mensajes nuevos de ESTA sala (reemplaza el poll de 3s). Una
    // sola suscripción y solo mientras hay un chat abierto → barata en cupo
    // de Realtime. El status de la sala (cierre) también llega al instante.
    const ch = supabase.channel(`lcd:${activeRoom.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${activeRoom.id}` },
        p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms', filter: `id=eq.${activeRoom.id}` },
        p => setActiveRoom(prev => (prev && prev.id === p.new.id) ? { ...prev, ...p.new } : prev))
      .subscribe()
    // Red de seguridad ante hipos del WS: re-sincroniza al volver a la pestaña.
    const onVisible = () => { if (!document.hidden) fetchMessages() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeRoom, fetchMessages])

  /* ── Scroll al fondo SOLO cuando el conteo cambia (no en cada poll) ── */
  useEffect(() => {
    if (messages.length === lastCountRef.current) return
    lastCountRef.current = messages.length
    const c = mensajesRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [messages])

  /* ── Reset de contador al cambiar de sala ── */
  useEffect(() => {
    lastCountRef.current = 0
  }, [activeRoom?.id])

  /* ── Mantén el "visto" al día mientras la sala está abierta ──────────────
     Si llegan mensajes nuevos por polling mientras estás dentro, avanzan el
     timestamp visto. Al cambiar a otra sala y volver, el badge sigue en 0.
     Solo se "incrementa" cuando entren mensajes ya con la sala cerrada. */
  useEffect(() => {
    if (!activeRoom || messages.length === 0) return
    const latest = messages[messages.length - 1]
    if (latest) markSeen(lawyerId, activeRoom.id, latest.created_at)
  }, [messages, activeRoom?.id, lawyerId])

  /* ── Seleccionar sala y marcar como activo si estaba en espera ── */
  async function selectRoom(room) {
    // Marca como visto inmediatamente — el badge de "no leídos" desaparece
    // al abrir y NO vuelve hasta que llegue un mensaje nuevo (como WhatsApp).
    // Usamos el timestamp del último msg conocido si lo tenemos; el effect
    // sobre `messages` lo refinará con el timestamp real más reciente.
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

  /* ── Enviar mensaje ── */
  async function enviar() {
    if (!input.trim() || sending || !activeRoom) return
    // ── Bloqueo de datos de contacto (teléfono / correo) ──
    if (contieneContacto(input.trim())) { setContactoBlocked(true); return }
    setSending(true)
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        room_id:     activeRoom.id,
        sender_type: 'lawyer',
        content:     input.trim(),
        message_type: 'text',
      }),
    })
    setInput('')
    setSending(false)
    fetchMessages()
  }

  /* ── Subir archivo ── */
  async function handleFile(e) {
    const file = e.target.files?.[0]
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

      // Generar URL firmada (7 días)
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
      e.target.value = ''
    }
  }

  /* ── Grabación de voz (click toggle, igual que ChatSection) ─────────────── */
  async function fixAudioDuration(blob) {
    return new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        try { URL.revokeObjectURL(audio.src) } catch {}
        resolve(blob)
      }
      // Firefox a veces no dispara `timeupdate` tras el seek a 1e101 — timeout
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
      alert('No se pudo acceder al micrófono: ' + err.message)
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

      // Content-Type "limpio" — Firefox rechaza reproducir si lo guardamos
      // con `audio/webm;codecs=opus` aunque el blob sí sea opus.
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
      //    AudioPlayer firma on-demand al reproducir → audio nunca expira.
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

  /* ── Cerrar sala (abogado) ── */
  async function closeRoom() {
    if (!activeRoom || closing) return
    setClosing(true)
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${activeRoom.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    })

    // Guardar calificación si la dio
    if (rating > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/chat_ratings`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          room_id:   activeRoom.id,
          lawyer_id: lawyerId,
          rating,
        }),
      })
    }

    setClosing(false)
    setShowRating(false)
    setActiveRoom(null)
    fetchRooms()
  }

  /* ── Verificar: notificar al administrador para revisión de proceso ──
     Inserta un mensaje en el canal interno (mensajes_internos) dirigido al
     superadmin. Reutiliza la infraestructura del chat interno: el admin lo
     verá en AdminInternalChat como un mensaje del abogado. */
  async function enviarVerificacion() {
    if (!activeRoom || sendingVerificar) return
    setSendingVerificar(true)
    try {
      // Endpoint seguro: valida server-side que soy el abogado asignado,
      // registra la notificación para la campanita del admin, deja el mensaje
      // en el chat interno y envía el correo. Ver api/verify-request.js.
      const headers = await getAuthHeaders()
      const res = await fetch('/api/verify-request', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roomId:       activeRoom.id,
          clientNombre: activeRoom.client_nombre || 'Anónimo',
          area:         activeRoom.area_derecho || 'Consulta',
        }),
      })
      if (!res.ok) throw new Error('verify-request failed')

      setVerifiedRooms(prev => new Set(prev).add(activeRoom.id))
      setToast('Solicitud de revisión enviada al administrador.')
    } catch (err) {
      setToast('No se pudo enviar la solicitud. Intenta de nuevo.')
    } finally {
      setSendingVerificar(false)
      setConfirmVerificar(false)
    }
  }

  const hasVideos = activeRoom && messages.some(m => m.message_type === 'video_call')

  return (
    <div className={`${styles.dashboard} ${activeRoom ? styles.dashboardChatOpen : ''}`}>

      {/* ── Sidebar de salas ── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarTitle}>Consultas activas</p>
          <p className={styles.sidebarSub}>Ordenadas por actividad reciente</p>
        </div>

        <div>
          {loadingRooms && <p className={styles.empty}>Cargando…</p>}
          {!loadingRooms && rooms.length === 0 && (
            <p className={styles.sinSalas}>No tienes consultas asignadas aún.</p>
          )}

          {rooms.map(room => {
            const isActive = activeRoom?.id === room.id
            const lastTs   = room.lastMsg?.created_at || room.created_at
            // Ocultamos el badge mientras la sala está abierta — sigue
            // siendo el conteo correcto, pero distrae al estar viendo el
            // chat. Se reseteará naturalmente al responder.
            const showUnread = room.unreadCount > 0 && !isActive

            return (
              <button
                key={room.id}
                className={`${styles.roomRow} ${isActive ? styles.roomRowActive : ''} ${room.status === 'closed' ? styles.itemClosed : ''}`}
                onClick={() => selectRoom(room)}
              >
                {/* Ícono de área */}
                <div className={styles.itemIcon}>⚖</div>

                <div className={styles.itemInfo}>
                  {/* Fila superior: NOMBRE del cliente + hora último mensaje */}
                  <div className={styles.itemRow}>
                    <span className={styles.itemNombre}>{room.client_nombre || 'Anónimo'}</span>
                    <span className={styles.itemFecha}>{fmtSidebar(lastTs)}</span>
                  </div>

                  {/* Fila media: último mensaje + badge unread + estado */}
                  <div className={styles.itemRow}>
                    <span className={styles.itemUltimo}>
                      {room.lastMsg
                        ? room.lastMsg.sender_type === 'lawyer'
                          ? `Tú: ${room.lastMsg.content}`
                          : room.lastMsg.content
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

                  {/* Fila inferior: área + fecha de inicio */}
                  <div className={styles.itemInicio}>
                    {room.area_derecho || 'Consulta'} · Inicio {fmtSidebar(room.created_at)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Área de chat ── */}
      <div className={styles.main}>
        {!activeRoom ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderIcon}>⚖</span>
            <p className={styles.placeholderText}>Selecciona una consulta para responder</p>
            <p className={styles.placeholderSub}>Los chats aparecen ordenados por más reciente</p>
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
                  Cliente · {activeRoom.client_nombre || 'Anónimo'}
                  {activeRoom.ciudad ? ` · ${activeRoom.ciudad}` : ''}
                  {activeRoom.created_at && (
                    <span> · Inicio: {fmtHora(activeRoom.created_at)}</span>
                  )}
                </p>
              </div>

              {/* Acciones del header — solo cuando NO está el panel rating activo */}
              {activeRoom.status !== 'closed' && !showRating && (
                <div className={styles.headerActions}>
                  {verifiedRooms.has(activeRoom.id)
                    ? <span className={styles.verificadoTag}>✓ Revisión solicitada</span>
                    : <button
                        className={styles.btnVerificar}
                        onClick={() => setConfirmVerificar(true)}
                        title="Notificar al administrador para revisión de proceso"
                      >
                        Verificar
                      </button>}
                  <button className={styles.btnClose} onClick={() => setConfirmClose(true)}>
                    Finalizar consulta
                  </button>
                </div>
              )}
            </div>

            {/* Sala cerrada — banner */}
            {activeRoom.status === 'closed' && (
              <div className={styles.closedBanner}>
                Consulta finalizada · Solo lectura
              </div>
            )}

            {/* Mensajes */}
            <div className={styles.messages} ref={mensajesRef}>
              {messages.length === 0 && (
                <p className={styles.messagesEmpty}>
                  No hay mensajes aún. Saluda al cliente para iniciar.
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
                        // mine={true} fuerza el skin dorado: se ve bien sobre
                        // fondo claro (skin "other" translúcido desaparece sobre ivory).
                        <AudioPlayer src={m.file_url} mine={true} />
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
                              setToast('Por políticas de privacidad no puedes guardar esta imagen.')
                            }}
                          />
                        ) : (
                          <button
                            className={styles.fileBtn}
                            onClick={() => canDownload
                              ? openChatFile(m.file_url)
                              : setToast('Por políticas de privacidad no puedes descargar este archivo.')
                            }
                            title={canDownload ? 'Descargar archivo' : 'Archivo bloqueado por políticas de privacidad'}
                          >
                            <IconPaperclip size={16} />
                            <span className={styles.fileName}>{m.file_name}</span>
                            {m.file_size && <span className={styles.fileSize}>{formatSize(m.file_size)}</span>}
                          </button>
                        )
                      ) : (
                        <p className={styles.msgText}>{renderMensaje(m.content)}</p>
                      )}
                      <p className={esMio ? styles.msgMetaMine : styles.msgMetaOther}>
                        {esMio ? 'Tú' : 'Cliente'} · {fmtHora(m.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Input — solo si la sala está abierta */}
            {activeRoom.status !== 'closed' && (
              <div className={styles.inputBar}>
                <button
                  className={styles.attachBtn}
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  title="Adjuntar archivo"
                >
                  {uploading ? '…' : <IconPaperclip size={15} />}
                </button>
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
                  placeholder="Responde al cliente…"
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

      {/* ── Modal: datos de contacto bloqueados ── */}
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
              Por seguridad, no está permitido enviar números de teléfono ni correos
              electrónicos dentro del chat. Continúa la conversación sin compartir
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

      {/* ── Modal: confirmar envío de notificación de revisión ── */}
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
            <h3 id="modalVerificarTitle" className={styles.modalTitle}>Enviar notificación de revisión</h3>
            <p className={styles.modalText}>
              ¿Seguro que deseas enviar al administrador una notificación para que
              revise este proceso? Quedará registrada en el canal interno.
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
                {sendingVerificar ? 'Enviando…' : 'Sí, enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: finalizar consulta (paso 1 confirmar → paso 2 calificar) ── */}
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
              /* Paso 1 — confirmar la finalización */
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
                  ¿Seguro que deseas finalizar esta consulta? El cliente ya no podrá
                  enviar más mensajes. A continuación podrás calificar la atención.
                </p>
                <div className={styles.modalActions}>
                  <button className={styles.btnCancel} onClick={() => setConfirmClose(false)}>
                    Cancelar
                  </button>
                  <button
                    className={styles.btnConfirmDanger}
                    onClick={() => { setConfirmClose(false); setShowRating(true) }}
                  >
                    Sí, finalizar
                  </button>
                </div>
              </>
            ) : (
              /* Paso 2 — calificar y cerrar */
              <>
                <div className={styles.modalIconGold}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 id="modalCloseTitle" className={styles.modalTitle}>Califica esta consulta</h3>
                <p className={styles.modalText}>
                  Antes de cerrar, califica la atención brindada en el chat (opcional).
                </p>
                <div className={styles.modalStars}>
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      className={`${styles.star} ${rating >= n ? styles.starOn : ''}`}
                      onClick={() => setRating(n)}
                      aria-label={`${n} estrella${n === 1 ? '' : 's'}`}
                    >★</button>
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
                    {closing ? 'Cerrando…' : 'Confirmar cierre'}
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
          >×</button>
        </div>
      )}
    </div>
  )
}