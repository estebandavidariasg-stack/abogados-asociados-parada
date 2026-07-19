import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { listarEvidencia, urlFirmada } from '../../lib/firmaService'
import EnviarAFirmar from '../firma/EnviarAFirmar'
import { IconFirma, IconDoc, IconFolder, IconUpload, IconDownload } from '../shared/Icons'
import styles from './MisContratos.module.css'

// Papelera clara (estilo Lucide trash-2) — más legible que el icono base
const IconTrash = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const TIPOS_OK = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

function fmtBytes(b) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
function fmtFecha(ts) {
  if (!ts) return ''
  // Fecha + hora (ej: "15 jul 2026, 3:42 p. m.") — el equipo necesita saber
  // exactamente cuándo se subió el archivo y cuándo llegó el firmado.
  return new Date(ts).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Momento en que se recibió la evidencia firmada: el último firmante que firmó
// (o, si aún no consta, la fecha de creación de la solicitud).
function fechaFirmado(s) {
  const firmados = (s?.firmas_firmantes || [])
    .map(f => f?.firmado_at)
    .filter(Boolean)
    .sort()
  return firmados[firmados.length - 1] || s?.created_at
}

export default function MisContratos({ abogadoId, isSuperAdmin = false }) {
  const [contratos, setContratos]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [archivo, setArchivo]       = useState(null)
  const [descripcion, setDescripcion] = useState('')
  const fileRef = useRef()

  // ── Firma electrónica ──
  const [tab, setTab]               = useState('subidos') // subidos | clientes
  const [evidencia, setEvidencia]   = useState({ clientes: [], administracion: [] })
  const [enviarFirma, setEnviarFirma] = useState(null)     // contrato a firmar | {} nuevo

  useEffect(() => { if (abogadoId) { cargar(); cargarEvidencia() } }, [abogadoId])

  async function cargarEvidencia() {
    try {
      const headers = await getAuthHeaders()
      setEvidencia(await listarEvidencia(abogadoId, headers))
    } catch { /* tablas de firma aún no aplicadas: sección vacía */ }
  }

  // Abre el documento firmado ya compuesto (evidencia con la firma ubicada)
  // en una pestaña nueva, mintando una URL firmada fresca del bucket privado.
  async function verDocumento(s) {
    try {
      const headers = await getAuthHeaders()
      const url = await urlFirmada(s.doc_firmado_path, headers)
      if (!url) throw new Error('No se pudo obtener el documento firmado')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError('No se pudo abrir el documento firmado. ' + (e?.message || ''))
    }
  }

  // Genera el certificado de firma AL VUELO desde la traza de los firmantes y
  // lo descarga. Funciona para cualquier firma (no depende de un archivo previo).
  async function descargarCertificado(s) {
    try {
      const { generarCertificadoPdf } = await import('../../lib/firmaPdf')
      const firmantes = (s.firmas_firmantes || []).map((f) => ({
        nombre: f.nombre, cedula: f.cedula, correo: f.correo, rol: f.rol_firma,
        firmado_at: f.firmado_at, ip: f.ip, user_agent: f.user_agent,
      }))
      const bytes = await generarCertificadoPdf({
        solicitudId: s.id,
        docHash: s.firmas_firmantes?.find((f) => f.doc_hash)?.doc_hash || '',
        firmantes,
      })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'certificado-de-firma.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      setError('No se pudo generar el certificado. ' + (e?.message || ''))
    }
  }

  async function cargar() {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/contratos?abogado_id=eq.${abogadoId}&select=*&order=created_at.desc`,
        { headers }
      )
      const data = await res.json()
      setContratos(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!archivo) { setError('Selecciona un archivo'); return }
    if (!TIPOS_OK.includes(archivo.type)) {
      setError('Solo se permiten PDF, DOC o DOCX'); return
    }
    if (archivo.size > 10 * 1024 * 1024) {
      setError('El archivo no puede superar 10 MB'); return
    }
    setUploading(true); setError(''); setSuccess('')
    try {
      const headers = await getAuthHeaders()
      const ext  = archivo.name.split('.').pop()
      const path = `${abogadoId}/${Date.now()}.${ext}`

      // 1 — subir al storage
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/contratos/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': archivo.type }, body: archivo }
      )
      if (!upRes.ok) throw new Error('Error subiendo el archivo')

      // 2 — guardar registro
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/contratos`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          nombre_archivo: archivo.name,
          storage_path: path,
          abogado_id: abogadoId,
          descripcion,
          size_bytes: archivo.size,
        }),
      })
      if (!insRes.ok) throw new Error('Error guardando el registro')

      setSuccess('Contrato subido correctamente')
      setArchivo(null); setDescripcion(''); setShowForm(false)
      if (fileRef.current) fileRef.current.value = ''
      await cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function descargar(c) {
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/contratos/${c.storage_path}`,
      { method: 'POST', headers, body: JSON.stringify({ expiresIn: 3600 }) }
    )
    const data = await res.json()
    const url  = `${SUPABASE_URL}/storage/v1${data.signedURL}`
    const a = document.createElement('a')
    a.href = url; a.download = c.nombre_archivo; a.target = '_blank'; a.click()
  }

  async function eliminar(id, path) {
    if (!isSuperAdmin) return
    if (!window.confirm('¿Eliminar este contrato?')) return
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/storage/v1/object/contratos/${path}`,
      { method: 'DELETE', headers })
    await fetch(`${SUPABASE_URL}/rest/v1/contratos?id=eq.${id}`,
      { method: 'DELETE', headers })
    cargar()
  }

  return (
    <div className={styles.wrap}>

      {/* Top bar */}
      <div className={styles.topBar}>
        <div>
          <h3 className={styles.titulo}>Mis Contratos</h3>
          <p className={styles.subtitulo}>
            {isSuperAdmin
              ? 'Contratos del abogado — ambos pueden ver y descargar.'
              : 'Sube tus contratos. El administrador también puede verlos y descargarlos.'}
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            className={styles.btnSubir}
            onClick={() => { setShowForm(true); setError(''); setSuccess('') }}
          >
            + Subir contrato
          </button>
        </div>
      </div>

      {/* Pestañas: subidos / evidencia firmada por contraparte */}
      <div className={styles.tabs} role="tablist">
        {[
          ['subidos', 'Subidos'],
          ['clientes', `Firmados con clientes${evidencia.clientes.length ? ` (${evidencia.clientes.length})` : ''}`],
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`${styles.tab} ${tab === k ? styles.tabOn : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {error   && <div className={styles.msgError}>{error}</div>}
      {success && <div className={styles.msgOk}>{success}</div>}

      {/* Modal: subir contrato */}
      {showForm && createPortal(
        <div className={styles.modalOverlay} onMouseDown={() => !uploading && setShowForm(false)}>
          <div className={styles.modalCard} onMouseDown={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3 className={styles.modalTitle}>Subir contrato</h3>
              <button
                className={styles.modalClose}
                onClick={() => !uploading && setShowForm(false)}
                aria-label="Cerrar"
              >✕</button>
            </div>
            {error && <div className={styles.msgError}>{error}</div>}
            <form className={styles.form} onSubmit={handleUpload}>
              <div className={styles.dropZone} onClick={() => fileRef.current?.click()}>
                {archivo ? (
                  <div className={styles.archivoSel}>
                    <span style={{ color: '#0d2d5e' }}><IconDoc size={30} /></span>
                    <div>
                      <p className={styles.archNombre}>{archivo.name}</p>
                      <p className={styles.archSize}>{fmtBytes(archivo.size)}</p>
                    </div>
                  </div>
                ) : (
                  <div className={styles.dropPlaceholder}>
                    <span style={{ color: '#c9a84c' }}><IconUpload size={30} /></span>
                    <p className={styles.dropTexto}>Haz clic para seleccionar archivo</p>
                    <p className={styles.dropSub}>PDF, DOC, DOCX — máx. 10 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileRef} type="file" accept=".pdf,.doc,.docx"
                style={{ display: 'none' }}
                onChange={e => setArchivo(e.target.files[0] || null)}
              />
              <input
                className={styles.inputDesc}
                placeholder="Descripción opcional (ej: Contrato honorarios — Juan Pérez)"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
              />
              <button className={styles.btnConfirmar} type="submit" disabled={uploading}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                {uploading ? 'Subiendo…' : <><IconUpload size={14} /> Confirmar subida</>}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Evidencia firmada con clientes */}
      {tab === 'clientes' && (
        evidencia.clientes.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyFirmaIcon}><IconFirma size={44} /></span>
            <p className={styles.emptyTxt}>Aún no hay documentos firmados con clientes</p>
            <p className={styles.emptySub}>Los documentos firmados quedarán aquí como evidencia</p>
          </div>
        ) : (
          <div className={styles.lista}>
            {evidencia.clientes.map(s => {
              const nombres = (s.firmas_firmantes || []).map(f => f.nombre).filter(Boolean).join(', ')
              return (
                <div key={s.id} className={styles.contratoCard}>
                  <span className={styles.contratoIcono} style={{ color: '#c9a84c' }}><IconFirma size={22} /></span>
                  <div className={styles.contratoInfo}>
                    <p className={styles.contratoNombre}>Documento firmado</p>
                    {nombres && <p className={styles.contratoDesc}>Firmantes: {nombres}</p>}
                    <p className={styles.contratoMeta}>Recibido firmado: {fmtFecha(fechaFirmado(s))}</p>
                  </div>
                  <div className={styles.contratoAcciones}>
                    {s.doc_firmado_path && (
                      <button
                        className={styles.btnFirmarSm}
                        onClick={() => verDocumento(s)}
                      >
                        <IconDoc size={14} /> Ver documento
                      </button>
                    )}
                    <button
                      className={styles.btnDown}
                      onClick={() => descargarCertificado(s)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <IconDownload size={13} /> Certificado
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Lista de subidos */}
      {tab === 'subidos' && (loading ? (
        <p className={styles.empty}>Cargando contratos…</p>
      ) : contratos.length === 0 ? (
        <div className={styles.emptyState}>
          <span style={{ color: '#c9a84c' }}><IconFolder size={40} /></span>
          <p className={styles.emptyTxt}>No hay contratos subidos aún</p>
          <p className={styles.emptySub}>Los contratos aparecerán aquí una vez subidos</p>
        </div>
      ) : (
        <div className={styles.lista}>
          {contratos.map(c => (
            <div key={c.id} className={styles.contratoCard}>
              <span className={styles.contratoIcono} style={{ color: '#0d2d5e' }}><IconDoc size={20} /></span>
              <div className={styles.contratoInfo}>
                <p className={styles.contratoNombre}>{c.nombre_archivo}</p>
                {c.descripcion && <p className={styles.contratoDesc}>{c.descripcion}</p>}
                <p className={styles.contratoMeta}>
                  Subido: {fmtFecha(c.created_at)}{c.size_bytes ? ` · ${fmtBytes(c.size_bytes)}` : ''}
                </p>
              </div>
              <div className={styles.contratoAcciones}>
                <button className={styles.btnFirmarSm} onClick={() => setEnviarFirma(c)}>
                  <IconFirma size={14} /> Firmar
                </button>
                <button className={styles.btnDown} onClick={() => descargar(c)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IconDownload size={13} /> Descargar
                </button>
                {isSuperAdmin && (
                  <button
                    className={styles.btnDel}
                    onClick={() => eliminar(c.id, c.storage_path)}
                    title="Eliminar contrato"
                    aria-label="Eliminar contrato"
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Modal: iniciar solicitud de firma */}
      {enviarFirma && (
        <EnviarAFirmar
          contrato={enviarFirma.id ? enviarFirma : null}
          abogadoId={abogadoId}
          onClose={() => setEnviarFirma(null)}
          onDone={() => { cargarEvidencia(); }}
        />
      )}
    </div>
  )
}