import styles from './LawyerCard.module.css'

export default function LawyerCard({ lawyer, delay = 0 }) {
  return (
    <div
      className={`${styles.card} fade-up`}
      style={{ transitionDelay: `${delay}s` }}
    >
      {/* Foto o placeholder con iniciales */}
      <div className={styles.photoWrap}>
        {lawyer.photo ? (
          <img
            src={lawyer.photo}
            alt={lawyer.name}
            className={styles.photo}
          />
        ) : (
          <div className={styles.placeholder}>
            <span>{lawyer.initials}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className={styles.info}>
        <span className={styles.area}>{lawyer.area}</span>
        <h3 className={styles.name}>{lawyer.name}</h3>
        <p className={styles.jobTitle}>{lawyer.title}</p>
        <div className={styles.socials}>
          <a href="#" className={styles.socialLink}>in</a>
          <a href="#" className={styles.socialLink}>@</a>
        </div>
      </div>
    </div>
  )
}
