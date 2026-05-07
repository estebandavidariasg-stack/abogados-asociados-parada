import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import SocialLinks from './SocialLinks'
// Reusamos los estilos del modal de LawyerCard — mismo lenguaje visual.
import styles from './LawyerCard.module.css'

function StarDisplay({ rating, total }) {
  if (!rating) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1,2,3,4,5].map(s => (
          <span key={s} style={{
            color: s <= Math.round(rating) ? 'var(--gold)' : 'rgba(13,45,94,0.18)',
            fontSize: '0.85rem',
          }}>★</span>
        ))}
      </div>
      <span style={{ color: '#888', fontSize: '0.73rem' }}>
        {rating} ({total})
      </span>
    </div>
  )
}

function InfoRow({ icon, label, value, isLink, href }) {
  if (!value) return null
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoIcon}>{icon}</span>
      <div>
        <span className={styles.infoLabel}>{label}</span>
        {isLink
          ? <a href={href || value} target="_blank" rel="noopener noreferrer" className={styles.infoValue} style={{ color:'var(--gold-dk, #8a6a28)', textDecoration:'underline' }}>{value}</a>
          : <span className={styles.infoValue}>{value}</span>}
      </div>
    </div>
  )
}

const goldStroke = { fill:'none', stroke:'var(--gold)', strokeWidth:1.5, width:18, height:18 }

const ICONS = {
  user:        <svg viewBox="0 0 24 24" {...goldStroke}><circle cx="12" cy="8" r="4"/><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
  email:       <svg viewBox="0 0 24 24" {...goldStroke}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  phone:       <svg viewBox="0 0 24 24" {...goldStroke}><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.91 10.6a16 16 0 0 0 6.49 6.49l1.43-1.43a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>,
  uni:         <svg viewBox="0 0 24 24" {...goldStroke}><path d="M12 3L1 9l11 6 11-6-11-6z"/><path d="M1 9v6"/><path d="M5 11.18v5.64L12 21l7-4.18v-5.64"/></svg>,
  briefcase:   <svg viewBox="0 0 24 24" {...goldStroke}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></svg>,
  pin:         <svg viewBox="0 0 24 24" {...goldStroke}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  building:    <svg viewBox="0 0 24 24" {...goldStroke}><path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M7 11h2v2H7zM15 11h2v2h-2zM7 16h2v2H7zM15 16h2v2h-2zM11 11h2v6h-2z"/></svg>,
  clock:       <svg viewBox="0 0 24 24" {...goldStroke}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>,
  card:        <svg viewBox="0 0 24 24" {...goldStroke}><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M8 3v5"/></svg>,
  paperclip:   <svg viewBox="0 0 24 24" {...goldStroke}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  home:        <svg viewBox="0 0 24 24" {...goldStroke}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
}

export default function ProfileDetailModal({ profile, onClose }) {
  const [rating, setRating] = useState(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    async function load() {
      if (!profile?.id) return
      const { data } = await supabase
        .from('chat_ratings')
        .select('rating')
        .eq('lawyer_id', profile.id)
      if (Array.isArray(data) && data.length) {
        const total = data.length
        const promedio = parseFloat((data.reduce((s, r) => s + r.rating, 0) / total).toFixed(1))
        setRating({ promedio, total })
      }
    }
    load()
  }, [profile?.id])

  if (!profile) return null

  const initials = (profile.nombre?.[0] || '?') + (profile.apellido?.[0] || '')
  const rolLabel = profile.rol === 'contador' ? 'Contador' : 'Abogado'
  const ciudadDB = profile.ciudad || ''
  const tieneBarrio = ciudadDB.includes(' - ')
  const ciudadVisible = tieneBarrio ? ciudadDB.split(' - ')[0] : ciudadDB
  const barrioVisible = tieneBarrio ? ciudadDB.split(' - ')[1] : null

  // Hay redes si al menos uno de los campos viene con valor
  const tieneRedes = !!(
    profile.instagram || profile.linkedin || profile.facebook ||
    profile.twitter   || profile.tiktok   || profile.whatsapp
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: 28 }}
      >

        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalPhotoWrap}>
            {profile.foto_url
              ? <img src={profile.foto_url} alt={profile.nombre} className={styles.modalPhoto} />
              : <span className={styles.modalInitials}>{initials}</span>}
          </div>
          <div className={styles.modalHeaderText}>
            {profile.area_derecho && (
              <p className={styles.modalAreas}>
                {profile.area_derecho.split(',').map((a, i, arr) => (
                  <span key={i}>
                    {a.trim()}{i < arr.length - 1 && <span className={styles.areaDot}> · </span>}
                  </span>
                ))}
              </p>
            )}
            <h2 className={styles.modalName}>
              {profile.nombre} {profile.apellido}
              <span className={`${styles.rolPill} ${profile.rol === 'contador' ? styles.rolPillContador : styles.rolPillAbogado}`}>
                {rolLabel}
              </span>
            </h2>
            {(ciudadVisible || profile.departamento) && (
              <p className={styles.modalLocation}>
                {[ciudadVisible, profile.departamento].filter(Boolean).join(', ')}
              </p>
            )}
            <p style={{
              margin: '6px 0 0',
              fontSize: '0.72rem',
              color: profile.aprobado ? '#1a8c4e' : '#a07c20',
              fontWeight: 600,
              letterSpacing: '0.06em',
            }}>
              {profile.aprobado ? '✦ Aprobado' : '◌ Pendiente de aprobación'}
            </p>
            {rating && (
              <div style={{ marginTop: 8 }}>
                <StarDisplay rating={rating.promedio} total={rating.total} />
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalDivider} />

        {/* Video */}
        {profile.video_url && (
          <div className={styles.modalSection}>
            <h4 className={styles.modalSectionTitle}>Presentación</h4>
            <video src={profile.video_url} controls className={styles.modalVideo}
              poster={profile.foto_url || undefined} />
          </div>
        )}

        {/* Descripción */}
        {profile.descripcion && (
          <div className={styles.modalSection}>
            <h4 className={styles.modalSectionTitle}>Sobre mí</h4>
            <p className={styles.modalDesc}>{profile.descripcion}</p>
          </div>
        )}

        {/* Datos de contacto */}
        <div className={styles.modalDetails}>
          <InfoRow icon={ICONS.user}  label="Usuario"  value={profile.username ? `@${profile.username}` : null} />
          <InfoRow icon={ICONS.email} label="Email"    value={profile.email}    isLink href={`mailto:${profile.email}`} />
          <InfoRow icon={ICONS.phone} label="Teléfono" value={profile.telefono} />
        </div>

        <div className={styles.modalDivider} />

        {/* Información profesional */}
        <div className={styles.modalDetails}>
          <InfoRow icon={ICONS.uni}       label="Universidad" value={profile.universidad} />
          <InfoRow icon={ICONS.briefcase}
            label={profile.rol === 'contador' ? 'Especialidades' : 'Áreas de derecho'}
            value={profile.area_derecho} />
          <InfoRow icon={ICONS.pin}      label="Ciudad"        value={ciudadVisible} />
          {barrioVisible && <InfoRow icon={ICONS.pin} label="Barrio / Comuna" value={barrioVisible} />}
          <InfoRow icon={ICONS.building} label="Departamento"  value={profile.departamento} />
          <InfoRow icon={ICONS.home}     label="Dirección de oficina" value={profile.direccion} />
          <InfoRow icon={ICONS.clock}    label="Años de experiencia"  value={profile.experiencia} />
          <InfoRow icon={ICONS.card}
            label="Tarjeta profesional (número)"
            value={profile.tarjeta_profesional} />
          {profile.tarjeta_archivo_url && (
            <InfoRow
              icon={ICONS.paperclip}
              label="Tarjeta profesional (archivo)"
              value="Ver archivo cargado ↗"
              isLink
              href={profile.tarjeta_archivo_url}
            />
          )}
        </div>

        {tieneRedes && (
          <>
            <div className={styles.modalDivider} />
            <div className={styles.modalSection}>
              <h4 className={styles.modalSectionTitle}>Redes sociales</h4>
              <SocialLinks profile={profile} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
