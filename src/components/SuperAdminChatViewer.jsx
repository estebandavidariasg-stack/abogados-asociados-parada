import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './SuperAdminChatViewer.module.css'
import { IconTrash, IconPaperclip } from './Icons'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const STATUS_COLOR = { waiting: 'var(--gold)', active: '#4caf50', closed: '#555' }
const STATUS_LABEL = { waiting: 'Esperando', active: 'Activo', closed: 'Cerrado' }

async function hashCedula(cedula) {
  const data = new TextEncoder().encode(cedula.trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function StarDisplay({ rating }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1,2,3,4,5].map(s => (
        <span key={s} style={{
          color: s <= Math.round(rating) ? 'var(--gold)' : 'rgba(13,45,94,0.15)',
          fontSize: '1rem'
        }}>★</span>
      ))}
    </div>
  )
}

const FIELDS = 'id, area_derecho, status, created_at, client_nombre, client_email, client_cedula, codigo_referencia'

export default function SuperAdminChatViewer() {
  const [rooms, setRooms]       = useState([])
  const [filtered, setFiltered] = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [messages, setMessages] = useState([])
  const [lawyers, setLawyers]   = useState([])
  const [ratings, setRatings]   = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterArea, setFilterArea]     = useState('')
  const [search, setSearch]             = useState('')
  const [searchMode, setSearchMode]     = useState('all')
  const [searchQuery, setSearchQuery]   = useState('')
  const [searching, setSearching]       = useState(false)
  const [searchError, setSearchError]   = useState('')
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

  const messagesRef = useRef(null)

  useEffect(() => { loadRooms() }, [])

  useEffect(() => {
    let list = [...rooms]
    if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus)
    if (filterArea) list = list.filter(r => r.area_derecho?.toLowerCase().includes(filterArea.toLowerCase()))
    if (search)     list = list.filter(r => r.area_derecho?.toLowerCase().includes(search.toLowerCase()))
    setFiltered(list)
  }, [rooms, filterStatus, filterArea, search])

  useEffect(() => {
    if (!activeRoom) return
    loadMessages(activeRoom.id)
    loadRoomLawyers(activeRoom.id)
    loadRatings(activeRoom.id)
    const ch = supabase.channel(`admin-room:${activeRoom.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'chat_messages', filter: `room_id=eq.${activeRoom.id}`
      }, p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [activeRoom])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  async function loadRooms() {
    const { data } = await supabase
      .from('chat_rooms')
      .select(FIELDS)
      .order('created_at', { ascending: false })
    if (!data) return
    const withLawyers = await Promise.all(data.map(async room => {
      const { data: assignments } = await supabase
        .from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', room.id)
      return { ...room, chat_room_lawyers: assignments || [] }
    }))
    setRooms(withLawyers)
  }

  async function loadMessages(rid) {
    const { data } = await supabase
      .from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function loadRoomLawyers(rid) {
    const { data: assignments } = await supabase
      .from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', rid)
    if (!assignments) return
    const lawyersData = await Promise.all(
      assignments.map(async a => {
        const { data: profile } = await supabase
          .from('profiles').select('nombre, apellido').eq('id', a.lawyer_id).single()
        return { ...a, nombre: profile ? `${profile.nombre} ${profile.apellido}` : 'Abogado' }
      })
    )
    setLawyers(lawyersData)
  }

  async function loadRatings(rid) {
    const { data } = await supabase
      .from('chat_ratings')
      .select('*, profiles(nombre, apellido, foto_url)')
      .eq('room_id', rid)
    setRatings(data || [])
  }

  async function handleAdvancedSearch() {
    if (!searchQuery.trim()) { setSearchError('Ingresa un valor para buscar.'); return }
    setSearching(true); setSearchError(''); setActiveRoom(null); setMessages([]); setRatings([])

    try {
      if (searchMode === 'cedula') {
        const hash = await hashCedula(searchQuery.trim())
        const { data } = await supabase
          .from('chat_rooms').select(FIELDS)
          .eq('client_cedula', hash)
          .order('created_at', { ascending: false })

        if (!data || data.length === 0) {
          setSearchError('No se encontraron chats para esta cédula.')
          setFiltered([])
        } else {
          const withLawyers = await Promise.all(data.map(async room => {
            const { data: assignments } = await supabase
              .from('chat_room_lawyers').select('lawyer_id, status').eq('room_id', room.id)
            return { ...room, chat_room_lawyers: assignments || [] }
          }))
          setFiltered(withLawyers)
        }

      } else if (searchMode === 'abogado') {
        // Fetch directo con OR en la URL
        const q = encodeURIComponent(searchQuery.trim())
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?rol=eq.abogado&or=(nombre.ilike.*${searchQuery.trim()}*,apellido.ilike.*${searchQuery.trim()}*)&select=id,nombre,apellido`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        const profiles = await res.json()

        if (!profiles || profiles.length === 0) {
          setSearchError('No se encontró ningún abogado con ese nombre.')
          setFiltered([]); setSearching(false); return
        }

        const allRooms = []
        for (const lawyer of profiles) {
          const { data: assignments } = await supabase
            .from('chat_room_lawyers').select('room_id').eq('lawyer_id', lawyer.id)
          for (const a of (assignments || [])) {
            const { data: room } = await supabase
              .from('chat_rooms').select(FIELDS).eq('id', a.room_id).single()
            if (room && !allRooms.find(r => r.id === room.id)) {
              allRooms.push({
                ...room,
                _lawyerNombre: `${lawyer.nombre} ${lawyer.apellido}`,
                chat_room_lawyers: [],
              })
            }
          }
        }

        allRooms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        if (allRooms.length === 0) setSearchError('No se encontraron chats para este abogado.')
        setFiltered(allRooms)
      }
    } catch (err) {
      setSearchError('Error en la búsqueda: ' + err.message)
    } finally {
      setSearching(false)
    }
  }

  function resetSearch() {
    setSearchMode('all')
    setSearchQuery('')
    setSearchError('')
    setActiveRoom(null)
    setMessages([])
    setRatings([])
    loadRooms()
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

      {/* ── Búsqueda avanzada ── */}
      <div className={styles.searchBox}>
        <p className={styles.searchTitle}>Búsqueda avanzada</p>
        <div className={styles.modeTabs}>
          {[
            { key: 'all',     label: 'Todos los chats' },
            { key: 'cedula',  label: 'Por cédula' },
            { key: 'abogado', label: 'Por abogado' },
          ].map(m => (
            <button
              key={m.key}
              className={searchMode === m.key ? styles.modeTabActive : styles.modeTab}
              onClick={() => { setSearchMode(m.key); setSearchQuery(''); setSearchError('') }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {searchMode !== 'all' && (
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdvancedSearch()}
              placeholder={searchMode === 'cedula'
                ? 'Número de cédula del cliente…'
                : 'Nombre o apellido del abogado…'}
            />
            <button className={styles.searchBtn} onClick={handleAdvancedSearch} disabled={searching}>
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
            <button className={styles.resetBtn} onClick={resetSearch}>✕ Limpiar</button>
          </div>
        )}
        {searchError && <p className={styles.searchError}>{searchError}</p>}
      </div>

      {/* ── Filtros generales ── */}
      {searchMode === 'all' && (
        <div className={styles.filters}>
          <input className={styles.searchInput} value={search}
            onChange={e => setSearch(e.target.value)} placeholder="Buscar por área…" />
          <select className={styles.filterSelect} value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="waiting">Esperando</option>
            <option value="active">Activos</option>
            <option value="closed">Cerrados</option>
          </select>
          <select className={styles.filterSelect} value={filterArea}
            onChange={e => setFilterArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className={styles.refreshBtn} onClick={loadRooms}>↺ Actualizar</button>
        </div>
      )}

      {/* ── Estadísticas ── */}
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
          <p className={styles.statNumber} style={{ color: 'var(--gold)' }}>{rooms.length}</p>
          <p className={styles.statLabel}>Total</p>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className={styles.grid}>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          {filtered.length === 0 && (
            <p className={styles.sidebarEmpty}>
              {searchMode !== 'all' ? 'Usa el buscador para encontrar chats.' : 'Sin resultados.'}
            </p>
          )}
          {filtered.map(room => (
            <div key={room.id}
              className={activeRoom?.id === room.id ? styles.roomRowActive : styles.roomRow}
              onClick={() => setActiveRoom(room)}
            >
              <div className={styles.roomTop}>
                <p className={styles.roomArea}>{room.area_derecho}</p>
                <span className={styles.roomStatus} style={{ color: STATUS_COLOR[room.status] }}>
                  {STATUS_LABEL[room.status]}
                </span>
              </div>
              {room.client_nombre && (
                <p className={styles.roomClient}>{room.client_nombre}</p>
              )}
              {room._lawyerNombre && (
                <p className={styles.roomClient}>{room._lawyerNombre}</p>
              )}
              {room.codigo_referencia && (
                <p className={styles.roomCodigo}>{room.codigo_referencia}</p>
              )}
              <p className={styles.roomDate}>
                {new Date(room.created_at).toLocaleString('es-CO', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })}
              </p>
            </div>
          ))}
        </div>

        {/* Panel principal */}
        {!activeRoom ? (
          <div className={styles.placeholder}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className={styles.placeholderText}>Selecciona una sala para ver la conversación</p>
          </div>
        ) : (
          <div className={styles.main}>

            {/* Header */}
            <div className={styles.chatHeader}>
              <div>
                <p className={styles.chatTitle}>{activeRoom.area_derecho}</p>
                {activeRoom.client_nombre && (
                  <p className={styles.chatClient}>
                    {activeRoom.client_nombre}
                    {activeRoom.client_email && ` · ${activeRoom.client_email}`}
                  </p>
                )}
                {/* ← NUEVO: código de referencia en header */}
                {activeRoom.codigo_referencia && (
                  <div className={styles.codigoRef}>
                    <span className={styles.codigoRefLabel}>Código de referencia:</span>
                    <span className={styles.codigoRefValue}>{activeRoom.codigo_referencia}</span>
                  </div>
                )}
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
                <button className={styles.btnForceClose}
                  onClick={() => forceCloseRoom(activeRoom.id)}>
                  Forzar cierre
                </button>
              )}
            </div>

            {/* Mensajes */}
            <div className={styles.messages} ref={messagesRef}>
              {messages.length === 0 && <p className={styles.messagesEmpty}>Sin mensajes.</p>}
              {messages.map(msg => {
                const isLawyer = msg.sender_type === 'lawyer'
                return (
                  <div key={msg.id} className={isLawyer ? styles.msgOuterMine : styles.msgOuterOther}>
                    {!isLawyer && (
                      <button className={styles.deleteBtn}
                        onClick={() => deleteMessage(msg.id)} title="Borrar"><IconTrash size={13} /></button>
                    )}
                    <div className={isLawyer ? styles.bubbleMine : styles.bubbleOther}>
                      <p className={styles.msgSender}>
                        {isLawyer ? 'Abogado' : 'Cliente'}
                      </p>
                      {msg.file_url ? (
                        <button className={styles.fileBtn}
                          onClick={() => window.open(msg.file_url, '_blank')}>
                          <IconPaperclip size={13} />
                          <span className={styles.fileName}>{msg.file_name}</span>
                          <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                        </button>
                      ) : (
                        <p className={styles.msgText}>{msg.content}</p>
                      )}
                      <p className={isLawyer ? styles.msgMetaMine : styles.msgMetaOther}>
                        {new Date(msg.created_at).toLocaleString('es-CO', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                    {isLawyer && (
                      <button className={styles.deleteBtn}
                        onClick={() => deleteMessage(msg.id)} title="Borrar"><IconTrash size={13} /></button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Calificaciones */}
            {ratings.length > 0 && (
              <div className={styles.ratingsSection}>
                <p className={styles.ratingsSectionTitle}>⭐ Calificaciones</p>
                {ratings.map((r, i) => {
                  const nombre = r.profiles
                    ? `${r.profiles.nombre} ${r.profiles.apellido}`
                    : 'Abogado'
                  return (
                    <div key={i} className={styles.ratingCard}>
                      <div className={styles.ratingTop}>
                        {r.profiles?.foto_url && (
                          <img src={r.profiles.foto_url} alt={nombre}
                            className={styles.ratingAvatar} />
                        )}
                        <div>
                          <p className={styles.ratingLawyer}>{nombre}</p>
                          <StarDisplay rating={r.rating} />
                        </div>
                        <span className={styles.ratingValue}>{r.rating}/5</span>
                      </div>
                      {r.comentario && (
                        <p className={styles.ratingComment}>"{r.comentario}"</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Footer */}
            <div className={styles.chatFooter}>
              <p className={styles.footerText}>
                Modo supervisión — el superadmin no puede escribir en el chat
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}