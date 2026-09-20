import { useEffect, useRef, useState } from 'react'
import { supabase, getAuthHeaders } from '../../lib/supabase'
import TarjetaPreview from './TarjetaPreview'
import styles from './DocumentosConfianza.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ─────────────────────────────────────────────────────────────────────────
   Documentos de confianza del profesional (perfil abogado/contador).

   Los clientes los consultan SOLO-VER dentro del chat (fila de confianza) y
   el certificado bancario es el que respalda el cobro de asesoría. Los
   registros nuevos los suben en el modal post-OTP; aquí los profesionales
   existentes los completan o corrigen.

   Se monta justo debajo de "Tarjeta profesional" y usa exactamente su mismo
   lenguaje: etiqueta en mayúsculas con la nota a la derecha, miniatura
   clicable (TarjetaPreview) y botón fantasma a todo el ancho. Sin tarjetas ni
   fondos: los tres van en una fila. Cada archivo se guarda al subirlo (no
   pasa por "Guardar cambios"). Los datos de texto (cédula, oficina, web)
   viven en el formulario de la página, con los datos básicos.

   Buckets y rutas sin cambios:
     · certificado bancario      → tarjetas-profesionales/<uid>/certificados/certificado.<ext>
     · certificado disciplinario → tarjetas-profesionales/<uid>/certificado-disciplinario.<ext>
     · modelo contractual (PDF)  → contratos/<uid>/modelo-contractual.pdf
───────────────────────────────────────────────────────────────────────── */

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

const DOCS = [
  {
    key: 'banc',
    nombre: 'Cuenta bancaria certificada',
    nota: 'obligatorio — PDF o imagen, máx. 10 MB',
    bucket: 'tarjetas-profesionales',
    columna: 'certificado_bancario_url',
    accept: ALLOWED.join(','),
    pdfOnly: false,
    path: (uid, ext) => `${uid}/certificados/certificado.${ext}`,
  },
  {
    key: 'disc',
    nombre: 'Certificado disciplinario',
    nota: 'obligatorio — PDF o imagen, máx. 10 MB',
    bucket: 'tarjetas-profesionales',
    columna: 'certificado_disciplinario_url',
    accept: ALLOWED.join(','),
    pdfOnly: false,
    path: (uid, ext) => `${uid}/certificado-disciplinario.${ext}`,
  },
  {
    key: 'modelo',
    nombre: 'Modelo contractual',
    nota: 'opcional — un solo PDF, máx. 10 MB',
    bucket: 'contratos',
    columna: 'modelo_contrato_path',
    accept: '.pdf,application/pdf',
    pdfOnly: true,
    path: (uid) => `${uid}/modelo-contractual.pdf`,
  },
]

async function firmar(bucket, path) {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
  return data?.signedUrl || null
}

export default function DocumentosConfianza({ userId }) {
  const [paths, setPaths]       = useState({ banc: null, disc: null, modelo: null })
  const [urls, setUrls]         = useState({ banc: null, disc: null, modelo: null })
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState('')     // 'banc' | 'disc' | 'modelo' | ''
  const [msg, setMsg]           = useState('')
  const [err, setErr]           = useState('')
  const inputRefs = { banc: useRef(null), disc: useRef(null), modelo: useRef(null) }

  useEffect(() => {
    if (!userId) return
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}` +
          `&select=certificado_bancario_url,certificado_disciplinario_url,modelo_contrato_path&limit=1`,
          { headers }
        )
        const rows = await res.json()
        const p = Array.isArray(rows) ? rows[0] : null
        if (cancel || !p) return
        const nuevos = {
          banc:   p.certificado_bancario_url || null,
          disc:   p.certificado_disciplinario_url || null,
          modelo: p.modelo_contrato_path || null,
        }
        setPaths(nuevos)
        // Firmamos las tres URLs en paralelo (1 h) para la previsualización.
        const firmadas = await Promise.all(DOCS.map(d => firmar(d.bucket, nuevos[d.key]).catch(() => null)))
        if (cancel) return
        setUrls({ banc: firmadas[0], disc: firmadas[1], modelo: firmadas[2] })
      } catch { /* los tres quedan como "sin archivo" */ }
      finally { if (!cancel) setCargando(false) }
    })()
    return () => { cancel = true }
  }, [userId])

  async function subir(e, doc) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
    if (doc.pdfOnly && !esPdf) { setErr('El modelo contractual debe ser un PDF.'); return }
    if (!doc.pdfOnly && !ALLOWED.includes(file.type)) { setErr('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setErr('El archivo no puede superar 10 MB.'); return }
    setErr(''); setMsg(''); setSubiendo(doc.key)
    try {
      const ext  = file.name.split('.').pop().toLowerCase()
      const path = doc.path(userId, ext)
      const headers = await getAuthHeaders()
      const up = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${doc.bucket}/${path}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': doc.pdfOnly ? 'application/pdf' : file.type, 'x-upsert': 'true' },
          body: file,
        }
      )
      if (!up.ok) throw new Error('upload')
      const patch = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ [doc.columna]: path }),
      })
      if (!patch.ok) throw new Error('patch')
      setPaths(prev => ({ ...prev, [doc.key]: path }))
      const url = await firmar(doc.bucket, path).catch(() => null)
      setUrls(prev => ({ ...prev, [doc.key]: url }))
      setMsg(doc.key === 'modelo'
        ? 'Modelo contractual guardado. Aparecerá en todos tus chats al enviar a firma.'
        : `${doc.nombre} guardado. Los clientes ya pueden consultarlo en el chat.`)
    } catch {
      setErr(`No se pudo subir ${doc.nombre.toLowerCase()}. Intenta de nuevo.`)
    } finally {
      setSubiendo('')
    }
  }

  return (
    <div className={styles.grid}>
      {DOCS.map(doc => {
        const path = paths[doc.key]
        const url  = urls[doc.key]
        const ocupado = subiendo === doc.key
        return (
          <div key={doc.key} className={styles.doc}>
            <label className={styles.label}>
              {doc.nombre}
              <span className={styles.optional}>({doc.nota})</span>
            </label>

            {cargando ? (
              <div className={styles.signing}>Cargando…</div>
            ) : path ? (
              url
                ? <TarjetaPreview key={path} displayUrl={url} storagePath={path} label={doc.nombre} />
                : <div className={styles.signing}>Generando enlace seguro…</div>
            ) : (
              <button type="button" className={styles.empty} disabled={ocupado}
                onClick={() => inputRefs[doc.key].current?.click()}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" />
                </svg>
                {ocupado ? 'Subiendo…' : 'Sin archivo'}
              </button>
            )}

            <button type="button" className="btn-ghost" disabled={ocupado || cargando}
              onClick={() => inputRefs[doc.key].current?.click()}>
              {ocupado ? 'Subiendo…' : path ? 'Cambiar archivo' : doc.pdfOnly ? 'Subir PDF' : 'Subir archivo'}
            </button>
            <input ref={inputRefs[doc.key]} type="file" accept={doc.accept}
              style={{ display: 'none' }} onChange={e => subir(e, doc)} />
          </div>
        )
      })}

      {err && <p className={styles.msgError} role="alert">{err}</p>}
      {msg && <p className={styles.msgOk} role="status">{msg}</p>}
    </div>
  )
}
