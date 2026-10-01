import { useState, useEffect, useRef } from 'react'

/* ────────────────────────────────────────────────────────────────────────
   Pantalla de verificación de código (Paso B del flujo de registro).
   Compartida por AuthModal, el RegisterModal unificado (abogado/contador/gestor)
   y el gate de voto de proyectos de ley.

   Props:
     · email       — para mostrar enmascarado en el subtítulo
     · error       — string mostrado bajo los inputs (lo gestiona el padre)
     · submitting  — hay una verificación en curso: las casillas laten una
                     tras otra y el botón muestra un indicador de carga
     · verificado  — el código ya fue aceptado y el padre sigue trabajando
                     (crear la consulta, la cuenta…): casillas en verde,
                     "Código correcto" y el botón con `textoVerificado`.
                     Opcional: sin él, el paso se comporta como siempre.
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
    color: #604d3d;
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
    background-color: #2a1b0d;
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
    color: #2a1b0d;
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
  /* ── Carga ──────────────────────────────────────────────────────────
     Entre pulsar Verificar y la pantalla siguiente pasan uno o varios
     segundos (comprobar el código y luego crear la consulta o la cuenta).
     Sin señal, la persona vuelve a pulsar o cree que se colgó. */
  .aap-otp-row--cargando .aap-otp-input:disabled { opacity: 1; cursor: progress; }
  .aap-otp-row--verificando .aap-otp-input {
    animation: aapOtpLatido 1.1s cubic-bezier(0.22, 1, 0.36, 1) infinite;
    animation-delay: calc(var(--i) * 90ms);
  }
  @keyframes aapOtpLatido {
    0%, 55%, 100% { border-color: rgba(201, 168, 76, 0.4); box-shadow: none; transform: none; }
    25% { border-color: #c9a84c; box-shadow: 0 0 12px rgba(201, 168, 76, 0.55); transform: translateY(-2px); }
  }
  .aap-otp-row--ok .aap-otp-input {
    border-color: #3fa866;
    box-shadow: 0 0 0 3px rgba(63, 168, 102, 0.18);
    transition: border-color 260ms ease-out, box-shadow 260ms ease-out;
  }
  .aap-verify-ok {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; color: #2c8a52; font-weight: 700;
    animation: aapOtpOk 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes aapOtpOk { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  /* Cargando: una sola línea, con el indicador pegado al texto. Las frases
     de carga son más largas que "Verificar": letra un punto más chica y
     menos espaciada para que quepan en el celular sin partirse. */
  .aap-verify-submit[data-cargando="true"] {
    opacity: 1; cursor: progress;
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    white-space: nowrap;
    font-size: clamp(0.74rem, 3.5vw, 0.86rem);
    letter-spacing: 0.04em;
  }
  .aap-verify-spinner {
    width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
    border: 2px solid rgba(42, 27, 13, 0.25); border-top-color: #2a1b0d;
    animation: aapOtpGiro 0.7s linear infinite;
  }
  @keyframes aapOtpGiro { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .aap-otp-row--verificando .aap-otp-input, .aap-verify-ok { animation: none; }
    .aap-otp-row--verificando .aap-otp-input { border-color: #c9a84c; }
    .aap-verify-spinner { animation-duration: 1.6s; }
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
  /* Corregir el correo sin salir del paso. Va en voz baja bajo la direccion:
     es una salida para la errata, no una accion principal que compita con
     escribir el codigo. */
  .aap-verify-edit {
    color: #8a6a28;
    margin-top: 6px;
    font-size: 0.76rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .aap-verify-edit:hover { color: #6d3c1b; }

  .aap-verify-edit-box {
    margin: 10px auto 14px;
    max-width: 320px;
    text-align: left;
  }
  .aap-verify-edit-label {
    display: block;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #7d6046;
    margin-bottom: 5px;
  }
  .aap-verify-edit-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid rgba(109, 60, 27, 0.22);
    border-radius: 10px;
    background: #fff;
    font-family: 'Poppins', sans-serif;
    /* 16px exactos, no menos: por debajo, Safari de iOS hace zoom al enfocar
       el campo y descoloca el modal. */
    font-size: 16px;
    color: #472f29;
  }
  .aap-verify-edit-input:focus {
    outline: none;
    border-color: #c9a84c;
    box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.18);
  }
  .aap-verify-edit-err {
    display: block;
    margin-top: 5px;
    font-size: 0.72rem;
    color: #a23b3b;
  }
  .aap-verify-edit-acciones {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
  }
  .aap-verify-edit-enviar {
    padding: 9px 16px;
    border: none;
    border-radius: 9px;
    background: #6d3c1b;
    color: #fff;
    font-family: 'Poppins', sans-serif;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .aap-verify-edit-enviar:disabled { opacity: 0.55; cursor: default; }
  .aap-verify-resend { color: #c9a84c; font-weight: 600; }

  @media (max-width: 480px) {
    .aap-otp-row    { gap: 8px; }
    .aap-otp-input  { width: 40px; height: 50px; font-size: 22px; }
    .aap-verify-wrap{ padding: 4px 4px 8px; }
    /* El editor ocupa el ancho y sus acciones se apilan, con el boton
       primero: es la accion, y asi queda bajo el pulgar. */
    .aap-verify-edit-box { max-width: none; }
    .aap-verify-edit-acciones {
      flex-direction: column-reverse;
      align-items: stretch;
      gap: 8px;
    }
    .aap-verify-edit-enviar { width: 100%; padding: 12px 16px; }
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
  verificado = false,
  textoVerificado = 'Un momento…',
  onSubmit,
  onResend,
  onBack,
  // Corregir SOLO el correo sin salir del paso: el caso real es la errata
  // que se descubre al no recibir nada. Devuelve promesa; reenvia el codigo.
  onCambiarCorreo,
}) {
  const [digits, setDigits]     = useState(['', '', '', '', '', ''])
  const [resendIn, setResendIn] = useState(60)   // 60s desde el primer envío
  const [resending, setResending] = useState(false)
  const [editando, setEditando]   = useState(false)
  const [correoNuevo, setCorreoNuevo] = useState(email)
  const [errCorreo, setErrCorreo] = useState('')
  const [enviandoCorreo, setEnviandoCorreo] = useState(false)
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
  const cargando  = submitting || verificado
  const canSubmit = code.length === 6 && !cargando

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
        <h3 className="aap-verify-title">Verifica Tu Correo</h3>
        {!editando ? (
          <p className="aap-verify-subtitle">
            Ingresa el código de 6 dígitos que enviamos a{' '}
            <strong>{email}</strong>
            {onCambiarCorreo && (
              <>
                <br />
                <button
                  type="button"
                  className="aap-verify-link aap-verify-edit"
                  onClick={() => { setCorreoNuevo(email); setErrCorreo(''); setEditando(true) }}
                  disabled={submitting}
                >
                  ¿Lo escribiste mal? Corregir correo
                </button>
              </>
            )}
          </p>
        ) : (
          <div className="aap-verify-edit-box">
            <label className="aap-verify-edit-label" htmlFor="aapNuevoCorreo">Corrige tu correo</label>
            <input
              id="aapNuevoCorreo"
              type="email"
              className="aap-verify-edit-input"
              value={correoNuevo}
              onChange={(e) => { setCorreoNuevo(e.target.value); setErrCorreo('') }}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              disabled={enviandoCorreo}
            />
            {errCorreo && <span className="aap-verify-edit-err">{errCorreo}</span>}
            <div className="aap-verify-edit-acciones">
              <button
                type="button"
                className="aap-verify-link"
                onClick={() => setEditando(false)}
                disabled={enviandoCorreo}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="aap-verify-edit-enviar"
                disabled={enviandoCorreo || !correoNuevo.trim()}
                onClick={async () => {
                  setEnviandoCorreo(true); setErrCorreo('')
                  try {
                    await onCambiarCorreo(correoNuevo)
                    setDigits(['', '', '', '', '', ''])
                    setResendIn(60)
                    setEditando(false)
                    setTimeout(() => inputsRef.current[0]?.focus(), 0)
                  } catch (err) {
                    setErrCorreo(err?.message || 'No se pudo enviar el código')
                  } finally {
                    setEnviandoCorreo(false)
                  }
                }}
              >
                {enviandoCorreo ? 'Enviando…' : 'Enviar código'}
              </button>
            </div>
          </div>
        )}

        <div
          className={`aap-otp-row${cargando ? ' aap-otp-row--cargando' : ''}${verificado ? ' aap-otp-row--ok' : submitting ? ' aap-otp-row--verificando' : ''}`}
          onPaste={handlePaste}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => (inputsRef.current[i] = el)}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={d}
              disabled={cargando}
              className="aap-otp-input"
              style={{ '--i': i }}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onFocus={e => e.target.select()}
              aria-label={`Dígito ${i + 1} de 6`}
            />
          ))}
        </div>

        {/* Una sola línea para el resultado: error o "Código correcto". */}
        <p className="aap-verify-error" role="status" aria-live="polite">
          {verificado ? (
            <span className="aap-verify-ok">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Código correcto
            </span>
          ) : (error || ' ')}
        </p>

        <button
          type="button"
          className="aap-verify-submit"
          disabled={!canSubmit}
          data-cargando={cargando ? 'true' : undefined}
          aria-busy={cargando || undefined}
          onClick={() => onSubmit?.(code)}
        >
          {cargando && <span className="aap-verify-spinner" aria-hidden="true" />}
          {verificado ? textoVerificado : submitting ? 'Verificando código…' : 'Verificar'}
        </button>

        <div className="aap-verify-footer">
          <button
            type="button"
            className="aap-verify-link aap-verify-back"
            onClick={onBack}
            disabled={cargando}
          >
            ← Volver
          </button>
          <button
            type="button"
            className="aap-verify-link aap-verify-resend"
            onClick={handleResend}
            disabled={resendIn > 0 || resending || cargando}
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
