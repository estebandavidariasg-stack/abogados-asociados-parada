import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import styles from './ModelosContractualesSection.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const CATEGORIAS = [
  'Todas', 'Laboral', 'Civil', 'Comercial', 'Familiar',
  'Penal', 'Administrativo', 'Inmobiliario', 'Societario', 'Otro',
]
const CATEGORIAS_FORM = CATEGORIAS.filter(c => c !== 'Todas')

const PAGE_SIZE = 12
const FORMAT_LABEL = { docx: 'WORD', xlsx: 'EXCEL', pdf: 'PDF' }

// MIME → formato (cubre los 3 formatos del bucket)
const MIME_TO_FORMATO = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

function detectFormato(file) {
  if (MIME_TO_FORMATO[file.type]) return MIME_TO_FORMATO[file.type]
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf' || ext === 'docx' || ext === 'xlsx') return ext
  return null
}

// ── Íconos inline por formato (W azul, X verde, PDF rojo) ─────────────────
function FormatIcon({ formato }) {
  const common = { width: 30, height: 30, viewBox: '0 0 32 32', xmlns: 'http://www.w3.org/2000/svg' }
  if (formato === 'docx') {
    return (
      <svg {...common} aria-label="Documento Word">
        <rect x="2" y="2" width="28" height="28" rx="4" fill="#2b579a" />
        <text x="16" y="22" textAnchor="middle" fontFamily="Arial, sans-serif"
          fontWeight="700" fontSize="14" fill="#fff">W</text>
      </svg>
    )
  }
  if (formato === 'xlsx') {
    return (
      <svg {...common} aria-label="Hoja de Excel">
        <rect x="2" y="2" width="28" height="28" rx="4" fill="#217346" />
        <text x="16" y="22" textAnchor="middle" fontFamily="Arial, sans-serif"
          fontWeight="700" fontSize="14" fill="#fff">X</text>
      </svg>
    )
  }
  if (formato === 'pdf') {
    return (
      <svg {...common} aria-label="Documento PDF">
        <rect x="2" y="2" width="28" height="28" rx="4" fill="#dc3545" />
        <text x="16" y="21" textAnchor="middle" fontFamily="Arial, sans-serif"
          fontWeight="700" fontSize="9" fill="#fff">PDF</text>
      </svg>
    )
  }
  return null
}

// ── Miniatura "primera página" ────────────────────────────────────────────
// Usa iframe del visor (Office Online para .docx/.xlsx, nativo para .pdf).
// IntersectionObserver evita levantar 12 iframes a la vez: sólo carga cuando
// la card entra al viewport (rootMargin 300px, una sola vez).
function CardThumb({ url, formato }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setInView(true); obs.disconnect() }
      },
      { rootMargin: '300px 0px', threshold: 0.05 }
    )
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} className={styles.cardThumb}>
      <div className={styles.cardThumbPage}>
        {inView && url && (
          <iframe
            src={url}
            title=""
            className={styles.cardThumbIframe}
            onLoad={() => setLoaded(true)}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {!loaded && (
          <div className={styles.cardThumbFallback}>
            <FormatIcon formato={formato} />
            {inView && (
              <span className={styles.cardThumbHint}>Cargando vista previa…</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Estado vacío: documento con borde punteado ────────────────────────────
function EmptyDocIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" strokeDasharray="2 2" />
    </svg>
  )
}

export default function ModelosContractualesSection() {
  const { isSuperAdmin } = useAuth()
  const [modelos, setModelos]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore]         = useState(false)
  const [categoria, setCategoria]     = useState('Todas')
  const [page, setPage]               = useState(0)
  const [error, setError]             = useState('')

  // ── Admin ────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen]         = useState(false)
  const [form, setForm]                   = useState({ nombre: '', descripcion: '', categoria: '', file: null })
  const [uploading, setUploading]         = useState(false)
  const [uploadError, setUploadError]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)  // modelo objeto a eliminar
  const [deleting, setDeleting]           = useState(false)
  const [dragOver, setDragOver]           = useState(false)
  const fileInputRef                      = useRef(null)

  // ── Preview ──────────────────────────────────────────────────────────
  const [previewModelo, setPreviewModelo] = useState(null)

  // Fetch paginado vía REST (offset/limit) — 12 en 12
  const fetchPage = useCallback(async (cat, pageIdx, append) => {
    if (pageIdx === 0) setLoading(true); else setLoadingMore(true)
    setError('')
    try {
      const offset = pageIdx * PAGE_SIZE
      let url = `${SUPABASE_URL}/rest/v1/modelos_contractuales`
      url += `?select=*&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`
      if (cat && cat !== 'Todas') url += `&categoria=eq.${encodeURIComponent(cat)}`
      const res  = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
      const json = await res.json()
      const arr  = Array.isArray(json) ? json : []
      setModelos(prev => append ? [...prev, ...arr] : arr)
      setHasMore(arr.length === PAGE_SIZE)
    } catch (_err) {
      setError('No se pudieron cargar los modelos.')
      if (!append) setModelos([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    fetchPage(categoria, 0, false)
  }, [categoria, fetchPage])

  function handleCategoria(cat) {
    if (cat !== categoria) setCategoria(cat)
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchPage(categoria, next, true)
  }

  function handleDownload(modelo) {
    // Bucket público — URL directa, sin signed URL
    const { data } = supabase.storage.from('contract-templates').getPublicUrl(modelo.storage_path)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank', 'noopener,noreferrer')
  }

  // ── Preview ──────────────────────────────────────────────────────────
  // PDF se renderiza nativamente en el iframe; .docx/.xlsx vía Office Online.
  function getPreviewUrl(modelo) {
    if (!modelo) return ''
    const { data } = supabase.storage.from('contract-templates').getPublicUrl(modelo.storage_path)
    const publicUrl = data?.publicUrl
    if (!publicUrl) return ''
    if (modelo.formato === 'pdf') return publicUrl
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`
  }
  function openPreview(modelo)  { setPreviewModelo(modelo) }
  function closePreview()       { setPreviewModelo(null) }

  // ─────────────────────── ADMIN: alta de modelo ─────────────────────────
  function openAddModal() {
    setForm({ nombre: '', descripcion: '', categoria: '', file: null })
    setUploadError('')
    setModalOpen(true)
  }

  function closeAddModal() {
    if (uploading) return
    setModalOpen(false)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    if (uploading) return
    // dataTransfer.dropEffect controla el cursor (copy / no-drop)
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    if (!dragOver) setDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    // Evita el flicker: solo apaga si el cursor salió de verdad del modal,
    // no si pasó a un hijo (input, label, etc.)
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (uploading) return
    const dropped = e.dataTransfer?.files?.[0]
    if (!dropped) return
    if (!detectFormato(dropped)) {
      setUploadError('Formato no permitido. Solo .docx, .xlsx o .pdf.')
      return
    }
    setForm(f => ({ ...f, file: dropped }))
    setUploadError('')
  }

  async function handleSubmitUpload(e) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.categoria || !form.file) {
      setUploadError('Completa nombre, categoría y archivo.')
      return
    }
    const formato = detectFormato(form.file)
    if (!formato) {
      setUploadError('Formato no permitido. Usa .docx, .xlsx o .pdf.')
      return
    }
    setUploading(true)
    setUploadError('')

    // Nombre seguro: timestamp + nombre saneado (sin chars problemáticos)
    const safeName = form.file.name.replace(/[^\w.\-]/g, '_')
    const filename = `${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage.from('contract-templates')
      .upload(filename, form.file, { contentType: form.file.type })
    if (uploadErr) {
      console.error('[modelos] Error subiendo archivo:', uploadErr)
      setUploadError(`No se pudo subir el archivo: ${uploadErr.message || 'error desconocido'}`)
      setUploading(false)
      return
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('modelos_contractuales')
      .insert({
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        categoria: form.categoria,
        formato,
        storage_path: filename,
      })
      .select().single()

    if (insertErr || !inserted) {
      // Rollback storage para no dejar archivo huérfano
      await supabase.storage.from('contract-templates').remove([filename])
      console.error('[modelos] Error insertando fila:', insertErr)
      setUploadError(`No se pudo guardar el modelo: ${insertErr?.message || 'error desconocido'}`)
      setUploading(false)
      return
    }

    // Insert al inicio si encaja con la categoría visible
    if (categoria === 'Todas' || categoria === inserted.categoria) {
      setModelos(prev => [inserted, ...prev])
    }
    setUploading(false)
    setModalOpen(false)
  }

  // ─────────────────────── ADMIN: eliminación ────────────────────────────
  async function handleConfirmDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    const { id, storage_path } = confirmDelete

    const { error: delErr } = await supabase.from('modelos_contractuales').delete().eq('id', id)
    if (delErr) {
      console.error('[modelos] Error eliminando fila:', delErr)
      setDeleting(false)
      return
    }
    // Best-effort: si falla aquí, la fila ya está fuera; el archivo quedará huérfano
    await supabase.storage.from('contract-templates').remove([storage_path])

    setModelos(prev => prev.filter(m => m.id !== id))
    setDeleting(false)
    setConfirmDelete(null)
  }

  return (
    <section className={styles.section} id="modelos">

      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.label}>Recursos Legales</span>
        <h2 className={styles.title}>MODELOS <em>CONTRACTUALES</em></h2>
        <p className={styles.desc}>
          Plantillas profesionales en Word, Excel y PDF — listas para descargar y adaptar a tu caso.
        </p>
      </div>

      {/* ── Filtros (chips horizontales, scroll en móvil) ── */}
      <div className={styles.filtersWrap}>
        {/* Botón admin alineado al nivel de las chips */}
        {isSuperAdmin && (
          <button
            type="button"
            className={styles.adminBtn}
            onClick={openAddModal}
            title="Agregar modelo contractual"
          >
            ＋ Agregar Modelo
          </button>
        )}
        <div className={styles.filters}>
          {CATEGORIAS.map(cat => (
            <button
              key={cat}
              type="button"
              className={`${styles.chip} ${categoria === cat ? styles.chipActive : ''}`}
              onClick={() => handleCategoria(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Subtítulo de categoría seleccionada ── */}
      {categoria !== 'Todas' && (
        <div className={styles.categoriaTitle}>
          <h3>{categoria}</h3>
          <span className={styles.categoriaSeparator} />
        </div>
      )}

      {/* ── Grid / estados ── */}
      {loading ? (
        <div className={styles.grid}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : modelos.length === 0 ? (
        <div className={styles.emptyWrap}>
          <span className={styles.emptyIcon}><EmptyDocIcon /></span>
          <p className={styles.empty}>
            No hay modelos disponibles{categoria !== 'Todas' ? ` en ${categoria}` : ''}.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {modelos.map(m => (
              <article
                key={m.id}
                className={styles.card}
                onClick={() => openPreview(m)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(m) } }}
              >

                {isSuperAdmin && (
                  <button
                    type="button"
                    className={styles.cardDeleteBtn}
                    onClick={e => { e.stopPropagation(); setConfirmDelete(m) }}
                    title="Eliminar modelo"
                    aria-label="Eliminar modelo"
                  >
                    ✕
                  </button>
                )}

                {/* Miniatura real de la primera página (lazy iframe) */}
                <CardThumb url={getPreviewUrl(m)} formato={m.formato} />

                <div className={styles.cardBody}>
                  <span className={styles.cardCategoria}>{m.categoria}</span>
                  <h4 className={styles.cardNombre} title={m.nombre}>{m.nombre}</h4>
                  {m.descripcion && (
                    <p className={styles.cardDescripcion} title={m.descripcion}>
                      {m.descripcion}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className={styles.cardDownload}
                  onClick={e => { e.stopPropagation(); handleDownload(m) }}
                >
                  ⬇ Descargar {FORMAT_LABEL[m.formato] || m.formato.toUpperCase()}
                </button>
              </article>
            ))}
          </div>

          {hasMore && (
            <div className={styles.loadMoreWrap}>
              <button
                type="button"
                className={styles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ─────────────── Modal: agregar modelo ─────────────── */}
      {modalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={closeAddModal}
          onDragOver={e => e.preventDefault()}
          onDrop={e => e.preventDefault()}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.modalContent}
            onClick={e => e.stopPropagation()}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <h3 className={styles.modalTitle}>Agregar modelo contractual</h3>

            <form className={styles.modalForm} onSubmit={handleSubmitUpload}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Nombre *</label>
                <input
                  className={styles.modalInput}
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Contrato de arrendamiento residencial"
                  required
                  disabled={uploading}
                  maxLength={120}
                />
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Descripción (opcional)</label>
                <textarea
                  className={styles.modalTextarea}
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Breve descripción del modelo y su uso típico"
                  rows={3}
                  disabled={uploading}
                  maxLength={300}
                />
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Categoría *</label>
                <select
                  className={styles.modalSelect}
                  value={form.categoria}
                  onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  required
                  disabled={uploading}
                >
                  <option value="">Seleccionar…</option>
                  {CATEGORIAS_FORM.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Archivo * (.docx, .xlsx, .pdf)</label>
                <label className={styles.modalFileLabel}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                    disabled={uploading}
                    style={{ display: 'none' }}
                  />
                  <span
                    className={`${styles.modalFileBtn} ${dragOver ? styles.modalFileBtnActive : ''}`}
                  >
                    {form.file
                      ? form.file.name
                      : dragOver
                        ? 'Suelta el archivo aquí'
                        : '＋ Seleccionar o arrastrar archivo'}
                  </span>
                </label>
              </div>

              {uploadError && <p className={styles.modalError}>⚠ {uploadError}</p>}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.modalCancel}
                  onClick={closeAddModal}
                  disabled={uploading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.modalSubmit}
                  disabled={uploading}
                >
                  {uploading ? <><span className={styles.spinner} /> Subiendo…</> : 'Subir modelo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────── Modal: preview del archivo ─────────────── */}
      {previewModelo && (
        <div
          className={styles.previewOverlay}
          onClick={closePreview}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.previewContent}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.previewHeader}>
              <div className={styles.previewHeadInfo}>
                <span className={styles.cardCategoria}>{previewModelo.categoria}</span>
                <h3 className={styles.previewTitle}>{previewModelo.nombre}</h3>
              </div>
              <button
                type="button"
                className={styles.previewClose}
                onClick={closePreview}
                aria-label="Cerrar previsualización"
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            <iframe
              key={previewModelo.id}
              src={getPreviewUrl(previewModelo)}
              title={previewModelo.nombre}
              className={styles.previewIframe}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />

            <div className={styles.previewFooter}>
              <p className={styles.previewNote}>
                {previewModelo.formato === 'pdf'
                  ? 'Vista previa nativa del navegador.'
                  : 'Vista previa vía Office Online (puede tardar unos segundos).'}
              </p>
              <button
                type="button"
                className={styles.previewDownload}
                onClick={() => handleDownload(previewModelo)}
              >
                ⬇ Descargar {FORMAT_LABEL[previewModelo.formato] || previewModelo.formato.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── Modal: confirmación de eliminación ─────────────── */}
      {confirmDelete && (
        <div
          className={styles.modalOverlay}
          onClick={() => !deleting && setConfirmDelete(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.confirmModalContent}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle}>¿Eliminar este modelo?</h3>
            <p className={styles.confirmText}>
              <strong>{confirmDelete.nombre}</strong>
              Esta acción no se puede deshacer.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
