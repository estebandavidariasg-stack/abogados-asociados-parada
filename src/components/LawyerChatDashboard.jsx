import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './LawyerChatDashboard.module.css'
import VideoCallOverlay from './VideoCallOverlay'
import AudioPlayer from './AudioPlayer'
import { IconPaperclip, IconVideoCamera, IconMic } from './Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1048576).toFixed(1)} MB`
}

const STATUS_COLOR = { waiting:'var(--gold)', active:'#4caf50', closed:'#555' }
const STATUS_LABEL = { waiting:'Esperando', active:'Activo', closed:'Cerrado' }

// ── Detecta teléfono o correo en el texto ──────────────────────────────────
function contieneContacto(texto) {
  if (!texto) return false
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i
  const telRegex   = /(?:\+?57[\s.\-]?)?3\d{2}[\s.\-]?\d{3}[\s.\-]?\d{4}/
  const telSimple  = /\b3\d{9}\b/
  return emailRegex.test(texto) || telRegex.test(texto) || telSimple.test(texto)
}

async function notificarSuperAdminContacto({ roomId, senderType, texto }) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'contact_blocked',
        data: { roomId, senderType, extracto: texto.substring(0, 120) },
      }),
    })
  } catch (err) { console.error('Error notificando contacto:', err) }
}

async function notificarCliente({ clientEmail, nombreCliente, nombreAbogado, area }) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type:'lawyer_joined', data:{ clientEmail, nombreCliente, nombreAbogado, area } }),
    })
  } catch (err) { console.error('Error notificando cliente:', err) }
}

async function notificarVerificacion({ roomId, lawyerNombre, clientNombre, area, codigoRef }) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'verificar_contrato',
        data: { roomId, lawyerNombre, clientNombre, area, codigoRef },
      }),
    })
  } catch (err) { console.error('Error notificando verificación:', err) }
}

export default function LawyerChatDashboard({ lawyerId }) {
  const [rooms, setRooms]           = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [closing, setClosing]       = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [lawyerProfile, setLawyerProfile] = useState(null)

  // ── Contacto bloqueado ─────────────────────────────────────────────────
  const [contactoWarning, setContactoWarning] = useState(false)

  // ── Verificar ──────────────────────────────────────────────────────────
  const [confirmVerificar, setConfirmVerificar] = useState(false)
  const [verificando, setVerificando]           = useState(false)
  const [verificadoOk, setVerificadoOk]         = useState(false)

  // ── Voz ────────────────────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // ── Video call ──────────────────────────────────────────────────────────
  const [callActive, setCallActive]     = useState(false)
  const [isCaller, setIsCaller]         = useState(false)
  const [incomingCall, setIncomingCall] = useState(null)

  const fileRef     = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    if (!lawyerId) return
    loadRooms(); loadLawyerProfile()
    const ch = supabase.channel(`lawyer-rooms:${lawyerId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_room_lawyers', filter:`lawyer_id=eq.${lawyerId}` }, () => loadRooms())
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'chat_rooms' }, () => loadRooms())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [lawyerId])

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!activeRoom) return
    loadMessages(activeRoom.id)
    const ch = supabase.channel(`lawyer-chat:${activeRoom.id}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${activeRoom.id}` },
        p => {
          setMessages(prev => prev.find(m => m.id===p.new.id) ? prev : [...prev, p.new])
          if (p.new.message_type==='call_invite' && p.new.sender_type==='client') {
            setIncomingCall({ callerName: activeRoom.client_nombre || 'Cliente' })
          }
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [activeRoom])

  async function loadLawyerProfile() {
    const { data } = await supabase.from('profiles').select('nombre, apellido, email').eq('id', lawyerId).single()
    if (data) setLawyerProfile(data)
  }

  async function loadRooms() {
    const { data } = await supabase.from('chat_room_lawyers').select('room_id, status').eq('lawyer_id', lawyerId)
    if (!data || data.length === 0) { setRooms([]); return }
    const roomsData = []
    for (const a of data) {
      const { data: room } = await supabase.from('chat_rooms')
        // ← Se agrega codigo_referencia al select
        .select('id, area_derecho, status, created_at, client_email, client_nombre, client_celular, codigo_referencia')
        .eq('id', a.room_id).single()
      if (room && room.status !== 'closed') roomsData.push({ ...room, my_status: a.status })
    }
    setRooms(roomsData)
  }

  async function joinRoom(room) {
    await supabase.from('chat_room_lawyers').update({ status:'active' }).eq('room_id', room.id).eq('lawyer_id', lawyerId)
    if (room.status === 'waiting') {
      await supabase.from('chat_rooms').update({ status:'active' }).eq('id', room.id)
      if (room.client_email && lawyerProfile) {
        await notificarCliente({ clientEmail: room.client_email, nombreCliente: room.client_nombre||'Cliente',
          nombreAbogado: `${lawyerProfile.nombre} ${lawyerProfile.apellido}`, area: room.area_derecho })
      }
    }
    setActiveRoom({ ...room, status: room.status==='waiting' ? 'active' : room.status })
    setConfirmClose(false); setCallActive(false); setIncomingCall(null)
    setVerificadoOk(false); setConfirmVerificar(false)
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage() {
    if (!input.trim() || !activeRoom) return
    const content = input.trim()
    // ── Bloqueo de datos de contacto ──────────────────────────────────────
    if (contieneContacto(content)) {
      setContactoWarning(true)
      setTimeout(() => setContactoWarning(false), 5000)
      await notificarSuperAdminContacto({ roomId: activeRoom.id, senderType:'lawyer', texto: content })
      return
    }
    setInput(''); setSending(true)
    await supabase.from('chat_messages').insert({ room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId, content })
    setSending(false)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file || !activeRoom) return
    setUploading(true)
    const path = `${activeRoom.id}/${crypto.randomUUID()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type })
    if (!error) {
      const { data: signed } = await supabase.storage.from('chat-files').createSignedUrl(path, 604800)
      await supabase.from('chat_messages').insert({
        room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId,
        content: file.name, file_url: signed?.signedUrl, file_name: file.name, file_size: file.size,
      })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function fixAudioDuration(blob) {
    return new Promise(resolve => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'; audio.src = URL.createObjectURL(blob)
      audio.onloadedmetadata = () => {
        if (audio.duration === Infinity || isNaN(audio.duration)) {
          audio.currentTime = 1e101
          audio.ontimeupdate = () => { audio.ontimeupdate = null; audio.currentTime = 0; URL.revokeObjectURL(audio.src); resolve(blob) }
        } else { URL.revokeObjectURL(audio.src); resolve(blob) }
      }
      audio.onerror = () => resolve(blob)
    })
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder; audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const actualType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: actualType })
        if (blob.size > 0) { const fixedBlob = await fixAudioDuration(blob); await uploadAudio(fixedBlob, actualType) }
      }
      recorder.start(100); setRecording(true); setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t+1), 1000)
    } catch (err) { alert('No se pudo acceder al micrófono: ' + err.message) }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop(); clearInterval(recordingTimerRef.current)
    setRecording(false); setRecordingTime(0)
  }

  async function uploadAudio(blob, mimeType = 'audio/webm') {
    if (!activeRoom) return
    setUploading(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `${activeRoom.id}/audio_${Date.now()}.${ext}`
      const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization':`Bearer ${SUPABASE_KEY}`, 'apikey':SUPABASE_KEY, 'Content-Type':mimeType, 'x-upsert':'true' },
        body: blob,
      })
      if (!res.ok) { const err = await res.json(); console.error('Error subiendo audio:', err); return }
      const { data: signed } = await supabase.storage.from('chat-files').createSignedUrl(path, 60*60*24*7)
      if (!signed?.signedUrl) { console.error('No se pudo obtener URL firmada'); return }
      await supabase.from('chat_messages').insert({
        room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId,
        content:'Mensaje de voz', file_url: signed.signedUrl,
        file_name:`voz_${Date.now()}.${ext}`, file_size: blob.size, message_type:'audio',
      })
    } catch (err) { console.error('Error en uploadAudio:', err) }
    finally { setUploading(false) }
  }

  async function startVideoCall() {
    setIsCaller(true); setCallActive(true)
    await supabase.from('chat_messages').insert({
      room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId,
      content:'Videollamada iniciada', message_type:'call_invite',
    })
  }
  function acceptCall() { setIncomingCall(null); setIsCaller(false); setCallActive(true) }
  async function rejectCall() {
    setIncomingCall(null)
    await supabase.from('chat_messages').insert({
      room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId,
      content:'Videollamada rechazada', message_type:'call_reject',
    })
  }

  async function closeRoom() {
    if (!activeRoom || closing) return
    setClosing(true)
    await supabase.from('chat_rooms').update({ status:'closed' }).eq('id', activeRoom.id)
    setActiveRoom(null); setMessages([]); setConfirmClose(false); setClosing(false)
    setCallActive(false); setIncomingCall(null)
    loadRooms()
  }

  // ── Verificar consulta ─────────────────────────────────────────────────
  async function handleVerificar() {
    if (!activeRoom || verificando) return
    setVerificando(true)
    try {
      // 1. Notificar superadmin por correo
      await notificarVerificacion({
        roomId: activeRoom.id,
        lawyerNombre: lawyerName,
        clientNombre: activeRoom.client_nombre || 'Cliente',
        area: activeRoom.area_derecho,
        codigoRef: activeRoom.codigo_referencia || '—',
      })
      // 2. Registrar en tabla verificaciones
      await supabase.from('verificaciones').insert({
        room_id: activeRoom.id,
        lawyer_id: lawyerId,
        estado: 'pendiente',
      })
      // 3. Mensaje de sistema en el chat
      await supabase.from('chat_messages').insert({
        room_id: activeRoom.id, sender_type:'lawyer', lawyer_id: lawyerId,
        content: '✅ Consulta enviada a verificación — El administrador revisará el contrato y coordinará el pago de comisión.',
        message_type: 'system',
      })
      setVerificadoOk(true)
      setConfirmVerificar(false)
    } catch (err) {
      console.error('Error en verificación:', err)
    } finally {
      setVerificando(false)
    }
  }

  const lawyerName = lawyerProfile ? `${lawyerProfile.nombre} ${lawyerProfile.apellido}` : 'Abogado'

  return (
    <div className={styles.dashboard}>

      {callActive && activeRoom && (
        <VideoCallOverlay roomId={activeRoom.id} isCaller={isCaller}
          myName={lawyerName} remoteName={activeRoom.client_nombre||'Cliente'}
          onEnd={() => setCallActive(false)} />
      )}

      {/* Sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarTitle}>Mis consultas</p>
        </div>
        {rooms.length === 0 && <p className={styles.empty}>No tienes consultas asignadas.</p>}
        {rooms.map(room => (
          <div key={room.id}
            className={activeRoom?.id===room.id ? styles.roomRowActive : styles.roomRow}
            onClick={() => joinRoom(room)}>
            <p className={styles.roomArea}>{room.area_derecho}</p>
            <div className={styles.roomMeta}>
              <span className={styles.roomStatus} style={{ color: STATUS_COLOR[room.status] }}>
                {STATUS_LABEL[room.status]}
              </span>
              <span className={styles.roomDate}>
                {new Date(room.created_at).toLocaleDateString('es-CO', { month:'short', day:'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Panel principal */}
      {!activeRoom ? (
        <div className={styles.placeholder}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p className={styles.placeholderText}>Selecciona una consulta</p>
        </div>
      ) : (
        <div className={styles.main}>

          {incomingCall && (
            <div className={styles.incomingCallBanner}>
              <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                <IconVideoCamera size={15}/> {incomingCall.callerName} te está llamando
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button className={styles.btnAcceptCall} onClick={acceptCall}>✓ Aceptar</button>
                <button className={styles.btnRejectCall} onClick={rejectCall}>✕ Rechazar</button>
              </div>
            </div>
          )}

          {/* Header */}
          <div className={styles.chatHeader}>
            <div className={styles.chatMeta}>
              <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
              <p className={styles.chatSubtitle}>
                {activeRoom.client_nombre || 'Cliente anónimo'} · sala privada
              </p>
              {activeRoom.codigo_referencia && (
                <p style={{
                  fontSize: '0.68rem', color: 'var(--gold)',
                  letterSpacing: '0.12em', fontFamily: "'Courier New', monospace",
                  marginTop: 3, opacity: 0.85,
                }}>
                  Ref: {activeRoom.codigo_referencia}
                </p>
              )}
            </div>

            {/* Acciones del header — fila compacta y legible */}
            <div className={styles.headerActions}>

              {/* Videollamada */}
              {activeRoom.status === 'active' && (
                <button className={styles.videoCallBtn} onClick={startVideoCall} title="Iniciar videollamada">
                  <IconVideoCamera size={17} />
                </button>
              )}

              {/* Verificar */}
              {activeRoom.status === 'active' && !verificadoOk && (
                <button
                  className={styles.btnVerificar}
                  onClick={() => setConfirmVerificar(v => !v)}
                >
                  ✦ Verificar
                </button>
              )}

              {verificadoOk && (
                <span className={styles.verificadoTag}>✓ Enviado a verificación</span>
              )}

              {/* Finalizar */}
              {!confirmClose ? (
                <button className={styles.btnClose} onClick={() => setConfirmClose(true)}>
                  Finalizar consulta
                </button>
              ) : (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>¿Cerrar?</span>
                  <button className={styles.btnConfirm} onClick={closeRoom} disabled={closing}>
                    {closing ? '…' : 'Sí'}
                  </button>
                  <button className={styles.btnCancel} onClick={() => setConfirmClose(false)}>No</button>
                </div>
              )}

            </div>
          </div>

          {/* Panel de confirmación de verificar — separado del header, debajo */}
          {confirmVerificar && !verificadoOk && (
            <div className={styles.verificarPanel}>
              <p className={styles.verificarTxt}>
                ¿Confirmas enviar esta consulta a revisión del administrador? Se solicitará el pago de comisión.
              </p>
              <div className={styles.verificarBtns}>
                <button className={styles.btnConfirmVerificar} onClick={handleVerificar} disabled={verificando}>
                  {verificando ? 'Enviando…' : 'Sí, enviar a verificación'}
                </button>
                <button className={styles.btnCancelVerificar} onClick={() => setConfirmVerificar(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Mensajes */}
          <div className={styles.messages} ref={messagesRef}>
            {messages.length === 0 && <p className={styles.messagesEmpty}>El cliente aún no ha escrito.</p>}
            {messages.map(msg => {
              const mine = msg.sender_type === 'lawyer'
              if (msg.message_type==='call_invite' || msg.message_type==='call_reject' || msg.message_type==='system') {
                return (
                  <div key={msg.id} className={styles.callSystemMsg}>
                    <span>{msg.content}</span>
                    <span className={styles.callSystemTime}>
                      {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>
                )
              }
              return (
                <div key={msg.id} className={mine ? styles.msgRowMine : styles.msgRowOther}>
                  <div className={mine ? styles.bubbleMine : styles.bubbleOther}>
                    {msg.message_type==='audio' && msg.file_url ? (
                      <AudioPlayer src={msg.file_url} mine={mine}/>
                    ) : msg.file_url ? (
                      <button className={styles.fileBtn} onClick={() => window.open(msg.file_url,'_blank')}>
                        <IconPaperclip size={14}/>
                        <span className={styles.fileName}>{msg.file_name}</span>
                        <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                      </button>
                    ) : (
                      <p className={styles.msgText}>{msg.content}</p>
                    )}
                    <p className={mine ? styles.msgMetaMine : styles.msgMetaOther}>
                      {mine ? 'Tú' : (activeRoom.client_nombre||'Cliente')} · {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Input */}
          <div className={styles.inputBar}>
            <button className={styles.attachBtn} onClick={() => fileRef.current?.click()}
              disabled={uploading} title="Adjuntar archivo"><IconPaperclip size={15}/></button>
            <input ref={fileRef} type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
              onChange={handleFile} style={{ display:'none' }}/>
            <button className={recording ? styles.recordingBtn : styles.attachBtn}
              onClick={recording ? stopRecording : startRecording} disabled={uploading}
              title={recording ? `Detener (${recordingTime}s)` : 'Grabar mensaje de voz'}>
              {recording ? <><span className={styles.recordDot}/>{recordingTime}s</> : <IconMic size={15}/>}
            </button>
            <input className={styles.chatInput} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
              placeholder="Responde al cliente…"/>
            <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim()||sending}>Enviar</button>
          </div>

          {/* ── Aviso de contacto bloqueado ── */}
          {contactoWarning && (
            <div style={{
              background:'rgba(220,80,50,0.1)', border:'1px solid rgba(220,80,50,0.3)',
              borderRadius:8, padding:'10px 14px', margin:'8px 12px',
              fontSize:'0.78rem', color:'rgba(255,160,130,0.95)',
              display:'flex', alignItems:'center', gap:8,
            }}>
              ⚠ No puedes compartir datos de contacto en el chat. El administrador ha sido notificado.
            </div>
          )}
        </div>
      )}
    </div>
  )
}