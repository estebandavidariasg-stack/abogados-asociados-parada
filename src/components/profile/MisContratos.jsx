import { useState, useEffect, useRef } from 'react'
import { getAuthHeaders } from '../../lib/supabase'
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
  return new Date(ts).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}
function iconoTipo(nombre) {
  const ext = nombre?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (ext === 'doc' || ext === 'docx') return '📝'
  return '📎'
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

  useEffect(() => { if (abogadoId) cargar() }, [abogadoId])

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
        <button
          className={styles.btnSubir}
          onClick={() => { setShowForm(s => !s); setError(''); setSuccess('') }}
        >
          {showForm ? '✕ Cancelar' : '+ Subir contrato'}
        </button>
      </div>

      {error   && <div className={styles.msgError}>{error}</div>}
      {success && <div className={styles.msgOk}>{success}</div>}

      {/* Formulario */}
      {showForm && (
        <form className={styles.form} onSubmit={handleUpload}>
          <div className={styles.dropZone} onClick={() => fileRef.current?.click()}>
            {archivo ? (
              <div className={styles.archivoSel}>
                <span style={{ fontSize: '2rem' }}>{iconoTipo(archivo.name)}</span>
                <div>
                  <p className={styles.archNombre}>{archivo.name}</p>
                  <p className={styles.archSize}>{fmtBytes(archivo.size)}</p>
                </div>
              </div>
            ) : (
              <div className={styles.dropPlaceholder}>
                <span style={{ fontSize: '2.2rem' }}>📂</span>
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
          <button className={styles.btnConfirmar} type="submit" disabled={uploading}>
            {uploading ? 'Subiendo…' : '⬆ Confirmar subida'}
          </button>
        </form>
      )}

      {/* Lista */}
      {loading ? (
        <p className={styles.empty}>Cargando contratos…</p>
      ) : contratos.length === 0 ? (
        <div className={styles.emptyState}>
          <span style={{ fontSize: '2.8rem' }}>📁</span>
          <p className={styles.emptyTxt}>No hay contratos subidos aún</p>
          <p className={styles.emptySub}>Los contratos aparecerán aquí una vez subidos</p>
        </div>
      ) : (
        <div className={styles.lista}>
          {contratos.map(c => (
            <div key={c.id} className={styles.contratoCard}>
              <span className={styles.contratoIcono}>{iconoTipo(c.nombre_archivo)}</span>
              <div className={styles.contratoInfo}>
                <p className={styles.contratoNombre}>{c.nombre_archivo}</p>
                {c.descripcion && <p className={styles.contratoDesc}>{c.descripcion}</p>}
                <p className={styles.contratoMeta}>
                  {fmtFecha(c.created_at)}{c.size_bytes ? ` · ${fmtBytes(c.size_bytes)}` : ''}
                </p>
              </div>
              <div className={styles.contratoAcciones}>
                <button className={styles.btnDown} onClick={() => descargar(c)}>
                  ⬇ Descargar
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
      )}
    </div>
  )
}