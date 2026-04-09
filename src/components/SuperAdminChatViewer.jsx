import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './SuperAdminChatViewer.module.css'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const STATUS_COLOR = { waiting: '#c9a84c', active: '#4caf50', closed: '#555' }
const STATUS_LABEL = { waiting: 'Esperando', active: 'Activo', closed: 'Cerrado' }

export default function SuperAdminChatViewer() {
  const [rooms, setRooms]       = useState([])
  const [filtered, setFiltered] = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [messages, setMessages] = useState([])
  const [lawyers, setLawyers]   = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterArea, setFilterArea]     = useState('')
  const [search, setSearch]             = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { loadRooms() }, [])

  useEffect(() => {
    let list = [...rooms]
    if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus)
    if (filterArea) list = list.filter(r => r.area_derecho.toLowerCase().includes(filterArea.toLowerCase()))
    if (search)     list = list.filter(r => r.area_derecho.toLowerCase().includes(search.toLowerCase()))
    setFiltered(list)
  }, [rooms, filterStatus, filterArea, search])

  useEffect(() => {
    if (!activeRoom) return
    loadMessages(activeRoom.id)
    loadRoomLawyers(activeRoom.id)
    const ch = supabase.channel(`admin-room:${activeRoom.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${activeRoom.id}` },
          p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [activeRoom])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadRooms() {
    const { data } = await supabase.from('chat_rooms').select('id, area_derecho, status, created_at').order('created_at', { ascending: false })
    if (!data) return

    // Para cada sala, buscar los abogados asignados
    const withLawyers = await Promise.all(data.map(async room => {
      const { data: assignments } = await supabase.from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', room.id)
      return { ...room, chat_room_lawyers: assignments || [] }
    }))
    setRooms(withLawyers)
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function loadRoomLawyers(rid) {
    const { data: assignments } = await supabase.from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', rid)
    if (!assignments) return
    const lawyersData = await Promise.all(
      assignments.map(async a => {
        const { data: profile } = await supabase.from('profiles').select('nombre, apellido').eq('id', a.lawyer_id).single()
        return { ...a, nombre: profile ? `${profile.nombre} ${profile.apellido}` : 'Abogado' }
      })
    )
    setLawyers(lawyersData)
  }

  async function forceCloseRoom(rid) {
    await supabase.from('chat_rooms').update({ status: 'closed' }).eq('id', rid)
    if (activeRoom?.id === rid) setActiveRoom(r => r ? { ...r, status: 'closed' } : r)
    loadRooms()
  }

  async function deleteMessage(mid) {
    await supabase.from('chat_messages').delete().eq('id', mid)
    setMessages(prev => prev.filter(m => m.id !== mid))
  }

  const areas = [...new Set(rooms.map(r => r.area_derecho))].sort()

  return (
    <div className={styles.viewer}>

      {/* Filtros */}
      <div className={styles.filters}>
        <input className={styles.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por área…" />
        <select className={styles.filterSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">Todos los estados</option>
          <option value="waiting">Esperando</option>
          <option value="active">Activos</option>
          <option value="closed">Cerrados</option>
        </select>
        <select className={styles.filterSelect} value={filterArea} onChange={e => setFilterArea(e.target.value)}>
          <option value="">Todas las áreas</option>
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button className={styles.refreshBtn} onClick={loadRooms}>↺ Actualizar</button>
      </div>

      {/* Estadísticas */}
      <div className={styles.stats}>
        {['waiting', 'active', 'closed'].map(s => (
          <div key={s} className={styles.statCard}>
            <p className={styles.statNumber} style={{ color: STATUS_COLOR[s] }}>
              {rooms.filter(r => r.status === s).length}
            </p>
            <p className={styles.statLabel}>{STATUS_LABEL[s]}</p>
          </div>
        ))}
        <div className={styles.statCard}>
          <p className={styles.statNumber} style={{ color: '#c9a84c' }}>{rooms.length}</p>
          <p className={styles.statLabel}>Total</p>
        </div>
      </div>

      {/* Grid */}
      <div className={styles.grid}>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          {filtered.length === 0 && <p className={styles.sidebarEmpty}>Sin resultados.</p>}
          {filtered.map(room => (
            <div key={room.id}
              className={activeRoom?.id === room.id ? styles.roomRowActive : styles.roomRow}
              onClick={() => setActiveRoom(room)}>
              <div className={styles.roomTop}>
                <p className={styles.roomArea}>{room.area_derecho}</p>
                <span className={styles.roomStatus} style={{ color: STATUS_COLOR[room.status] }}>
                  {STATUS_LABEL[room.status]}
                </span>
              </div>
              <p className={styles.roomDate}>
                {new Date(room.created_at).toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))}
        </div>

        {/* Panel principal */}
        {!activeRoom
          ? <div className={styles.placeholder}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p className={styles.placeholderText}>Selecciona una sala para ver la conversación</p>
            </div>
          : <div className={styles.main}>
              {/* Header */}
              <div className={styles.chatHeader}>
                <div>
                  <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
                  <div className={styles.lawyerTags}>
                    {lawyers.map(l => (
                      <span key={l.lawyer_id} className={styles.lawyerTag}
                        style={{ color: l.status === 'active' ? '#4caf50' : '#888' }}>
                        {l.nombre}
                      </span>
                    ))}
                  </div>
                </div>
                {activeRoom.status !== 'closed' && (
                  <button className={styles.btnForceClose} onClick={() => forceCloseRoom(activeRoom.id)}>
                    Forzar cierre
                  </button>
                )}
              </div>

              {/* Mensajes */}
              <div className={styles.messages}>
                {messages.length === 0 && <p className={styles.messagesEmpty}>Sin mensajes.</p>}
                {messages.map(msg => {
                  const isLawyer = msg.sender_type === 'lawyer'
                  return (
                    <div key={msg.id} className={isLawyer ? styles.msgOuterMine : styles.msgOuterOther}>
                      {!isLawyer && (
                        <button className={styles.deleteBtn} onClick={() => deleteMessage(msg.id)} title="Borrar">🗑</button>
                      )}
                      <div className={isLawyer ? styles.bubbleMine : styles.bubbleOther}>
                        {msg.file_url
                          ? <button className={styles.fileBtn} onClick={() => window.open(msg.file_url, '_blank')}>
                              <span>📎</span>
                              <span className={styles.fileName}>{msg.file_name}</span>
                              <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                            </button>
                          : <p className={styles.msgText}>{msg.content}</p>
                        }
                        <p className={isLawyer ? styles.msgMetaMine : styles.msgMetaOther}>
                          {isLawyer ? 'Abogado' : 'Cliente'} · {new Date(msg.created_at).toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {isLawyer && (
                        <button className={styles.deleteBtn} onClick={() => deleteMessage(msg.id)} title="Borrar">🗑</button>
                      )}
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Footer */}
              <div className={styles.chatFooter}>
                <p className={styles.footerText}>Modo supervisión — el superadmin no puede escribir en el chat</p>
              </div>
            </div>
        }
      </div>
    </div>
  )
}
