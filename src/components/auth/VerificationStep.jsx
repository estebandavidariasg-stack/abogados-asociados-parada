import { useState, useEffect, useRef } from 'react'

/* ────────────────────────────────────────────────────────────────────────
   Pantalla de verificación de código (Paso B del flujo de registro).
   Compartida entre AuthModal (abogados) y RegisterContadorModal.

   Props:
     · email       — para mostrar enmascarado en el subtítulo
     · error       — string mostrado bajo los inputs (lo gestiona el padre)
     · submitting  — deshabilita el botón "Verificar"
     · onSubmit    — (code: string) => void  — invocado al pulsar Verificar
     · onResend    — () => Promise<void>     — el padre re-llama al endpoint
     · onBack      — () => void              — vuelve al formulario

   Estilos: 100% inline vía un <style> embebido. NO toca los .module.css
   de los modales — el componente es autocontenido.
──────────────────────────────────────────────────────────────────────── */

const VERIFY_STYLES = `
  .aap-verify-wrap {
    padding: 4px 0 8px;
    text-align: center;
  }
  .aap-verify-title {
    font-family: 'Cinzel', Georgia, serif;
    color: #c9a84c;
    font-size: 1.15rem;
    letter-spacing: 0.08em;
    margin: 0 0 8px;
    text-align: center;
  }
  .aap-verify-subtitle {
    color: #3d4a60;
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 24px;
    text-align: center;
    padding: 0 4px;
  }
  /* break-word evita el corte feo a media palabra que sí causaba
     break-all. La línea baja de bloque cuando no cabe pero no parte
     el email en pedazos. */
  .aap-verify-subtitle strong {
    color: #c9a84c;
    font-weight: 600;
    word-break: break-word;
    overflow-wrap: anywhere;
    display: inline-block;
    max-width: 100%;
  }
  .aap-otp-row {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 0 0 18px;
  }
  .aap-otp-input {
    width: 44px;
    height: 54px;
    text-align: center;
    font-size: 24px;
    font-weight: bold;
    color: #c9a84c;
    background-color: #0d1b2a;
    border: 2px solid rgba(201, 168, 76, 0.4);
    border-radius: 6px;
    outline: none;
    font-family: Georgia, 'Times New Roman', serif;
    transition: border-color 180ms ease, box-shadow 180ms ease;
    caret-color: #c9a84c;
  }
  .aap-otp-input:focus {
    border-color: rgba(201, 168, 76, 1);
    box-shadow: 0 0 8px rgba(201, 168, 76, 0.40);
  }
  .aap-otp-input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .aap-verify-error {
    color: rgba(220, 100, 80, 0.95);
    font-size: 0.78rem;
    margin: 0 0 14px;
    text-align: center;
    min-height: 1em;
  }
  .aap-verify-submit {
    width: 100%;
    min-height: 44px;
    padding: 12px 20px;
    background-color: #c9a84c;
    color: #0d1b2a;
    border: none;
    border-radius: 8px;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 0.95rem;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    transition: opacity 180ms ease, transform 120ms ease;
  }
  .aap-verify-submit:hover:not(:disabled) {
    opacity: 0.92;
  }
  .aap-verify-submit:active:not(:disabled) {
    transform: translateY(1px);
  }
  .aap-verify-submit:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .aap-verify-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    gap: 12px;
  }
  .aap-verify-link {
    background: none;
    border: none;
    padding: 6px 4px;
    font-family: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    transition: opacity 160ms ease;
  }
  .aap-verify-link:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .aap-verify-back  { color: #888888; }
  .aap-verify-resend { color: #c9a84c; font-weight: 600; }

  @media (max-width: 480px) {
    .aap-otp-row    { gap: 8px; }
    .aap-otp-input  { width: 40px; height: 50px; font-size: 22px; }
    .aap-verify-wrap{ padding: 4px 4px 8px; }
  }
`

function fmt(s) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function VerificationStep({
  email,
  error,
  submitting = false,
  onSubmit,
  onResend,
  onBack,
}) {
  const [digits, setDigits]     = useState(['', '', '', '', '', ''])
  const [resendIn, setResendIn] = useState(60)   // 60s desde el primer envío
  const [resending, setResending] = useState(false)
  const inputsRef = useRef([])

  // Focus inicial al montar
  useEffect(() => {
    inputsRef.current[0]?.focus()
  }, [])

  // Countdown del reenvío
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setInterval(() => setResendIn(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [resendIn])

  // Cuando el padre nos pasa un error nuevo (código inválido), limpiamos
  // los inputs y devolvemos focus al primero — UX típica de OTP.
  useEffect(() => {
    if (error) {
      setDigits(['', '', '', '', '', ''])
      setTimeout(() => inputsRef.current[0]?.focus(), 0)
    }
  }, [error])

  const code      = digits.join('')
  const canSubmit = code.length === 6 && !submitting

  function setDigit(idx, value) {
    setDigits(prev => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }

  function handleChange(idx, raw) {
    const digit = raw.replace(/\D/g, '').slice(0, 1)
    setDigit(idx, digit)
    if (digit && idx < 5) inputsRef.current[idx + 1]?.focus()
  }

  function handleKeyDown(idx, e) {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        setDigit(idx, '')
      } else if (idx > 0) {
        setDigit(idx - 1, '')
        inputsRef.current[idx - 1]?.focus()
      }
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault()
      inputsRef.current[idx - 1]?.focus()
    } else if (e.key === 'ArrowRight' && idx < 5) {
      e.preventDefault()
      inputsRef.current[idx + 1]?.focus()
    } else if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      onSubmit?.(code)
    }
  }

  // Pegar el código completo de un solo paste — UX importante en móvil
  function handlePaste(e) {
    const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    e.preventDefault()
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    const focusIdx = Math.min(pasted.length, 5)
    setTimeout(() => inputsRef.current[focusIdx]?.focus(), 0)
  }

  async function handleResend() {
    if (resendIn > 0 || resending || !onResend) return
    setResending(true)
    try {
      await onResend()
      setDigits(['', '', '', '', '', ''])
      setResendIn(60)
      setTimeout(() => inputsRef.current[0]?.focus(), 0)
    } catch {
      // El padre ya muestra el error — solo dejamos el countdown como está
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <style>{VERIFY_STYLES}</style>
      <div className="aap-verify-wrap">
        <h3 className="aap-verify-title">Verifica tu correo</h3>
        <p className="aap-verify-subtitle">
          Ingresa el código de 6 dígitos que enviamos a{' '}
          <strong>{email}</strong>
        </p>

        <div className="aap-otp-row" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => (inputsRef.current[i] = el)}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={d}
              disabled={submitting}
              className="aap-otp-input"
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onFocus={e => e.target.select()}
              aria-label={`Dígito ${i + 1} de 6`}
            />
          ))}
        </div>

        <p className="aap-verify-error">{error || ' '}</p>

        <button
          type="button"
          className="aap-verify-submit"
          disabled={!canSubmit}
          onClick={() => onSubmit?.(code)}
        >
          {submitting ? 'Verificando…' : 'Verificar'}
        </button>

        <div className="aap-verify-footer">
          <button
            type="button"
            className="aap-verify-link aap-verify-back"
            onClick={onBack}
            disabled={submitting}
          >
            ← Volver
          </button>
          <button
            type="button"
            className="aap-verify-link aap-verify-resend"
            onClick={handleResend}
            disabled={resendIn > 0 || resending || submitting}
          >
            {resending
              ? 'Enviando…'
              : resendIn > 0
                ? `Reenviar en ${fmt(resendIn)}`
                : 'Reenviar código'}
          </button>
        </div>
      </div>
    </>
  )
}
