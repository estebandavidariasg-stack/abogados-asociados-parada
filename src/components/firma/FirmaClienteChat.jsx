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

  async function firmar(signedBytes, pie, firmaPng) {
    const res = await persistirFirma({
      solicitud: { id: firma.solicitudId, doc_original_path: firma.docPath },
      firmante: { id: firma.firmanteId },
      signedBytes, pie, headers: anonHeaders(),
    })

    let docPath = res?.docFirmadoPath || firma.docPath
    let certPath = null

    // Al completar la firma: generar el DOCUMENTO en Word (firma movible) y el
    // CERTIFICADO en PDF aparte. Todo el peso (docx, pdf.js) baja aquí, no en
    // el bundle público. Si algo falla, queda el PDF estampado como respaldo.
    if (res?.completa && bytes) {
      try {
        const [{ rasterizarPdf }, { generarWordFirma }, { generarCertificadoPdf, hashDocumento }] = await Promise.all([
          import('../../lib/pdfARaster'),
          import('../../lib/firmaWord'),
          import('../../lib/firmaPdf'),
        ])
        const paginas = await rasterizarPdf(bytes)
        const wordBlob = await generarWordFirma({ paginas, firmaPngDataUrl: firmaPng, pie })
        const wordBytes = new Uint8Array(await wordBlob.arrayBuffer())
        const wordPath = `${firma.solicitudId}/documento.docx`
        await subirDoc(wordPath, wordBytes, anonHeaders(),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

        const certBytes = await generarCertificadoPdf({
          solicitudId: firma.solicitudId,
          docHash: await hashDocumento(wordBytes),
          firmantes: (res.firmantes || []).map((f) => ({
            nombre: f.nombre, cedula: f.cedula, correo: f.correo, rol: f.rol_firma,
            firmado_at: f.firmado_at, ip: f.ip, user_agent: f.user_agent,
          })),
        })
        certPath = `${firma.solicitudId}/certificado.pdf`
        await subirDoc(certPath, certBytes, anonHeaders(), 'application/pdf')

        await cerrarSolicitud(firma.solicitudId, wordPath, anonHeaders())
        docPath = wordPath
      } catch (e) { console.error('[firma word/cert]', e?.message || e) }
    }

    // Avisar en el hilo del chat que el cliente firmó (el profesional recibe el
    // toast por realtime y puede descargar el documento Word + certificado).
    if (roomId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
          method: 'POST',
          headers: anonHeaders(),
          body: JSON.stringify({
            room_id: roomId,
            sender_type: 'client',
            content: JSON.stringify({ t: 'firma_ok', solicitudId: firma.solicitudId, docPath, certPath }),
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
        <div style={card}><span style={{ color: '#4a6080' }}>Cargando documento…</span></div>
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

const overlay = { position: 'fixed', inset: 0, zIndex: 10001, display: 'grid', placeItems: 'center', background: 'rgba(8,24,51,0.55)', backdropFilter: 'blur(4px)' }
const card = { background: '#faf7f2', borderRadius: 14, padding: '1.6rem', display: 'grid', gap: '1rem', placeItems: 'center', boxShadow: '0 24px 70px -20px rgba(8,24,51,0.55)' }
const btn = { padding: '0.55rem 1.3rem', border: 'none', borderRadius: 9, background: '#0d2d5e', color: '#fff', fontWeight: 700, cursor: 'pointer' }
