import { useState } from 'react'
import styles from './Footer.module.css'
import { DOCS_LEGALES, DOCS_FOOTER, VisorLegal } from '../shared/DocumentosLegales'
import { NETWORKS } from '../profile/SocialLinks'

/* Redes de la empresa, en este orden. Los glifos son los oficiales de cada
   marca (los mismos del perfil del profesional), en los colores del sitio.
   Solo se pintan las que tienen enlace: Facebook y LinkedIn quedan listos
   para cuando exista la página, basta con poner su URL. */
const REDES_EMPRESA = [
  ['instagram', 'https://www.instagram.com/paradabridge/'],
  ['whatsapp', 'https://wa.me/573108886571'],
  ['facebook', null],
  ['linkedin', null],
]
const SOCIALS = REDES_EMPRESA
  .filter(([, href]) => href)
  .map(([key, href]) => ({ ...NETWORKS.find(n => n.key === key), href }))

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

/* Documentos legales: el catálogo y el visor viven en shared/DocumentosLegales
   (los mismos que abre el registro y el chat). Aquí van los generales, en
   Title Case, en una sola fila. Los contratos por rol (profesional, gestor)
   no van en el footer: se leen y aceptan al registrarse. */
export default function Footer() {
  // Clave del documento abierto en el visor (null = cerrado).
  const [docAbierto, setDocAbierto] = useState(null)

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
          <a href="https://wa.me/573108886571" target="_blank" rel="noopener noreferrer" className={styles.contactItem}>
            <span className={styles.contactIcon}><IconPhone /></span>
            <div>
              <span className={styles.contactLabel}>¿Tienes dudas?</span>
              <span className={styles.contactValue}>+57 310 888 6571</span>
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
        {SOCIALS.map(({ key, label, href, icon }) => (
          <a key={key} href={href} className={styles.socialBtn} aria-label={`Parada Bridge en ${label}`} title={label} target="_blank" rel="noopener noreferrer">
            {icon}
          </a>
        ))}
      </div>

      {/* ── Documentos legales ── */}
      <nav aria-label="Documentos legales" className={styles.legalNav}>
        {DOCS_FOOTER.map(clave => (
          <button key={clave} type="button" className={styles.legalLink} onClick={() => setDocAbierto(clave)}>
            {DOCS_LEGALES[clave].titulo}
          </button>
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

      {/* ── Visor del documento en la misma página (se ve también en celular) ── */}
      <VisorLegal doc={docAbierto} onClose={() => setDocAbierto(null)} />
    </footer>
  )
}
