import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { anonHeaders, bytesDeDoc, persistirFirma, subirDoc, cerrarSolicitud } from '../../lib/firmaService'
import FirmaSigner from './FirmaSigner'

/* ─────────────────────────────────────────────────────────────────────────
   FirmaClienteChat — firma del CLIENTE anónimo desde el hilo del chat.

   Se carga con React.lazy desde ChatSection, así todo el peso (pdf-lib,
   recaptcha) queda fuera del bundle público del home y solo baja cuando el
   cliente decide firmar.

   Props: firma = { solicitudId, docPath, firmanteId, correo }
          onClose(), onDone()
   ───────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export default function FirmaClienteChat({ firma, roomId, onClose, onDone }) {
  const [bytes, setBytes] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const b = await bytesDeDoc(firma.docPath, anonHeaders())
        if (!cancel) setBytes(b)
      } catch (e) {
        if (!cancel) setError(e?.message || 'No se pudo cargar el documento.')
      }
    })()
    return () => { cancel = true }
  }, [firma.docPath])

  async function firmar(signedBytes, pie, firmaPng, firmaProof) {
    const res = await persistirFirma({
      solicitud: { id: firma.solicitudId, doc_original_path: firma.docPath },
      firmante: { id: firma.firmanteId },
      signedBytes, pie, firmaProof, headers: anonHeaders(),
    })

    // Guardamos el PNG de la firma (para que el profesional la ubique luego y
    // exporte el PDF) y el certificado aparte. El documento se estampa al momento
    // de descargar, en la posición que elija el profesional (ver UbicarFirma).
    const firmaPath = `${firma.solicitudId}/firma.png`
    if (res?.completa) {
      try {
        // firmaPng es un dataURL PNG del lienzo → bytes.
        const b64 = String(firmaPng || '').split(',')[1] || ''
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k)
        await subirDoc(firmaPath, arr, anonHeaders(), 'image/png')
      } catch (e) { console.error('[firma png]', e?.message || e) }
    }

    // Avisar en el hilo: el profesional podrá ubicar la firma y descargar el PDF.
    if (roomId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
          method: 'POST',
          headers: anonHeaders(),
          body: JSON.stringify({
            room_id: roomId,
            sender_type: 'client',
            content: JSON.stringify({
              t: 'firma_ok', solicitudId: firma.solicitudId,
              origPath: firma.docPath, firmaPath, pie,
            }),
            message_type: 'firma_ok',
          }),
        })
      } catch { /* best-effort */ }
    }
    onDone?.()
  }

  if (error) {
    return createPortal(
      <div style={overlay} onMouseDown={onClose}>
        <div style={card} onMouseDown={(e) => e.stopPropagation()}>
          <p style={{ color: '#9a2b2b', margin: 0 }}>{error}</p>
          <button style={btn} onClick={onClose}>Cerrar</button>
        </div>
      </div>,
      document.body
    )
  }
  if (!bytes) {
    return createPortal(
      <div style={overlay}>
        <div style={card}><span style={{ color: '#6f5c48' }}>Cargando documento…</span></div>
      </div>,
      document.body
    )
  }
  return (
    <FirmaSigner
      pdfBytes={bytes}
      firmante={{ correo: firma.correo || '', rol: 'cliente' }}
      onComplete={firmar}
      onCancel={onClose}
    />
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 10001, display: 'grid', placeItems: 'center', background: 'rgba(51, 28, 8,0.55)', backdropFilter: 'blur(4px)' }
const card = { background: '#faf7f2', borderRadius: 14, padding: '1.6rem', display: 'grid', gap: '1rem', placeItems: 'center', boxShadow: '0 24px 70px -20px rgba(51, 28, 8,0.55)' }
const btn = { padding: '0.55rem 1.3rem', border: 'none', borderRadius: 9, background: '#6d3c1b', color: '#fff', fontWeight: 700, cursor: 'pointer' }
