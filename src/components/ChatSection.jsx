import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import styles from './ChatSection.module.css'
import VideoCallOverlay from './VideoCallOverlay'
import AudioPlayer from './AudioPlayer'
import { IconPaperclip, IconVideoCamera, IconMic } from './Icons'
import { validarCelular, validarCorreo, normalizarCelular } from '../lib/validaciones'


const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const DEPARTAMENTOS_CIUDADES = [
  'Amazonas - Leticia', 'Antioquia - Medellín', 'Antioquia - Bello',
  'Antioquia - Envigado', 'Antioquia - Itagüí', 'Arauca - Arauca',
  'Atlántico - Barranquilla', 'Atlántico - Soledad', 'Bolívar - Cartagena',
  'Boyacá - Tunja', 'Caldas - Manizales', 'Caquetá - Florencia',
  'Casanare - Yopal', 'Cauca - Popayán', 'Cesar - Valledupar',
  'Chocó - Quibdó', 'Córdoba - Montería', 'Cundinamarca - Bogotá D.C.',
  'Cundinamarca - Soacha', 'Huila - Neiva', 'La Guajira - Riohacha',
  'Magdalena - Santa Marta', 'Meta - Villavicencio', 'Nariño - Pasto',
  'Norte de Santander - Cúcuta', 'Putumayo - Mocoa', 'Quindío - Armenia',
  'Risaralda - Pereira', 'San Andrés - San Andrés', 'Santander - Bucaramanga',
  'Santander - Floridablanca', 'Sucre - Sincelejo', 'Tolima - Ibagué',
  'Valle del Cauca - Cali', 'Valle del Cauca - Buenaventura',
  'Valle del Cauca - Palmira', 'Vaupés - Mitú', 'Vichada - Puerto Carreño',
]
const DEPARTAMENTOS = [...new Set(DEPARTAMENTOS_CIUDADES.map(dc => dc.split(' - ')[0]))]
const AREAS_DERECHO = [
  'Derecho Civil', 'Derecho Penal', 'Derecho Laboral', 'Derecho Comercial',
  'Derecho de Familia', 'Derecho Administrativo', 'Derecho Tributario',
  'Derecho Migratorio', 'Derecho Corporativo', 'Derecho Constitucional',
  'Derecho Ambiental', 'Derecho Internacional', 'Derecho Inmobiliario',
  'Derecho de Tránsito', 'Derecho Disciplinario',
]

async function hashCedula(cedula) {
  const data = new TextEncoder().encode(cedula.trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1048576).toFixed(1)} MB`
}

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

async function notificarAbogado({ lawyerEmail, nombreAbogado, nombreCliente, area }) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'new_consultation', data: { lawyerEmail, nombreAbogado, nombreCliente, area } }),
    })
  } catch (err) { console.error('Error notificando abogado:', err) }
}

const CARDS_LEFT = [
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>), title: 'Cifrado seguro', text: 'Tu información viaja protegida con encriptación de extremo a extremo.', delay: '0s', duration: '4.4s' },
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>), title: 'Identidad anónima', text: 'Tu cédula se convierte en un código único. Nadie sabrá quién eres.', delay: '0.9s', duration: '5s' },
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>), title: 'Cobertura nacional', text: 'Abogados en todo el territorio colombiano listos para atenderte.', delay: '1.7s', duration: '4.7s' },
]
const CARDS_RIGHT = [
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>), title: 'Abogado experto', text: 'Conecta con especialistas verificados en tu área jurídica.', delay: '0.3s', duration: '4.8s' },
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>), title: 'Respuesta rápida', text: 'Recibe orientación legal en minutos desde cualquier dispositivo.', delay: '1.1s', duration: '4.3s' },
  { icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>), title: 'Atención 24/7', text: 'Consulta cuando lo necesites, sin importar la hora ni el lugar.', delay: '2s', duration: '5.2s' },
]

function SideCards({ cards }) {
  return (
    <div className={styles.sideCards}>
      {cards.map(card => (
        <div key={card.title} className={styles.featureCard}
          style={{ animationDelay: card.delay, animationDuration: card.duration }}>
          <div className={styles.cardIconWrap}>{card.icon}</div>
          <h4 className={styles.cardTitle}>{card.title}</h4>
          <p className={styles.cardText}>{card.text}</p>
        </div>
      ))}
    </div>
  )
}

function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display:'flex', gap:8 }}>
      {[1,2,3,4,5].map(star => (
        <span key={star} onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)} onMouseLeave={() => setHovered(0)}
          style={{ fontSize:'2.4rem', cursor:'pointer',
            color: star <= (hovered||value) ? 'var(--gold)' : '#2a2a2a',
            transition:'color 0.15s, transform 0.1s',
            transform: star <= (hovered||value) ? 'scale(1.15)' : 'scale(1)',
            lineHeight:1, userSelect:'none' }}>★</span>
      ))}
    </div>
  )
}

function RatingPanel({ roomId, onDone }) {
  const [lawyers, setLawyers]       = useState([])
  const [ratings, setRatings]       = useState({})
  const [comentario, setComentario] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  useEffect(() => {
    async function load() {
      const { data: assignments } = await supabase.from('chat_room_lawyers').select('lawyer_id').eq('room_id', roomId)
      if (!assignments) return
      const profiles = []
      for (const { lawyer_id } of assignments) {
        const { data: p } = await supabase.from('profiles').select('id, nombre, apellido, foto_url').eq('id', lawyer_id).single()
        if (p) profiles.push(p)
      }
      setLawyers(profiles)
    }
    load()
  }, [roomId])

  async function handleSubmit() {
    setSubmitting(true)
    for (const [lawyer_id, rating] of Object.entries(ratings)) {
      await supabase.from('chat_ratings').insert({ room_id: roomId, lawyer_id, rating, comentario: comentario.trim() || null })
    }
    setSubmitted(true)
    setTimeout(onDone, 2000)
    setSubmitting(false)
  }

  if (submitted) return (
    <div className={styles.ratingCard}>
      <p className={styles.ratingTitle}>¡Gracias por tu calificación!</p>
      <p className={styles.ratingSubtitle}>Redirigiendo…</p>
    </div>
  )

  return (
    <div className={styles.ratingCard}>
      <p className={styles.ratingTitle}>¿Cómo fue tu experiencia?</p>
      <p className={styles.ratingSubtitle}>Califica el servicio de los abogados que te atendieron.</p>
      <div style={{ display:'flex', flexDirection:'column', gap:24, margin:'28px 0' }}>
        {lawyers.length === 0 && (
          <div>
            <p style={{ color:'#666', fontSize:'0.8rem', marginBottom:12 }}>Calificación general</p>
            <StarRating value={ratings['general']||0} onChange={v => setRatings({ general: v })} />
          </div>
        )}
        {lawyers.map(l => {
          const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
          return (
            <div key={l.id}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
                <img src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`}
                  alt={nombre} style={{ width:40, height:40, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                <p style={{ color:'#ccc', fontWeight:600, fontSize:'0.9rem', margin:0 }}>{nombre}</p>
              </div>
              <StarRating value={ratings[l.id]||0} onChange={v => setRatings(r => ({ ...r, [l.id]: v }))} />
            </div>
          )
        })}
      </div>
      <div style={{ marginBottom:20 }}>
        <label className={styles.label}>Comentario opcional</label>
        <textarea className={styles.textarea} value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="¿Algo que quieras compartir sobre la atención?" rows={3} />
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <button className={styles.btnGold} style={{ flex:1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Enviando…' : 'Enviar calificación'}
        </button>
        <button className={styles.btnOutline} onClick={onDone}>Omitir</button>
      </div>
    </div>
  )
}

function StepCedula({ onNew, onResume }) {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const codigoURL = urlParams.get('codigo') || ''
  const [cedula, setCedula] = useState('')
  const [codigo, setCodigo] = useState(codigoURL)
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    const rawCedula = cedula.trim()
    if (!/^\d{6,12}$/.test(rawCedula)) { setError('Ingresa un número de cédula válido (6–12 dígitos).'); return }
    setLoading(true); setError('')
    const hash = await hashCedula(rawCedula)
    localStorage.setItem('chat_cedula_hash', hash)
    if (codigo.trim()) localStorage.setItem('chat_codigo_ref', codigo.trim().toUpperCase())
    else localStorage.removeItem('chat_codigo_ref')
    const { data: rooms } = await supabase.from('chat_rooms').select('*').eq('client_cedula', hash).order('created_at', { ascending: false })
    const existing = rooms?.find(r => r.status === 'waiting' || r.status === 'active')
    if (existing) onResume(existing)
    else onNew()
    setLoading(false)
  }

  return (
    <div className={styles.card}>
      <p className={styles.cedulaTitle}>Identificación</p>
      <p className={styles.cedulaHint}>Ingresa tu cédula para iniciar o retomar una consulta.</p>
      <div className={styles.field} style={{ marginBottom:16 }}>
        <label className={styles.label}>Número de cédula <span className={styles.required}>*</span></label>
        <input className={styles.input} value={cedula}
          onChange={e => { setCedula(e.target.value.replace(/\D/g,'')); setError('') }}
          onKeyDown={e => e.key==='Enter' && handleSubmit()} placeholder="Ej: 1234567890" maxLength={12} />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>
          Código de referencia
          <span style={{ color:'rgba(255,255,255,0.35)', fontWeight:400, marginLeft:8 }}>(opcional)</span>
        </label>
        <input className={styles.input} value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,''))}
          onKeyDown={e => e.key==='Enter' && handleSubmit()}
          placeholder="Ej: AAP-A3KX72" maxLength={10} style={{ letterSpacing:'2px', fontWeight:600 }} />
        <p style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.3)', marginTop:6 }}>
          Si un asesor te dio un código, ingrésalo aquí.
        </p>
      </div>
      {error && <p className={styles.formError} style={{ marginTop:8 }}>{error}</p>}
      <button className={styles.btnGold} style={{ marginTop:20, width:'100%' }}
        onClick={handleSubmit} disabled={loading || !cedula}>
        {loading ? 'Verificando…' : 'Continuar'}
      </button>
    </div>
  )
}

export default function ChatSection() {
  const [step, setStep]         = useState('cedula')
  const [form, setForm]         = useState({
    nombre:'', apellido:'', ciudad:'', departamento:'',
    areas:[], correo:'', celular:'', descripcion:'',
  })
  const [correoTouched,  setCorreoTouched]  = useState(false)
  const [celularTouched, setCelularTouched] = useState(false)
  const [formError, setFormError]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lawyers, setLawyers]       = useState({ cercanos:[], porArea:[] })
  const [picked, setPicked]         = useState([])
  const [loadingL, setLoadingL]     = useState(false)
  const [roomId, setRoomId]         = useState(null)
  const [roomStatus, setRoomStatus] = useState('waiting')
  const [roomArea, setRoomArea]     = useState('')
  const [roomCodigo, setRoomCodigo] = useState('')          // ← código de referencia visible
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [uploading, setUploading]   = useState(false)

  // ── Contacto bloqueado ────────────────────────────────────────────────────
  const [contactoWarning, setContactoWarning] = useState(false)

  // ── Abogados excluidos (inactividad) ─────────────────────────────────────
  const [excludedLawyerIds, setExcludedLawyerIds] = useState([])
  const [closedRoomId, setClosedRoomId]           = useState(null)

  // ── Voz ──────────────────────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // ── Video call ────────────────────────────────────────────────────────────
  const [callActive, setCallActive]     = useState(false)
  const [isCaller, setIsCaller]         = useState(false)
  const [incomingCall, setIncomingCall] = useState(null)

  // refs para evitar stale closures en callbacks de realtime
  const formRef    = useRef(form)
  const roomAreaRef = useRef(roomArea)
  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { roomAreaRef.current = roomArea }, [roomArea])

  const fileRef     = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!roomId) return
    loadMessages(roomId)
    const ch = supabase.channel(`rc:${roomId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${roomId}` },
        p => {
          setMessages(prev => prev.find(m => m.id===p.new.id) ? prev : [...prev, p.new])
          if (p.new.message_type==='call_invite' && p.new.sender_type==='lawyer') {
            setIncomingCall({ callerName:'Abogado' })
          }
        })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'chat_rooms', filter:`id=eq.${roomId}` },
        async p => {
          setRoomStatus(p.new.status)
          if (p.new.status === 'closed') {
            // Guardar roomId cerrado para rating posterior
            setClosedRoomId(p.new.id)
            // Obtener abogados del chat cerrado para excluirlos
            const { data: assignments } = await supabase
              .from('chat_room_lawyers').select('lawyer_id').eq('room_id', p.new.id)
            const excluded = (assignments || []).map(a => a.lawyer_id)
            setExcludedLawyerIds(excluded)
            // Obtener áreas actuales
            const areas = formRef.current.areas.length > 0
              ? formRef.current.areas
              : roomAreaRef.current.split(', ').map(a => a.trim()).filter(Boolean)
            const dept = formRef.current.departamento || ''
            // Buscar abogados disponibles excluyendo los del chat cerrado
            if (areas.length > 0) {
              const { data: todos } = await supabase.from('profiles')
                .select('id, nombre, apellido, area_derecho, ciudad, departamento, foto_url, email')
                .eq('aprobado', true)
              const filtrados = (todos || []).filter(l =>
                !excluded.includes(l.id) &&
                areas.some(a => l.area_derecho?.toLowerCase().includes(a.toLowerCase()))
              )
              setLawyers({
                cercanos: filtrados.filter(l => l.departamento === dept),
                porArea:  filtrados.filter(l => l.departamento !== dept),
              })
            }
            setStep('choose_another')
          }
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [roomId])

  function handleResume(room) {
    setRoomId(room.id)
    setRoomStatus(room.status)
    setRoomArea(room.area_derecho)
    setRoomCodigo(room.codigo_referencia || '')
    setStep('chat')
  }

  function resetToStart() {
    setStep('cedula'); setRoomId(null); setRoomStatus('waiting'); setRoomArea(''); setRoomCodigo('')
    setMessages([]); setForm({ nombre:'', apellido:'', ciudad:'', departamento:'', areas:[], correo:'', celular:'', descripcion:'' })
    setPicked([]); setCallActive(false); setIncomingCall(null)
    setExcludedLawyerIds([]); setClosedRoomId(null)
    localStorage.removeItem('chat_cedula_hash'); localStorage.removeItem('chat_nombre'); localStorage.removeItem('chat_codigo_ref')
  }

  async function handleFormSubmit() {
    const { nombre, apellido, ciudad, departamento, areas, correo, celular, descripcion } = form
    if (!nombre.trim())                    { setFormError('Ingresa tu nombre.'); return }
    if (!apellido.trim())                  { setFormError('Ingresa tu apellido.'); return }
    if (!departamento)                     { setFormError('Selecciona tu departamento.'); return }
    if (!ciudad)                           { setFormError('Selecciona tu ciudad.'); return }
    if (areas.length < 1)                  { setFormError('Selecciona al menos un área.'); return }
    if (!correo.trim() && !celular.trim()) { setFormError('Ingresa al menos un correo o celular.'); return }
    if (!descripcion.trim())               { setFormError('Describe brevemente tu caso.'); return }
    setSubmitting(true); setFormError('')
    localStorage.setItem('chat_nombre', `${nombre.trim()} ${apellido.trim()}`)
    await fetchLawyers(areas, departamento, excludedLawyerIds)
    setStep('lawyers'); setSubmitting(false)
  }

  async function fetchLawyers(areas, departamento, excluded = []) {
    setLoadingL(true)
    const { data } = await supabase.from('profiles')
      .select('id, nombre, apellido, area_derecho, ciudad, departamento, foto_url, email').eq('aprobado', true)
    const filtrados = (data || []).filter(l =>
      !excluded.includes(l.id) &&
      areas.some(a => l.area_derecho?.toLowerCase().includes(a.toLowerCase()))
    )
    setLawyers({
      cercanos: filtrados.filter(l => l.departamento === departamento),
      porArea:  filtrados.filter(l => l.departamento !== departamento),
    })
    setLoadingL(false)
  }

  function toggleLawyer(id) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x!==id) : prev.length < 3 ? [...prev, id] : prev)
  }

  async function startChat() {
    if (!picked.length) return
    setSending(true)
    const hash      = localStorage.getItem('chat_cedula_hash')
    const codigoRef = localStorage.getItem('chat_codigo_ref') || null
    const { nombre, apellido, areas, descripcion, ciudad, departamento, correo, celular } = form
    const { data: room, error } = await supabase.from('chat_rooms')
      .insert({ area_derecho: areas.join(', '), client_token: hash, client_cedula: hash,
        client_email: correo||null, client_nombre: `${nombre} ${apellido}`,
        client_celular: celular||null, codigo_referencia: codigoRef, status:'waiting' })
      .select().single()
    if (error || !room) { setSending(false); return }
    await supabase.from('chat_room_lawyers').insert(picked.map(lid => ({ room_id: room.id, lawyer_id: lid, status:'invited' })))
    await supabase.from('chat_messages').insert({
      room_id: room.id, sender_type:'client', lawyer_id: null,
      content: `Hola, mi nombre es ${nombre} ${apellido}.\n\nUbicación: ${ciudad}, ${departamento}\nÁrea(s): ${areas.join(', ')}\nContacto: ${correo||'—'} / ${celular||'—'}\n\nDescripción del caso:\n${descripcion}`,
    })
    const todosAbogados = [...lawyers.cercanos, ...lawyers.porArea]
    for (const abogado of todosAbogados.filter(l => picked.includes(l.id))) {
      if (abogado.email) await notificarAbogado({ lawyerEmail: abogado.email,
        nombreAbogado: `${abogado.nombre} ${abogado.apellido}`, nombreCliente:`${nombre} ${apellido}`, area: areas.join(', ') })
    }
    setRoomId(room.id); setRoomStatus('waiting'); setRoomArea(areas.join(', '))
    setRoomCodigo(codigoRef || ''); setPicked([])
    setStep('chat'); setSending(false)
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage() {
    if (!input.trim() || !roomId) return
    const content = input.trim()
    // ── Bloqueo de datos de contacto ──────────────────────────────────────
    if (contieneContacto(content)) {
      setContactoWarning(true)
      setTimeout(() => setContactoWarning(false), 5000)
      await notificarSuperAdminContacto({ roomId, senderType:'client', texto: content })
      return
    }
    setInput('')
    await supabase.from('chat_messages').insert({ room_id: roomId, sender_type:'client', lawyer_id: null, content })
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
        room_id: roomId, sender_type:'client', lawyer_id: null,
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
    if (!roomId) return
    setUploading(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `${roomId}/audio_${Date.now()}.${ext}`
      const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization':`Bearer ${SUPABASE_KEY}`, 'apikey':SUPABASE_KEY, 'Content-Type':mimeType, 'x-upsert':'true' },
        body: blob,
      })
      if (!res.ok) { const err = await res.json(); console.error('Error subiendo audio:', err); return }
      const { data: signed } = await supabase.storage.from('chat-files').createSignedUrl(path, 60*60*24*7)
      if (!signed?.signedUrl) { console.error('No se pudo obtener URL firmada'); return }
      await supabase.from('chat_messages').insert({
        room_id: roomId, sender_type:'client', lawyer_id: null,
        content:'Mensaje de voz', file_url: signed.signedUrl,
        file_name:`voz_${Date.now()}.${ext}`, file_size: blob.size, message_type:'audio',
      })
    } catch (err) { console.error('Error en uploadAudio:', err) }
    finally { setUploading(false) }
  }

  async function startVideoCall() {
    setIsCaller(true); setCallActive(true)
    await supabase.from('chat_messages').insert({
      room_id: roomId, sender_type:'client', lawyer_id: null,
      content:'Videollamada iniciada', message_type:'call_invite',
    })
  }
  function acceptCall() { setIncomingCall(null); setIsCaller(false); setCallActive(true) }
  async function rejectCall() {
    setIncomingCall(null)
    await supabase.from('chat_messages').insert({
      room_id: roomId, sender_type:'client', lawyer_id: null,
      content:'Videollamada rechazada', message_type:'call_reject',
    })
  }

  const allLawyers = [...(lawyers.cercanos||[]), ...(lawyers.porArea||[])]
  const myName     = localStorage.getItem('chat_nombre') || 'Cliente'

  // ── JSX compartido para lista de abogados (reutilizado en lawyers y choose_another) ──
  function LawyerList({ onStart, startLabel }) {
    return (
      <>
        {loadingL ? <p className={styles.loadingText}>Buscando abogados disponibles…</p>
          : allLawyers.length === 0 ? (
            <div className={styles.emptyLawyers}>
              <p className={styles.emptyText}>No hay más abogados disponibles en esta área.</p>
              <button className={styles.btnOutline} onClick={resetToStart}>Volver al inicio</button>
            </div>
          ) : (
            <>
              {lawyers.cercanos.length > 0 && (
                <>
                  <div className={styles.sectionLabel}><span className={styles.sectionLabelDot}/>Cerca de ti — {form.ciudad}, {form.departamento}</div>
                  <div className={styles.lawyersList}>
                    {lawyers.cercanos.map(l => {
                      const sel = picked.includes(l.id)
                      const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
                      return (
                        <div key={l.id} className={sel ? styles.lawyerCardSelected : styles.lawyerCard} onClick={() => toggleLawyer(l.id)}>
                          <img className={styles.lawyerAvatar} src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`} alt={nombre} />
                          <div className={styles.lawyerInfo}>
                            <p className={sel ? styles.lawyerNameSelected : styles.lawyerName}>{nombre}</p>
                            <p className={styles.lawyerArea}>{l.area_derecho}</p>
                            {l.ciudad && <p className={styles.lawyerCity}>{l.ciudad}{l.departamento ? `, ${l.departamento}` : ''}</p>}
                          </div>
                          <div className={sel ? styles.checkCircleSelected : styles.checkCircle}>{sel && <span className={styles.checkMark}>✓</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {lawyers.porArea.length > 0 && (
                <>
                  <div className={styles.sectionLabel} style={{ marginTop: lawyers.cercanos.length > 0 ? 32 : 0 }}>
                    <span className={styles.sectionLabelDot}/>Por área — resto del país
                  </div>
                  <div className={styles.lawyersList}>
                    {lawyers.porArea.map(l => {
                      const sel = picked.includes(l.id)
                      const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
                      return (
                        <div key={l.id} className={sel ? styles.lawyerCardSelected : styles.lawyerCard} onClick={() => toggleLawyer(l.id)}>
                          <img className={styles.lawyerAvatar} src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`} alt={nombre} />
                          <div className={styles.lawyerInfo}>
                            <p className={sel ? styles.lawyerNameSelected : styles.lawyerName}>{nombre}</p>
                            <p className={styles.lawyerArea}>{l.area_derecho}</p>
                            {l.ciudad && <p className={styles.lawyerCity}>{l.ciudad}{l.departamento ? `, ${l.departamento}` : ''}</p>}
                          </div>
                          <div className={sel ? styles.checkCircleSelected : styles.checkCircle}>{sel && <span className={styles.checkMark}>✓</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )
        }
        {picked.length > 0 && (
          <button className={styles.btnGold} style={{ marginTop:24 }} onClick={onStart} disabled={sending}>
            {sending ? 'Iniciando chat…' : startLabel || `Iniciar chat con ${picked.length} abogado${picked.length > 1 ? 's' : ''}`}
          </button>
        )}
      </>
    )
  }

  return (
    <section className={styles.section} id="chat">

      {callActive && (
        <VideoCallOverlay roomId={roomId} isCaller={isCaller}
          myName={myName} remoteName="Abogado" onEnd={() => setCallActive(false)} />
      )}

      <div className={styles.header}>
        <h2 className={styles.title}>Consulta <span className={styles.titleGold}>Privada</span></h2>
        <p className={styles.subtitle}>
          Conecta directamente con abogados especializados. Tu cédula se convierte en un código anónimo.
        </p>
      </div>

      {/* ── Layout 3 columnas ── */}
      {(step === 'cedula' || step === 'chat') && (
        <div className={styles.floatingLayout}>
          <SideCards cards={CARDS_LEFT} />

          <div className={styles.centerContent}>
            {step === 'cedula' && (
              <StepCedula onNew={() => setStep('form')} onResume={handleResume} />
            )}

            {step === 'chat' && (
              /* position:relative permite posicionar el botón de video en esquina superior derecha */
              <div className={styles.chatWrap} style={{ position:'relative' }}>

                {/* ── Botón videollamada cliente — esquina superior derecha ── */}
                {roomStatus === 'active' && (
                  <button
                    className={styles.videoCallBtn}
                    onClick={startVideoCall}
                    title="Iniciar videollamada"
                    style={{ position:'absolute', top:12, right:12, zIndex:10 }}
                  >
                    <IconVideoCamera size={17} />
                  </button>
                )}

                {incomingCall && (
                  <div className={styles.incomingCallBanner}>
                    <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <IconVideoCamera size={15} /> {incomingCall.callerName} te está llamando
                    </span>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className={styles.btnAcceptCall} onClick={acceptCall}>✓ Aceptar</button>
                      <button className={styles.btnRejectCall} onClick={rejectCall}>✕ Rechazar</button>
                    </div>
                  </div>
                )}

                <div className={styles.chatHeader}>
                  <div>
                    <p className={styles.chatTitle}>Consulta — {roomArea || form.areas.join(', ')}</p>
                    <p className={styles.chatStatus}>
                      {roomStatus === 'waiting' ? 'Esperando que un abogado se una…'
                        : roomStatus === 'active' ? 'Chat activo'
                        : 'Consulta finalizada'}
                    </p>
                    {/* ── Código de referencia visible ── */}
                    {roomCodigo && (
                      <p style={{ fontSize:'0.68rem', color:'var(--gold)', letterSpacing:'0.12em',
                        fontFamily:"'Courier New', monospace", marginTop:4, opacity:0.8 }}>
                        Ref: {roomCodigo}
                      </p>
                    )}
                  </div>
                </div>

                <div className={styles.chatMessages} ref={messagesRef}>
                  {messages.length === 0 && (
                    <div className={styles.chatEmpty}>
                      <p className={styles.chatEmptyText}>Puedes presentar tu consulta.</p>
                      <p className={styles.chatEmptyHint}>Un abogado se unirá en breve.</p>
                    </div>
                  )}
                  {messages.map(msg => {
                    const mine = msg.sender_type === 'client'
                    if (msg.message_type === 'call_invite' || msg.message_type === 'call_reject' || msg.message_type === 'system') {
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
                        <div className={mine ? styles.msgBubbleMine : styles.msgBubbleOther}>
                          {msg.message_type === 'audio' && msg.file_url ? (
                            <AudioPlayer src={msg.file_url} mine={mine} />
                          ) : msg.file_url ? (
                            <button className={styles.fileBtn} onClick={() => window.open(msg.file_url,'_blank')}>
                              <IconPaperclip size={14} />
                              <span className={styles.fileName}>{msg.file_name}</span>
                              <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                            </button>
                          ) : (
                            <p className={styles.msgText}>{msg.content}</p>
                          )}
                          <p className={mine ? styles.msgMetaMine : styles.msgMetaOther}>
                            {mine ? (localStorage.getItem('chat_nombre') || 'Tú') : 'Abogado'} · {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className={styles.chatInputBar}>
                  <button className={styles.attachBtn} onClick={() => fileRef.current?.click()}
                    disabled={uploading} title="Adjuntar archivo"><IconPaperclip size={15} /></button>
                  <input ref={fileRef} type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
                    onChange={handleFile} style={{ display:'none' }} />
                  <button className={recording ? styles.recordingBtn : styles.attachBtn}
                    onClick={recording ? stopRecording : startRecording} disabled={uploading}
                    title={recording ? `Detener (${recordingTime}s)` : 'Grabar mensaje de voz'}>
                    {recording ? <><span className={styles.recordDot}/>{recordingTime}s</> : <IconMic size={15} />}
                  </button>
                  <input className={styles.chatInput} value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                    placeholder="Escribe un mensaje… (Enter para enviar)" />
                  <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim()}>Enviar</button>
                </div>

                {/* ── Aviso de contacto bloqueado ── */}
                {contactoWarning && (
                  <div style={{
                    background:'rgba(220,80,50,0.12)', border:'1px solid rgba(220,80,50,0.35)',
                    borderRadius:8, padding:'10px 14px', margin:'8px 0 0',
                    fontSize:'0.78rem', color:'rgba(255,160,130,0.95)',
                    display:'flex', alignItems:'center', gap:8,
                  }}>
                    ⚠ No puedes compartir datos de contacto en el chat. El administrador ha sido notificado.
                  </div>
                )}
              </div>
            )}
          </div>

          <SideCards cards={CARDS_RIGHT} />
        </div>
      )}

      {/* ── Form ── */}
      {step === 'form' && (
        <div className={styles.form}>
          <div className={styles.formCard}>
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre <span className={styles.required}>*</span></label>
                <input className={styles.input} value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Tu nombre" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido <span className={styles.required}>*</span></label>
                <input className={styles.input} value={form.apellido}
                  onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} placeholder="Tu apellido" />
              </div>
            </div>
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>Departamento <span className={styles.required}>*</span></label>
                <select className={styles.select} value={form.departamento}
                  onChange={e => setForm(f => ({ ...f, departamento: e.target.value, ciudad:'' }))}>
                  <option value="">Selecciona…</option>
                  {DEPARTAMENTOS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Ciudad <span className={styles.required}>*</span></label>
                <select className={styles.select} value={form.ciudad}
                  onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} disabled={!form.departamento}>
                  <option value="">Selecciona…</option>
                  {DEPARTAMENTOS_CIUDADES.filter(dc => dc.startsWith(form.departamento))
                    .map(dc => dc.split(' - ')[1]).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              {(() => {
                const v = validarCorreo(form.correo)
                return (
                  <>
                    <input
                      className={styles.input}
                      type="email"
                      value={form.correo}
                      onChange={e => setForm(f => ({ ...f, correo: e.target.value }))}
                      onBlur={() => setCorreoTouched(true)}
                      placeholder="tu@correo.com"
                      style={correoTouched && form.correo ? {
                        borderColor: v.valid === true
                          ? 'rgba(46,204,113,0.6)'
                          : v.valid === false
                          ? 'rgba(220,80,80,0.5)'
                          : undefined,
                      } : {}}
                    />
                    {correoTouched && form.correo && (
                      <span style={{
                        fontSize: '0.68rem',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: v.valid === true
                          ? 'rgba(46,204,113,0.9)'
                          : 'rgba(220,120,100,0.9)',
                      }}>
                        {v.valid === true ? '✓' : '⚠'} {v.msg}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Celular */}
            <div className={styles.field}>
              <label className={styles.label}>Celular</label>
              {(() => {
                const v = validarCelular(form.celular)
                return (
                  <>
                    <input
                      className={styles.input}
                      type="tel"
                      inputMode="numeric"
                      value={form.celular}
                      onChange={e => {
                        const normalizado = normalizarCelular(e.target.value)
                        setForm(f => ({ ...f, celular: normalizado }))
                      }}
                      onBlur={() => setCelularTouched(true)}
                      placeholder="3001234567"
                      maxLength={10}
                      style={celularTouched && form.celular ? {
                        borderColor: v.valid === true
                          ? 'rgba(46,204,113,0.6)'
                          : v.valid === false
                          ? 'rgba(220,80,80,0.5)'
                          : undefined,
                      } : {}}
                    />
                    {celularTouched && form.celular && (
                      <span style={{
                        fontSize: '0.68rem',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: v.valid === true
                          ? 'rgba(46,204,113,0.9)'
                          : 'rgba(220,120,100,0.9)',
                      }}>
                        {v.valid === true ? '✓' : '⚠'} {v.msg}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>
                Área del caso <span className={styles.required}>*</span>
                <span style={{ color:'rgba(255,255,255,0.35)', fontWeight:400, marginLeft:8 }}>(mínimo 1, máximo 3)</span>
              </label>
              <div className={styles.areasGrid}>
                {AREAS_DERECHO.map(area => {
                  const selected = form.areas.includes(area)
                  const disabled = !selected && form.areas.length >= 3
                  return (
                    <button key={area} type="button"
                      className={selected ? styles.areaChipSelected : styles.areaChip}
                      disabled={disabled}
                      onClick={() => setForm(f => ({ ...f, areas: selected ? f.areas.filter(a => a!==area) : [...f.areas, area] }))}>
                      {area}
                    </button>
                  )
                })}
              </div>
              {form.areas.length > 0 && <p className={styles.areasSelected}>Seleccionadas: <strong>{form.areas.join(' · ')}</strong></p>}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Descripción del caso <span className={styles.required}>*</span></label>
              <textarea className={styles.textarea} value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
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

      {/* ── Selección inicial de abogados ── */}
      {step === 'lawyers' && (
        <div className={styles.lawyersWrap}>
          <button className={styles.btnBack} onClick={() => setStep('form')}>← Volver al formulario</button>
          <p className={styles.areaTitle}>{form.areas.join(' · ')}</p>
          <p className={styles.areaSubtitle}>Selecciona hasta 3 abogados para iniciar el chat.</p>
          <LawyerList
            onStart={startChat}
            startLabel={sending ? 'Iniciando chat…' : `Iniciar chat con ${picked.length} abogado${picked.length > 1 ? 's' : ''}`}
          />
        </div>
      )}

      {/* ── Elegir otro abogado tras cierre/inactividad ── */}
      {step === 'choose_another' && (
        <div className={styles.lawyersWrap}>
          {/* Banner informativo */}
          <div style={{
            background:'rgba(220,160,50,0.1)', border:'1px solid rgba(220,160,50,0.3)',
            borderRadius:10, padding:'14px 18px', marginBottom:20,
            fontSize:'0.83rem', color:'rgba(255,210,120,0.9)', lineHeight:1.6,
          }}>
            <strong>Tu consulta anterior fue cerrada.</strong><br/>
            Puedes elegir otro abogado disponible para continuar. Los abogados del chat anterior no aparecen en esta lista.
          </div>

          <p className={styles.areaTitle}>Continuar con otro abogado</p>
          <p className={styles.areaSubtitle}>Selecciona hasta 3 abogados para iniciar una nueva consulta.</p>

          <LawyerList
            onStart={async () => {
              setClosedRoomId(null); setExcludedLawyerIds([])
              await startChat()
            }}
            startLabel={sending ? 'Iniciando chat…' : `Iniciar nueva consulta con ${picked.length} abogado${picked.length > 1 ? 's' : ''}`}
          />

          <div style={{ display:'flex', gap:12, marginTop:16, flexWrap:'wrap' }}>
            {closedRoomId && (
              <button className={styles.btnOutline}
                onClick={() => { setStep('rating'); setRoomId(closedRoomId) }}>
                Calificar consulta anterior
              </button>
            )}
            <button className={styles.btnBack} onClick={resetToStart}>Salir</button>
          </div>
        </div>
      )}

      {step === 'rating' && roomId && (
        <RatingPanel roomId={roomId} onDone={resetToStart} />
      )}
    </section>
  )
}