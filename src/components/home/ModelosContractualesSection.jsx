import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { headerStagger, eyebrowReveal, fadeUp, VIEWPORT } from '../../lib/motionVariants'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import styles from './ModelosContractualesSection.module.css'
import { descargarDesdeUrl, PdfVisor } from '../../lib/chatFiles'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const CATEGORIAS = [
  'Todas', 'Laboral', 'Civil', 'Comercial', 'Familiar',
  'Penal', 'Administrativo', 'Inmobiliario', 'Societario', 'Otro',
]
const CATEGORIAS_FORM = CATEGORIAS.filter(c => c !== 'Todas')

const PAGE_SIZE = 12
// Modelos a la vista al llegar; "Ver más" suma de a tantos y "Ver menos" vuelve
// aquí. La lista completa de una categoría empujaba el resto del inicio muy abajo.
const MODELOS_INICIO = 6
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

/* El PDF de vista previa de un Word/Excel vive junto al archivo, con el mismo
   nombre: no necesita columna en la BD. Solo sirve para MOSTRAR el modelo; lo
   que se descarga sigue siendo el Word/Excel editable. */
const rutaVistaPrevia = (storagePath) => storagePath.replace(/\.[^.]+$/, '') + '.vista.pdf'

const PESO_MAX = 25 * 1024 * 1024   // tope del bucket contract-templates
const SIN_ERRORES = { doc: '', pdf: '' }
const PASO_SUBIDA = { doc: 'Subiendo documento…', pdf: 'Subiendo PDF…', fila: 'Guardando…' }

function fmtPeso(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M20 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </svg>
  )
}

/* Campo de archivo: vacío es una zona para elegir o soltar; lleno muestra el
   archivo con su peso y la opción de quitarlo. El input real va oculto y lo
   abre un <button>, que sí recibe foco con el teclado (antes era un <label>
   con el input en display:none: sin teclado no había forma de elegir). */
function CampoArchivo({ id, etiqueta, tipos, accept, archivo, error, arrastrando, disabled, onElegir, onQuitar }) {
  const inputRef = useRef(null)
  const idEtiqueta = `${id}-etiqueta`
  const idError = `${id}-error`
  return (
    <div className={styles.modalField}>
      <span id={idEtiqueta} className={styles.modalLabel}>{etiqueta} *</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={styles.srOnly}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''   // permite volver a elegir el mismo archivo tras quitarlo
          if (f) onElegir(f)
        }}
      />
      {archivo ? (
        <div className={styles.archivo} aria-labelledby={idEtiqueta} role="group">
          <FormatIcon formato={detectFormato(archivo)} />
          <div className={styles.archivoInfo}>
            {/* Se recorta el nombre, nunca la extensión: en el celular
                "Poder especial penal…" no decía si era el .docx o el .pdf. */}
            <span className={styles.archivoNombre} title={archivo.name}>
              <span className={styles.archivoBase}>{archivo.name.replace(/\.[^.]+$/, '')}</span>
              {archivo.name.match(/\.[^.]+$/)?.[0]}
            </span>
            <span className={styles.archivoPeso}>{fmtPeso(archivo.size)}</span>
          </div>
          <button
            type="button"
            className={styles.archivoQuitar}
            onClick={onQuitar}
            disabled={disabled}
            aria-label={`Quitar ${archivo.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            Quitar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.dropzone} ${arrastrando ? styles.dropzoneActiva : ''} ${error ? styles.dropzoneError : ''}`}
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-labelledby={idEtiqueta}
          aria-describedby={error ? idError : undefined}
        >
          <UploadIcon />
          <span>
            {arrastrando
              ? 'Suelta el archivo aquí'
              : <>Selecciona o arrastra el <strong>{tipos}</strong></>}
          </span>
        </button>
      )}
      {error && <p id={idError} className={styles.campoError} role="alert">{error}</p>}
    </div>
  )
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

// ── Ícono "ojo" para el botón de previsualización ─────────────────────────
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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
  // Superadmin o admin (el admin hace todo menos gestionar roles).
  const { isPanelAdmin: puedeEditar } = useAuth()
  const [modelos, setModelos]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore]         = useState(false)
  const [categoria, setCategoria]     = useState('Todas')
  const [page, setPage]               = useState(0)
  const [verN, setVerN]               = useState(MODELOS_INICIO)   // cuántos se muestran
  const [error, setError]             = useState('')

  // ── Admin ────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen]         = useState(false)
  const [form, setForm]                   = useState({ nombre: '', descripcion: '', categoria: '', file: null, pdfVista: null })
  const [uploading, setUploading]         = useState(false)
  const [uploadError, setUploadError]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)  // modelo objeto a eliminar
  const [deleting, setDeleting]           = useState(false)
  const [dragOver, setDragOver]           = useState(false)
  const [erroresArchivo, setErroresArchivo] = useState(SIN_ERRORES)
  const [pasoSubida, setPasoSubida]       = useState('')   // 'doc' | 'pdf' | 'fila'

  // ── Preview ──────────────────────────────────────────────────────────
  const [previewModelo, setPreviewModelo]   = useState(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [vista, setVista]                   = useState(null)   // { tipo: 'pdf'|'office', url }

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

  // Diferir la primera carga hasta que la sección se acerque al viewport:
  // es de las últimas secciones y su query directa a Postgres corría en
  // CADA visita a la home aunque el visitante nunca llegara hasta aquí.
  const [visible, setVisible] = useState(false)
  const sectionRef = useRef(null)
  useEffect(() => {
    const el = sectionRef.current
    if (!el || !('IntersectionObserver' in window)) { setVisible(true); return }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() } },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    setPage(0)
    setVerN(MODELOS_INICIO)
    fetchPage(categoria, 0, false)
  }, [visible, categoria, fetchPage])

  function handleCategoria(cat) {
    if (cat !== categoria) setCategoria(cat)
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchPage(categoria, next, true)
  }

  // Ver más: muestra otra tanda y, si ya no alcanzan los que hay cargados,
  // trae la siguiente página. Ver menos: vuelve a la tanda inicial y sube al
  // comienzo de la sección (si no, uno queda mirando lo que venía después).
  function handleVerMas() {
    const objetivo = verN + MODELOS_INICIO
    setVerN(objetivo)
    if (objetivo > modelos.length && hasMore && !loadingMore) handleLoadMore()
  }
  function handleVerMenos() {
    setVerN(MODELOS_INICIO)
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // En dos tiempos, como el botón "Iniciar consulta" del perfil: la lista
    // se recoge y las secciones de arriba aún se están acomodando, así que el
    // primer desplazamiento queda corto; el segundo lo deja en su sitio.
    const ir = (behavior) => sectionRef.current?.scrollIntoView({ behavior, block: 'start' })
    requestAnimationFrame(() => ir(suave ? 'smooth' : 'auto'))
    setTimeout(() => ir('auto'), 700)
  }

  /* Bucket público: URL directa, sin firmar. NO pasa por downloadChatFile:
     esa firma solo archivos del bucket `chat-files` (candado anti
     open-redirect) y con cualquier otro devolvía null, así que el botón no
     hacía nada. Descarga real (blob) con la extensión en el nombre: sin ella
     el archivo bajaba como "PODER ESPECIAL…" y Windows no sabía abrirlo. */
  async function handleDownload(modelo) {
    const url = getRawUrl(modelo)
    if (!url) return
    const base = (modelo.nombre || 'modelo').replace(/[\\/:*?"<>|]+/g, ' ').trim()
    const ok = await descargarDesdeUrl(url, modelo.formato ? `${base}.${modelo.formato}` : base)
    if (!ok) window.open(url, '_blank', 'noopener')
  }

  // ── Preview ──────────────────────────────────────────────────────────
  // URL pública directa del archivo (sin el visor de Office).
  function getRawUrl(modelo) {
    if (!modelo) return ''
    const { data } = supabase.storage.from('contract-templates').getPublicUrl(modelo.storage_path)
    return data?.publicUrl || ''
  }

  function openPreview(modelo)  { setPreviewLoading(true); setPreviewModelo(modelo) }
  function closePreview()       { setPreviewModelo(null) }

  /* Qué se muestra:
     · Un PDF (el modelo mismo o el PDF de vista previa de un Word/Excel) →
       PdfVisor: exacto, instantáneo y visible en el celular (un PDF dentro
       de un <iframe> no se ve en Android).
     · Word/Excel sin PDF → visor de Office Online. Tarda de 5 a 20 s, pero es
       el único gratis que dibuja las formas de Word. docx-preview era
       instantáneo y NO las dibuja: la portada, el logo y la marca de agua de
       las plantillas de la firma son formas, y salían en blanco. */
  useEffect(() => {
    if (!previewModelo) return
    let vivo = true
    const raw = getRawUrl(previewModelo)
    setVista(null)
    if (previewModelo.formato === 'pdf') { setVista({ tipo: 'pdf', url: raw }); return }
    const { data } = supabase.storage.from('contract-templates').getPublicUrl(rutaVistaPrevia(previewModelo.storage_path))
    ;(async () => {
      let hayPdf = false
      try { hayPdf = (await fetch(data.publicUrl, { method: 'HEAD' })).ok } catch { /* sin PDF: Office */ }
      if (!vivo) return
      setVista(hayPdf
        ? { tipo: 'pdf', url: data.publicUrl }
        : { tipo: 'office', url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(raw)}` })
    })()
    return () => { vivo = false }
  }, [previewModelo])

  // ─────────────────────── ADMIN: alta de modelo ─────────────────────────
  function openAddModal() {
    setForm({ nombre: '', descripcion: '', categoria: '', file: null, pdfVista: null })
    setUploadError('')
    setErroresArchivo(SIN_ERRORES)
    setModalOpen(true)
  }

  /* El TIPO decide el campo, no dónde se soltó ni qué botón se pulsó: un PDF
     siempre es la vista previa y un Word/Excel el documento. Así se pueden
     arrastrar los dos a la vez sin apuntar. Devuelve el error, o '' si entró. */
  function asignarArchivo(file) {
    const formato = detectFormato(file)
    if (!formato) return `«${file.name}» no es Word, Excel ni PDF.`
    if (file.size > PESO_MAX) return `«${file.name}» pesa más de 25 MB.`
    const campo = formato === 'pdf' ? 'pdf' : 'doc'
    setForm(f => ({ ...f, [campo === 'pdf' ? 'pdfVista' : 'file']: file }))
    setErroresArchivo(e => ({ ...e, [campo]: '' }))
    return ''
  }

  // Elegido con el selector de un campo: el error se muestra en ese campo.
  function elegirArchivo(campo, file) {
    const error = asignarArchivo(file)
    if (error) setErroresArchivo(e => ({ ...e, [campo]: error }))
    else setUploadError('')
  }

  function quitarArchivo(campo) {
    setForm(f => ({ ...f, [campo === 'pdf' ? 'pdfVista' : 'file']: null }))
    setErroresArchivo(e => ({ ...e, [campo]: '' }))
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
    const errores = [...(e.dataTransfer?.files || [])].map(asignarArchivo).filter(Boolean)
    setUploadError(errores.join(' '))
  }

  async function handleSubmitUpload(e) {
    e.preventDefault()
    // Los dos son obligatorios: el Word/Excel es lo que se descarga y el PDF
    // lo que se muestra. Sin PDF la vista previa dependería de Office Online,
    // que tarda de 5 a 20 s.
    const faltan = {
      doc: form.file ? '' : 'Falta el documento que se va a descargar.',
      pdf: form.pdfVista ? '' : 'Falta el PDF de la vista previa.',
    }
    if (faltan.doc || faltan.pdf) { setErroresArchivo(faltan); return }
    if (!form.nombre.trim() || !form.categoria) {
      setUploadError('Completa el nombre y la categoría.')
      return
    }
    const formato = detectFormato(form.file)
    const pdfVista = form.pdfVista
    setUploading(true)
    setUploadError('')
    setPasoSubida('doc')

    // Nombre seguro: timestamp + nombre saneado (sin chars problemáticos)
    const safeName = form.file.name.replace(/[^\w.\-]/g, '_')
    const filename = `${Date.now()}_${safeName}`
    const subidos = [filename]

    const { error: uploadErr } = await supabase.storage.from('contract-templates')
      .upload(filename, form.file, { contentType: form.file.type })
    if (uploadErr) {
      console.error('[modelos] Error subiendo archivo:', uploadErr)
      setUploadError(`No se pudo subir el archivo: ${uploadErr.message || 'error desconocido'}`)
      setUploading(false)
      return
    }

    // Antes de la fila: si el PDF falla, no queda un modelo a medias.
    setPasoSubida('pdf')
    const rutaPdf = rutaVistaPrevia(filename)
    const { error: pdfErr } = await supabase.storage.from('contract-templates')
      .upload(rutaPdf, pdfVista, { contentType: 'application/pdf' })
    if (pdfErr) {
      await supabase.storage.from('contract-templates').remove([filename])
      console.error('[modelos] Error subiendo el PDF de vista previa:', pdfErr)
      setUploadError(`No se pudo subir el PDF de vista previa: ${pdfErr.message || 'error desconocido'}`)
      setUploading(false)
      return
    }
    subidos.push(rutaPdf)

    setPasoSubida('fila')
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
      // Rollback storage para no dejar archivos huérfanos
      await supabase.storage.from('contract-templates').remove(subidos)
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
    // Best-effort: si falla aquí, la fila ya está fuera; el archivo quedará
    // huérfano. El PDF de vista previa puede no existir: su fallo no importa.
    await supabase.storage.from('contract-templates').remove([storage_path, rutaVistaPrevia(storage_path)])

    setModelos(prev => prev.filter(m => m.id !== id))
    setDeleting(false)
    setConfirmDelete(null)
  }

  return (
    <section ref={sectionRef} className={styles.section} id="modelos">

      {/* ── Header ── */}
      <motion.div
        className={styles.header}
        variants={headerStagger}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT}
      >
        <motion.span className={styles.label} variants={eyebrowReveal}>
          Recursos Legales
        </motion.span>
        <motion.h2 className={styles.title} variants={fadeUp}>
          Modelos <em>Contractuales</em>
        </motion.h2>
        <motion.p className={styles.desc} variants={fadeUp}>
          Plantillas profesionales en Word, Excel y PDF — listas para descargar y adaptar a tu caso.
        </motion.p>
      </motion.div>

      {/* Control de edición (superadmin o admin): el mismo botón flotante que
          "Editar noticias" y "Editar videos". Antes iba anclado a la fila de
          categorías y tapaba el último chip ("Otro"). */}
      {puedeEditar && (
        <button type="button" className={styles.fab} onClick={openAddModal} aria-haspopup="dialog">
          ＋ Agregar modelo
        </button>
      )}

      {/* ── Filtros (chips horizontales, scroll en móvil) ── */}
      <div className={styles.filtersWrap}>
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
        <div className={styles.list}>
          <div className={styles.rowSkeleton} />
          <div className={styles.rowSkeleton} />
          <div className={styles.rowSkeleton} />
          <div className={styles.rowSkeleton} />
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
          <div className={styles.list}>
            {modelos.slice(0, verN).map((m, i) => (
              <motion.article
                key={m.id}
                className={styles.row}
                // Cada fila se anima al MONTARSE, de forma independiente. Así,
                // un modelo recién subido (insertado al inicio) aparece siempre,
                // sin depender de la orquestación del contenedor.
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(i, 8) * 0.035 }}
              >
                {/* Ícono de formato (pequeño) — no es previsualización */}
                <span className={styles.rowIcon}><FormatIcon formato={m.formato} /></span>

                <div className={styles.rowInfo}>
                  <span className={styles.cardCategoria}>{m.categoria}</span>
                  <h4 className={styles.rowNombre} title={m.nombre}>{m.nombre}</h4>
                  {m.descripcion && (
                    <p className={styles.rowDescripcion} title={m.descripcion}>
                      {m.descripcion}
                    </p>
                  )}
                </div>

                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowPreview}
                    onClick={() => openPreview(m)}
                  >
                    <EyeIcon /> Previsualizar
                  </button>
                  <button
                    type="button"
                    className={styles.rowDownload}
                    onClick={() => handleDownload(m)}
                  >
                    ⬇ Descargar {FORMAT_LABEL[m.formato] || m.formato.toUpperCase()}
                  </button>
                  {puedeEditar && (
                    <button
                      type="button"
                      className={styles.rowDeleteBtn}
                      onClick={() => setConfirmDelete(m)}
                      title="Eliminar modelo"
                      aria-label="Eliminar modelo"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </motion.article>
            ))}
          </div>

          {(modelos.length > verN || hasMore || verN > MODELOS_INICIO) && (
            <div className={styles.loadMoreWrap}>
              {(modelos.length > verN || hasMore) && (
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={handleVerMas}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Cargando…' : 'Ver más'}
                </button>
              )}
              {verN > MODELOS_INICIO && (
                <button
                  type="button"
                  className={`${styles.loadMoreBtn} ${styles.loadLessBtn}`}
                  onClick={handleVerMenos}
                >
                  Ver menos
                </button>
              )}
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

              <CampoArchivo
                id="modelo-doc"
                etiqueta="Documento para descargar"
                tipos="Word o Excel"
                accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                archivo={form.file}
                error={erroresArchivo.doc}
                arrastrando={dragOver}
                disabled={uploading}
                onElegir={f => elegirArchivo('doc', f)}
                onQuitar={() => quitarArchivo('doc')}
              />

              <CampoArchivo
                id="modelo-pdf"
                etiqueta="PDF para la vista previa"
                tipos="PDF"
                accept=".pdf,application/pdf"
                archivo={form.pdfVista}
                error={erroresArchivo.pdf}
                arrastrando={dragOver}
                disabled={uploading}
                onElegir={f => elegirArchivo('pdf', f)}
                onQuitar={() => quitarArchivo('pdf')}
              />

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
                  {uploading ? <><span className={styles.spinner} /> {PASO_SUBIDA[pasoSubida] || 'Subiendo…'}</> : 'Subir modelo'}
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

            <div className={styles.previewFrameWrap}>
              {vista?.tipo === 'pdf' && (
                <div className={styles.previewPdf}>
                  <PdfVisor url={vista.url} titulo={previewModelo.nombre} fondo="#f1ede9" />
                </div>
              )}
              {vista?.tipo === 'office' && (
                <iframe
                  key={previewModelo.id}
                  src={vista.url}
                  title={previewModelo.nombre}
                  className={styles.previewIframe}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  onLoad={() => setPreviewLoading(false)}
                />
              )}
              {(!vista || (vista.tipo === 'office' && previewLoading)) && (
                <div className={styles.previewLoading} aria-hidden="true">
                  <span className={styles.spinner} />
                  <span>Cargando vista previa…</span>
                </div>
              )}
            </div>

            <div className={styles.previewFooter}>
              <p className={styles.previewNote}>
                {vista?.tipo === 'office'
                  ? 'La vista previa la genera Microsoft y puede tardar unos segundos. Si no se ve, usa “Descargar”.'
                  : previewModelo.formato === 'pdf'
                    ? 'Vista previa del documento.'
                    : `Vista previa. Se descarga en ${previewModelo.formato === 'xlsx' ? 'Excel' : 'Word'}, listo para editar.`}
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
