import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import styles from './ProfilePage.module.css'

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

const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año',
  '1 - 3 años',
  '3 - 5 años',
  '5 - 10 años',
  '10 - 15 años',
  'Más de 15 años',
]

const MAX_VIDEO_MB = 200

export default function ProfilePage() {
  const { user, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)

  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg]           = useState(null)
  const [error, setError]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Campos del perfil
  const [nombre, setNombre]         = useState('')
  const [apellido, setApellido]     = useState('')
  const [telefono, setTelefono]     = useState('')
  const [universidad, setUniversidad] = useState('')
  const [experiencia, setExperiencia] = useState('')
  const [direccion, setDireccion]   = useState('')
  const [ciudad, setCiudad]         = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fotoUrl, setFotoUrl]       = useState(null)
  const [videoUrl, setVideoUrl]     = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [uploadingFoto, setUploadingFoto]   = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  

  useEffect(() => {
  if (loading) return
  if (!user) { navigate('/'); return }
  if (profile) {
    setNombre(profile.nombre || '')
    setApellido(profile.apellido || '')
    setTelefono(profile.telefono || '')
    setUniversidad(profile.universidad || '')
    setExperiencia(profile.experiencia || '')
    setDireccion(profile.direccion || '')
    setCiudad(profile.ciudad || '')
    setDescripcion(profile.descripcion || '')
    setFotoUrl(profile.foto_url || null)
    setVideoUrl(profile.video_url || null)
    if (profile.foto_url) setFotoPreview(profile.foto_url)
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
      const publicUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-photos/${path}`
      setFotoUrl(publicUrl)
    } catch (err) {
      setError('Error subiendo la foto: ' + err.message)
    } finally {
      setUploadingFoto(false)
    }
  }

  async function handleVideoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > MAX_VIDEO_MB) {
      setError(`El video no puede superar ${MAX_VIDEO_MB} MB`)
      return
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
      const publicUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-videos/${path}`
      setVideoUrl(publicUrl)
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
    setSaving(true)
    setError(null)
    setMsg(null)
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
            experiencia, direccion, ciudad,
            descripcion, foto_url: fotoUrl, video_url: videoUrl,
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
      // Eliminar perfil
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

            {/* Foto centrada */}
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
              <input ref={fileInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={handleFotoChange} />
              <p className={styles.photoHint}>JPG, PNG — máx. 5 MB</p>
            </div>

            {/* Grid de campos */}
            <div className={styles.fieldsGrid}>

              {/* Fila 1: Nombre + Apellido */}
              <div className={styles.field}>
                <label className={styles.label}>Nombre</label>
                <input type="text" className={styles.input} placeholder="Nombre"
                  value={nombre} onChange={e => setNombre(e.target.value)} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido</label>
                <input type="text" className={styles.input} placeholder="Apellido"
                  value={apellido} onChange={e => setApellido(e.target.value)} required />
              </div>

              {/* Fila 2: Correo + Teléfono */}
              <div className={styles.field}>
                <label className={styles.label}>Correo electrónico</label>
                <input type="email" className={`${styles.input} ${styles.readonly}`}
                  value={user?.email || ''} readOnly />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Teléfono</label>
                <input type="tel" className={styles.input} placeholder="+57 300 000 0000"
                  value={telefono} onChange={e => setTelefono(e.target.value)} />
              </div>

              {/* Fila 3: Universidad + Experiencia */}
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

              {/* Fila 4: Ciudad + Dirección */}
              <div className={styles.field}>
                <label className={styles.label}>Departamento — Ciudad</label>
                <select className={styles.input} value={ciudad} onChange={e => setCiudad(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {DEPARTAMENTOS_CIUDADES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Dirección de oficina</label>
                <input type="text" className={styles.input} placeholder="Calle 123 # 45-67, Of. 101"
                  value={direccion} onChange={e => setDireccion(e.target.value)} />
              </div>

              {/* Perfil profesional — ancho completo */}
              <div className={`${styles.field} ${styles.fullWidth}`}>
                <label className={styles.label}>
                  Perfil profesional <span className={styles.required}>*</span>
                  <span className={styles.charCount}>{descripcion.length}/500</span>
                </label>
                <textarea className={styles.textarea} rows={4}
                  placeholder="Describa su experiencia, especialidades y enfoque profesional..."
                  value={descripcion}
                  onChange={e => { if (e.target.value.length <= 500) setDescripcion(e.target.value) }}
                  required />
              </div>

              {/* Video — ancho completo */}
              <div className={`${styles.field} ${styles.fullWidth}`}>
                <label className={styles.label}>
                  Video de presentación
                  <span className={styles.optional}>(opcional — máx. {MAX_VIDEO_MB} MB)</span>
                </label>
                {videoUrl && <video src={videoUrl} controls className={styles.videoPreview} />}
                <button type="button" className="btn-ghost"
                  onClick={() => videoInputRef.current.click()} disabled={uploadingVideo}>
                  {uploadingVideo ? 'Subiendo video...' : videoUrl ? 'Cambiar video' : 'Subir video'}
                </button>
                <input ref={videoInputRef} type="file" accept="video/*"
                  style={{ display: 'none' }} onChange={handleVideoChange} />
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
                  ? <button type="button" className={styles.deleteBtn}
                      onClick={() => setConfirmDelete(true)}>Eliminar cuenta</button>
                  : <div className={styles.confirmDelete}>
                      <span>¿Seguro? Esta acción no se puede deshacer.</span>
                      <button type="button" className={styles.deleteBtnConfirm}
                        onClick={handleDeleteAccount} disabled={deleting}>
                        {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                      </button>
                      <button type="button" className="btn-ghost"
                        onClick={() => setConfirmDelete(false)}>Cancelar</button>
                    </div>
                }
              </div>

            </div>
          </form>
        </div>
      </div>
    )
}