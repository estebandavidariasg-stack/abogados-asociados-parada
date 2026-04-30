import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './ProfilePage.module.css'
import LawyerChatDashboard from '../components/LawyerChatDashboard'
import MisContratos from '../components/MisContratos'
import { getAuthHeaders } from '../lib/supabase'

const UNIVERSIDADES = [
  'Universidad Nacional de Colombia',
  'Universidad de los Andes',
  'Universidad de Antioquia',
  'Universidad Javeriana',
  'Universidad del Rosario',
  'Universidad Externado de Colombia',
  'Universidad Libre',
  'Universidad de La Sabana',
  'Universidad EAFIT',
  'Universidad del Norte',
  'Universidad Industrial de Santander',
  'Universidad de Cartagena',
  'Universidad de Nariño',
  'Universidad del Cauca',
  'Universidad Surcolombiana',
  'Universidad de Córdoba',
  'Universidad Popular del Cesar',
  'Universidad de La Guajira',
  'Universidad Francisco de Paula Santander',
  'Universidad de Pamplona',
  'Universidad Autónoma de Bucaramanga',
  'Universidad Cooperativa de Colombia',
  'Universidad Santo Tomás',
  'Universidad Militar Nueva Granada',
  'Universidad Distrital Francisco José de Caldas',
  'Universidad Pedagógica Nacional',
  'Universidad de Caldas',
  'Universidad de Manizales',
  'Universidad del Quindío',
  'Universidad Tecnológica de Pereira',
  'Universidad del Valle',
  'Universidad Santiago de Cali',
  'Universidad Autónoma de Occidente',
  'Universidad de San Buenaventura',
  'Universidad Piloto de Colombia',
  'Otra',
]

const DEPARTAMENTOS_CIUDADES = [
  'Amazonas - Leticia',
  'Antioquia - Medellín',
  'Antioquia - Bello',
  'Antioquia - Envigado',
  'Antioquia - Itagüí',
  'Arauca - Arauca',
  'Atlántico - Barranquilla',
  'Atlántico - Soledad',
  'Bolívar - Cartagena',
  'Bolívar - Magangué',
  'Boyacá - Tunja',
  'Boyacá - Duitama',
  'Caldas - Manizales',
  'Caquetá - Florencia',
  'Casanare - Yopal',
  'Cauca - Popayán',
  'Cesar - Valledupar',
  'Chocó - Quibdó',
  'Córdoba - Montería',
  'Cundinamarca - Bogotá D.C.',
  'Cundinamarca - Soacha',
  'Cundinamarca - Fusagasugá',
  'Guainía - Inírida',
  'Guaviare - San José del Guaviare',
  'Huila - Neiva',
  'La Guajira - Riohacha',
  'Magdalena - Santa Marta',
  'Meta - Villavicencio',
  'Nariño - Pasto',
  'Norte de Santander - Cúcuta',
  'Putumayo - Mocoa',
  'Quindío - Armenia',
  'Risaralda - Pereira',
  'San Andrés - San Andrés',
  'Santander - Bucaramanga',
  'Santander - Floridablanca',
  'Sucre - Sincelejo',
  'Tolima - Ibagué',
  'Valle del Cauca - Cali',
  'Valle del Cauca - Buenaventura',
  'Valle del Cauca - Palmira',
  'Valle del Cauca - Tulúa',
  'Vaupés - Mitú',
  'Vichada - Puerto Carreño',
]

const AREAS_DERECHO = [
  'Derecho Penal', 'Derecho Civil', 'Derecho de Familia', 'Derecho Laboral',
  'Derecho Comercial', 'Derecho Corporativo', 'Derecho Administrativo',
  'Derecho Constitucional', 'Derecho Tributario', 'Derecho Ambiental',
  'Derecho Internacional', 'Derecho Migratorio', 'Derecho Inmobiliario',
  'Derecho de Seguros', 'Derecho de Tránsito', 'Derecho Disciplinario',
  'Derecho Minero y Energético', 'Derecho de Propiedad Intelectual',
  'Derecho Informático', 'Derecho Médico', 'Otro',
]

const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año', '1 - 3 años', '3 - 5 años',
  '5 - 10 años', '10 - 15 años', 'Más de 15 años',
]

const MAX_VIDEO_MB = 200

export default function ProfilePage() {
  const { user, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const fileInputRef  = useRef(null)
  const videoInputRef = useRef(null)

  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [msg, setMsg]             = useState(null)
  const [error, setError]         = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── Campos del perfil ─────────────────────────────────────────────────
  const [nombre, setNombre]           = useState('')
  const [apellido, setApellido]       = useState('')
  const [telefono, setTelefono]       = useState('')
  const [universidad, setUniversidad] = useState('')
  const [experiencia, setExperiencia] = useState('')
  const [direccion, setDireccion]     = useState('')
  const [ciudad, setCiudad]           = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fotoUrl, setFotoUrl]         = useState(null)
  const [videoUrl, setVideoUrl]       = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [uploadingFoto, setUploadingFoto]   = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [departamento, setDepartamento]     = useState('')
  const [areasDerecho, setAreasDerecho] = useState([])  

  // ── Redes sociales ────────────────────────────────────────────────────
  const [instagram, setInstagram] = useState('')
  const [linkedin,  setLinkedin]  = useState('')
  const [facebook,  setFacebook]  = useState('')
  const [twitter,   setTwitter]   = useState('')
  const [whatsapp,  setWhatsapp]  = useState('')
  const [tiktok,    setTiktok]    = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/'); return }
    if (profile) {
      setNombre(profile.nombre       || '')
      setApellido(profile.apellido   || '')
      setTelefono(profile.telefono   || '')
      setUniversidad(profile.universidad || '')
      setExperiencia(profile.experiencia || '')
      setAreasDerecho(
        profile.area_derecho
          ? profile.area_derecho.split(',').map(a => a.trim()).filter(Boolean)
          : []
      )
      setDireccion(profile.direccion  || '')
      setDepartamento(profile.departamento || '')
      setCiudad(profile.ciudad       || '')
      setDescripcion(profile.descripcion || '')
      setFotoUrl(profile.foto_url    || null)
      setVideoUrl(profile.video_url  || null)
      if (profile.foto_url) setFotoPreview(profile.foto_url)

      // Redes sociales
      setInstagram(profile.instagram || '')
      setLinkedin(profile.linkedin   || '')
      setFacebook(profile.facebook   || '')
      setTwitter(profile.twitter     || '')
      setWhatsapp(profile.whatsapp   || '')
      setTiktok(profile.tiktok       || '')
    }
  }, [user, profile, loading, navigate])

  async function handleFotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setFotoPreview(URL.createObjectURL(file))
    setUploadingFoto(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `avatars/${user.id}.${ext}`
      const res  = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/profile-photos/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sb_token')}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': file.type,
          'x-upsert': 'true',
        },
        body: file,
      })
      if (!res.ok) throw new Error('Error subiendo foto')
      setFotoUrl(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-photos/${path}`)
    } catch (err) {
      setError('Error subiendo la foto: ' + err.message)
    } finally {
      setUploadingFoto(false)
    }
  }

  async function handleVideoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size / (1024 * 1024) > MAX_VIDEO_MB) {
      setError(`El video no puede superar ${MAX_VIDEO_MB} MB`); return
    }
    setUploadingVideo(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `videos/${user.id}.${ext}`
      const res  = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/profile-videos/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sb_token')}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': file.type,
          'x-upsert': 'true',
        },
        body: file,
      })
      if (!res.ok) throw new Error('Error subiendo video')
      setVideoUrl(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-videos/${path}`)
      setMsg('Video subido correctamente')
    } catch (err) {
      setError('Error subiendo el video: ' + err.message)
    } finally {
      setUploadingVideo(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!descripcion.trim()) { setError('El campo Perfil es obligatorio'); return }
    setSaving(true); setError(null); setMsg(null)
    try {
      const token = localStorage.getItem('sb_token')
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            nombre, apellido, telefono, universidad,
            experiencia, direccion, ciudad, departamento,
            area_derecho: areasDerecho.join(', '),
            descripcion, foto_url: fotoUrl, video_url: videoUrl,
            // Redes sociales
            instagram, linkedin, facebook, twitter, whatsapp, tiktok,
          }),
        }
      )
      if (!res.ok) {
        const errData = await res.json()
        console.error('Error RLS:', errData)
        throw new Error('Error guardando perfil')
      }
      setMsg('¡Perfil actualizado correctamente!')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const token = localStorage.getItem('sb_token')
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
        method: 'DELETE',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
      })
      await signOut()
      navigate('/')
    } catch (err) {
      setError('Error eliminando cuenta: ' + err.message)
      setDeleting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>

        {/* Header */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>← Volver</button>
          <h1 className={styles.pageTitle}>Mi <em>Perfil</em></h1>
          <span className={styles.status}>
            {profile?.aprobado ? '✦ Aprobado — visible en la página' : '◌ Pendiente de aprobación'}
          </span>
        </div>

        <form className={styles.form} onSubmit={handleSave}>

          {/* Foto */}
          <div className={styles.photoSection}>
            <div className={styles.photoWrap} onClick={() => fileInputRef.current.click()}>
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto de perfil" className={styles.photoImg} />
                : <div className={styles.photoPlaceholder}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    </svg>
                  </div>
              }
              <div className={styles.photoOverlay}>
                {uploadingFoto ? 'Subiendo...' : 'Cambiar foto'}
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFotoChange} />
            <p className={styles.photoHint}>JPG, PNG — máx. 5 MB</p>
          </div>

          {/* Grid de campos */}
          <div className={styles.fieldsGrid}>

            <div className={styles.field}>
              <label className={styles.label}>Nombre</label>
              <input type="text" className={styles.input} placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Apellido</label>
              <input type="text" className={styles.input} placeholder="Apellido" value={apellido} onChange={e => setApellido(e.target.value)} required />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              <input type="email" className={`${styles.input} ${styles.readonly}`} value={user?.email || ''} readOnly />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Teléfono</label>
              <input type="tel" className={styles.input} placeholder="+57 300 000 0000" value={telefono} onChange={e => setTelefono(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Universidad</label>
              <select className={styles.input} value={universidad} onChange={e => setUniversidad(e.target.value)}>
                <option value="">Seleccionar...</option>
                {UNIVERSIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Experiencia laboral</label>
              <select className={styles.input} value={experiencia} onChange={e => setExperiencia(e.target.value)}>
                <option value="">Seleccionar...</option>
                {EXPERIENCIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>
                Áreas de derecho
                <span className={styles.optional}>(puedes seleccionar varias)</span>
              </label>
              <div className={styles.checkboxGrid}>
                {AREAS_DERECHO.map(area => (
                  <label key={area} className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={areasDerecho.includes(area)}
                      onChange={e => {
                        if (e.target.checked) {
                          setAreasDerecho(prev => [...prev, area])
                        } else {
                          setAreasDerecho(prev => prev.filter(a => a !== area))
                        }
                      }}
                    />
                    <span>{area}</span>
                  </label>
                ))}
              </div>
              {areasDerecho.length > 0 && (
                <p className={styles.selectedAreas}>
                  Seleccionadas: <strong>{areasDerecho.join(' · ')}</strong>
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Departamento</label>
              <select className={styles.input} value={departamento} onChange={e => setDepartamento(e.target.value)}>
                <option value="">Seleccionar...</option>
                {[...new Set(DEPARTAMENTOS_CIUDADES.map(dc => dc.split(' - ')[0]))].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Ciudad</label>
              <select className={styles.input} value={ciudad} onChange={e => setCiudad(e.target.value)}>
                <option value="">Seleccionar...</option>
                {DEPARTAMENTOS_CIUDADES
                  .filter(dc => !departamento || dc.startsWith(departamento))
                  .map(dc => dc.split(' - ')[1])
                  .map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Dirección de oficina</label>
              <input type="text" className={styles.input} placeholder="Calle 123 # 45-67, Of. 101" value={direccion} onChange={e => setDireccion(e.target.value)} />
            </div>

            {/* ── Redes sociales ── */}
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>Redes sociales</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {[
                  { label: 'Instagram',   placeholder: 'https://instagram.com/tu_usuario',    value: instagram, set: setInstagram },
                  { label: 'LinkedIn',    placeholder: 'https://linkedin.com/in/tu_perfil',   value: linkedin,  set: setLinkedin  },
                  { label: 'Facebook',    placeholder: 'https://facebook.com/tu_perfil',      value: facebook,  set: setFacebook  },
                  { label: 'X / Twitter', placeholder: 'https://x.com/tu_usuario',            value: twitter,   set: setTwitter   },
                  { label: 'TikTok',      placeholder: 'https://tiktok.com/@tu_usuario',      value: tiktok,    set: setTiktok    },
                ].map(({ label, placeholder, value, set }) => (
                  <div key={label}>
                    <label className={styles.label}>{label}</label>
                    <input type="url" className={styles.input} placeholder={placeholder} value={value} onChange={e => set(e.target.value)} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Video ── */}
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>
                Video de presentación
                <span className={styles.optional}>(opcional — máx. {MAX_VIDEO_MB} MB)</span>
              </label>
              {videoUrl && <video src={videoUrl} controls className={styles.videoPreview} />}
              <button type="button" className="btn-ghost" onClick={() => videoInputRef.current.click()} disabled={uploadingVideo}>
                {uploadingVideo ? 'Subiendo video...' : videoUrl ? 'Cambiar video' : 'Subir video'}
              </button>
              <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleVideoChange} />
            </div>

            {/* Mensajes */}
            {error && <p className={styles.msgError}>{error}</p>}
            {msg   && <p className={styles.msgSuccess}>{msg}</p>}

            {/* Acciones */}
            <div className={styles.actions}>
              <button type="submit" className="btn-solid btn-lg" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              {!confirmDelete
                ? <button type="button" className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>Eliminar cuenta</button>
                : <div className={styles.confirmDelete}>
                    <span>¿Seguro? Esta acción no se puede deshacer.</span>
                    <button type="button" className={styles.deleteBtnConfirm} onClick={handleDeleteAccount} disabled={deleting}>
                      {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                  </div>
              }
            </div>

          </div>
        </form>

       {/* ── Sección de Chat ── */}
        <div className={styles.sectionBlock}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Consultas de <em>clientes</em>
            </h2>
            <p className={styles.sectionSub}>
              Aquí aparecen los chats de clientes asignados a tu área.
            </p>
          </div>
          <LawyerChatDashboard lawyerId={user?.id} />
        </div>

        {/* ── Mis Contratos ── */}
        <div className={styles.sectionBlock}>
          <div className={styles.contractsWrap}>
            <MisContratos abogadoId={user?.id} isSuperAdmin={false} />
          </div>
        </div>
      </div>
    </div>
  )
}
