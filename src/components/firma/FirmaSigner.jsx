import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { estamparFirma, ROL_LABEL } from '../../lib/firmaPdf'
import styles from './FirmaSigner.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   FirmaSigner — experiencia de firma electrónica (modal, 4 pasos):
     1) Revisar el documento
     2) Verificar identidad (OTP de 6 dígitos al correo)
     3) Dibujar la firma + completar el pie de firma
     4) Confirmar → estampa el PDF y entrega los bytes firmados al padre

   Es puro (UI + motor). NO persiste: el padre recibe onComplete(signedBytes, pie)
   y decide dónde guardar (Contratos o chat). Reutilizable en ambos flujos.

   Props:
     pdfBytes    Uint8Array del PDF a firmar (ya convertido si venía de Word)
     firmante    prefill { nombre, cedula, telefono, correo, ciudad, rol }
     onComplete  (signedBytes: Uint8Array, pie) => Promise|void
     onCancel    () => void
     posicion    { x, y, pagina } opcional para ubicar la firma
   ───────────────────────────────────────────────────────────────────────── */

const PASOS = ['Revisar', 'Verificar', 'Firmar', 'Listo']

export default function FirmaSigner({ pdfBytes, firmante = {}, onComplete, onCancel, posicion, initialStep = 0 }) {
  const [paso, setPaso] = useState(initialStep)
  const [pdfUrl, setPdfUrl] = useState('')
  const [error, setError] = useState('')

  // Blob URL para previsualizar el documento.
  useEffect(() => {
    if (!pdfBytes) return
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfBytes])

  // Cerrar con Escape.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  // Portal a document.body: escapa el stacking context del perfil (la barra
  // lateral tiene backdrop-filter + z-index propio y, sin portal, quedaba encima).
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Firmar documento" onMouseDown={onCancel}>
      <div className={`${styles.modal} ${(paso === 1 || paso === 3) ? styles.modalNarrow : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>Firma electrónica</h2>
            <p className={styles.sub}>Ley 527 de 1999 · sin costo</p>
          </div>
          <button className={styles.close} onClick={onCancel} aria-label="Cerrar">✕</button>
        </header>

        <Stepper paso={paso} />

        {error && <div className={styles.errBar} role="alert">{error}</div>}

        {paso === 0 && (
          <PasoRevisar pdfUrl={pdfUrl} onNext={() => { setError(''); setPaso(1) }} onCancel={onCancel} />
        )}
        {paso === 1 && (
          <PasoOtp
            correo={firmante.correo}
            onError={setError}
            onVerified={() => { setError(''); setPaso(2) }}
            onBack={() => setPaso(0)}
          />
        )}
        {paso === 2 && (
          <PasoFirmar
            firmante={firmante}
            pdfBytes={pdfBytes}
            posicion={posicion}
            onError={setError}
            onDone={async (signedBytes, pie, firmaPng) => {
              setError('')
              setPaso(3)
              try { await onComplete?.(signedBytes, pie, firmaPng) }
              catch (e) { setError(e?.message || 'No se pudo guardar el documento firmado.'); setPaso(2) }
            }}
            onBack={() => setPaso(1)}
          />
        )}
        {paso === 3 && <PasoListo onCancel={onCancel} />}
      </div>
    </div>,
    document.body
  )
}

/* ── Indicador de pasos ──────────────────────────────────────────────────── */
function Stepper({ paso }) {
  return (
    <ol className={styles.stepper}>
      {PASOS.map((p, i) => (
        <li key={p} className={`${styles.step} ${i === paso ? styles.stepOn : ''} ${i < paso ? styles.stepDone : ''}`}>
          <span className={styles.stepDot}>{i < paso ? '✓' : i + 1}</span>
          <span className={styles.stepLabel}>{p}</span>
        </li>
      ))}
    </ol>
  )
}

/* ── Paso 1 · Revisar ─────────────────────────────────────────────────────── */
function PasoRevisar({ pdfUrl, onNext, onCancel }) {
  return (
    <div className={styles.body}>
      <p className={styles.lead}>Revisa el documento antes de firmar. Al continuar, aceptas firmarlo electrónicamente.</p>
      <div className={styles.viewer}>
        {pdfUrl
          ? <iframe title="Documento a firmar" src={`${pdfUrl}#zoom=page-width`} className={styles.frame} />
          : <div className={styles.viewerLoad}><span className={styles.spinner} /> Cargando documento…</div>}
      </div>
      <div className={styles.actions}>
        <button className={styles.btnGhost} onClick={onCancel}>Cancelar</button>
        <button className={styles.btnSolid} onClick={onNext} disabled={!pdfUrl}>Continuar a firmar</button>
      </div>
    </div>
  )
}

/* ── Paso 2 · OTP ─────────────────────────────────────────────────────────── */
function PasoOtp({ correo, onVerified, onBack, onError }) {
  const [sending, setSending] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Envía el OTP al correo. Sin captcha: el flujo lo inicia un profesional
  // autenticado y ya está limitado por rate-limit (3/10min) + el propio OTP.
  const enviar = useCallback(async () => {
    if (!correo) { onError('No hay un correo para verificar.'); return }
    setSending(true); onError('')
    try {
      const r = await fetch('/api/send-verification-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: correo, tipoRegistro: 'firma' }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d?.error || 'No se pudo enviar el código.')
      }
      setCooldown(60)
    } catch (err) { onError(err.message || 'No se pudo enviar el código. Intenta de nuevo.') }
    finally { setSending(false) }
  }, [correo, onError])

  // Enviar automáticamente al entrar al paso.
  useEffect(() => { enviar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function verificar(e) {
    e?.preventDefault()
    if (code.length !== 6) return
    setChecking(true); onError('')
    try {
      const r = await fetch('/api/verify-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: correo, code }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || data?.success === false) throw new Error(data?.error || 'Código inválido o expirado')
      onVerified()
    } catch (err) { onError(err.message || 'Código inválido o expirado') }
    finally { setChecking(false) }
  }

  return (
    <form className={`${styles.body} ${styles.otpStep}`} onSubmit={verificar}>
      <p className={styles.lead}>
        Enviamos un código de 6 dígitos a <strong>{correo || 'tu correo'}</strong>. Ingrésalo para confirmar tu identidad.
      </p>
      <OtpInput value={code} onChange={setCode} disabled={checking} />
      <div className={styles.resendRow}>
        {cooldown > 0
          ? <span className={styles.resendMuted}>{sending ? <><span className={styles.spinner} /> Enviando…</> : `Podrás reenviar en ${cooldown}s`}</span>
          : <button type="button" className={styles.linkBtn} onClick={enviar} disabled={sending}>
              {sending ? 'Enviando…' : 'Reenviar código'}
            </button>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.btnGhost} onClick={onBack}>Atrás</button>
        <button type="submit" className={styles.btnSolid} disabled={code.length !== 6 || checking}>
          {checking ? 'Verificando…' : 'Verificar'}
        </button>
      </div>
    </form>
  )
}

function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([])
  const set = (i, ch) => {
    const digits = value.split('')
    digits[i] = ch
    const next = digits.join('').slice(0, 6)
    onChange(next)
    if (ch && refs.current[i + 1]) refs.current[i + 1].focus()
  }
  return (
    <div className={styles.otp} onPaste={(e) => {
      const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
      if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus() }
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i} ref={(el) => (refs.current[i] = el)}
          className={styles.otpCell} inputMode="numeric" maxLength={1} disabled={disabled}
          value={value[i] || ''}
          onChange={(e) => set(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && refs.current[i - 1]) refs.current[i - 1].focus() }}
          aria-label={`Dígito ${i + 1}`}
        />
      ))}
    </div>
  )
}

/* ── Paso 3 · Firmar (lienzo + pie de firma) ──────────────────────────────── */
function PasoFirmar({ firmante, pdfBytes, posicion, onDone, onBack, onError }) {
  const [pie, setPie] = useState({
    nombre: firmante.nombre || '', cedula: firmante.cedula || '',
    telefono: firmante.telefono || '', correo: firmante.correo || '',
    ciudad: firmante.ciudad || '', rol: firmante.rol || 'cliente',
  })
  const [firmaPng, setFirmaPng] = useState(null)
  const [firmando, setFirmando] = useState(false)
  const rolFijo = !!firmante.rol

  const upd = (k) => (e) => setPie((p) => ({ ...p, [k]: e.target.value }))
  const completo = pie.nombre && pie.cedula && pie.telefono && pie.correo && pie.ciudad && firmaPng

  async function firmar() {
    if (!completo) { onError('Completa todos los campos y dibuja tu firma.'); return }
    setFirmando(true); onError('')
    try {
      const signed = await estamparFirma(pdfBytes, {
        firmaPng,
        pie: { ...pie, fecha: new Date().toISOString() },
        posicion: posicion || {},
      })
      await onDone(signed, { ...pie, fecha: new Date().toISOString() }, firmaPng)
    } catch (e) {
      onError(e?.message || 'No se pudo estampar la firma.')
      setFirmando(false)
    }
  }

  return (
    <div className={styles.body}>
      <div className={styles.signGrid}>
        <div>
          <label className={styles.fieldLabel}>Tu firma</label>
          <SignaturePad onChange={setFirmaPng} />
        </div>
        <div className={styles.pieForm}>
          <label className={styles.fieldLabel}>Datos del pie de firma</label>
          <Field label="Nombre completo" value={pie.nombre} onChange={upd('nombre')} />
          <div className={styles.row2}>
            <Field label="Cédula" value={pie.cedula} onChange={upd('cedula')} inputMode="numeric" />
            <Field label="Teléfono" value={pie.telefono} onChange={upd('telefono')} inputMode="tel" />
          </div>
          <Field label="Correo" value={pie.correo} onChange={upd('correo')} type="email" />
          <div className={styles.row2}>
            <Field label="Ciudad" value={pie.ciudad} onChange={upd('ciudad')} placeholder="Ej: Bogotá D.C." />
            <div className={styles.field}>
              <label className={styles.fieldLabel}>En calidad de</label>
              {rolFijo
                ? <input className={styles.input} value={ROL_LABEL[pie.rol] || pie.rol} disabled />
                : <select className={styles.input} value={pie.rol} onChange={upd('rol')}>
                    {Object.entries(ROL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.btnGhost} onClick={onBack} disabled={firmando}>Atrás</button>
        <button className={styles.btnSolid} onClick={firmar} disabled={!completo || firmando}>
          {firmando ? 'Firmando…' : 'Firmar documento'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, ...rest }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <input className={styles.input} {...rest} />
    </div>
  )
}

/* Lienzo de firma con puntero/touch. Exporta PNG recortado y detecta vacío. */
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Mide el canvas y fija el trazo. Idempotente: se puede llamar varias veces.
    // NO re-inicializa si ya hay firma dibujada (borraría el canvas).
    const setup = () => {
      if (dirty.current) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0d2d5e'
    }

    // Medir DESPUÉS de que el modal termine su animación de ancho/entrada.
    const raf = requestAnimationFrame(() => requestAnimationFrame(setup))
    // Re-medir si el modal cambia de tamaño (transición de ancho entre pasos).
    const ro = new ResizeObserver(setup)
    ro.observe(canvas)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const t = e.touches?.[0] || e
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
  }
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y) }
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true }
  const end = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(canvasRef.current.toDataURL('image/png')) }

  const limpiar = () => {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    dirty.current = false
    onChange(null)
  }

  return (
    <div className={styles.padWrap}>
      <canvas
        ref={canvasRef} className={styles.pad}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div className={styles.padFoot}>
        <span className={styles.padHint}>Dibuja tu firma con el mouse o el dedo</span>
        <button type="button" className={styles.linkBtn} onClick={limpiar}>Borrar</button>
      </div>
    </div>
  )
}

/* ── Paso 4 · Listo ───────────────────────────────────────────────────────── */
function PasoListo({ onCancel }) {
  return (
    <div className={`${styles.body} ${styles.done}`}>
      <div className={styles.doneMark} aria-hidden="true">✓</div>
      <h3 className={styles.doneTitle}>Documento firmado</h3>
      <p className={styles.lead}>
        Tu firma quedó estampada con el pie de firma y un certificado de auditoría. El documento firmado ya está guardado.
      </p>
      <div className={styles.actions}>
        <button className={styles.btnSolid} onClick={onCancel}>Cerrar</button>
      </div>
    </div>
  )
}
