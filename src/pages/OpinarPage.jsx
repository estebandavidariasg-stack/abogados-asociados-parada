import { useState } from 'react'
import styles from './OpinarPage.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   /opinar?token=..&rating=..  — página pública de reseña de la web.

   El cliente llega desde el correo (estrellas clicables). Envía su opinión
   DIRECTO a Supabase con la anon key (patrón de `pqr`), sin función serverless:
   PATCH resenas?token=eq.X&estado=eq.enviada → estado='recibida'. El token de
   la URL es el secreto; una RLS restringe la transición enviada→recibida.
   ───────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

function leerParams() {
  const p = new URLSearchParams(window.location.search)
  const rating = parseInt(p.get('rating'), 10)
  return { token: p.get('token') || '', rating: rating >= 1 && rating <= 5 ? rating : 0 }
}

export default function OpinarPage() {
  const [{ token }] = useState(leerParams)
  const [rating, setRating] = useState(leerParams().rating)
  const [hover, setHover] = useState(0)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('form') // form | enviando | ok | error
  const [error, setError] = useState('')

  async function enviar(e) {
    e.preventDefault()
    if (!token) { setError('Enlace inválido.'); setEstado('error'); return }
    if (rating < 1) { setError('Elige una calificación de 1 a 5 estrellas.'); return }
    setEstado('enviando'); setError('')
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/resenas?token=eq.${encodeURIComponent(token)}&estado=eq.enviada`,
        {
          method: 'PATCH',
          headers: {
            apikey: ANON, Authorization: `Bearer ${ANON}`,
            'Content-Type': 'application/json', Prefer: 'return=representation',
          },
          body: JSON.stringify({ rating, texto: texto.trim() || null, estado: 'recibida' }),
        }
      )
      const rows = await res.json().catch(() => [])
      if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
        throw new Error('Este enlace ya fue usado o expiró.')
      }
      setEstado('ok')
    } catch (err) {
      setError(err.message || 'No se pudo enviar tu opinión.')
      setEstado('error')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>Parada <span>Bridge</span></div>

        {estado === 'ok' ? (
          <div className={styles.done}>
            <div className={styles.check} aria-hidden="true">★</div>
            <h1 className={styles.title}>¡Gracias por tu opinión!</h1>
            <p className={styles.lead}>Tu comentario nos ayuda a mejorar. Lo revisaremos y podría aparecer en nuestra página.</p>
            <a className={styles.btn} href="/">Volver al inicio</a>
          </div>
        ) : estado === 'error' && !token ? (
          <div className={styles.done}>
            <h1 className={styles.title}>Enlace no válido</h1>
            <p className={styles.lead}>{error || 'El enlace de la reseña no es válido.'}</p>
            <a className={styles.btn} href="/">Ir al inicio</a>
          </div>
        ) : (
          <form onSubmit={enviar}>
            <h1 className={styles.title}>Cuéntanos tu experiencia</h1>
            <p className={styles.lead}>¿Qué te pareció nuestra página web? Tu opinión es muy valiosa.</p>

            <div className={styles.stars} role="radiogroup" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  className={`${styles.star} ${(hover || rating) >= n ? styles.starOn : ''}`}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              className={styles.textarea}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe tu comentario (opcional)…"
              rows={4}
              maxLength={500}
            />

            {error && <p className={styles.err}>{error}</p>}

            <button className={styles.btn} type="submit" disabled={estado === 'enviando'}>
              {estado === 'enviando' ? 'Enviando…' : 'Enviar mi opinión'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
