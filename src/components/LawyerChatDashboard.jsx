import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './LawyerChatDashboard.module.css'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const STATUS_COLOR = { waiting: '#c9a84c', active: '#4caf50', closed: '#555' }
const STATUS_LABEL = { waiting: 'Esperando', active: 'Activo', closed: 'Cerrado' }

export default function LawyerChatDashboard({ lawyerId }) {
  const [rooms, setRooms]           = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [closing, setClosing]       = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const fileRef   = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!lawyerId) return
    loadRooms()
    const ch = supabase.channel(`lawyer-rooms:${lawyerId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_room_lawyers', filter: `lawyer_id=eq.${lawyerId}` }, () => loadRooms())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms' }, () => loadRooms())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [lawyerId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!activeRoom) return
    loadMessages(activeRoom.id)
    const ch = supabase.channel(`lawyer-chat:${activeRoom.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${activeRoom.id}` },
          p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [activeRoom])

  async function loadRooms() {
    const { data } = await supabase.from('chat_room_lawyers').select('room_id, status').eq('lawyer_id', lawyerId)
    if (!data || data.length === 0) { setRooms([]); return }
    const roomsData = []
    for (const a of data) {
      const { data: room } = await supabase.from('chat_rooms').select('id, area_derecho, status, created_at').eq('id', a.room_id).single()
      if (room && room.status !== 'closed') roomsData.push({ ...room, my_status: a.status })
    }
    setRooms(roomsData)
  }

  async function joinRoom(room) {
    await supabase.from('chat_room_lawyers').update({ status: 'active' }).eq('room_id', room.id).eq('lawyer_id', lawyerId)
    if (room.status === 'waiting') await supabase.from('chat_rooms').update({ status: 'active' }).eq('id', room.id)
    setActiveRoom({ ...room, status: room.status === 'waiting' ? 'active' : room.status })
    setConfirmClose(false)
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage() {
    if (!input.trim() || !activeRoom) return
    const content = input.trim(); setInput(''); setSending(true)
    await supabase.from('chat_messages').insert({ room_id: activeRoom.id, sender_type: 'lawyer', lawyer_id: lawyerId, content })
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
        room_id: activeRoom.id, sender_type: 'lawyer', lawyer_id: lawyerId,
        content: `📎 ${file.name}`, file_url: signed?.signedUrl, file_name: file.name, file_size: file.size,
      })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function closeRoom() {
    if (!activeRoom || closing) return
    setClosing(true)
    await supabase.from('chat_rooms').update({ status: 'closed' }).eq('id', activeRoom.id)
    setActiveRoom(null); setMessages([]); setConfirmClose(false); setClosing(false)
    loadRooms()
  }

  return (
    <div className={styles.dashboard}>

      {/* ── Sidebar ── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarTitle}>Mis consultas</p>
        </div>
        {rooms.length === 0 && <p className={styles.empty}>No tienes consultas asignadas.</p>}
        {rooms.map(room => (
          <div key={room.id}
            className={activeRoom?.id === room.id ? styles.roomRowActive : styles.roomRow}
            onClick={() => joinRoom(room)}>
            <p className={styles.roomArea}>{room.area_derecho}</p>
            <div className={styles.roomMeta}>
              <span className={styles.roomStatus} style={{ color: STATUS_COLOR[room.status] }}>
                {STATUS_LABEL[room.status]}
              </span>
              <span className={styles.roomDate}>
                {new Date(room.created_at).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Panel principal ── */}
      {!activeRoom
        ? <div className={styles.placeholder}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className={styles.placeholderText}>Selecciona una consulta</p>
          </div>
        : <div className={styles.main}>
            {/* Header */}
            <div className={styles.chatHeader}>
              <div className={styles.chatMeta}>
                <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
                <p className={styles.chatSubtitle}>Cliente anónimo · sala privada</p>
              </div>
              <div className={styles.closeActions}>
                {!confirmClose
                  ? <button className={styles.btnClose} onClick={() => setConfirmClose(true)}>Finalizar consulta</button>
                  : <>
                      <span className={styles.confirmText}>¿Confirmar cierre?</span>
                      <button className={styles.btnConfirm} onClick={closeRoom} disabled={closing}>
                        {closing ? 'Cerrando…' : 'Sí, terminar'}
                      </button>
                      <button className={styles.btnCancel} onClick={() => setConfirmClose(false)}>Cancelar</button>
                    </>
                }
              </div>
            </div>

            {/* Mensajes */}
            <div className={styles.messages}>
              {messages.length === 0 && <p className={styles.messagesEmpty}>El cliente aún no ha escrito.</p>}
              {messages.map(msg => {
                const mine = msg.sender_type === 'lawyer'
                return (
                  <div key={msg.id} className={mine ? styles.msgRowMine : styles.msgRowOther}>
                    <div className={mine ? styles.bubbleMine : styles.bubbleOther}>
                      {msg.file_url
                        ? <button className={styles.fileBtn} onClick={() => window.open(msg.file_url, '_blank')}>
                            <span>📎</span>
                            <span className={styles.fileName}>{msg.file_name}</span>
                            <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                          </button>
                        : <p className={styles.msgText}>{msg.content}</p>
                      }
                      <p className={mine ? styles.msgMetaMine : styles.msgMetaOther}>
                        {mine ? 'Tú' : 'Cliente'} · {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className={styles.inputBar}>
              <button className={styles.attachBtn} onClick={() => fileRef.current?.click()} disabled={uploading} title="Adjuntar archivo">
                {uploading ? '⏳' : '📎'}
              </button>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={handleFile} style={{ display: 'none' }} />
              <input className={styles.chatInput} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Responde al cliente…" />
              <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim() || sending}>Enviar</button>
            </div>
          </div>
      }
    </div>
  )
}
