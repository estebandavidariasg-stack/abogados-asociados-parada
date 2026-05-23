import { useState, useEffect, useRef, useCallback } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './LawyerChatDashboard.module.css'
import AudioPlayer from './AudioPlayer'
import { IconPaperclip, IconMic } from '../shared/Icons'

// Detecta si el archivo es imagen para renderizar preview inline (WhatsApp style).
function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
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

export default function LawyerChatDashboard({ lawyerId }) {
  const [rooms,       setRooms]       = useState([])
  const [activeRoom,  setActiveRoom]  = useState(null)
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [sending,     setSending]     = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [closing,     setClosing]     = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [rating,      setRating]      = useState(0)
  const [showRating,  setShowRating]  = useState(false)
  const [loadingRooms, setLoadingRooms] = useState(true)

  const fileRef   = useRef(null)
  const mensajesRef = useRef(null)
  const lastCountRef = useRef(0)
  const pollRooms = useRef(null)
  const pollMsgs  = useRef(null)

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

  // ── Lightbox para imágenes (click en thumbnail = abrir fullscreen) ──
  const [lightbox, setLightbox] = useState(null)
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

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
    await Promise.all(
      roomData.map(async room => {
        const mRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_messages` +
          `?room_id=eq.${room.id}&order=created_at.desc&limit=50&select=content,created_at,sender_type`,
          { headers: await getAuthHeaders() }
        )
        const mData = await mRes.json()
        if (Array.isArray(mData) && mData.length > 0) {
          lastMsgMap[room.id] = mData[0]
          // Sólo cuenta msgs del cliente posteriores al último "visto"
          // (abrir la sala o nuestra última respuesta). El break al ver un
          // 'lawyer' implica que cualquier respuesta nuestra también resetea
          // el contador, sin depender de seenMap.
          const seenAt = seenMap[room.id] ? new Date(seenMap[room.id]).getTime() : 0
          let unread = 0
          for (const m of mData) {
            if (m.sender_type === 'lawyer') break
            if (m.sender_type === 'client' && new Date(m.created_at).getTime() > seenAt) {
              unread++
            }
          }
          unreadMap[room.id] = unread
        }
      })
    )

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
    pollRooms.current = setInterval(fetchRooms, 6000)
    return () => clearInterval(pollRooms.current)
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
    clearInterval(pollMsgs.current)
    if (activeRoom) {
      fetchMessages()
      pollMsgs.current = setInterval(fetchMessages, 3000)
    }
    return () => clearInterval(pollMsgs.current)
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
                  {/* Fila superior: área + hora último mensaje */}
                  <div className={styles.itemRow}>
                    <span className={styles.itemArea}>{room.area_derecho || 'Consulta'}</span>
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

                  {/* Fila inferior: fecha de inicio del chat */}
                  <div className={styles.itemInicio}>
                    Inicio · {fmtSidebar(room.created_at)}
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

              {/* Botón de cierre — solo cuando NO está el panel rating activo */}
              {activeRoom.status !== 'closed' && !showRating && (
                !confirmClose
                  ? <button className={styles.btnClose} onClick={() => setConfirmClose(true)}>
                      Finalizar consulta
                    </button>
                  : <div className={styles.confirmRow}>
                      <span className={styles.confirmText}>¿Confirmar cierre?</span>
                      <button className={styles.btnConfirm} onClick={() => setShowRating(true)}>
                        Sí, cerrar
                      </button>
                      <button className={styles.btnCancel} onClick={() => setConfirmClose(false)}>
                        Cancelar
                      </button>
                    </div>
              )}
            </div>

            {/* Panel de calificación — banda full-width debajo del header,
                no compite con el botón "Finalizar consulta". */}
            {showRating && (
              <div className={styles.ratingPanel}>
                <p className={styles.ratingLabel}>Califica esta consulta</p>
                <div className={styles.stars}>
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      className={`${styles.star} ${rating >= n ? styles.starOn : ''}`}
                      onClick={() => setRating(n)}
                    >★</button>
                  ))}
                </div>
                <div className={styles.ratingActions}>
                  <button
                    className={styles.btnCancel}
                    onClick={() => { setShowRating(false); setRating(0); setConfirmClose(false) }}
                  >
                    Cancelar
                  </button>
                  <button
                    className={styles.btnConfirm}
                    onClick={closeRoom}
                    disabled={closing}
                  >
                    {closing ? 'Cerrando…' : 'Confirmar cierre'}
                  </button>
                </div>
              </div>
            )}

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
                          <button
                            className={styles.imgBtn}
                            onClick={() => setLightbox(m.file_url)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setToast('Por políticas de privacidad no puedes guardar esta imagen.')
                            }}
                            title="Click para ampliar"
                          >
                            <img
                              src={m.file_url}
                              alt={m.file_name || 'imagen'}
                              className={styles.imgPreview}
                              draggable="false"
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <button
                            className={styles.fileBtn}
                            onClick={() => setToast('Por políticas de privacidad no puedes descargar este archivo.')}
                            title="Archivo bloqueado por políticas de privacidad"
                          >
                            <IconPaperclip size={16} />
                            <span className={styles.fileName}>{m.file_name}</span>
                            {m.file_size && <span className={styles.fileSize}>{formatSize(m.file_size)}</span>}
                          </button>
                        )
                      ) : (
                        <p className={styles.msgText}>{m.content}</p>
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