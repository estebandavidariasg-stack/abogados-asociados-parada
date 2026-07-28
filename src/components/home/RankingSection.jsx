import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import LawyerCard from './LawyerCard'
import styles from './RankingSection.module.css'

/*
  Ranking del mes — Top 5 profesionales mejor valorados, en formato podio.
  Métrica combinada (calidad + volumen), a pedido: no gana quien tiene una
  sola reseña de 5★, sino quien sostiene buenas calificaciones con volumen.

    score = promedio·0.65 + (volumen normalizado)·5·0.35

  Datos: valoraciones reales de consultas (`chat_ratings`) del mes en curso.
  Si aún no hay suficientes este mes, cae a la calificación histórica que ya
  agrega /api/professionals (rating_promedio + rating_total) → la sección
  siempre muestra algo real o no se muestra (nunca un cascarón vacío).
*/

function scoreOf(avg, count, maxCount) {
  const vol = maxCount > 0 ? count / maxCount : 0
  return avg * 0.65 + vol * 5 * 0.35
}

async function fetchPros(rol) {
  try {
    const r = await fetch(`/api/professionals?rol=${rol}`)
    if (r.ok) {
      const d = await r.json()
      if (Array.isArray(d)) return d
    }
  } catch { /* la sección simplemente no se muestra */ }
  return []
}

// Corona (1.º) / medalla (2.º y 3.º)
function CrownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 8.5l3.4 3L12 5l5.6 6.5 3.4-3L19 18.5H5L3 8.5zM5 20.5h14v1.2H5z" />
    </svg>
  )
}

function Stars({ value, className }) {
  return (
    <span className={`${styles.stars} ${className || ''}`} role="img" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={s <= Math.round(value) ? styles.starOn : styles.starOff}>★</span>
      ))}
    </span>
  )
}

const nombreDe    = p => `${p.nombre || ''} ${p.apellido || ''}`.trim()
const inicialesDe = p => ((p.nombre?.[0] || '?') + (p.apellido?.[0] || '')).toUpperCase()
const areaDe      = p => (p.area_derecho || '').split(',')[0]?.trim() || (p.rol === 'contador' ? 'Contador' : 'Abogado')

export default function RankingSection() {
  const [top, setTop]         = useState([])   // [{ pro, avg, count, score }]
  const [periodo, setPeriodo] = useState('este mes')
  const [loading, setLoading] = useState(true)
  const [sel, setSel]         = useState(null) // profesional cuyo modal está abierto
  const reduce = useReducedMotion()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [ab, co] = await Promise.all([fetchPros('abogado'), fetchPros('contador')])
      const pros = [...ab, ...co].filter(p => p && p.id != null)
      if (!pros.length) { if (!cancelled) setLoading(false); return }
      const byId = new Map(pros.map(p => [String(p.id), p]))

      // Valoraciones del mes en curso (datos reales de consultas cerradas).
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      let monthly = null
      try {
        const { data } = await supabase
          .from('chat_ratings')
          .select('lawyer_id,rating,created_at')
          .gte('created_at', monthStart)
        if (Array.isArray(data)) monthly = data
      } catch { /* cae al histórico */ }

      let ranked = []
      let per = 'este mes'

      if (Array.isArray(monthly) && monthly.length) {
        const agg = new Map()
        for (const r of monthly) {
          const id = String(r.lawyer_id)
          if (!byId.has(id)) continue
          const a = agg.get(id) || { sum: 0, count: 0 }
          a.sum += Number(r.rating) || 0
          a.count += 1
          agg.set(id, a)
        }
        ranked = [...agg.entries()].map(([id, a]) => ({
          pro: byId.get(id), avg: a.sum / a.count, count: a.count,
        }))
      }

      // Fallback: histórico agregado por el API (siempre disponible).
      if (ranked.length < 3) {
        ranked = pros
          .filter(p => (p.rating_total || 0) > 0 && p.rating_promedio != null)
          .map(p => ({ pro: p, avg: Number(p.rating_promedio) || 0, count: p.rating_total || 0 }))
        per = 'destacados'
      }

      if (!ranked.length) { if (!cancelled) setLoading(false); return }

      const maxCount = Math.max(...ranked.map(r => r.count))
      ranked.forEach(r => { r.score = scoreOf(r.avg, r.count, maxCount) })
      ranked.sort((a, b) => b.score - a.score || b.avg - a.avg || b.count - a.count)

      if (!cancelled) {
        setTop(ranked.slice(0, 5).map((r, i) => ({ ...r, rank: i + 1 })))
        setPeriodo(per)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  if (loading || !top.length) return null

  // Podio (1–3) reordenado 2 · 1 · 3; puestos 4–5 como lista.
  const byRank = r => top.find(t => t.rank === r)
  const podium = [byRank(2), byRank(1), byRank(3)].filter(Boolean)
  const rest   = top.filter(t => t.rank >= 4)

  const ease = [0.16, 1, 0.3, 1]

  return (
    <section className={styles.section} aria-labelledby="ranking-heading">
      <motion.header
        initial={reduce ? false : { opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.8, ease }}
        className={styles.header}
      >
        <span className={styles.eyebrow}>Ranking · {periodo}</span>
        <h2 id="ranking-heading" className={styles.heading}>
          Los profesionales <em>mejor valorados</em>
        </h2>
        <p className={styles.desc}>
          Un top cinco que combina la calificación de los clientes con el volumen de consultas
          atendidas. Toca a un profesional para ver su perfil e iniciar tu consulta.
        </p>
      </motion.header>

      {/* ── Podio 1–3 ── */}
      <div className={styles.podium}>
        {podium.map((r) => {
          const p = r.pro
          const cls = r.rank === 1 ? styles.first : r.rank === 2 ? styles.second : styles.third
          return (
            <motion.button
              type="button"
              key={p.id}
              className={`${styles.column} ${cls}`}
              onClick={() => setSel(p)}
              initial={reduce ? false : { opacity: 0, y: 34 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, ease, delay: reduce ? 0 : (r.rank === 1 ? 0.1 : r.rank === 2 ? 0.22 : 0.34) }}
              aria-label={`Ver perfil de ${nombreDe(p)}, puesto ${r.rank}`}
            >
              <span className={styles.badge} aria-hidden="true">
                {r.rank === 1
                  ? <CrownIcon className={styles.badgeIcon} />
                  : <span className={styles.badgeMedal}>{r.rank}</span>}
              </span>

              <span className={styles.avatarWrap}>
                {p.foto_url
                  ? <img src={p.foto_url} alt={nombreDe(p)} className={styles.avatar} loading="lazy" decoding="async" />
                  : <span className={styles.avatarInitials}>{inicialesDe(p)}</span>}
              </span>

              <span className={styles.name} title={nombreDe(p)}>{nombreDe(p)}</span>
              <span className={styles.area}>{areaDe(p)}</span>

              <span className={styles.scoreLine}>
                <span className={styles.scoreNum}>{r.avg.toFixed(1)}</span>
                <Stars value={r.avg} />
              </span>
              <span className={styles.count}>{r.count} {r.count === 1 ? 'valoración' : 'valoraciones'}</span>

              {/* Bloque del podio */}
              <motion.span
                className={styles.block}
                initial={reduce ? false : { scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.7, ease, delay: reduce ? 0 : (r.rank === 1 ? 0.18 : r.rank === 2 ? 0.3 : 0.42) }}
                aria-hidden="true"
              >
                <span className={styles.blockRank}>{r.rank}</span>
              </motion.span>
            </motion.button>
          )
        })}
      </div>

      {/* ── Puestos 4–5 ── */}
      {rest.length > 0 && (
        <ol className={styles.list}>
          {rest.map((r, idx) => {
            const p = r.pro
            return (
              <motion.li
                key={p.id}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.5, ease, delay: reduce ? 0 : 0.08 * idx }}
              >
                <button type="button" className={styles.row} onClick={() => setSel(p)} aria-label={`Ver perfil de ${nombreDe(p)}, puesto ${r.rank}`}>
                  <span className={styles.rowRank} aria-hidden="true">{r.rank}</span>
                  <span className={styles.rowAvatar}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={nombreDe(p)} className={styles.rowAvatarImg} loading="lazy" decoding="async" />
                      : <span className={styles.rowAvatarInitials}>{inicialesDe(p)}</span>}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{nombreDe(p)}</span>
                    <span className={styles.rowArea}>{areaDe(p)}</span>
                  </span>
                  <span className={styles.rowScore}>
                    <span className={styles.rowScoreNum}>{r.avg.toFixed(1)}</span>
                    <Stars value={r.avg} />
                  </span>
                </button>
              </motion.li>
            )
          })}
        </ol>
      )}

      {/* Modal del profesional (reutiliza LawyerCard controlado → deep-link al chat). */}
      {sel && (
        <LawyerCard
          lawyer={sel}
          reveal={false}
          hideCard
          controlledOpen
          onControlledClose={() => setSel(null)}
        />
      )}
    </section>
  )
}
