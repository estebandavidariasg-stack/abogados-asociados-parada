import { useEffect, useState, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import styles from './AdminPage.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function authHeaders() {
  const token = localStorage.getItem('sb_token')
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token || SUPABASE_KEY}`,
  }
}

const LOCAL_SLIDES = [
  { id: 'local-1', eyebrow: 'Bufete Jurídico · Colombia',        titulo: 'Soluciones legales con resultados reales',       subtitulo: 'Asesoría jurídica especializada con el compromiso y la seriedad que su caso merece.',  imagen_url: '/hero-1.jpg', activo: true, isLocal: true },
  { id: 'local-2', eyebrow: 'Derecho Civil · Penal · Corporativo', titulo: 'Estrategia legal de alto nivel',                subtitulo: 'Un equipo comprometido con la justicia, la ética y la defensa de sus intereses.',        imagen_url: '/hero-2.jpg', activo: true, isLocal: true },
  { id: 'local-3', eyebrow: 'Experiencia · Compromiso · Resultados', titulo: 'Su confianza, nuestra mayor responsabilidad', subtitulo: 'Cada caso es único. Cada cliente recibe atención personalizada y dedicación absoluta.',    imagen_url: '/hero-3.jpg', activo: true, isLocal: true },
  { id: 'local-4', eyebrow: 'Parada & Asociados · Bufete Jurídico', titulo: 'Defendemos lo que más importa',               subtitulo: 'Representación legal sólida en litigios civiles, penales y asuntos corporativos.',        imagen_url: '/hero-4.jpg', activo: true, isLocal: true },
  { id: 'local-5', eyebrow: 'Justicia · Ética · Excelencia',     titulo: 'El derecho como herramienta de justicia',        subtitulo: 'Con visión estratégica y profundo conocimiento jurídico, luchamos por usted.',             imagen_url: '/hero-5.jpg', activo: true, isLocal: true },
]

export default function AdminPage() {
  const { user, profile, loading } = useAuth()
  const navigate  = useNavigate()
  const [activeTab, setActiveTab]   = useState('pending')
  const [pending, setPending]       = useState([])
  const [approved, setApproved]     = useState([])
  const [dbSlides, setDbSlides]     = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [editSlide, setEditSlide]   = useState(null)
  const [uploading, setUploading]   = useState(false)
  const imgInputRef = useRef(null)

  const allSlides = [...LOCAL_SLIDES, ...dbSlides]

  useEffect(() => {
    if (loading) return
    if (!user || profile?.rol !== 'superadmin') { navigate('/'); return }
    fetchAll()
  }, [user, profile, loading])

  async function fetchAll() {
    setLoadingData(true)
    await Promise.all([fetchPending(), fetchApproved(), fetchSlides()])
    setLoadingData(false)
  }

  async function fetchPending() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.false&rol=eq.abogado&select=*`, { headers: authHeaders() })
    const data = await res.json()
    setPending(Array.isArray(data) ? data : [])
  }

  async function fetchApproved() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.abogado&select=*`, { headers: authHeaders() })
    const data = await res.json()
    setApproved(Array.isArray(data) ? data : [])
  }

  async function fetchSlides() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/carrusel?select=*&order=orden.asc`, { headers: authHeaders() })
    const data = await res.json()
    setDbSlides(Array.isArray(data) ? data : [])
  }

  async function approveProfile(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ aprobado: true }) })
    fetchAll()
  }

  async function rejectProfile(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ aprobado: false }) })
    fetchAll()
  }

  async function removeApproved(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ aprobado: false }) })
    fetchAll()
  }

  async function saveSlide(slide) {
    const { id, isLocal, ...rest } = slide
    if (id && !String(id).startsWith('local-')) {
      await fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(rest) })
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/carrusel`, { method: 'POST', headers: { ...authHeaders(), 'Prefer': 'return=representation' }, body: JSON.stringify({ ...rest, orden: dbSlides.length }) })
    }
    setEditSlide(null)
    fetchSlides()
  }

  async function deleteSlide(id) {
    if (!confirm('¿Eliminar este slide?')) return
    await fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${id}`, { method: 'DELETE', headers: authHeaders() })
    fetchSlides()
  }

  async function toggleSlide(id, activo) {
    await fetch(`${SUPABASE_URL}/rest/v1/carrusel?id=eq.${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ activo: !activo }) })
    fetchSlides()
  }

  async function uploadImage(file) {
    setUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `hero/${Date.now()}.${ext}`
      const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/carousel-images/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('sb_token')}`, 'apikey': SUPABASE_KEY, 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      })
      if (!res.ok) throw new Error('Error subiendo imagen')
      const url = `${SUPABASE_URL}/storage/v1/object/public/carousel-images/${path}`
      setEditSlide(s => ({ ...s, imagen_url: url }))
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  if (loading || loadingData) return (
    <div className={styles.loading}><span className={styles.loadingDot} /></div>
  )

  return (
    <div className={styles.page}>
      <div className={styles.bgGlow} />
      <div className={styles.goldLine} />

      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Panel de administración</span>
          <h1 className={styles.title}>Control <em>Total</em></h1>
        </div>
        <button className="btn-ghost" onClick={() => navigate('/')}>← Volver al sitio</button>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}><span className={styles.statNum}>{pending.length}</span><span className={styles.statLabel}>Solicitudes pendientes</span></div>
        <div className={styles.stat}><span className={styles.statNum}>{approved.length}</span><span className={styles.statLabel}>Abogados aprobados</span></div>
        <div className={styles.stat}><span className={styles.statNum}>{allSlides.length}</span><span className={styles.statLabel}>Slides del hero</span></div>
      </div>

      <div className={styles.tabs}>
        {[
          { key: 'pending',  label: `Solicitudes (${pending.length})` },
          { key: 'approved', label: `Aprobados (${approved.length})` },
          { key: 'hero',     label: 'Hero / Carrusel' },
        ].map(t => (
          <button key={t.key} className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* PENDIENTES */}
      {activeTab === 'pending' && (
        <div className={styles.section}>
          {pending.length === 0 ? <p className={styles.empty}>No hay solicitudes pendientes</p>
            : pending.map(p => (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardPhoto}>
                  {p.foto_url ? <img src={p.foto_url} alt={p.nombre} /> : <span>{(p.nombre?.[0]||'?')}{(p.apellido?.[0]||'')}</span>}
                </div>
                <div className={styles.cardInfo}>
                  <h3>{p.nombre} {p.apellido}</h3>
                  <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
                  {p.universidad && <span className={styles.cardMeta}>{p.universidad}</span>}
                  {p.ciudad      && <span className={styles.cardMeta}>{p.ciudad}</span>}
                  {p.descripcion && <p className={styles.cardDesc}>{p.descripcion}</p>}
                </div>
                <div className={styles.cardActions}>
                  <button className={styles.btnApprove} onClick={() => approveProfile(p.id)}>✓ Aprobar</button>
                  <button className={styles.btnReject}  onClick={() => rejectProfile(p.id)}>✕ Rechazar</button>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* APROBADOS */}
      {activeTab === 'approved' && (
        <div className={styles.section}>
          {approved.length === 0 ? <p className={styles.empty}>No hay abogados aprobados aún</p>
            : approved.map(p => (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardPhoto}>
                  {p.foto_url ? <img src={p.foto_url} alt={p.nombre} /> : <span>{(p.nombre?.[0]||'?')}{(p.apellido?.[0]||'')}</span>}
                </div>
                <div className={styles.cardInfo}>
                  <h3>{p.nombre} {p.apellido}</h3>
                  <span className={styles.cardMeta}>@{p.username} · {p.email}</span>
                  {p.ciudad && <span className={styles.cardMeta}>{p.ciudad}</span>}
                </div>
                <div className={styles.cardActions}>
                  <button className={styles.btnReject} onClick={() => removeApproved(p.id)}>Quitar de la página</button>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* HERO */}
      {activeTab === 'hero' && (
        <div className={styles.section}>
          <div className={styles.heroHeader}>
            <p className={styles.heroHint}>Los slides ⊞ son predeterminados. Crea nuevos para reemplazarlos.</p>
            <button className="btn-solid" onClick={() => setEditSlide({ eyebrow: '', titulo: '', subtitulo: '', imagen_url: '', orden: dbSlides.length, activo: true })}>
              + Nuevo slide
            </button>
          </div>

          <div className={styles.slidesGrid}>
            {allSlides.map(s => (
              <div key={s.id} className={`${styles.slideCard} ${!s.activo ? styles.slideInactive : ''}`}>
                {/* Preview: layout texto izq + imagen der */}
                <div className={styles.slidePreview}>
                  <div className={styles.slidePreviewText}>
                    <span className={styles.slidePreviewEyebrow}>{s.eyebrow || '—'}</span>
                    <p className={styles.slidePreviewTitle}>{s.titulo || 'Sin título'}</p>
                    <p className={styles.slidePreviewSub}>{s.subtitulo || ''}</p>
                  </div>
                  <div className={styles.slidePreviewPhoto}>
                    {s.imagen_url
                      ? <img 
                          src={s.imagen_url} 
                          alt={s.titulo}
                          style={{ 
                            position: 'absolute',
                            inset: 0,
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'cover', 
                            objectPosition: 'center top'
                          }} 
                        />
                      : <span className={styles.slideNoImg}>Sin imagen</span>
                    }
                  </div>
                  {s.isLocal && <span className={styles.slideLocalBadge}>⊞ Predeterminado</span>}
                  {!s.activo && <span className={styles.slideInactiveBadge}>Inactivo</span>}
                </div>

                <div className={styles.slideCardActions}>
                  <button className={styles.btnEdit} onClick={() => setEditSlide({ ...s })}>
                    {s.isLocal ? 'Editar y guardar en BD' : 'Editar'}
                  </button>
                  {!s.isLocal && <>
                    <button className={s.activo ? styles.btnReject : styles.btnApprove} onClick={() => toggleSlide(s.id, s.activo)}>
                      {s.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className={styles.btnDelete} onClick={() => deleteSlide(s.id)}>Eliminar</button>
                  </>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL */}
      {editSlide && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setEditSlide(null)}>
          <div className={styles.modalWide}>

            <div className={styles.modalForm}>
              <h3 className={styles.modalTitle}>
                {editSlide.id && !String(editSlide.id).startsWith('local-') ? 'Editar slide' : 'Nuevo slide'}
              </h3>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Eyebrow (texto pequeño)</label>
                <input className={styles.modalInput} value={editSlide.eyebrow || ''} onChange={e => setEditSlide(s => ({ ...s, eyebrow: e.target.value }))} placeholder="Ej: Bufete Jurídico · Colombia" />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Título</label>
                <input className={styles.modalInput} value={editSlide.titulo || ''} onChange={e => setEditSlide(s => ({ ...s, titulo: e.target.value }))} placeholder="Título del slide" />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Subtítulo</label>
                <textarea className={styles.modalTextarea} value={editSlide.subtitulo || ''} onChange={e => setEditSlide(s => ({ ...s, subtitulo: e.target.value }))} placeholder="Descripción breve..." rows={3} />
              </div>

              {/* Upload imagen */}
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Imagen del slide</label>
                <div className={styles.imgUploadArea} onClick={() => imgInputRef.current.click()}>
                  {editSlide.imagen_url
                    ? <>
                        <img
                          src={editSlide.imagen_url}
                          alt=""
                          style={{
                            position: 'absolute', inset: 0,
                            width: '100%', height: '100%',
                            objectFit: 'cover', objectPosition: 'center top'
                          }}
                        />
                        <div className={styles.imgUploadOverlay}>
                          {uploading ? 'Subiendo...' : 'Cambiar imagen'}
                        </div>
                      </>
                    : <span className={styles.imgUploadPlaceholder}>
                        {uploading ? 'Subiendo...' : '+ Clic para subir imagen'}
                      </span>
                  }
                </div>
                <input ref={imgInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e => e.target.files[0] && uploadImage(e.target.files[0])} />
              </div>

              <div className={styles.modalActions}>
                <button className="btn-solid" onClick={() => saveSlide(editSlide)} disabled={uploading}>Guardar slide</button>
                <button className="btn-ghost" onClick={() => setEditSlide(null)}>Cancelar</button>
              </div>
            </div>

            {/* Preview columna derecha */}
            <div className={styles.modalPreviewCol}>
              <p className={styles.modalLabel} style={{ marginBottom:'0.75rem' }}>Previsualización</p>
             <div className={styles.livePreview}>
              <div className={styles.liveText}>
                <span className={styles.liveEyebrow}>{editSlide.eyebrow || 'Eyebrow · Texto'}</span>
                <p className={styles.liveTitle}>{editSlide.titulo || 'Título del slide'}</p>
                <p className={styles.liveSub}>{editSlide.subtitulo || 'Subtítulo descriptivo...'}</p>
              </div>
              <div className={styles.livePhoto}>
                {editSlide.imagen_url
                  ? <img src={editSlide.imagen_url} alt=""
                      style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center top', display:'block' }} />
                  : <span className={styles.livePhotoPlaceholder}>Foto aquí</span>
                }
              </div>
            </div>
              <p style={{ fontSize:'0.62rem', color:'var(--muted)', marginTop:'0.5rem', textAlign:'center' }}>Se actualiza en tiempo real</p>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
