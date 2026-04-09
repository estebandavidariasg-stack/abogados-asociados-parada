import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './ChatSection.module.css'

const AREAS = [
  'Derecho Civil', 'Derecho Penal', 'Derecho Laboral', 'Derecho Comercial',
  'Derecho de Familia', 'Derecho Administrativo', 'Derecho Tributario', 'Derecho Migratorio',
]

async function hashCedula(cedula) {
  const data = new TextEncoder().encode(cedula.trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ── Estrellas ─────────────────────────────────────────────────────────────
function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          style={{
            fontSize: '2.4rem',
            cursor: 'pointer',
            color: star <= (hovered || value) ? '#c9a84c' : '#2a2a2a',
            transition: 'color 0.15s, transform 0.1s',
            transform: star <= (hovered || value) ? 'scale(1.15)' : 'scale(1)',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          ★
        </span>
      ))}
    </div>
  )
}

// ── Panel de calificación ─────────────────────────────────────────────────
function RatingPanel({ roomId, onDone }) {
  const [lawyers, setLawyers]       = useState([])
  const [ratings, setRatings]       = useState({})
  const [comentario, setComentario] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  useEffect(() => {
    async function load() {
      const { data: assignments } = await supabase
        .from('chat_room_lawyers').select('lawyer_id').eq('room_id', roomId)
      if (!assignments) return

      const profiles = []
      for (const { lawyer_id } of assignments) {
        const { data: p } = await supabase
          .from('profiles').select('id, nombre, apellido, foto_url')
          .eq('id', lawyer_id).single()
        if (p) profiles.push(p)
      }
      setLawyers(profiles)
    }
    load()
  }, [roomId])

  async function handleSubmit() {
    setSubmitting(true)
    for (const [lawyer_id, rating] of Object.entries(ratings)) {
      await supabase.from('chat_ratings').insert({
        room_id: roomId, lawyer_id, rating,
        comentario: comentario.trim() || null,
      })
    }
    setSubmitted(true)
    setTimeout(onDone, 2000)
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div className={styles.ratingCard}>
        <p className={styles.ratingTitle}>¡Gracias por tu calificación!</p>
        <p className={styles.ratingSubtitle}>Redirigiendo…</p>
      </div>
    )
  }

  return (
    <div className={styles.ratingCard}>
      <p className={styles.ratingTitle}>¿Cómo fue tu experiencia?</p>
      <p className={styles.ratingSubtitle}>Califica el servicio de los abogados que te atendieron.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '28px 0' }}>
        {lawyers.length === 0 && (
          <div>
            <p style={{ color: '#666', fontSize: '0.8rem', marginBottom: 12 }}>Calificación general</p>
            <StarRating value={ratings['general'] || 0} onChange={v => setRatings({ general: v })} />
          </div>
        )}
        {lawyers.map(l => {
          const nombre = `${l.nombre || ''} ${l.apellido || ''}`.trim()
          return (
            <div key={l.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <img
                  src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`}
                  alt={nombre}
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
                <p style={{ color: '#ccc', fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>{nombre}</p>
              </div>
              <StarRating
                value={ratings[l.id] || 0}
                onChange={v => setRatings(r => ({ ...r, [l.id]: v }))}
              />
            </div>
          )
        })}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label className={styles.label}>Comentario opcional</label>
        <textarea
          className={styles.textarea}
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="¿Algo que quieras compartir sobre la atención?"
          rows={3}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className={styles.btnGold} style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Enviando…' : 'Enviar calificación'}
        </button>
        <button className={styles.btnOutline} onClick={onDone}>Omitir</button>
      </div>
    </div>
  )
}

// ── Paso 0: Cédula ────────────────────────────────────────────────────────
function StepCedula({ onNew, onResume }) {
  const [cedula, setCedula]   = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    const raw = cedula.trim()
    if (!/^\d{6,12}$/.test(raw)) { setError('Ingresa un número de cédula válido (6–12 dígitos).'); return }
    setLoading(true); setError('')
    const hash = await hashCedula(raw)
    localStorage.setItem('chat_cedula_hash', hash)

    const { data: rooms } = await supabase
      .from('chat_rooms').select('*').eq('client_cedula', hash).order('created_at', { ascending: false })

    const existing = rooms?.find(r => r.status === 'waiting' || r.status === 'active')
    if (existing) onResume(existing)
    else onNew()
    setLoading(false)
  }

  return (
    <div className={styles.card}>
      <p className={styles.cedulaTitle}>Identificación</p>
      <p className={styles.cedulaHint}>
        Ingresa tu cédula para iniciar o retomar una consulta. El número se convierte en un código anónimo.
      </p>
      <input
        className={styles.input}
        value={cedula}
        onChange={e => { setCedula(e.target.value.replace(/\D/g, '')); setError('') }}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        placeholder="Número de cédula"
        maxLength={12}
      />
      {error && <p className={styles.formError} style={{ marginTop: 8 }}>{error}</p>}
      <button className={styles.btnGold} style={{ marginTop: 16 }} onClick={handleSubmit} disabled={loading || !cedula}>
        {loading ? 'Verificando…' : 'Continuar'}
      </button>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────
export default function ChatSection() {
  const [step, setStep]   = useState('cedula') // cedula|form|lawyers|chat|rating
  const [form, setForm]   = useState({ nombre: '', area: '', descripcion: '' })
  const [formError, setFormError]   = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [lawyers, setLawyers]   = useState([])
  const [picked, setPicked]     = useState([])
  const [loadingL, setLoadingL] = useState(false)

  const [roomId, setRoomId]         = useState(null)
  const [roomStatus, setRoomStatus] = useState('waiting')
  const [roomArea, setRoomArea]     = useState('')
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [uploading, setUploading]   = useState(false)

  const fileRef   = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (!roomId) return
    loadMessages(roomId)
    const ch = supabase.channel(`rc:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
          p => setMessages(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_rooms', filter: `id=eq.${roomId}` },
          p => {
            setRoomStatus(p.new.status)
            // Cuando el abogado cierra → ir a calificación
            if (p.new.status === 'closed') setStep('rating')
          })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [roomId])

  function handleResume(room) {
    setRoomId(room.id); setRoomStatus(room.status); setRoomArea(room.area_derecho); setStep('chat')
  }

  function resetToStart() {
    setStep('cedula')
    setRoomId(null)
    setRoomStatus('waiting')
    setRoomArea('')
    setMessages([])
    setForm({ nombre: '', area: '', descripcion: '' })
    setPicked([])
    localStorage.removeItem('chat_cedula_hash')
    localStorage.removeItem('chat_nombre')
  }

  async function handleFormSubmit() {
    const { nombre, area, descripcion } = form
    if (!nombre.trim())      { setFormError('Ingresa tu nombre.'); return }
    if (!area)               { setFormError('Selecciona el área de tu caso.'); return }
    if (!descripcion.trim()) { setFormError('Describe brevemente tu caso.'); return }
    setSubmitting(true); setFormError('')
    localStorage.setItem('chat_nombre', nombre.trim())
    await fetchLawyers(area)
    setStep('lawyers'); setSubmitting(false)
  }

  async function fetchLawyers(area) {
    setLoadingL(true)
    const { data } = await supabase.from('profiles')
      .select('id, nombre, apellido, area_derecho, ciudad, departamento, foto_url').eq('aprobado', true)
    const filtered = (data || []).filter(l => l.area_derecho?.toLowerCase().includes(area.toLowerCase())).slice(0, 5)
    setLawyers(filtered); setLoadingL(false)
  }

  function toggleLawyer(id) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev)
  }

  async function startChat() {
    if (!picked.length) return
    setSending(true)
    const hash = localStorage.getItem('chat_cedula_hash')
    const { nombre, area, descripcion } = form
    const { data: room, error } = await supabase.from('chat_rooms')
      .insert({ area_derecho: area, client_token: hash, client_cedula: hash, status: 'waiting' }).select().single()
    if (error || !room) { setSending(false); return }
    await supabase.from('chat_room_lawyers').insert(picked.map(lid => ({ room_id: room.id, lawyer_id: lid, status: 'invited' })))
    await supabase.from('chat_messages').insert({
      room_id: room.id, sender_type: 'client', lawyer_id: null,
      content: `Hola, mi nombre es ${nombre}.\n\nÁrea: ${area}\n\nDescripción del caso:\n${descripcion}`,
    })
    setRoomId(room.id); setRoomStatus('waiting'); setRoomArea(area); setStep('chat'); setSending(false)
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage() {
    if (!input.trim() || !roomId) return
    const content = input.trim(); setInput('')
    await supabase.from('chat_messages').insert({ room_id: roomId, sender_type: 'client', lawyer_id: null, content })
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file || !roomId) return
    setUploading(true)
    const path = `${roomId}/${crypto.randomUUID()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type })
    if (!error) {
      const { data: signed } = await supabase.storage.from('chat-files').createSignedUrl(path, 604800)
      await supabase.from('chat_messages').insert({
        room_id: roomId, sender_type: 'client', lawyer_id: null,
        content: `📎 ${file.name}`, file_url: signed?.signedUrl, file_name: file.name, file_size: file.size,
      })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <section className={styles.section} id="chat">
      <div className={styles.header}>
        <h2 className={styles.title}>Consulta Privada</h2>
        <p className={styles.subtitle}>
          Conecta directamente con abogados especializados. Tu cédula se convierte en un código anónimo.
        </p>
      </div>

      {/* CÉDULA */}
      {step === 'cedula' && <StepCedula onNew={() => setStep('form')} onResume={handleResume} />}

      {/* FORMULARIO */}
      {step === 'form' && (
        <div className={styles.form}>
          <div className={styles.formCard}>
            <div className={styles.field}>
              <label className={styles.label}>Nombre completo</label>
              <input className={styles.input} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="¿Cómo te llamamos?" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Área del caso</label>
              <select className={styles.select} value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}>
                <option value="">Selecciona un área…</option>
                {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Descripción breve del caso</label>
              <textarea className={styles.textarea} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Describe la situación. No incluyas datos personales sensibles aún." rows={4} />
            </div>
            {formError && <p className={styles.formError}>{formError}</p>}
            <button className={styles.btnGold} onClick={handleFormSubmit} disabled={submitting}>
              {submitting ? 'Buscando abogados…' : 'Buscar abogados disponibles'}
            </button>
            <button className={styles.btnBack} onClick={() => setStep('cedula')}>← Volver</button>
          </div>
        </div>
      )}

      {/* ABOGADOS */}
      {step === 'lawyers' && (
        <div className={styles.lawyersWrap}>
          <button className={styles.btnBack} onClick={() => setStep('form')}>← Volver al formulario</button>
          <p className={styles.areaTitle}>{form.area}</p>
          <p className={styles.areaSubtitle}>Selecciona hasta 3 abogados para iniciar el chat.</p>

          {loadingL ? <p className={styles.loadingText}>Buscando abogados disponibles…</p>
            : lawyers.length === 0
            ? <div className={styles.emptyLawyers}>
                <p className={styles.emptyText}>No hay abogados disponibles en esta área.</p>
                <button className={styles.btnOutline} onClick={() => setStep('form')}>Cambiar área</button>
              </div>
            : <div className={styles.lawyersList}>
                {lawyers.map(l => {
                  const sel    = picked.includes(l.id)
                  const nombre = `${l.nombre || ''} ${l.apellido || ''}`.trim()
                  return (
                    <div key={l.id} className={sel ? styles.lawyerCardSelected : styles.lawyerCard} onClick={() => toggleLawyer(l.id)}>
                      <img className={styles.lawyerAvatar}
                        src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`}
                        alt={nombre} />
                      <div className={styles.lawyerInfo}>
                        <p className={sel ? styles.lawyerNameSelected : styles.lawyerName}>{nombre}</p>
                        <p className={styles.lawyerArea}>{l.area_derecho}</p>
                        {l.ciudad && <p className={styles.lawyerCity}>{l.ciudad}{l.departamento ? `, ${l.departamento}` : ''}</p>}
                      </div>
                      <div className={sel ? styles.checkCircleSelected : styles.checkCircle}>
                        {sel && <span className={styles.checkMark}>✓</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
          }

          {picked.length > 0 && (
            <button className={styles.btnGold} style={{ marginTop: 24 }} onClick={startChat} disabled={sending}>
              {sending ? 'Iniciando chat…' : `Iniciar chat con ${picked.length} abogado${picked.length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {/* CHAT */}
      {step === 'chat' && (
        <div className={styles.chatWrap}>
          <div className={styles.chatHeader}>
            <p className={styles.chatTitle}>Consulta — {roomArea || form.area}</p>
            <p className={styles.chatStatus}>
              {roomStatus === 'waiting' ? '⏳ Esperando que un abogado se una…'
                : roomStatus === 'active' ? '🟢 Chat activo'
                : '🔴 Consulta finalizada'}
            </p>
          </div>

          <div className={styles.chatMessages}>
            {messages.length === 0 && (
              <div className={styles.chatEmpty}>
                <p className={styles.chatEmptyText}>Puedes presentar tu consulta.</p>
                <p className={styles.chatEmptyHint}>Un abogado se unirá en breve.</p>
              </div>
            )}
            {messages.map(msg => {
              const mine = msg.sender_type === 'client'
              return (
                <div key={msg.id} className={mine ? styles.msgRowMine : styles.msgRowOther}>
                  <div className={mine ? styles.msgBubbleMine : styles.msgBubbleOther}>
                    {msg.file_url
                      ? <button className={styles.fileBtn} onClick={() => window.open(msg.file_url, '_blank')}>
                          <span>📎</span>
                          <span className={styles.fileName}>{msg.file_name}</span>
                          <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                        </button>
                      : <p className={styles.msgText}>{msg.content}</p>
                    }
                    <p className={mine ? styles.msgMetaMine : styles.msgMetaOther}>
                      {mine ? (localStorage.getItem('chat_nombre') || 'Tú') : 'Abogado'} · {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <div className={styles.chatInputBar}>
            <button className={styles.attachBtn} onClick={() => fileRef.current?.click()} disabled={uploading} title="Adjuntar archivo">
              {uploading ? '⏳' : '📎'}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={handleFile} style={{ display: 'none' }} />
            <input className={styles.chatInput} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
              placeholder="Escribe un mensaje… (Enter para enviar)" />
            <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim()}>Enviar</button>
          </div>
        </div>
      )}

      {/* CALIFICACIÓN — aparece cuando el abogado cierra el chat */}
      {step === 'rating' && roomId && (
        <RatingPanel roomId={roomId} onDone={resetToStart} />
      )}
    </section>
  )
}
