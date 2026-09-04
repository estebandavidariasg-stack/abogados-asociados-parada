import { useEffect, useState } from 'react'
import styles from './Footer.module.css'

const SOCIALS = [
  { label: 'Instagram', href: '#', path: 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 1.5A4 4 0 0 0 3.5 7.5v9a4 4 0 0 0 4 4h9a4 4 0 0 0 4-4v-9a4 4 0 0 0-4-4h-9zm4.5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm5.25-.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z' },
  { label: 'LinkedIn', href: '#', path: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { label: 'Facebook', href: '#', path: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z' },
]

const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)
const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6.29 6.29l1.16-1.16a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)
const IconMapPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
  </svg>
)

// ── Documentos legales (PDFs en public/legal) — se ven en la misma página ──
const DOCS_LEGALES = [
  { titulo: 'Términos y condiciones',                    href: '/terminos' },
  { titulo: 'Política de privacidad',                    href: '/privacidad' },
  { titulo: 'Política de cookies',                       pdf: '/legal/politica-cookies.pdf' },
  { titulo: 'Política de devoluciones',                  pdf: '/legal/politica-devoluciones.pdf' },
  { titulo: 'Licencia de usuario final (EULA)',          pdf: '/legal/eula.pdf' },
  { titulo: 'Autorización y tratamiento de datos',       pdf: '/legal/tratamiento-datos.pdf' },
]

export default function Footer() {
  // PDF abierto en el visor de la misma página ({ titulo, pdf } | null).
  const [docAbierto, setDocAbierto] = useState(null)

  // Esc cierra el visor y bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!docAbierto) return
    const onKey = (e) => { if (e.key === 'Escape') setDocAbierto(null) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [docAbierto])

  return (
    <footer className={styles.footer}>
      {/* Glow de fondo */}
      <div className={styles.glow} />

      <div className={styles.inner}>
        {/* ── Columna 1: tagline ── */}
        <div className={styles.brand}>
          <p className={styles.tagline}>Somos una plataforma web de intermediación que facilita la conexión entre personas que necesitan orientación jurídica y contable.</p>
        </div>

        {/* ── Columna 2: Contacto (correo, WhatsApp, ubicación) + redes ── */}
        <div className={styles.contact}>
          <h4 className={`${styles.colTitle} ${styles.colTitleContact}`}>Contacto</h4>
          <a href="mailto:gerencia@paradabridge.com" className={styles.contactItem}>
            <span className={styles.contactIcon}><IconMail /></span>
            <div>
              <span className={styles.contactLabel}>En cualquier momento</span>
              <span className={styles.contactValue}>gerencia@paradabridge.com</span>
              <span className={styles.contactSub}>Respondemos en menos de 24 horas</span>
            </div>
          </a>
          <a href="https://wa.me/573124086734" target="_blank" rel="noopener noreferrer" className={styles.contactItem}>
            <span className={styles.contactIcon}><IconPhone /></span>
            <div>
              <span className={styles.contactLabel}>¿Tienes dudas?</span>
              <span className={styles.contactValue}>+57 312 408 6734</span>
              <span className={styles.contactSub}>Escríbenos por WhatsApp</span>
            </div>
          </a>
          <a
            href="https://www.google.com/maps/search/?api=1&query=Carrera%2066%20%2319-72%2C%20Bogot%C3%A1"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.contactItem}
          >
            <span className={styles.contactIcon}><IconMapPin /></span>
            <div>
              <span className={styles.contactLabel}>Nuestra oficina</span>
              <span className={styles.contactValue}>Carrera 66 #19-72</span>
              <span className={styles.contactSub}>Bogotá D.C., Colombia</span>
            </div>
          </a>
        </div>
      </div>

      {/* ── Redes sociales — centradas en todo el ancho del footer ── */}
      <div className={styles.socials}>
        {SOCIALS.map(({ label, href, path }) => (
          <a key={label} href={href} className={styles.socialBtn} aria-label={label} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={path} />
            </svg>
          </a>
        ))}
      </div>

      {/* ── Documentos legales ── */}
      <nav aria-label="Documentos legales" style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        gap: '6px 22px', padding: '10px 20px 0', position: 'relative', zIndex: 1,
      }}>
        {/* Café tinta sobre el fondo claro del footer (antes iba en crema y
            se volvía invisible: solo se veían los subrayados). */}
        {DOCS_LEGALES.map(d => d.pdf ? (
          <button
            key={d.titulo}
            type="button"
            onClick={() => setDocAbierto(d)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: '0.76rem', color: '#68584a',
              textDecoration: 'underline', textUnderlineOffset: 3,
              textDecorationColor: 'rgba(201,168,76,0.55)',
            }}
          >
            {d.titulo}
          </button>
        ) : (
          <a key={d.titulo} href={d.href} style={{
            fontSize: '0.76rem', color: '#68584a',
            textDecoration: 'underline', textUnderlineOffset: 3,
            textDecorationColor: 'rgba(201,168,76,0.55)',
          }}>
            {d.titulo}
          </a>
        ))}
      </nav>

      {/* ── Marca gigante ── */}
      <div className={styles.bigBrand}>
        <span className={styles.bigText}>PARADA</span>
        <span className={styles.bigTextGold}>BRIDGE</span>
      </div>

      {/* ── Bottom bar ── */}
      <div className={styles.bottom}>
        <span>© 2026 Parada Bridge. Todos los derechos reservados.</span>
        <span className={styles.bottomDot}>·</span>
        <span>Bogotá, Colombia</span>
      </div>

      {/* ── Visor del documento en la misma página ── */}
      {docAbierto && (
        <div
          role="dialog" aria-modal="true" aria-label={docAbierto.titulo}
          onClick={() => setDocAbierto(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(30,20,12,0.62)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fffdf6', borderRadius: 16, overflow: 'hidden',
              width: 'min(880px, 96vw)', height: 'min(88dvh, 1000px)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 26px 80px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', background: '#472f29', color: '#fffef1',
            }}>
              <h3 style={{
                margin: 0, fontSize: '0.95rem', fontWeight: 700, flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {docAbierto.titulo}
              </h3>
              <a
                href={docAbierto.pdf} target="_blank" rel="noopener noreferrer"
                style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#f2d580',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                  border: '1px solid rgba(242,213,128,0.45)', borderRadius: 8, padding: '5px 10px',
                }}
              >
                Abrir en pestaña nueva ↗
              </a>
              <button
                type="button" onClick={() => setDocAbierto(null)} aria-label="Cerrar documento"
                style={{
                  border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fffef1',
                  width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 15, lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
            {/* El PDF se rinde con el visor nativo del navegador */}
            <iframe
              src={`${docAbierto.pdf}#view=FitH`}
              title={docAbierto.titulo}
              style={{ border: 'none', width: '100%', flex: 1, background: '#fff' }}
            />
          </div>
        </div>
      )}
    </footer>
  )
}
