import { useState, useEffect, useRef } from 'react'
import { getAuthHeaders } from '../lib/supabase'
import styles from './AdminInternalChat.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=id,nombre,apellido,foto_url,ciudad&order=nombre.asc`,
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

  return (
    <div className={styles.wrap}>

      {/* ── Sidebar abogados ── */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <p className={styles.sidebarTitulo}>Abogados aprobados</p>
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
                  ? <img src={a.foto_url} alt={a.nombre} />
                  : `${a.nombre?.[0] || ''}${a.apellido?.[0] || ''}`}
              </div>
              <div className={styles.itemInfo}>
                <p className={styles.itemNombre}>{a.nombre} {a.apellido}</p>
                <p className={styles.itemCiudad}>{a.ciudad || '—'}</p>
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
                  ? <img src={selected.foto_url} alt={selected.nombre} />
                  : `${selected.nombre?.[0] || ''}${selected.apellido?.[0] || ''}`}
              </div>
              <div>
                <p className={styles.chatHeadNombre}>{selected.nombre} {selected.apellido}</p>
                <p className={styles.chatHeadSub}>Chat interno · Visible solo para ti y el abogado</p>
              </div>
            </div>

            {/* Mensajes */}
            <div className={styles.mensajes}>
              {messages.length === 0 && (
                <p className={styles.sinMsgs}>No hay mensajes. Inicia la conversación.</p>
              )}
              {messages.map(m => (
                <div
                  key={m.id}
                  className={`${styles.burbuja} ${m.from_id === miId ? styles.mia : styles.suya}`}
                >
                  <p className={styles.burbujaTexto}>{m.mensaje}</p>
                  <span className={styles.burbujaHora}>{fmtHora(m.created_at)}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className={styles.inputArea}>
              <input
                className={styles.inputMsg}
                type="text"
                placeholder="Escribe un mensaje al abogado…"
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