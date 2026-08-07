import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import styles from './ConfirmDialog.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   ConfirmDialog — diálogo de confirmación reutilizable del panel admin.
   Mismo lenguaje visual que el resto de modales: tarjeta blanca, título Cinzel
   centrado, texto centrado y botones tipo píldora (Cancelar + acción).
   Portaleado a <body> para no depender del contexto de apilamiento del panel.

   Props: open, title, message, confirmLabel, tone ('danger'|'gold'|'primary'),
          busy, onConfirm, onClose.
   ───────────────────────────────────────────────────────────────────────── */
export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirmar',
  tone = 'danger', busy = false, onConfirm, onClose,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, busy, onClose])

  const toneClass = tone === 'gold' ? styles.gold : tone === 'primary' ? styles.primary : styles.danger

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          onClick={() => !busy && onClose?.()}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className={styles.modal}
            role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.text}>{message}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>Cancelar</button>
              <button type="button" className={`${styles.confirm} ${toneClass}`} onClick={onConfirm} disabled={busy}>
                {busy ? 'Aplicando…' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
