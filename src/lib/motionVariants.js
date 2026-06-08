// Shared framer-motion variants for the homepage.
// All animations: ease-out-expo curves, no bounce/elastic.

export const EASE = [0.16, 1, 0.3, 1]  // ease-out-expo

// ── Eyebrow: wipe in from left with clip-path ─────────────────────
export const eyebrowReveal = {
  hidden: { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
  visible: {
    opacity: 1,
    clipPath: 'inset(0 0% 0 0)',
    transition: { duration: 0.6, ease: EASE },
  },
}

// ── Standard heading rise ─────────────────────────────────────────
export const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

// ── Premium: heading fades in while blur clears (CTA only) ────────
export const blurReveal = {
  hidden: { opacity: 0, y: 18, filter: 'blur(12px)' },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: 0.95, ease: EASE },
  },
}

// ── Scale in (buttons, small elements) ───────────────────────────
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: EASE } },
}

// ── Section header stagger wrapper ───────────────────────────────
export const headerStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.13 } },
}

// ── Card grid stagger wrapper ─────────────────────────────────────
export const gridStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

// ── Individual card entrance ──────────────────────────────────────
export const cardReveal = {
  hidden: { opacity: 0, y: 26, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.52, ease: EASE },
  },
}

// ── Viewport preset (fire once, when 20% visible) ────────────────
export const VIEWPORT = { once: true, amount: 0.2 }
