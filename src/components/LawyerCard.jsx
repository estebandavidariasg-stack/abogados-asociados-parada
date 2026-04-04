import { useState, useEffect } from 'react'
import styles from './LawyerCard.module.css'

export default function LawyerCard({ lawyer, delay = 0 }) {
  const [open, setOpen] = useState(false)

  const initials =
    (lawyer.nombre?.[0] || '?') + (lawyer.apellido?.[0] || '')

  /* ── Bloquear scroll cuando modal está abierto ── */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  /* ── Info rows helper ──────────────────────── */
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
      {/* ── Tarjeta en el grid ────────────────────── */}
      <div
        className={`${styles.card} fade-up`}
        style={{ transitionDelay: `${delay}s` }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
      >
        <div className={styles.photoWrap}>
          {lawyer.foto_url ? (
            <img src={lawyer.foto_url} alt={lawyer.nombre} className={styles.photo} />
          ) : (
            <span className={styles.initials}>{initials}</span>
          )}
          <div className={styles.photoGlow} />
        </div>

        <div className={styles.info}>
          {lawyer.especialidad && (
            <span className={styles.area}>{lawyer.especialidad}</span>
          )}
          <h3 className={styles.name}>
            {lawyer.nombre} {lawyer.apellido}
          </h3>
          {(lawyer.ciudad || lawyer.departamento) && (
            <p className={styles.location}>
              {[lawyer.ciudad, lawyer.departamento].filter(Boolean).join(', ')}
            </p>
          )}
          {lawyer.universidad && (
            <p className={styles.subtitle}>{lawyer.universidad}</p>
          )}
        </div>

        <div className={styles.cardHint}>Ver perfil →</div>
      </div>

      {/* ── Modal de perfil completo ─────────────── */}
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botón cerrar */}
            <button
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              ✕
            </button>

            {/* Header del modal */}
            <div className={styles.modalHeader}>
              <div className={styles.modalPhotoWrap}>
                {lawyer.foto_url ? (
                  <img
                    src={lawyer.foto_url}
                    alt={lawyer.nombre}
                    className={styles.modalPhoto}
                  />
                ) : (
                  <span className={styles.modalInitials}>{initials}</span>
                )}
              </div>

              <div className={styles.modalHeaderText}>
                {lawyer.especialidad && (
                  <span className={styles.modalArea}>{lawyer.especialidad}</span>
                )}
                <h2 className={styles.modalName}>
                  {lawyer.nombre} {lawyer.apellido}
                </h2>
                {(lawyer.ciudad || lawyer.departamento) && (
                  <p className={styles.modalLocation}>
                    {[lawyer.ciudad, lawyer.departamento].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            </div>

            {/* Línea dorada decorativa */}
            <div className={styles.modalDivider} />

            {/* Video de presentación */}
            {lawyer.video_url && (
              <div className={styles.modalSection}>
                <h4 className={styles.modalSectionTitle}>Presentación</h4>
                <video
                  src={lawyer.video_url}
                  controls
                  className={styles.modalVideo}
                  poster={lawyer.foto_url || undefined}
                />
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
              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M12 3L1 9l11 6 11-6-11-6z"/><path d="M1 9v6"/><path d="M5 11.18v5.64L12 21l7-4.18v-5.64"/></svg>} label="Universidad" value={lawyer.universidad} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></svg>} label="Área de derecho" value={lawyer.area_derecho} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>} label="Ciudad" value={lawyer.ciudad} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M7 11h2v2H7zM15 11h2v2h-2zM7 16h2v2H7zM15 16h2v2h-2zM11 11h2v6h-2z"/></svg>} label="Departamento" value={lawyer.departamento} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.91 10.6a16 16 0 0 0 6.49 6.49l1.43-1.43a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>} label="Teléfono" value={lawyer.telefono} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} label="Email" value={lawyer.email} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>} label="LinkedIn" value={lawyer.linkedin} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>} label="Años de experiencia" value={lawyer.experiencia} />

              <InfoRow icon={<svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" width="18" height="18"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M8 3v5"/></svg>} label="Tarjeta profesional" value={lawyer.tarjeta_profesional} />
            </div>

            {/* CTA */}
            {lawyer.telefono && (
              <a
                href={`https://wa.me/57${lawyer.telefono.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.modalCta}
              >
                Contactar por WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}
