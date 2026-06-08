import { useEffect, useState } from 'react'
import styles from './SubNav.module.css'

// Mapeo de link → sección observada para el active state
const LINKS = [
  { label: 'Cómo funciona',      anchor: 'intro',   sectionId: 'intro'   },
  { label: 'Para profesionales', anchor: null,       sectionId: null      },
  { label: 'Iniciar consulta',   anchor: 'chat',    sectionId: null, cta: true },
]

function scrollTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  // scroll-padding-top en el html maneja el offset del chrome fijo
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function SubNav({ onUnirse }) {
  const [scrolled,  setScrolled]  = useState(false)
  const [activeId,  setActiveId]  = useState(null)

  // Sincroniza con el scroll del Navbar (> 50px → modo píldora)
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // IntersectionObserver para resaltar el link activo
  useEffect(() => {
    const sectionIds = ['intro', 'chat', 'modelos']
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        })
      },
      // Se activa cuando el centro del viewport cruza la sección
      { rootMargin: '-40% 0px -55% 0px' }
    )
    sectionIds.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      className={`${styles.subnav} ${scrolled ? styles.subnavScrolled : ''}`}
      aria-label="Navegación de secciones"
    >
      <ul className={styles.list}>
        {LINKS.map(({ label, anchor, sectionId, cta }) => {
          const isActive = sectionId && activeId === sectionId

          const className = [
            styles.link,
            cta     ? styles.linkCta : '',
            isActive ? styles.active  : '',
          ].filter(Boolean).join(' ')

          return (
            <li key={label}>
              {anchor ? (
                <a
                  href={`#${anchor}`}
                  className={className}
                  onClick={(e) => { e.preventDefault(); scrollTo(anchor) }}
                >
                  {label}
                </a>
              ) : (
                <button
                  type="button"
                  className={className}
                  onClick={onUnirse}
                >
                  {label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
