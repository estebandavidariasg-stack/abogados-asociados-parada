import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import SocialLinks from '../profile/SocialLinks'
import styles from './LawyerCard.module.css'


// Muestra estrellas doradas (solo lectura)
function StarDisplay({ rating, total, dark = false }) {
  if (!rating) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1,2,3,4,5].map(s => (
          <span key={s} style={{
            color: s <= Math.round(rating) ? 'var(--gold)' : (dark ? 'rgba(13,45,94,0.18)' : 'rgba(255,255,255,0.2)'),
            fontSize: '0.85rem'
          }}>★</span>
        ))}
      </div>
      <span style={{ color: dark ? '#888' : 'rgba(255,255,255,0.55)', fontSize: '0.73rem' }}>
        {rating} ({total})
      </span>
    </div>
  )
}

export default function LawyerCard({ lawyer, delay = 0, isSuperAdmin = false }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(null) // { promedio, total }

  const initials = (lawyer.nombre?.[0] || '?') + (lawyer.apellido?.[0] || '')

  // Cargar calificación del abogado
  useEffect(() => {
    async function loadRating() {
      const { data } = await supabase
        .from('chat_ratings')
        .select('rating')
        .eq('lawyer_id', lawyer.id)
      if (data && data.length > 0) {
        const total   = data.length
        const promedio = parseFloat((data.reduce((s, r) => s + r.rating, 0) / total).toFixed(1))
        setRating({ promedio, total })
      }
    }
    loadRating()
  }, [lawyer.id])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function InfoRow({ icon, label, value }) {
    if (!value) return null
    return (
      <div className={styles.infoRow}>
        <span className={styles.infoIcon}>{icon}</span>
        <div>
          <span className={styles.infoLabel}>{label}</span>
          <span className={styles.infoValue}>{value}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── Tarjeta en el grid ── */}
      <div
        className={`${styles.card} fade-up`}
        style={{ transitionDelay: `${delay}s` }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
      >
        <div className={styles.photoWrap}>
          {lawyer.foto_url
            ? <img src={lawyer.foto_url} alt={lawyer.nombre} className={styles.photo} />
            : <span className={styles.initials}>{initials}</span>
          }
          <div className={styles.photoGlow} />
        </div>

        <div className={styles.info}>
          {lawyer.area_derecho && (
            <p className={styles.areas}>
              {lawyer.area_derecho.split(',').map((a, i, arr) => (
                <span key={i}>
                  {a.trim()}{i < arr.length - 1 && <span className={styles.areaDot}> · </span>}
                </span>
              ))}
            </p>
          )}
          <h3 className={styles.name}>
            {lawyer.nombre} {lawyer.apellido}
            <span className={`${styles.rolPill} ${lawyer.rol === 'contador' ? styles.rolPillContador : styles.rolPillAbogado}`}>
              {lawyer.rol === 'contador' ? 'Contador' : 'Abogado'}
            </span>
          </h3>
          {(lawyer.ciudad || lawyer.departamento) && (
            <p className={styles.location}>
              {[lawyer.ciudad, lawyer.departamento].filter(Boolean).join(', ')}
            </p>
          )}
          {lawyer.universidad && <p className={styles.subtitle}>{lawyer.universidad}</p>}

          {/* Estrellas en la tarjeta */}
          {rating && (
            <div style={{ marginTop: 8 }}>
              <StarDisplay rating={rating.promedio} total={rating.total} dark={false} />
            </div>
          )}

          {/* Iconos de redes en la tarjeta (pequeños) */}
          {isSuperAdmin && (
            <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
              <SocialLinks profile={lawyer} size="sm" />
            </div>
          )}
        </div>

        <div className={styles.cardHint}>Ver perfil →</div>
      </div>

      {/* ── Modal ── */}
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

            <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>

            {/* Header */}
            <div className={styles.modalHeader}>
              <div className={styles.modalPhotoWrap}>
                {lawyer.foto_url
                  ? <img src={lawyer.foto_url} alt={lawyer.nombre} className={styles.modalPhoto} />
                  : <span className={styles.modalInitials}>{initials}</span>
                }
              </div>
              <div className={styles.modalHeaderText}>
                {lawyer.area_derecho && (
                  <p className={styles.modalAreas}>
                    {lawyer.area_derecho.split(',').map((a, i, arr) => (
                      <span key={i}>
                        {a.trim()}{i < arr.length - 1 && <span className={styles.areaDot}> · </span>}
                      </span>
                    ))}
                  </p>
                )}
                <h2 className={styles.modalName}>
                  {lawyer.nombre} {lawyer.apellido}
                  <span className={`${styles.rolPill} ${lawyer.rol === 'contador' ? styles.rolPillContador : styles.rolPillAbogado}`}>
                    {lawyer.rol === 'contador' ? 'Contador' : 'Abogado'}
                  </span>
                </h2>
                {(lawyer.ciudad || lawyer.departamento) && (
                  <p className={styles.modalLocation}>
                    {[lawyer.ciudad, lawyer.departamento].filter(Boolean).join(', ')}
                  </p>
                )}
                {/* Calificación en el modal */}
                {rating && (
                  <div style={{ marginTop: 8 }}>
                    <StarDisplay rating={rating.promedio} total={rating.total} dark={true} />
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalDivider} />


            {/* Video */}
            {lawyer.video_url && (
              <div className={styles.modalSection}>
                <h4 className={styles.modalSectionTitle}>Presentación</h4>
                <video src={lawyer.video_url} controls className={styles.modalVideo} poster={lawyer.foto_url || undefined} />
              </div>
            )}

            {/* Descripción */}
            {lawyer.descripcion && (
              <div className={styles.modalSection}>
                <h4 className={styles.modalSectionTitle}>Sobre mí</h4>
                <p className={styles.modalDesc}>{lawyer.descripcion}</p>
              </div>
            )}

            {/* Info detallada */}
            <div className={styles.modalDetails}>
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><path d="M12 3L1 9l11 6 11-6-11-6z"/><path d="M1 9v6"/><path d="M5 11.18v5.64L12 21l7-4.18v-5.64"/></svg>} label="Universidad" value={lawyer.universidad} />
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></svg>} label="Área de derecho" value={lawyer.area_derecho} />
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>} label="Ciudad" value={lawyer.ciudad} />
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M7 11h2v2H7zM15 11h2v2h-2zM7 16h2v2H7zM15 16h2v2h-2zM11 11h2v6h-2z"/></svg>} label="Departamento" value={lawyer.departamento} />
              {isSuperAdmin && <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.91 10.6a16 16 0 0 0 6.49 6.49l1.43-1.43a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>} label="Teléfono" value={lawyer.telefono} />}
              {isSuperAdmin && <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} label="Email" value={lawyer.email} />}
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>} label="Años de experiencia" value={lawyer.experiencia} />
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M8 3v5"/></svg>} label="Tarjeta profesional" value={lawyer.tarjeta_profesional} />
            </div>

            {/* CTA — lleva a la sección de consulta privada */}
            <button
              type="button"
              className={styles.modalCta}
              onClick={() => {
                setOpen(false)
                // pequeño delay para que el modal se desmonte antes del scroll
                setTimeout(() => {
                  const el = document.getElementById('chat')
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 120)
              }}
            >
              INICIAR CONSULTA
            </button>
          </div>
        </div>
      )}
    </>
  )
}
