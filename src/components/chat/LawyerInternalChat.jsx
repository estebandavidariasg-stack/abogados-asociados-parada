import { useState, useEffect, useRef, useCallback } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
import { openChatFile, ChatImage, ChatLightbox } from '../../lib/chatFiles'
import styles from './LawyerInternalChat.module.css'
import AudioPlayer from './AudioPlayer'
import { IconMic, IconPaperclip } from '../shared/Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
}

function fmtFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024)    return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtFechaHora(ts) {
  const d = new Date(ts)
  const hoy = new Date()
  const esHoy =
    d.getDate() === hoy.getDate() &&
    d.getMonth() === hoy.getMonth() &&
    d.getFullYear() === hoy.getFullYear()
  if (esHoy) {
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

/* ─────────────────────────────────────────────
   Primero buscamos el id del superadmin para
   poder construir la conversación correctamente
───────────────────────────────────────────── */
async function fetchAdminId() {
  const headers = await getAuthHeaders()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?rol=eq.superadmin&select=id&limit=1`,
    { headers }
  )
  const data = await res.json()
  return Array.isArray(data) && data.length ? data[0].id : null
}

export default function LawyerInternalChat({ miId }) {
  const [adminId,   setAdminId]   = useState(null)
  const [messages,  setMessages]  = useState([])
  const [texto,     setTexto]     = useState('')
  const [sending,   setSending]   = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [noLeidos,  setNoLeidos]  = useState(0)
  const mensajesRef = useRef(null)
  const lastCountRef = useRef(0)
  const pollRef   = useRef()

  // ── Voz ──────────────────────────────────────────────────────────────────
  const [recording, setRecording]           = useState(false)
  const [recordingTime, setRecordingTime]   = useState(0)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // ── Adjuntos ─────────────────────────────────────────────────────────────
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef(null)

  // ── Lightbox para imágenes ──
  const [lightbox, setLightbox] = useState(null)

  /* ── Obtener id del admin al montar ── */
  useEffect(() => {
    if (!miId) return
    fetchAdminId().then(id => {
      setAdminId(id)
    })
    return () => clearInterval(pollRef.current)
  }, [miId])

  /* ── Arrancar polling cuando ya tenemos adminId ── */
  useEffect(() => {
    if (!adminId || !miId) return
    fetchMessages()
    // Polling pausado con la pestaña oculta + refresco inmediato al volver.
    pollRef.current = setInterval(() => { if (!document.hidden) fetchMessages() }, 3000)
    const onVisible = () => { if (!document.hidden) fetchMessages() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(pollRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [adminId, miId])

  /* ── Scroll: solo auto-baja si el user YA estaba al fondo ──────────────
     Antes auto-bajaba en cada nuevo mensaje, lo que yankeaba al user cuando
     estaba leyendo historial arriba. Ahora trackeamos la posición y solo
     scrolleamos si la distancia al fondo es menor a 80px. */
  const isAtBottomRef = useRef(true)
  useEffect(() => {
    const c = mensajesRef.current
    if (!c) return
    const onScroll = () => {
      isAtBottomRef.current = c.scrollHeight - c.scrollTop - c.clientHeight < 80
    }
    c.addEventListener('scroll', onScroll, { passive: true })
    return () => c.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (messages.length === lastCountRef.current) return
    const prevCount = lastCountRef.current
    lastCountRef.current = messages.length
    const c = mensajesRef.current
    if (!c) return
    // Si el user no estaba al fondo, NO bajarlo a la fuerza.
    // Excepción: carga inicial (prevCount === 0) → siempre al fondo.
    if (prevCount === 0 || isAtBottomRef.current) {
      c.scrollTop = c.scrollHeight
    }
  }, [messages])

  const fetchMessages = useCallback(async () => {
    if (!adminId || !miId) return
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mensajes_internos` +
      `?or=(and(from_id.eq.${miId},to_id.eq.${adminId}),and(from_id.eq.${adminId},to_id.eq.${miId}))` +
      `&order=created_at.asc&select=*`,
      { headers }
    )
    const data = await res.json()
    setMessages(Array.isArray(data) ? data : [])
    setLoading(false)

    /* Marcar como leídos los mensajes del admin hacia el abogado */
    const sinLeer = (Array.isArray(data) ? data : []).filter(
      m => m.to_id === miId && !m.leido
    )
    setNoLeidos(sinLeer.length)
    if (sinLeer.length > 0) {
      const h2 = await getAuthHeaders()
      await fetch(
        `${SUPABASE_URL}/rest/v1/mensajes_internos` +
        `?to_id=eq.${miId}&from_id=eq.${adminId}&leido=eq.false`,
        {
          method: 'PATCH',
          headers: { ...h2, 'Content-Type': 'application/json' },
          body: JSON.stringify({ leido: true }),
        }
      )
      setNoLeidos(0)
    }
  }, [adminId, miId])

  async function enviar() {
    if (!texto.trim() || !adminId || sending) return
    setSending(true)
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ from_id: miId, to_id: adminId, mensaje: texto.trim() }),
    })
    setTexto('')
    setSending(false)
    await fetchMessages()
  }

  /* ── Grabación de voz (click toggle, igual que ClientChat) ─────────────── */
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
    if (!adminId) return
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
    if (!adminId) return
    setUploadingAudio(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `internal/${miId}_${adminId}/audio_${Date.now()}.${ext}`

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
      //    AudioPlayer firma on-demand → audio nunca expira.
      const insHeaders = await getAuthHeaders()
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
        method: 'POST',
        headers: { ...insHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          from_id: miId,
          to_id: adminId,
          mensaje: null,
          message_type: 'audio',
          file_url: path,
          file_name: `voz_${Date.now()}.${ext}`,
          file_size: blob.size,
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

  /* ── Adjuntar archivo ─────────────────────────────────────────────────
     Mismo patrón que uploadAudio (fetch directo al endpoint Storage de
     Supabase + sign URL a 7 días). El bucket 'chat-files' ya está en uso
     por los audios; reutilizamos las mismas policies. */
  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset para que se pueda re-seleccionar el mismo archivo
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      alert(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
      return
    }
    uploadFile(file)
  }

  async function uploadFile(file) {
    if (!adminId) return
    setUploadingFile(true)
    try {
      const ext  = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const path = `internal/${miId}_${adminId}/file_${Date.now()}_${safe}`

      // 1) Upload con JWT del usuario
      const upHeaders = await getAuthHeaders()
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
        method: 'POST',
        headers: {
          ...upHeaders,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert':     'true',
        },
        body: file,
      })
      if (!upRes.ok) {
        const detail = await upRes.text().catch(() => '')
        console.error('Error subiendo archivo:', upRes.status, detail)
        alert('No se pudo subir el archivo.')
        return
      }

      // 2) Sign URL (7 días)
      const signHeaders = await getAuthHeaders()
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/chat-files/${path}`,
        {
          method: 'POST',
          headers: { ...signHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
        }
      )
      if (!signRes.ok) {
        const detail = await signRes.text().catch(() => '')
        console.error('Error firmando URL:', signRes.status, detail)
        return
      }
      const signData = await signRes.json()
      const signedUrl = signData?.signedURL
        ? `${SUPABASE_URL}/storage/v1${signData.signedURL}`
        : null
      if (!signedUrl) { console.error('No se pudo firmar URL', signData); return }

      // 3) Insert mensaje con metadata
      const insHeaders = await getAuthHeaders()
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
        method: 'POST',
        headers: { ...insHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          from_id:      miId,
          to_id:        adminId,
          mensaje:      null,
          message_type: 'file',
          file_url:     signedUrl,
          file_name:    file.name,
          file_size:    file.size,
        }),
      })
      if (!insRes.ok) {
        const detail = await insRes.text().catch(() => '')
        console.error('Error insertando mensaje de archivo:', insRes.status, detail)
        return
      }
      await fetchMessages()
    } catch (err) {
      console.error('Error en uploadFile:', err)
    } finally {
      setUploadingFile(false)
    }
  }

  if (!miId) return null

  return (
    <div className={styles.wrap}>
      {/* Header */}
      <div className={styles.head}>
        <div className={styles.headAvatar}>A</div>
        <div>
          <p className={styles.headNombre}>
            Administración · AAP
            {noLeidos > 0 && <span className={styles.badge}>{noLeidos}</span>}
          </p>
          <p className={styles.headSub}>Canal privado · Solo visible para ti y el administrador</p>
        </div>
      </div>

      {/* Mensajes */}
      <div className={styles.mensajes} ref={mensajesRef}>
        {loading && <p className={styles.cargando}>Cargando mensajes…</p>}
        {!loading && messages.length === 0 && (
          <div className={styles.vacio}>
            <span className={styles.vacioIcon}>💬</span>
            <p>No hay mensajes aún.</p>
            <p>Escribe al administrador de AAP para iniciar la conversación.</p>
          </div>
        )}
        {messages.map(m => {
          const mine = m.from_id === miId
          return (
            <div
              key={m.id}
              className={`${styles.burbuja} ${mine ? styles.mia : styles.suya}`}
            >
              {m.message_type === 'audio' && m.file_url ? (
                <div className={styles.audioWrap}>
                  <AudioPlayer src={m.file_url} mine={mine} theme="light" />
                </div>
              ) : m.message_type === 'file' && m.file_url ? (
                isImage(m.file_name) ? (
                  <ChatImage
                    src={m.file_url}
                    alt={m.file_name || 'imagen'}
                    btnClassName={styles.imgBtn}
                    imgClassName={styles.imgPreview}
                    onOpen={setLightbox}
                  />
                ) : (
                  <button
                    className={styles.fileBtn}
                    onClick={() => openChatFile(m.file_url)}
                    title={m.file_name}
                  >
                    <IconPaperclip size={16} />
                    <span className={styles.fileName}>{m.file_name}</span>
                    <span className={styles.fileSize}>{fmtFileSize(m.file_size)}</span>
                  </button>
                )
              ) : (
                <p className={styles.burbujaTexto}>{m.mensaje}</p>
              )}
              <span className={styles.burbujaHora}>{fmtFechaHora(m.created_at)}</span>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        {/* Adjuntar archivo */}
        <button
          className={styles.attachBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile || recording || uploadingAudio}
          title={uploadingFile ? 'Subiendo archivo…' : 'Adjuntar archivo'}
        >
          <IconPaperclip size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.zip"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {/* Grabar voz */}
        <button
          className={recording ? styles.recordingBtn : styles.attachBtn}
          onClick={recording ? stopRecording : startRecording}
          disabled={uploadingAudio || uploadingFile}
          title={recording ? `Detener (${recordingTime}s)` : 'Grabar mensaje de voz'}
        >
          {recording
            ? <><span className={styles.recordDot}/>{recordingTime}s</>
            : <IconMic size={15} />}
        </button>
        <input
          className={styles.inputMsg}
          type="text"
          placeholder="Escribe un mensaje a la administración…"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
        />
        <button
          className={styles.btnEnviar}
          onClick={enviar}
          disabled={sending || !texto.trim()}
        >
          ➤
        </button>
      </div>

      <ChatLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
