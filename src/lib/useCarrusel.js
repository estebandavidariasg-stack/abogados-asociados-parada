import { useRef, useEffect, useCallback } from 'react'

/* ── prefers-reduced-motion (una sola lectura reactiva) ─────────────────── */
function prefiereMenosMovimiento() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Carrusel horizontal reutilizable (cinta de perfiles y de testimonios).
 *
 * Da tres formas de navegar la misma fila:
 *   1. Auto-avance continuo y suave (rAF) que hace bucle sin salto. Requiere que
 *      el contenido se renderice DUPLICADO (dos copias idénticas seguidas) — el
 *      salto de una copia a la otra es invisible porque el contenido es idéntico.
 *   2. Arrastre con el puntero (mouse o dedo): se agarra la cinta y se desplaza
 *      como un scroll, a la velocidad del gesto.
 *   3. Flechas: `step(±1)` avanza ~un ancho visible con easing.
 *
 * Se pausa el auto-avance al pasar el mouse, arrastrar, enfocar con teclado, o
 * cuando la sección sale del viewport. Respeta prefers-reduced-motion (sin
 * auto-avance; arrastre y flechas siguen funcionando).
 *
 * @param {object}  opts
 * @param {number}  opts.speed      px/seg del auto-avance (default 42)
 * @param {number}  opts.direction  1 = avanza hacia la izquierda; -1 hacia la derecha
 * @param {boolean} opts.loop       bucle infinito + auto-avance (requiere contenido duplicado)
 */
export function useCarrusel({ speed = 42, direction = 1, loop = true } = {}) {
  const ref = useRef(null)
  const S = useRef({
    pos: 0, half: 0, loopable: false,
    paused: false, dragging: false, dragged: false,
    startX: 0, startLeft: 0,
    tween: null, raf: null, last: 0, visible: true,
    reduce: false,
  })

  /* Normaliza una posición al rango [0, half) — el bucle perfecto. */
  const wrap = (x, half) => ((x % half) + half) % half

  /* Escribe la posición lógica en el scroll real del contenedor. */
  const aplicar = useCallback(() => {
    const el = ref.current
    const s = S.current
    if (!el) return
    if (s.loopable) el.scrollLeft = wrap(s.pos, s.half)
    else el.scrollLeft = Math.max(0, Math.min(s.pos, s.half)) // half = scroll máximo
  }, [])

  const medir = useCallback(() => {
    const el = ref.current
    const s = S.current
    if (!el) return
    if (loop) {
      s.half = el.scrollWidth / 2
      // Solo hay bucle real si una copia desborda el ancho visible; si todo
      // cabe, la matemática del wrap no aplica y caemos a scroll acotado.
      s.loopable = s.half > el.clientWidth + 1
    } else {
      s.half = el.scrollWidth - el.clientWidth
      s.loopable = false
    }
  }, [loop])

  /* ── Bucle de animación (auto-avance + tween de las flechas) ──────────── */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    S.current.reduce = prefiereMenosMovimiento()
    medir()

    const tick = (t) => {
      const s = S.current
      if (!s.last) s.last = t
      const dt = Math.min((t - s.last) / 1000, 0.05) // acota saltos al volver de pestaña oculta
      s.last = t

      if (s.tween) {
        const p = Math.min(1, (t - s.tween.t0) / s.tween.dur)
        const e = 1 - Math.pow(1 - p, 4) // easeOutQuart
        s.pos = s.tween.from + (s.tween.to - s.tween.from) * e
        aplicar()
        if (p >= 1) { s.tween = null; s.last = 0 }
      } else if (
        s.loopable && !s.reduce && !s.paused && !s.dragging && s.visible
      ) {
        s.pos += direction * speed * dt
        aplicar()
      } else {
        // Inactivo: seguimos la posición nativa para que el scroll táctil o de
        // rueda del usuario no dé un salto al reanudar el auto-avance.
        s.pos = el.scrollLeft
      }
      s.raf = requestAnimationFrame(tick)
    }
    S.current.raf = requestAnimationFrame(tick)

    // Pausa el auto-avance cuando la cinta no está en pantalla (CPU/batería).
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => { S.current.visible = entries.some((e) => e.isIntersecting) },
        { threshold: 0.01 }
      )
      io.observe(el)
    }

    const onResize = () => medir()
    window.addEventListener('resize', onResize)

    // Re-medir cuando cambia el contenido (cambio de profesión, filtros) o
    // cuando cargan las fuentes web y varían los anchos — el track (primer hijo)
    // cambia de tamaño aunque el contenedor no.
    let ro = null
    if ('ResizeObserver' in window && el.firstElementChild) {
      ro = new ResizeObserver(() => medir())
      ro.observe(el.firstElementChild)
    }

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMq = (e) => { S.current.reduce = e.matches }
    mq?.addEventListener?.('change', onMq)

    return () => {
      if (S.current.raf) cancelAnimationFrame(S.current.raf)
      if (io) io.disconnect()
      if (ro) ro.disconnect()
      window.removeEventListener('resize', onResize)
      mq?.removeEventListener?.('change', onMq)
    }
  }, [aplicar, medir, direction, speed])

  /* ── Arrastre con el puntero ──────────────────────────────────────────── */
  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = ref.current
    const s = S.current
    if (!el) return
    s.dragging = true
    s.dragged = false
    s.startX = e.clientX
    s.startLeft = el.scrollLeft
    s.tween = null
    try { el.setPointerCapture(e.pointerId) } catch { /* noop */ }
  }, [])

  const onPointerMove = useCallback((e) => {
    const el = ref.current
    const s = S.current
    if (!el || !s.dragging) return
    const dx = e.clientX - s.startX
    if (Math.abs(dx) > 4) s.dragged = true
    let left = s.startLeft - dx
    if (s.loopable) left = wrap(left, s.half)
    else left = Math.max(0, Math.min(left, s.half))
    el.scrollLeft = left
    s.pos = left
  }, [])

  const onPointerUp = useCallback((e) => {
    const el = ref.current
    const s = S.current
    s.dragging = false
    if (el) {
      try { el.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      s.pos = el.scrollLeft
    }
  }, [])

  // Un arrastre real no debe disparar el click del hijo (abrir una tarjeta).
  const onClickCapture = useCallback((e) => {
    const s = S.current
    if (s.dragged) {
      e.preventDefault()
      e.stopPropagation()
      s.dragged = false
    }
  }, [])

  // El auto-avance NO se pausa al pasar el mouse: debe seguir moviéndose aunque
  // el cursor quede encima mientras se hace scroll de la página. Solo se pausa
  // al enfocar con teclado (para poder activar una tarjeta) y durante el arrastre.
  const onFocusCapture = useCallback(() => { S.current.paused = true }, [])
  const onBlurCapture = useCallback(() => { S.current.paused = false }, [])

  /* ── Flechas ──────────────────────────────────────────────────────────── */
  const step = useCallback((dir) => {
    const el = ref.current
    const s = S.current
    if (!el) return
    const amt = Math.round(el.clientWidth * 0.82) * dir
    if (s.loopable) {
      // Tween sobre la posición lógica → bucle sin salto.
      s.pos = el.scrollLeft
      s.tween = { from: s.pos, to: s.pos + amt, t0: performance.now(), dur: s.reduce ? 1 : 480 }
    } else {
      el.scrollBy({ left: amt, behavior: s.reduce ? 'auto' : 'smooth' })
    }
  }, [])

  return {
    scrollerRef: ref,
    step,
    handlers: {
      onPointerDown, onPointerMove, onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      onFocusCapture, onBlurCapture,
    },
  }
}
