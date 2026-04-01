import { useState, useEffect, useCallback } from 'react'
import styles from './Hero.module.css'

const SLIDES = [
  {
    image: '/hero-1.png',
    eyebrow: 'Bufete Jurídico · Colombia',
    title: ['Soluciones legales con ', 'resultados reales'],
    titleGold: 1,
    subtitle: 'Asesoría jurídica especializada con el compromiso y la seriedad que su caso merece.',
    cta: { label: 'Consulta gratuita', href: '#contacto' },
  },
  {
    image: '/hero-2.png',
    eyebrow: 'Derecho Civil · Penal · Corporativo',
    title: ['Estrategia legal de ', 'alto nivel'],
    titleGold: 1,
    subtitle: 'Un equipo comprometido con la justicia, la ética y la defensa de sus intereses.',
    cta: { label: 'Conocer al equipo', href: '#lawyers' },
  },
  {
    image: '/hero-3.png',
    eyebrow: 'Experiencia · Compromiso · Resultados',
    title: ['Su confianza, ', 'nuestra mayor responsabilidad'],
    titleGold: 0,
    subtitle: 'Cada caso es único. Cada cliente recibe atención personalizada y dedicación absoluta.',
    cta: { label: 'Ver perfiles', href: '#lawyers' },
  },
  {
    image: '/hero-4.png',
    eyebrow: 'Parada & Asociados · Bufete Jurídico',
    title: ['Defendemos lo que ', 'más importa'],
    titleGold: 1,
    subtitle: 'Representación legal sólida en litigios civiles, penales y asuntos corporativos.',
    cta: { label: 'Contáctenos', href: '#contacto' },
  },
  {
    image: '/hero-5.png',
    eyebrow: 'Justicia · Ética · Excelencia',
    title: ['El derecho como ', 'herramienta de justicia'],
    titleGold: 1,
    subtitle: 'Con visión estratégica y profundo conocimiento jurídico, luchamos por usted.',
    cta: { label: 'Agendar cita', href: '#contacto' },
  },
]

export default function Hero() {
  const [current, setCurrent] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  const goTo = useCallback((n) => {
    setCurrent((n + SLIDES.length) % SLIDES.length)
    setAnimKey((k) => k + 1)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => goTo(current + 1), 6000)
    return () => clearInterval(timer)
  }, [current, goTo])

  const slide = SLIDES[current]

  return (
    <section className={styles.hero}>

      {/* Fondo oscuro texturizado */}
      <div className={styles.heroBg} />

      {/* Línea dorada izquierda */}
      <div className={styles.goldLine} />

      {/* Layout: texto izq + foto der */}
      <div className={styles.layout} key={`layout-${animKey}`}>

        {/* — LADO IZQUIERDO: texto — */}
        <div className={styles.textSide}>
          <span className={styles.eyebrow}>{slide.eyebrow}</span>
          <h1 className={styles.title}>
            {slide.titleGold === 0
              ? <><em>{slide.title[0]}</em>{slide.title[1]}</>
              : <>{slide.title[0]}<em>{slide.title[1]}</em></>
            }
          </h1>
          <p className={styles.subtitle}>{slide.subtitle}</p>
          <a href={slide.cta.href} className={`btn-solid btn-lg ${styles.cta}`}>
            {slide.cta.label}
          </a>

          {/* Dots dentro del lado izquierdo */}
          <div className={styles.dots}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* — LADO DERECHO: foto portrait — */}
        <div className={styles.photoSide}>
          {/* Marco decorativo dorado */}
          <div className={styles.photoFrame}>
            <img
              key={`img-${animKey}`}
              src={slide.image}
              alt="Abogado"
              className={styles.photo}
            />
            {/* Degradado inferior para mezclar con fondo */}
            <div className={styles.photoFade} />
          </div>

          {/* Flechas navegación */}
          <div className={styles.arrows}>
            <button className={styles.arrow} onClick={() => goTo(current - 1)}>←</button>
            <button className={styles.arrow} onClick={() => goTo(current + 1)}>→</button>
          </div>
        </div>

      </div>
    </section>
  )
}
