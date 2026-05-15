import { useState, useEffect, useRef } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './AdminInternalChat.module.css'
import AudioPlayer from './AudioPlayer'
import { IconMic, IconPaperclip } from '../shared/Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

function fmtFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024)    return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminInternalChat({ miId }) {
  const [abogados, setAbogados]         = useState([])
  const [selected, setSelected]         = useState(null)
  const [messages, setMessages]         = useState([])
  const [texto, setTexto]               = useState('')
  const [sending, setSending]           = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [noLeidos, setNoLeidos]         = useState({})

  // ── Voz ──────────────────────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // ── Adjuntos ─────────────────────────────────────────────────────────────
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef(null)

  const bottomRef = useRef()
  const pollRef   = useRef()

  useEffect(() => {
    fetchAbogados()
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    clearInterval(pollRef.current)
    if (selected) {
      fetchMessages()
      pollRef.current = setInterval(fetchMessages, 3000)
    }
    return () => clearInterval(pollRef.current)
  }, [selected])

  useEffect(() => {
    if (!bottomRef.current || messages.length === 0) return
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  async function fetchAbogados() {
    setLoadingUsers(true)
    const headers = await getAuthHeaders()
    // Trae abogados Y contadores aprobados (ambos pueden chatear con admin)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=in.(abogado,contador)&select=id,nombre,apellido,foto_url,ciudad,rol&order=nombre.asc`,
      { headers }
    )
    const data = await res.json()
    setAbogados(Array.isArray(data) ? data : [])
    setLoadingUsers(false)

    // Contar no leídos por abogado
    if (Array.isArray(data) && data.length && miId) {
      const h2 = await getAuthHeaders()
      const nRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mensajes_internos?to_id=eq.${miId}&leido=eq.false&select=from_id`,
        { headers: h2 }
      )
      const nData = await nRes.json()
      if (Array.isArray(nData)) {
        const counts = {}
        nData.forEach(m => { counts[m.from_id] = (counts[m.from_id] || 0) + 1 })
        setNoLeidos(counts)
      }
    }
  }

  async function fetchMessages() {
    if (!selected || !miId) return
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mensajes_internos?or=(and(from_id.eq.${miId},to_id.eq.${selected.id}),and(from_id.eq.${selected.id},to_id.eq.${miId}))&order=created_at.asc&select=*`,
      { headers }
    )
    const data = await res.json()
    setMessages(Array.isArray(data) ? data : [])

    // Marcar como leídos los mensajes hacia mí
    const sinLeer = (Array.isArray(data) ? data : []).filter(
      m => m.to_id === miId && !m.leido
    )
    if (sinLeer.length > 0) {
      const h2 = await getAuthHeaders()
      await fetch(
        `${SUPABASE_URL}/rest/v1/mensajes_internos?to_id=eq.${miId}&from_id=eq.${selected.id}&leido=eq.false`,
        { method: 'PATCH', headers: h2, body: JSON.stringify({ leido: true }) }
      )
      setNoLeidos(prev => ({ ...prev, [selected.id]: 0 }))
    }
  }

  async function enviar() {
    if (!texto.trim() || !selected || sending) return
    setSending(true)
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ from_id: miId, to_id: selected.id, mensaje: texto.trim() }),
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
      // para no colgar el flujo de subida. El blob se sube igual; la duración
      // se calcula en el reproductor.
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
    if (!selected) return
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
    if (!selected) return
    setUploadingAudio(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `internal/${miId}_${selected.id}/audio_${Date.now()}.${ext}`

      // Content-Type "limpio" sin codec spec — Firefox rechaza reproducir
      // archivos guardados con `audio/webm;codecs=opus` aunque el blob sí sea opus.
      const cleanMime = mimeType.split(';')[0] || 'audio/webm'

      // 1) Upload con JWT del usuario autenticado (las policies del bucket lo exigen)
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
        headers: { ...insHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          from_id: miId,
          to_id: selected.id,
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
     Mismo patrón que uploadAudio. Bucket 'chat-files' compartido. */
  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      alert(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
      return
    }
    uploadFile(file)
  }

  async function uploadFile(file) {
    if (!selected) return
    setUploadingFile(true)
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const path = `internal/${miId}_${selected.id}/file_${Date.now()}_${safe}`

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

      // 3) Insert mensaje
      const insHeaders = await getAuthHeaders()
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_internos`, {
        method: 'POST',
        headers: { ...insHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          from_id:      miId,
          to_id:        selected.id,
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

  return (
    <div className={styles.wrap}>

      {/* ── Sidebar profesionales ── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <p className={styles.sidebarTitulo}>Profesionales aprobados</p>
          <p className={styles.sidebarSub}>Selecciona para chatear</p>
        </div>
        <div className={styles.lista}>
          {loadingUsers && <p className={styles.cargando}>Cargando…</p>}
          {abogados.map(a => (
            <button
              key={a.id}
              className={`${styles.item} ${selected?.id === a.id ? styles.itemActive : ''}`}
              onClick={() => setSelected(a)}
            >
              <div className={styles.avatar}>
                {a.foto_url
                  ? <img src={a.foto_url} alt={a.nombre} width="40" height="40" loading="lazy" decoding="async" />
                  : `${a.nombre?.[0] || ''}${a.apellido?.[0] || ''}`}
              </div>
              <div className={styles.itemInfo}>
                <p className={styles.itemNombre}>{a.nombre} {a.apellido}</p>
                <p className={styles.itemCiudad}>
                  <span className={`${styles.rolPill} ${a.rol === 'contador' ? styles.rolPillContador : styles.rolPillAbogado}`}>
                    {a.rol === 'contador' ? 'Contador' : 'Abogado'}
                  </span>
                  {a.ciudad && <span className={styles.itemCiudadTxt}> · {a.ciudad}</span>}
                </p>
              </div>
              {noLeidos[a.id] > 0 && (
                <span className={styles.badge}>{noLeidos[a.id]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Área de chat ── */}
      <div className={styles.chatArea}>
        {!selected ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderIcon}>💬</span>
            <p className={styles.placeholderTxt}>Selecciona un abogado para iniciar el chat interno</p>
            <p className={styles.placeholderSub}>El abogado recibirá tu mensaje en su perfil</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={styles.chatHead}>
              <div className={styles.chatHeadAvatar}>
                {selected.foto_url
                  ? <img src={selected.foto_url} alt={selected.nombre} width="44" height="44" loading="lazy" decoding="async" />
                  : `${selected.nombre?.[0] || ''}${selected.apellido?.[0] || ''}`}
              </div>
              <div>
                <p className={styles.chatHeadNombre}>
                  {selected.nombre} {selected.apellido}
                  <span className={`${styles.rolPill} ${selected.rol === 'contador' ? styles.rolPillContador : styles.rolPillAbogado}`}>
                    {selected.rol === 'contador' ? 'Contador' : 'Abogado'}
                  </span>
                </p>
                <p className={styles.chatHeadSub}>
                  Chat interno · Visible solo para ti y el {selected.rol === 'contador' ? 'contador' : 'abogado'}
                </p>
              </div>
            </div>

            {/* Mensajes */}
            <div className={styles.mensajes}>
              {messages.length === 0 && (
                <p className={styles.sinMsgs}>No hay mensajes. Inicia la conversación.</p>
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
                        <AudioPlayer src={m.file_url} mine={mine} />
                      </div>
                    ) : m.message_type === 'file' && m.file_url ? (
                      <button
                        className={styles.fileBtn}
                        onClick={() => window.open(m.file_url, '_blank', 'noopener,noreferrer')}
                        title={m.file_name}
                      >
                        <IconPaperclip size={14} />
                        <span className={styles.fileName}>{m.file_name}</span>
                        <span className={styles.fileSize}>{fmtFileSize(m.file_size)}</span>
                      </button>
                    ) : (
                      <p className={styles.burbujaTexto}>{m.mensaje}</p>
                    )}
                    <span className={styles.burbujaHora}>{fmtHora(m.created_at)}</span>
                  </div>
                )
              })}
              <div ref={bottomRef} />
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
                placeholder={`Escribe un mensaje al ${selected.rol === 'contador' ? 'contador' : 'abogado'}…`}
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
          </>
        )}
      </div>
    </div>
  )
}
