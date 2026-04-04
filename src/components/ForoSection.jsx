import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import styles from './ForoSection.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const DEPARTAMENTOS_CIUDADES = [
  'Amazonas - Leticia','Antioquia - Medellín','Antioquia - Bello','Antioquia - Envigado',
  'Antioquia - Itagüí','Arauca - Arauca','Atlántico - Barranquilla','Atlántico - Soledad',
  'Bolívar - Cartagena','Bolívar - Magangué','Boyacá - Tunja','Boyacá - Duitama',
  'Caldas - Manizales','Caquetá - Florencia','Casanare - Yopal','Cauca - Popayán',
  'Cesar - Valledupar','Chocó - Quibdó','Córdoba - Montería',
  'Cundinamarca - Bogotá D.C.','Cundinamarca - Soacha','Cundinamarca - Fusagasugá',
  'Guainía - Inírida','Guaviare - San José del Guaviare','Huila - Neiva',
  'La Guajira - Riohacha','Magdalena - Santa Marta','Meta - Villavicencio',
  'Nariño - Pasto','Norte de Santander - Cúcuta','Putumayo - Mocoa',
  'Quindío - Armenia','Risaralda - Pereira','San Andrés - San Andrés',
  'Santander - Bucaramanga','Santander - Floridablanca','Sucre - Sincelejo',
  'Tolima - Ibagué','Valle del Cauca - Cali','Valle del Cauca - Buenaventura',
  'Valle del Cauca - Palmira','Valle del Cauca - Tulúa','Vaupés - Mitú',
  'Vichada - Puerto Carreño',
]

const AREAS_DERECHO = [
  'Derecho Penal','Derecho Civil','Derecho de Familia','Derecho Laboral',
  'Derecho Comercial','Derecho Corporativo','Derecho Administrativo',
  'Derecho Constitucional','Derecho Tributario','Derecho Ambiental',
  'Derecho Internacional','Derecho Migratorio','Derecho Inmobiliario',
  'Derecho de Seguros','Derecho de Tránsito','Derecho Disciplinario',
  'Derecho Minero y Energético','Derecho de Propiedad Intelectual',
  'Derecho Informático','Derecho Médico','Otro',
]

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
  }
}

export default function ForoSection() {
  const { profile } = useAuth()
  const isAbogado = profile?.rol === 'abogado' && profile?.aprobado
  const isSuperAdmin = profile?.rol === 'superadmin'

  const [comentarios, setComentarios] = useState([])
  const [loadingComentarios, setLoadingComentarios] = useState(true)

  /* ── Form state ────────────────────────────── */
  const [nombre, setNombre] = useState('')
  const [contacto, setContacto] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [areaDerecho, setAreaDerecho] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [formMsg, setFormMsg] = useState(null)
  const [formError, setFormError] = useState(null)

  /* ── Reply state ───────────────────────────── */
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

  /* ── Fetch comentarios ─────────────────────── */
  useEffect(() => {
    fetchComentarios()
  }, [])

  async function fetchComentarios() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/comentarios?visible=eq.true&select=*&order=created_at.desc`,
        {
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        },
      )
      const data = await res.json()
      if (!Array.isArray(data)) { setComentarios([]); return }

      /* Fetch respuestas para cada comentario */
      const conRespuestas = await Promise.all(
        data.map(async (c) => {
          const resR = await fetch(
            `${SUPABASE_URL}/rest/v1/respuestas?comentario_id=eq.${c.id}&select=*,profiles:abogado_id(nombre,apellido,area_derecho,foto_url)&order=created_at.asc`,
            {
              headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
              },
            },
          )
          const respuestas = await resR.json()
          return { ...c, respuestas: Array.isArray(respuestas) ? respuestas : [] }
        }),
      )
      setComentarios(conRespuestas)
    } catch {
      setComentarios([])
    } finally {
      setLoadingComentarios(false)
    }
  }

  /* ── Enviar comentario ─────────────────────── */
  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)
    setFormMsg(null)

    if (!nombre.trim() || !contacto.trim() || !descripcion.trim()) {
      setFormError('Nombre, contacto y descripción son obligatorios.')
      return
    }

    setEnviando(true)
    try {
      const payload = {
        nombre: nombre.trim(),
        contacto: contacto.trim(),
        departamento: departamento || null,
        ciudad: ciudad || null,
        area_derecho: areaDerecho || null,
        descripcion: descripcion.trim(),
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/comentarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error('Error al publicar')

      const [nuevoComentario] = await res.json()

      /* Notificar abogados que coincidan */
      notifyMatchingLawyers(nuevoComentario)

      setFormMsg('¡Tu caso fue publicado exitosamente! Un abogado podría contactarte pronto.')
      setNombre('')
      setContacto('')
      setDepartamento('')
      setCiudad('')
      setAreaDerecho('')
      setDescripcion('')
      fetchComentarios()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  /* ── Notificar abogados matching ───────────── */
  async function notifyMatchingLawyers(comentario) {
    try {
      const headers = await getAuthHeaders()
      /* Buscar abogados aprobados */
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=nombre,apellido,email,departamento,ciudad,area_derecho`,
        { headers },
      )
      const abogados = await res.json()
      if (!Array.isArray(abogados)) return

      const matching = abogados.filter((a) => {
        if (comentario.area_derecho && a.area_derecho === comentario.area_derecho) return true
        if (comentario.departamento && a.departamento === comentario.departamento) return true
        if (comentario.ciudad && a.ciudad === comentario.ciudad) return true
        return false
      })

      if (matching.length === 0) return

      /* Llamar Edge Function para enviar emails */
      const emails = matching.map((a) => a.email).filter(Boolean)
      if (emails.length === 0) return

      await fetch(`${SUPABASE_URL}/functions/v1/notify-lawyers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          emails,
          comentario: {
            nombre: comentario.nombre,
            area_derecho: comentario.area_derecho,
            departamento: comentario.departamento,
            ciudad: comentario.ciudad,
            descripcion: comentario.descripcion,
          },
        }),
      })
    } catch {
      /* Silencioso — no bloquea la publicación */
    }
  }

  /* ── Responder comentario ──────────────────── */
  async function handleReply(comentarioId) {
    if (!replyText.trim()) return
    setSendingReply(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/respuestas`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          comentario_id: comentarioId,
          abogado_id: profile.id,
          contenido: replyText.trim(),
        }),
      })

      if (!res.ok) throw new Error('Error al responder')

      /* Notificar al comentarista */
      const comentario = comentarios.find((c) => c.id === comentarioId)
      if (comentario) {
        notifyCommenter(comentario, replyText.trim())
      }

      setReplyText('')
      setReplyingTo(null)
      fetchComentarios()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSendingReply(false)
    }
  }

  /* ── Notificar comentarista ────────────────── */
  async function notifyCommenter(comentario, respuesta) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-commenter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          contacto: comentario.contacto,
          nombre: comentario.nombre,
          respuesta,
          abogado: `${profile.nombre} ${profile.apellido}`,
        }),
      })
    } catch {
      /* Silencioso */
    }
  }

  /* ── Ocultar comentario (admin) ────────────── */
  async function hideComment(id) {
    if (!confirm('¿Eliminar este comentario?')) return
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/comentarios?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ visible: false }),
    })
    fetchComentarios()
  }

  /* ── Ciudades filtradas por departamento ────── */
  const ciudadesFiltradas = DEPARTAMENTOS_CIUDADES
    .filter((dc) => !departamento || dc.startsWith(departamento))
    .map((dc) => dc.split(' - ')[1])

  const departamentosUnicos = [...new Set(DEPARTAMENTOS_CIUDADES.map((dc) => dc.split(' - ')[0]))]

  /* ── Formatear fecha ───────────────────────── */
  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Hace un momento'
    if (mins < 60) return `Hace ${mins} min`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `Hace ${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `Hace ${days}d`
    return new Date(dateStr).toLocaleDateString('es-CO')
  }

  return (
    <section className={styles.section} id="foro">

      {/* ── Header ───────────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.label}>Foro Legal</span>
        <h2 className={styles.title}>
          ¿NECESITA <em>ASESORÍA?</em>
        </h2>
        <p className={styles.desc}>
          Describa su caso y un abogado especializado podría contactarlo.
          Su información de contacto es privada.
        </p>
      </div>

      {/* ── Formulario ───────────────────────────── */}
      {!isAbogado && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGrid}>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Nombre completo <span className={styles.req}>*</span>
              </label>
              <input
                type="text"
                className={styles.input}
                placeholder="Su nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Correo o celular <span className={styles.req}>*</span>
              </label>
              <input
                type="text"
                className={styles.input}
                placeholder="correo@email.com o 300 000 0000"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Departamento</label>
              <select
                className={styles.input}
                value={departamento}
                onChange={(e) => { setDepartamento(e.target.value); setCiudad('') }}
              >
                <option value="">Seleccionar...</option>
                {departamentosUnicos.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Ciudad</label>
              <select
                className={styles.input}
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {ciudadesFiltradas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Área del caso</label>
              <select
                className={styles.input}
                value={areaDerecho}
                onChange={(e) => setAreaDerecho(e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {AREAS_DERECHO.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.fieldLabel}>
                Describa su caso <span className={styles.req}>*</span>
                <span className={styles.charCount}>{descripcion.length}/500</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={4}
                placeholder="Describa brevemente su situación legal..."
                value={descripcion}
                onChange={(e) => { if (e.target.value.length <= 500) setDescripcion(e.target.value) }}
                required
              />
            </div>
          </div>

          {formError && <p className={styles.msgError}>{formError}</p>}
          {formMsg && <p className={styles.msgSuccess}>{formMsg}</p>}

          <button type="submit" className={styles.submitBtn} disabled={enviando}>
            {enviando ? 'Publicando...' : 'Publicar caso'}
          </button>

          <p className={styles.privacyNote}>
            🔒 Su información de contacto solo será visible para abogados verificados.
          </p>
        </form>
      )}

      {/* ── Lista de comentarios ─────────────────── */}
      <div className={styles.comments}>
        {loadingComentarios ? (
          <p className={styles.emptyMsg}>Cargando casos...</p>
        ) : comentarios.length === 0 ? (
          <p className={styles.emptyMsg}>Aún no hay casos publicados. ¡Sé el primero!</p>
        ) : (
          comentarios.map((c) => (
            <div key={c.id} className={styles.comment}>

              {/* Header del comentario */}
              <div className={styles.commentHeader}>
                <div className={styles.commentAvatar}>
                  {c.nombre?.[0]?.toUpperCase() || '?'}
                </div>
                <div className={styles.commentMeta}>
                  <span className={styles.commentName}>{c.nombre}</span>
                  <span className={styles.commentTime}>{timeAgo(c.created_at)}</span>
                </div>
                <div className={styles.commentTags}>
                  {c.area_derecho && <span className={styles.tag}>{c.area_derecho}</span>}
                  {c.ciudad && <span className={styles.tagLight}>{c.ciudad}</span>}
                  {c.departamento && <span className={styles.tagLight}>{c.departamento}</span>}
                </div>
                {isSuperAdmin && (
                  <button className={styles.deleteBtn} onClick={() => hideComment(c.id)} title="Eliminar">
                    ✕
                  </button>
                )}
              </div>

              {/* Descripción */}
              <p className={styles.commentBody}>{c.descripcion}</p>

              {/* Contacto visible solo para abogados */}
              {isAbogado && (
                <div className={styles.commentContact}>
                  📧 Contacto: <strong>{c.contacto}</strong>
                </div>
              )}

              {/* Respuestas */}
              {c.respuestas?.length > 0 && (
                <div className={styles.replies}>
                  {c.respuestas.map((r) => (
                    <div key={r.id} className={styles.reply}>
                      <div className={styles.replyHeader}>
                        <div className={styles.replyAvatar}>
                          {r.profiles?.foto_url
                            ? <img src={r.profiles.foto_url} alt="" className={styles.replyAvatarImg} />
                            : <span>⚖</span>
                          }
                        </div>
                        <div>
                          <span className={styles.replyName}>
                            {r.profiles?.nombre} {r.profiles?.apellido}
                          </span>
                          {r.profiles?.area_derecho && (
                            <span className={styles.replyArea}>{r.profiles.area_derecho}</span>
                          )}
                        </div>
                        <span className={styles.replyTime}>{timeAgo(r.created_at)}</span>
                      </div>
                      <p className={styles.replyBody}>{r.contenido}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Botón responder (solo abogados) */}
              {isAbogado && (
                <div className={styles.replySection}>
                  {replyingTo === c.id ? (
                    <div className={styles.replyForm}>
                      <textarea
                        className={styles.replyInput}
                        rows={3}
                        placeholder="Escriba su respuesta..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <div className={styles.replyActions}>
                        <button
                          className={styles.replySendBtn}
                          onClick={() => handleReply(c.id)}
                          disabled={sendingReply || !replyText.trim()}
                        >
                          {sendingReply ? 'Enviando...' : 'Enviar respuesta'}
                        </button>
                        <button
                          className={styles.replyCancelBtn}
                          onClick={() => { setReplyingTo(null); setReplyText('') }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className={styles.replyBtn}
                      onClick={() => { setReplyingTo(c.id); setReplyText('') }}
                    >
                      ↩ Responder
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
