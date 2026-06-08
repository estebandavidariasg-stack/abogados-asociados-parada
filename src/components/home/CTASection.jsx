import { useEffect, useRef } from 'react'
import styles from './CTASection.module.css'

export default function CTASection() {
  const ref = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('visible')
      }),
      { threshold: 0.15 }
    )
    ref.current?.querySelectorAll('.fade-up').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <section className={styles.section} id="contacto" ref={ref}>
      <span className={`${styles.label} fade-up`}>¿Necesita asesoría?</span>
      <h2 className={`${styles.title} fade-up`}>
        Escríbanos <br /> si tiene dudas
      </h2>
      <div className={`${styles.actions} fade-up`}>
        <a 
          href="https://wa.me/573124086734" 
          className={styles.ctaButton}
        >
          WhatsApp directo
        </a>

      </div>
    </section>
  )
}
