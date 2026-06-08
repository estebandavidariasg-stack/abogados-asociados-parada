import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
// Reutilizamos el mismo CSS module del perfil de abogado — los estilos son
// idénticos, solo cambian los datos. Importar un .module.css desde otro
// componente NO lo modifica; las clases siguen siendo scoped al archivo.
import styles from './ProfilePage.module.css'
import MisContratos from '../components/profile/MisContratos'
import LawyerInternalChat from '../components/chat/LawyerInternalChat'
import ContadorChatDashboard from '../components/chat/ContadorChatDashboard'
import UbicacionSelector from '../components/profile/UbicacionSelector'
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

// Áreas/Especialidades específicas de la profesión contable
const ESPECIALIDADES_CONTADURIA = [
  'Contabilidad General',
  'Auditoría',
  'Tributaria y Fiscal',
  'Contabilidad Forense',
  'Costos y Presupuestos',
  'Revisoría Fiscal',
  'Finanzas Corporativas',
  'Contabilidad Internacional (NIIF)',
  'Nómina y Seguridad Social',
  'Otro',
]

const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año', '1 - 3 años', '3 - 5 años',
  '5 - 10 años', '10 - 15 años', 'Más de 15 años',
]

const MAX_VIDEO_MB = 200

export default function ProfileContadorPage() {
  const { user, profile, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const fileInputRef    = useRef(null)
  const videoInputRef   = useRef(null)
  const tarjetaInputRef = useRef(null)

  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [msg, setMsg]             = useState(null)
  const [error, setError]         = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Campos
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
  const [tarjetaArchivoUrl, setTarjetaArchivoUrl] = useState(null)
  const [tarjetaDisplayUrl, setTarjetaDisplayUrl] = useState(null)
  const [uploadingTarjeta, setUploadingTarjeta]   = useState(false)
  const [departamento, setDepartamento]     = useState('')
  const [barrio, setBarrio]                 = useState('')
  const [especialidades, setEspecialidades] = useState([])

  // Redes sociales
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
      // El campo BD se llama area_derecho aunque para contador signifique
      // "especialidad". Reusamos la columna existente.
      setEspecialidades(
        profile.area_derecho
          ? profile.area_derecho.split(',').map(a => a.trim()).filter(Boolean)
          : []
      )
      setDireccion(profile.direccion  || '')
      setDepartamento(profile.departamento || '')
      const ciudadDB = profile.ciudad || ''
      if (ciudadDB.includes(' - ')) {
        const idx = ciudadDB.indexOf(' - ')
        setCiudad(ciudadDB.slice(0, idx))
        setBarrio(ciudadDB.slice(idx + 3))
      } else {
        setCiudad(ciudadDB)
        setBarrio('')
      }
      setDescripcion(profile.descripcion || '')
      setFotoUrl(profile.foto_url    || null)
      setVideoUrl(profile.video_url  || null)
      setTarjetaArchivoUrl(profile.tarjeta_archivo_url || null)
      if (profile.foto_url) setFotoPreview(profile.foto_url)

      setInstagram(profile.instagram || '')
      setLinkedin(profile.linkedin   || '')
      setFacebook(profile.facebook   || '')
      setTwitter(profile.twitter     || '')
      setWhatsapp(profile.whatsapp   || '')
      setTiktok(profile.tiktok       || '')
    }
  }, [user, profile, loading, navigate])

  /* ── Resolver de URL de visualización para la tarjeta profesional ────────
     Bucket `tarjetas-profesionales` privado por datos sensibles. El campo
     puede contener un path nuevo o una URL pública legacy — manejamos ambos
     casos para no romper perfiles antiguos durante la migración. */
  useEffect(() => {
    if (!tarjetaArchivoUrl) { setTarjetaDisplayUrl(null); return }
    if (/^https?:\/\//.test(tarjetaArchivoUrl)) {
      setTarjetaDisplayUrl(tarjetaArchivoUrl)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.storage
        .from('tarjetas-profesionales')
        .createSignedUrl(tarjetaArchivoUrl, 3600)
      if (!cancelled && data?.signedUrl) setTarjetaDisplayUrl(data.signedUrl)
    })()
    return () => { cancelled = true }
  }, [tarjetaArchivoUrl])

  async function handleFotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setFotoPreview(URL.createObjectURL(file))
    setUploadingFoto(true)
    try {
      const headers = await getAuthHeaders()
      const ext  = file.name.split('.').pop()
      const path = `avatars/${user.id}.${ext}`
      const res  = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/profile-photos/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
      )
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
      const headers = await getAuthHeaders()
      const ext  = file.name.split('.').pop()
      const path = `videos/${user.id}.${ext}`
      const res  = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/profile-videos/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
      )
      if (!res.ok) throw new Error('Error subiendo video')
      setVideoUrl(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/profile-videos/${path}`)
      setMsg('Video subido correctamente')
    } catch (err) {
      setError('Error subiendo el video: ' + err.message)
    } finally {
      setUploadingVideo(false)
    }
  }

  async function handleTarjetaArchivoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.')
      return
    }
    if (file.size / (1024 * 1024) > 10) {
      setError('El archivo no puede superar 10 MB'); return
    }
    setUploadingTarjeta(true); setError(null)
    try {
      const headers = await getAuthHeaders()
      const ext  = file.name.split('.').pop().toLowerCase()
      const path = `${user.id}/tarjeta.${ext}`
      const res  = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
      )
      if (!res.ok) throw new Error('Error subiendo tarjeta')
      // Guardamos sólo el path; el resolver useEffect lo convierte en
      // signed URL para visualización. Bucket privado por datos sensibles.
      setTarjetaArchivoUrl(path)
      setMsg('Tarjeta profesional subida correctamente')
    } catch (err) {
      setError('Error subiendo la tarjeta: ' + err.message)
    } finally {
      setUploadingTarjeta(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!descripcion.trim()) { setError('El campo Perfil es obligatorio'); return }
    setSaving(true); setError(null); setMsg(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            nombre, apellido, telefono, universidad,
            experiencia, direccion,
            ciudad: barrio ? `${ciudad} - ${barrio}` : ciudad,
            departamento,
            // Reusamos la columna area_derecho para almacenar especialidades
            area_derecho: especialidades.join(', '),
            descripcion, foto_url: fotoUrl, video_url: videoUrl,
            tarjeta_archivo_url: tarjetaArchivoUrl || null,
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
      const headers = await getAuthHeaders()
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
        { method: 'DELETE', headers }
      )
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
          <h1 className={styles.pageTitle}>Mi Perfil — <em>Contador</em></h1>
          <span className={styles.status}>
            {profile?.aprobado ? '✦ Aprobado — visible en la página' : '◌ Pendiente de aprobación'}
          </span>
        </div>

        <form className={styles.form} onSubmit={handleSave}>

          {/* Foto */}
          <div className={styles.photoSection}>
            <div className={styles.photoWrap} onClick={() => fileInputRef.current.click()}>
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto de perfil" className={styles.photoImg} width="160" height="160" decoding="async" />
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
                Especialidades
                <span className={styles.optional}>(puedes seleccionar varias)</span>
              </label>
              <div className={styles.checkboxGrid}>
                {ESPECIALIDADES_CONTADURIA.map(area => (
                  <label key={area} className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={especialidades.includes(area)}
                      onChange={e => {
                        if (e.target.checked) {
                          setEspecialidades(prev => [...prev, area])
                        } else {
                          setEspecialidades(prev => prev.filter(a => a !== area))
                        }
                      }}
                    />
                    <span>{area}</span>
                  </label>
                ))}
              </div>
              {especialidades.length > 0 && (
                <p className={styles.selectedAreas}>
                  Seleccionadas: <strong>{especialidades.join(' · ')}</strong>
                </p>
              )}
            </div>

            <UbicacionSelector
              departamento={departamento}
              municipio={ciudad}
              barrio={barrio}
              classes={{ field: styles.field, label: styles.label, select: styles.input }}
              onChange={({ departamento: d, municipio, barrio: b }) => {
                setDepartamento(d); setCiudad(municipio); setBarrio(b)
              }}
            />
            <div className={styles.field}>
              <label className={styles.label}>Dirección de oficina</label>
              <input type="text" className={styles.input} placeholder="Calle 123 # 45-67, Of. 101" value={direccion} onChange={e => setDireccion(e.target.value)} />
            </div>

            {/* Descripción */}
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>
                Perfil profesional <span className={styles.required}>*</span>
              </label>
              <textarea
                className={styles.input}
                rows={4}
                placeholder="Describe tu experiencia, especialidades y enfoque profesional…"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                required
                style={{ resize: 'vertical', minHeight: 100 }}
              />
            </div>

            {/* Redes */}
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

            {/* Video */}
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>
                Video de presentación
                <span className={styles.optional}>(opcional — máx. {MAX_VIDEO_MB} MB)</span>
              </label>
              {videoUrl && <video src={videoUrl} controls preload="metadata" className={styles.videoPreview} />}
              <button type="button" className="btn-ghost" onClick={() => videoInputRef.current.click()} disabled={uploadingVideo}>
                {uploadingVideo ? 'Subiendo video...' : videoUrl ? 'Cambiar video' : 'Subir video'}
              </button>
              <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleVideoChange} />
            </div>

            {/* Tarjeta profesional (archivo) */}
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label className={styles.label}>
                Tarjeta profesional
                <span className={styles.optional}>(opcional — PDF, PNG, JPG o WEBP, máx. 10 MB)</span>
              </label>
              {tarjetaArchivoUrl && (
                <p style={{ margin: '0 0 8px', fontSize: '0.82rem' }}>
                  {tarjetaDisplayUrl ? (
                    <a
                      href={tarjetaDisplayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--gold-dk, #8a6a28)', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      Ver archivo cargado ↗
                    </a>
                  ) : (
                    <span style={{ color: '#888' }}>Generando enlace seguro…</span>
                  )}
                </p>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => tarjetaInputRef.current.click()}
                disabled={uploadingTarjeta}
              >
                {uploadingTarjeta
                  ? 'Subiendo tarjeta...'
                  : tarjetaArchivoUrl ? 'Cambiar tarjeta' : 'Subir tarjeta'}
              </button>
              <input
                ref={tarjetaInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleTarjetaArchivoChange}
              />
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

        {/* ── Sección de Chat con clientes ── */}
        <div className={styles.sectionBlock}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Consultas de <em>clientes</em>
            </h2>
            <p className={styles.sectionSub}>
              Aquí aparecen los chats de clientes asignados a tu especialidad.
            </p>
          </div>
          <ContadorChatDashboard contadorId={user?.id} canDownloadFiles={!!profile?.puede_descargar_archivos} />
        </div>

        {/* Canal interno con el administrador (sí aplica al contador) */}
        <div className={styles.sectionBlock}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Canal interno · <em>Administración</em>
            </h2>
            <p className={styles.sectionSub}>
              Comunicación directa y privada con el equipo de AAP.
            </p>
          </div>
          <LawyerInternalChat miId={user?.id} />
        </div>

        {/* Mis Contratos (storage genérico, también aplica) */}
        <div className={styles.sectionBlock}>
          <div className={styles.contractsWrap}>
            <MisContratos abogadoId={user?.id} isSuperAdmin={false} />
          </div>
        </div>

      </div>
    </div>
  )
}
