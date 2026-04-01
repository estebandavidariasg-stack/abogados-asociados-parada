import { useEffect, useRef } from 'react'
import LawyerCard from './LawyerCard'
import styles from './LawyersSection.module.css'

// Datos de ejemplo — luego vendrán de Supabase
const LAWYERS = [
  {
    id: 1,
    initials: 'AR',
    name: 'Alejandro Rodríguez',
    area: 'Derecho Penal',
    title: 'Socio Fundador · 22 años de experiencia',
    photo: null,
  },
  {
    id: 2,
    initials: 'SM',
    name: 'Sofía Martínez',
    area: 'Derecho Corporativo',
    title: 'Socia Senior · 16 años de experiencia',
    photo: null,
  },
  {
    id: 3,
    initials: 'CP',
    name: 'Carlos Pardo',
    area: 'Derecho de Familia',
    title: 'Asociado · 9 años de experiencia',
    photo: null,
  },
  {
    id: 4,
    initials: 'LV',
    name: 'Laura Valencia',
    area: 'Derecho Civil',
    title: 'Asociada · 11 años de experiencia',
    photo: null,
  },
]

export default function LawyersSection() {
  const sectionRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('visible')
      }),
      { threshold: 0.12 }
    )
    const els = sectionRef.current?.querySelectorAll('.fade-up')
    els?.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <section className={styles.section} id="lawyers" ref={sectionRef}>
      <div className={`${styles.header} fade-up`}>
        <span className={styles.label}>Nuestro Equipo</span>
        <h2 className={styles.title}>
          ABOGADOS DE <em>EXCELENCIA</em>
        </h2>
        <p className={styles.desc}>
          Profesionales especializados, comprometidos con cada caso y con la defensa de sus derechos.
        </p>
      </div>

      <div className={styles.grid}>
        {LAWYERS.map((lawyer, i) => (
          <LawyerCard key={lawyer.id} lawyer={lawyer} delay={i * 0.1} />
        ))}
      </div>
    </section>
  )
}
