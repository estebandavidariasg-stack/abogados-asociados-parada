import { motion } from 'framer-motion'
import { eyebrowReveal, blurReveal, scaleIn, headerStagger, VIEWPORT } from '../../lib/motionVariants'
import styles from './CTASection.module.css'

export default function CTASection() {
  return (
    <section className={styles.section} id="contacto">
      <div className={styles.topFade} aria-hidden="true" />

      <motion.div
        variants={headerStagger}
        initial="hidden"
        whileInView="visible"
        viewport={{ ...VIEWPORT, amount: 0.35 }}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <motion.span className={styles.label} variants={eyebrowReveal}>
          ¿Necesita asesoría?
        </motion.span>

        <motion.h2 className={styles.title} variants={blurReveal}>
          Escríbanos <br /> si tiene dudas
        </motion.h2>

        <motion.div className={styles.actions} variants={scaleIn}>
          <a
            href="https://wa.me/573124086734"
            className={styles.ctaButton}
          >
            WhatsApp directo
          </a>
        </motion.div>
      </motion.div>
    </section>
  )
}
