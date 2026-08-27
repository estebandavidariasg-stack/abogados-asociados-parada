import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ResultadosProyecto from '../proyectos/ResultadosProyecto'
import {
  fetchProyectosAdmin, fetchArticulos, crearProyecto, actualizarProyecto,
  eliminarProyecto, reemplazarArticulos, fetchVotosDetalle,
  construirVotantes, notificarResultadoVotantes,
  apoyaMeta, toCSV, descargarArchivo, fmtFecha,
} from '../../lib/proyectosLey'
import styles from './ProyectosLeyAdmin.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   ProyectosLeyAdmin — panel superadmin del "Debate de proyectos de ley".
   Todas las acciones (crear, editar, publicar/despublicar, eliminar, ver
   resultados) ocurren en MODALES portaleados a <body>, para no perder el
   contexto de la lista y evitar clipping por overflow/transform del panel.
   ───────────────────────────────────────────────────────────────────────── */

const emptyForm = () => ({
  id: null, nombre: '', numero: '', descripcion: '', fecha_radicacion: '',
  enlace_documento: '', permite_articulado: true, publicado: false,
})
// Fecha local YYYY-MM-DD (para inputs de tipo date sin desfase de zona horaria).
const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const emptyArt = () => ({ numero: '', titulo: '', contenido: '' })

/* ── Marco de modal reutilizable (backdrop + panel + cierre) ── */
function ModalShell({ onClose, title, subtitle, size = 'md', children, footer, closeDisabled }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !closeDisabled) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, closeDisabled])

  return (
    <motion.div
      className={styles.backdrop}
      onClick={() => !closeDisabled && onClose()}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className={`${styles.modal} ${styles['size_' + size]}`}
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        {!closeDisabled && (
          <button type="button" className={styles.modalX} onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
        <div className={styles.modalHead}>
          <h3 className={styles.modalTitle}>{title}</h3>
          {subtitle && <p className={styles.modalSub}>{subtitle}</p>}
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFoot}>{footer}</div>}
      </motion.div>
    </motion.div>
  )
}

/* Iconos de acción (mismo trazo que el resto de la UI). */
const IconEdit = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export default function ProyectosLeyAdmin() {
  const [proyectos, setProyectos] = useState(null)
  const [busy, setBusy]           = useState(false)
  // modal: null | { tipo: 'edit'|'delete'|'publish'|'resultados', proyecto? }
  const [modal, setModal]         = useState(null)

  const [form, setForm]           = useState(emptyForm())
  const [articulos, setArticulos] = useState([])
  const [selArts, setSelArts]     = useState([])

  // Importación automática desde archivo (PDF / Word / TXT) → prellenar el form.
  const [imp, setImp]           = useState({ phase: 'idle', progress: 0, msg: '', resumen: null })
  const [dragging, setDragging] = useState(false)   // arrastre activo (solo escritorio)
  const fileRef = useRef(null)
  const resetImport = () => { setImp({ phase: 'idle', progress: 0, msg: '', resumen: null }); setDragging(false) }

  // Modal de resultado + notificación a votantes.
  const [resForm, setResForm]     = useState({ estado: '', fecha: '', notas: '' })
  const [notif, setNotif]         = useState({ phase: 'idle', done: 0, total: 0, sent: 0, failed: 0, msg: '' })
  const [paso, setPaso]           = useState('resultado')   // modal resultado: 'resultado' | 'notificar'

  // Filtros de la lista: texto (nombre/número/tema) + rango de fecha de radicación.
  const [busqueda, setBusqueda] = useState('')
  const [desde, setDesde]       = useState('')
  const [hasta, setHasta]       = useState('')
  const proyectosFiltrados = useMemo(() => {
    if (!proyectos) return []
    const term = busqueda.trim().toLowerCase()
    return proyectos.filter(p => {
      if (term) {
        const heno = `${p.nombre || ''} ${p.numero || ''} ${p.descripcion || ''}`.toLowerCase()
        if (!heno.includes(term)) return false
      }
      const f = (p.fecha_radicacion || '').slice(0, 10)
      if (desde && (!f || f < desde)) return false
      if (hasta && (!f || f > hasta)) return false
      return true
    })
  }, [proyectos, busqueda, desde, hasta])
  const hayFiltro = !!(busqueda.trim() || desde || hasta)
  const limpiarFiltros = () => { setBusqueda(''); setDesde(''); setHasta('') }

  const cargar = useCallback(async () => { setProyectos(await fetchProyectosAdmin()) }, [])
  useEffect(() => { cargar() }, [cargar])

  const cerrar = () => { if (!busy) setModal(null) }

  /* ── Abrir modales ── */
  function nuevoProyecto() {
    setForm(emptyForm()); setArticulos([]); resetImport(); setModal({ tipo: 'edit' })
  }
  async function editar(p) {
    resetImport()
    setForm({
      id: p.id, nombre: p.nombre || '', numero: p.numero || '',
      descripcion: p.descripcion || '', fecha_radicacion: p.fecha_radicacion || '',
      enlace_documento: p.enlace_documento || '',
      permite_articulado: !!p.permite_articulado, publicado: !!p.publicado,
    })
    setArticulos([])
    setModal({ tipo: 'edit', proyecto: p })
    const arts = await fetchArticulos(p.id)
    setArticulos(arts.map(a => ({ numero: a.numero ?? '', titulo: a.titulo || '', contenido: a.contenido || '' })))
  }
  async function verResultados(p) {
    setSelArts([])
    setModal({ tipo: 'resultados', proyecto: p })
    setSelArts(await fetchArticulos(p.id))
  }
  function abrirResultado(p) {
    setResForm({
      estado: p.estado_resultado || '',
      fecha:  p.resultado_fecha || hoyISO(),
      notas:  p.resultado_notas || '',
    })
    setNotif({ phase: 'idle', done: 0, total: 0, sent: 0, failed: 0, msg: '' })
    setPaso('resultado')
    setModal({ tipo: 'resultado', proyecto: p })
  }

  /* ── Editor artículos ── */
  const setArt = (i, patch) => setArticulos(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  const addArt = () => setArticulos(prev => [...prev, emptyArt()])
  const delArt = (i) => setArticulos(prev => prev.filter((_, idx) => idx !== i))

  /* ── Importar desde archivo: extrae el texto en el navegador y detecta
     número, título, fecha y articulado para prellenar el formulario. No usa
     IA ni funciones serverless (respeta el tope de 12 de Vercel). Acepta el
     archivo por arrastre (escritorio) o por selección/toque (móvil). ── */
  const importBusy = imp.phase === 'leyendo' || busy

  async function procesarArchivo(file) {
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      setImp({ phase: 'error', progress: 0, msg: 'El archivo supera los 25 MB.', resumen: null })
      return
    }
    setImp({ phase: 'leyendo', progress: 0, msg: 'Leyendo el documento…', resumen: null })
    try {
      const [{ extractDocText }, { parseProyectoLey }] = await Promise.all([
        import('../../utils/extractDocText'),
        import('../../utils/parseProyectoLey'),
      ])
      const { text } = await extractDocText(file, { onProgress: (p) => setImp(s => ({ ...s, progress: p })) })
      if (!text || text.trim().length < 40) {
        setImp({ phase: 'error', progress: 0, resumen: null,
          msg: 'No se encontró texto legible. Si el PDF es una imagen escaneada, no tiene texto seleccionable: usa un PDF con texto o un Word.' })
        return
      }
      const r = parseProyectoLey(text)
      if (!r.numero && !r.nombre && r.articulos.length === 0) {
        setImp({ phase: 'error', progress: 0, resumen: null,
          msg: 'Se leyó el archivo pero no se reconoció la estructura de un proyecto de ley. Revisa y completa los campos a mano.' })
        return
      }
      // Prellenar sin pisar lo ya escrito cuando la detección viene vacía.
      setForm(f => ({
        ...f,
        nombre:           r.nombre || f.nombre,
        numero:           r.numero || f.numero,
        fecha_radicacion: r.fecha_radicacion || f.fecha_radicacion,
        descripcion:      r.descripcion || f.descripcion,
      }))
      if (r.articulos.length > 0) {
        setForm(f => ({ ...f, permite_articulado: true }))
        setArticulos(r.articulos.map(a => ({ numero: a.numero, titulo: a.titulo, contenido: a.contenido })))
      }
      setImp({ phase: 'done', progress: 1, msg: '', resumen: r.meta })
    } catch (err) {
      setImp({ phase: 'error', progress: 0, resumen: null, msg: err.message || 'No se pudo procesar el archivo.' })
    }
  }

  // <input type=file> (toque/clic → funciona en celular, donde no hay arrastre).
  function onInputChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''                 // permite re-elegir el mismo archivo
    procesarArchivo(file)
  }
  const abrirSelector = () => { if (!importBusy) fileRef.current?.click() }

  // Arrastrar y soltar (solo escritorio: en táctil estos eventos no se disparan).
  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    if (importBusy) return
    procesarArchivo(e.dataTransfer?.files?.[0])
  }
  function onDragOver(e) { e.preventDefault() }
  function onDragEnter(e) { e.preventDefault(); if (!importBusy) setDragging(true) }
  function onDragLeave(e) {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget)) return   // sigue dentro de la zona
    setDragging(false)
  }

  /* ── Acciones ── */
  async function guardar() {
    if (!form.nombre.trim()) return alert('El nombre del proyecto es obligatorio.')
    setBusy(true)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        numero: form.numero.trim() || null,
        descripcion: form.descripcion.trim() || null,
        fecha_radicacion: form.fecha_radicacion || null,
        enlace_documento: form.enlace_documento.trim() || null,
        permite_articulado: form.permite_articulado,
        publicado: form.publicado,
      }
      let id = form.id
      if (id) await actualizarProyecto(id, payload)
      else { const creado = await crearProyecto(payload); id = creado?.id }
      if (!id) throw new Error('No se pudo guardar el proyecto.')
      await reemplazarArticulos(id, articulos)
      await cargar()
      setModal(null)
    } catch (e) { alert(e.message || 'Error al guardar.') }
    finally { setBusy(false) }
  }
  async function confirmarPublicar() {
    const p = modal.proyecto
    setBusy(true)
    await actualizarProyecto(p.id, { publicado: !p.publicado })
    await cargar()
    setBusy(false); setModal(null)
  }
  async function confirmarEliminar() {
    const p = modal.proyecto
    setBusy(true)
    await eliminarProyecto(p.id)
    await cargar()
    setBusy(false); setModal(null)
  }

  /* ── Resultado del trámite + notificación a votantes ── */
  async function guardarResultado() {
    const p = modal.proyecto
    if (!resForm.estado) return alert('Elige si el proyecto fue aprobado o no aprobado.')
    setBusy(true)
    try {
      const patch = {
        estado_resultado: resForm.estado,
        resultado_fecha:  resForm.fecha || hoyISO(),
        resultado_notas:  resForm.notas.trim() || null,
      }
      const ok = await actualizarProyecto(p.id, patch)
      if (!ok) throw new Error('No se pudo guardar el resultado.')
      // Refresca la lista y el proyecto del modal para habilitar "Notificar".
      const lista = await fetchProyectosAdmin()
      setProyectos(lista)
      const actualizado = lista.find(x => x.id === p.id) || { ...p, ...patch }
      setModal({ tipo: 'resultado', proyecto: actualizado })
      setNotif(n => ({ ...n, msg: 'Resultado guardado. Ya puedes notificar a los votantes.' }))
      setPaso('notificar')   // paso 2: avisar a los votantes
    } catch (e) { alert(e.message || 'Error al guardar el resultado.') }
    finally { setBusy(false) }
  }

  async function notificarVotantes() {
    const p = modal.proyecto
    if (!p.estado_resultado) return alert('Primero guarda el resultado (aprobado / no aprobado).')
    setNotif({ phase: 'preparando', done: 0, total: 0, sent: 0, failed: 0, msg: 'Reuniendo votantes…' })
    try {
      const [detalle, arts] = await Promise.all([fetchVotosDetalle(p.id), fetchArticulos(p.id)])
      const recipients = construirVotantes(detalle)
      if (recipients.length === 0) {
        setNotif({ phase: 'done', done: 0, total: 0, sent: 0, failed: 0, msg: 'No hay votantes con correo para notificar.' })
        return
      }
      setNotif(n => ({ ...n, phase: 'preparando', total: recipients.length, msg: 'Generando el PDF del proyecto…' }))
      // PDF del proyecto completo (nacional, completo + cada artículo) para adjuntar.
      const { generarReportePDFBase64 } = await import('../../lib/proyectosPdf')
      const base64 = await generarReportePDFBase64({
        proyecto: p, articulos: arts, resumen: await import('../../lib/proyectosLey').then(m => m.fetchResumen(p.id)),
        filtro: { nivel: 'nacional' }, scopeSel: 'todos',
      })
      const filename = `resultados-${(p.numero || p.nombre || 'proyecto').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.pdf`

      setNotif(n => ({ ...n, phase: 'enviando', msg: '' }))
      const proyectoPayload = {
        nombre: p.nombre, numero: p.numero || null, estado: p.estado_resultado,
        fecha: p.resultado_fecha || null, enlace: p.enlace_documento || null, notas: p.resultado_notas || null,
      }
      const r = await notificarResultadoVotantes({
        proyecto: proyectoPayload,
        recipients,
        pdf: { base64, filename },
        onProgress: (done, total) => setNotif(n => ({ ...n, done, total })),
      })
      // Sella la fecha de notificación (best-effort).
      await actualizarProyecto(p.id, { resultado_notificado_at: new Date().toISOString() }).catch(() => {})
      setNotif({
        phase: 'done', done: recipients.length, total: recipients.length,
        sent: r.sent, failed: r.failed,
        msg: r.demo
          ? `Modo prueba: se habrían enviado ${r.sent} correos (no se envió nada real).`
          : `Listo: ${r.sent} correos enviados${r.failed ? `, ${r.failed} fallidos` : ''}.`,
      })
    } catch (e) {
      console.error('[notificar] error', e)
      setNotif(n => ({ ...n, phase: 'done', msg: 'Ocurrió un error al notificar. Intenta de nuevo.' }))
    }
  }

  async function descargarDetalle(p) {
    const [votos, arts] = await Promise.all([fetchVotosDetalle(p.id), fetchArticulos(p.id)])
    const artMap = {}; arts.forEach(a => { artMap[a.id] = a })
    const cab = ['Fecha', 'Ámbito', 'Postura', 'Observaciones', 'Nombre', 'Cédula', 'Celular', 'Correo', 'Departamento', 'Municipio/Localidad']
    const filas = votos.map(v => [
      new Date(v.created_at).toLocaleString('es-CO'),
      v.articulo_id ? `Artículo ${artMap[v.articulo_id]?.numero ?? '—'}` : 'Proyecto completo',
      apoyaMeta(v.apoya).label, v.observaciones || '',
      v.nombre || '', v.cedula || '', v.celular || '', v.correo || '', v.departamento || '', v.municipio || '',
    ])
    const nombre = `reporte-detallado-${(p.numero || p.nombre || 'proyecto').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.csv`
    descargarArchivo(nombre, toCSV(cab, filas))
  }

  /* ═══════════════ Lista ═══════════════ */
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>Proyectos de ley</h3>
          <p className={styles.sub}>Publica proyectos para el debate ciudadano y consulta los resultados.</p>
        </div>
        <button className={styles.newBtn} onClick={nuevoProyecto}>+ Nuevo proyecto</button>
      </div>

      {Array.isArray(proyectos) && proyectos.length > 0 && (
        <div className={styles.filtros}>
          <div className={styles.buscador}>
            <svg className={styles.buscadorIcon} viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, número o tema…" aria-label="Buscar proyectos de ley"
            />
            {busqueda && (
              <button type="button" className={styles.buscadorClear} onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda">✕</button>
            )}
          </div>
          <div className={styles.fechas}>
            <label className={styles.fechaField}>
              <span>Radicado desde</span>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)} max={hasta || undefined} />
            </label>
            <label className={styles.fechaField}>
              <span>Radicado hasta</span>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} min={desde || undefined} />
            </label>
          </div>
          {hayFiltro && (
            <button type="button" className={styles.limpiarBtn} onClick={limpiarFiltros}>Limpiar</button>
          )}
        </div>
      )}
      {hayFiltro && Array.isArray(proyectos) && proyectos.length > 0 && (
        <p className={styles.filtroCount} aria-live="polite">
          {proyectosFiltrados.length === 0
            ? 'Sin coincidencias'
            : `Mostrando ${proyectosFiltrados.length} de ${proyectos.length} proyecto${proyectos.length === 1 ? '' : 's'}`}
        </p>
      )}

      {proyectos === null ? (
        <p className={styles.muted}>Cargando proyectos…</p>
      ) : proyectos.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">🏛️</span>
          <p>Aún no has creado ningún proyecto de ley.</p>
          <button className={styles.newBtn} onClick={nuevoProyecto}>+ Crear el primero</button>
        </div>
      ) : proyectosFiltrados.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">🔎</span>
          <p>Ningún proyecto coincide con la búsqueda o el rango de fechas.</p>
          <button className={styles.limpiarBtn} onClick={limpiarFiltros}>Limpiar filtros</button>
        </div>
      ) : (
        <ul className={styles.list}>
          {proyectosFiltrados.map(p => (
            <li key={p.id} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.itemMeta}>
                  <span className={`${styles.estado} ${p.publicado ? styles.pub : styles.borrador}`}>
                    {p.publicado ? 'Publicado' : 'Borrador'}
                  </span>
                  {p.estado_resultado && (
                    <span className={`${styles.estado} ${p.estado_resultado === 'aprobado' ? styles.aprobado : styles.rechazado}`}>
                      {p.estado_resultado === 'aprobado' ? 'Aprobado' : 'No aprobado'}
                    </span>
                  )}
                  {p.numero && <span className={styles.numero}>{p.numero}</span>}
                  {p.fecha_radicacion && <span className={styles.fecha}>Radicado {fmtFecha(p.fecha_radicacion)}</span>}
                </div>
                <h4 className={styles.itemName}>{p.nombre}</h4>
              </div>
              <div className={styles.itemActions}>
                <button className={styles.act} onClick={() => verResultados(p)}>Estadísticas</button>
                <button className={styles.act} onClick={() => abrirResultado(p)}>Definir resultado</button>
                <button className={styles.act} onClick={() => setModal({ tipo: 'publish', proyecto: p })}>
                  {p.publicado ? 'Despublicar' : 'Publicar'}
                </button>
                <button className={`${styles.act} ${styles.actIcon}`} onClick={() => editar(p)} title="Editar" aria-label="Editar proyecto">
                  <IconEdit />
                </button>
                <button className={`${styles.act} ${styles.actIcon} ${styles.danger}`} onClick={() => setModal({ tipo: 'delete', proyecto: p })} title="Eliminar" aria-label="Eliminar proyecto">
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ═══════════════ Modales ═══════════════ */}
      {createPortal(
        <AnimatePresence>
          {modal?.tipo === 'edit' && (
            <ModalShell
              key="edit"
              onClose={cerrar}
              closeDisabled={busy}
              size="lg"
              title={form.id ? 'Editar proyecto' : 'Nuevo proyecto de ley'}
              subtitle="Los proyectos publicados aparecen en el debate ciudadano."
              footer={
                <>
                  <button className={styles.cancel} onClick={cerrar} disabled={busy}>Cancelar</button>
                  <button className={styles.save} onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar proyecto'}</button>
                </>
              }
            >
              {/* Importar desde archivo: arrastra (escritorio) o toca para elegir
                  (móvil). Detecta título, número, fecha y artículos. */}
              <div className={styles.importBox}>
                <div
                  className={`${styles.importZone} ${dragging ? styles.importZoneDrag : ''} ${importBusy ? styles.importZoneBusy : ''}`}
                  role="button" tabIndex={0}
                  onClick={abrirSelector}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirSelector() } }}
                  onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}
                  aria-label="Importar proyecto desde archivo: arrastra un PDF o Word aquí, o toca para elegirlo"
                >
                  <div className={styles.importIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 15 3-3 3 3" /><path d="M12 12v6" />
                    </svg>
                  </div>
                  <div className={styles.importText}>
                    <strong>Importar desde archivo</strong>
                    <span>
                      <span className={styles.soloDesktop}>Arrastra aquí el archivo o </span>
                      <span className={styles.soloMovil}>Toca para elegir un archivo</span>
                      <span className={styles.soloDesktop}>toca para elegirlo</span>
                      {' '}(PDF con texto, Word .docx o TXT). Detectamos título, número, fecha y artículos.
                    </span>
                  </div>
                  <span className={`${styles.importBtn} ${imp.phase === 'leyendo' ? styles.importBtnBusy : ''}`} aria-hidden="true">
                    {imp.phase === 'leyendo' ? 'Leyendo…' : 'Elegir archivo'}
                  </span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={onInputChange}
                  disabled={importBusy}
                  hidden
                />

                {imp.phase === 'leyendo' && (
                  <div className={styles.importProg}>
                    <div className={styles.importProgBar}>
                      <div className={styles.importProgFill} style={{ width: `${Math.max(8, Math.round(imp.progress * 100))}%` }} />
                    </div>
                    <span>{imp.msg}</span>
                  </div>
                )}
                {imp.phase === 'done' && imp.resumen && (
                  <p className={styles.importOk}>
                    ✓ Detectado:
                    {imp.resumen.detecto.numero && ' número,'}
                    {imp.resumen.detecto.nombre && ' título,'}
                    {imp.resumen.detecto.fecha && ' fecha,'}
                    {' '}{imp.resumen.totalArticulos} artículo{imp.resumen.totalArticulos === 1 ? '' : 's'}.
                    {' '}<b>Revisa y ajusta antes de guardar.</b>
                  </p>
                )}
                {imp.phase === 'error' && (
                  <p className={styles.importErr}>{imp.msg}</p>
                )}
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Nombre del proyecto *</span>
                  <input autoFocus value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Reforma al Código de Comercio" />
                </label>
                <label className={styles.field}>
                  <span>Número / radicado</span>
                  <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Proyecto de Ley 123 de 2026" />
                </label>
                <label className={styles.field}>
                  <span>Fecha de radicación</span>
                  <input type="date" value={form.fecha_radicacion || ''} onChange={e => setForm(f => ({ ...f, fecha_radicacion: e.target.value }))} />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Enlace al documento oficial</span>
                  <input type="url" value={form.enlace_documento} onChange={e => setForm(f => ({ ...f, enlace_documento: e.target.value }))} placeholder="https://www.camara.gov.co/…  (donde está colgado el proyecto completo)" />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Descripción</span>
                  <textarea rows={5} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Resumen del proyecto para la ciudadanía…" />
                </label>
              </div>

              <div className={styles.switches}>
                <label className={styles.switch}>
                  <input type="checkbox" checked={form.permite_articulado} onChange={e => setForm(f => ({ ...f, permite_articulado: e.target.checked }))} />
                  <span>Permitir votación artículo por artículo</span>
                </label>
                <label className={styles.switch}>
                  <input type="checkbox" checked={form.publicado} onChange={e => setForm(f => ({ ...f, publicado: e.target.checked }))} />
                  <span>Publicado (visible para la ciudadanía)</span>
                </label>
              </div>

              <div className={styles.artsEditor}>
                <div className={styles.artsHead}>
                  <h4>Articulado <small>({articulos.length})</small></h4>
                  <button className={styles.addBtn} onClick={addArt}>+ Añadir artículo</button>
                </div>
                {articulos.length === 0 && <p className={styles.hint}>Sin artículos: la ciudadanía votará solo el proyecto completo.</p>}
                {articulos.map((a, i) => (
                  <div key={i} className={styles.artRow}>
                    <input className={styles.artNum} value={a.numero} onChange={e => setArt(i, { numero: e.target.value })} placeholder="N°" inputMode="numeric" />
                    <div className={styles.artFields}>
                      <input value={a.titulo} onChange={e => setArt(i, { titulo: e.target.value })} placeholder="Título del artículo" />
                      <textarea rows={5} value={a.contenido} onChange={e => setArt(i, { contenido: e.target.value })} placeholder="Texto del artículo (opcional)" />
                    </div>
                    <button className={styles.delBtn} onClick={() => delArt(i)} title="Eliminar artículo" aria-label="Eliminar artículo">✕</button>
                  </div>
                ))}
              </div>
            </ModalShell>
          )}

          {modal?.tipo === 'publish' && (
            <ModalShell
              key="publish"
              onClose={cerrar}
              closeDisabled={busy}
              size="sm"
              title={modal.proyecto.publicado ? 'Despublicar proyecto' : 'Publicar proyecto'}
              footer={
                <>
                  <button className={styles.cancel} onClick={cerrar} disabled={busy}>Cancelar</button>
                  <button className={modal.proyecto.publicado ? styles.delDanger : styles.save} onClick={confirmarPublicar} disabled={busy}>
                    {busy ? 'Aplicando…' : (modal.proyecto.publicado ? 'Despublicar' : 'Publicar')}
                  </button>
                </>
              }
            >
              <p className={styles.confirmText}>
                {modal.proyecto.publicado
                  ? <>El proyecto <strong>«{modal.proyecto.nombre}»</strong> dejará de ser visible para la ciudadanía y no se podrá votar. Los votos ya registrados se conservan.</>
                  : <>El proyecto <strong>«{modal.proyecto.nombre}»</strong> quedará visible para la ciudadanía y abierto a votación.</>}
              </p>
            </ModalShell>
          )}

          {modal?.tipo === 'delete' && (
            <ModalShell
              key="delete"
              onClose={cerrar}
              closeDisabled={busy}
              size="sm"
              title="Eliminar proyecto"
              footer={
                <>
                  <button className={styles.cancel} onClick={cerrar} disabled={busy}>Cancelar</button>
                  <button className={styles.delDanger} onClick={confirmarEliminar} disabled={busy}>{busy ? 'Eliminando…' : 'Sí, eliminar'}</button>
                </>
              }
            >
              <p className={styles.confirmText}>
                Vas a eliminar <strong>«{modal.proyecto.nombre}»</strong>. Se borran también sus artículos y todos los votos. Esta acción no se puede deshacer.
              </p>
            </ModalShell>
          )}

          {modal?.tipo === 'resultados' && (
            <ModalShell
              key="resultados"
              onClose={cerrar}
              size="xl"
              title={modal.proyecto.nombre}
              subtitle={modal.proyecto.numero || 'Resultados del debate'}
              footer={<button className={styles.cerrarBtn} onClick={cerrar}>Cerrar</button>}
            >
              <div className={styles.resHead}>
                <button className={styles.reportBtn} onClick={() => descargarDetalle(modal.proyecto)}>
                  Descargar reporte detallado (CSV)
                </button>
                <span className={styles.resNota}>Incluye datos de contacto (solo visibles para administración).</span>
              </div>
              <ResultadosProyecto proyecto={modal.proyecto} articulos={selArts} isAdmin />
            </ModalShell>
          )}

          {modal?.tipo === 'resultado' && (
            <ModalShell
              key="resultado"
              onClose={cerrar}
              closeDisabled={notif.phase === 'enviando' || notif.phase === 'preparando'}
              size="md"
              title={paso === 'resultado' ? 'Resultado del proyecto' : 'Avisar a los votantes'}
              subtitle={modal.proyecto.numero || modal.proyecto.nombre}
              footer={paso === 'resultado' ? (
                <button className={styles.save} onClick={guardarResultado} disabled={busy || !resForm.estado}>
                  {busy ? 'Guardando…' : (modal.proyecto.estado_resultado ? 'Actualizar resultado' : 'Guardar resultado')}
                </button>
              ) : (
                <button
                  className={styles.notifBtn}
                  onClick={notificarVotantes}
                  disabled={!modal.proyecto.estado_resultado || notif.phase === 'enviando' || notif.phase === 'preparando'}
                >
                  {notif.phase === 'enviando' || notif.phase === 'preparando' ? 'Enviando…' : 'Notificar a los votantes'}
                </button>
              )}
            >
              {/* Indicador de los dos pasos */}
              <div className={styles.pasos} aria-hidden="true">
                <span className={`${styles.pasoDot} ${paso === 'resultado' ? styles.pasoDotOn : styles.pasoDotDone}`}>1</span>
                <span className={styles.pasoLinea} />
                <span className={`${styles.pasoDot} ${paso === 'notificar' ? styles.pasoDotOn : ''}`}>2</span>
              </div>

              {paso === 'resultado' ? (
                <div className={styles.resultadoBox}>
                  <span className={styles.resLabel}>¿El proyecto fue aprobado?</span>
                  <div className={styles.resChoice} role="radiogroup" aria-label="Resultado del proyecto">
                    {[['aprobado', 'Aprobado'], ['rechazado', 'No aprobado']].map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={resForm.estado === k}
                        className={`${styles.resOpt} ${resForm.estado === k ? (k === 'aprobado' ? styles.resOptOk : styles.resOptNo) : ''}`}
                        onClick={() => setResForm(f => ({ ...f, estado: k }))} disabled={busy}>
                        {l}
                      </button>
                    ))}
                  </div>

                  <div className={styles.resGrid}>
                    <label className={styles.field}>
                      <span>Fecha del resultado</span>
                      <input type="date" value={resForm.fecha} onChange={e => setResForm(f => ({ ...f, fecha: e.target.value }))} disabled={busy} />
                    </label>
                  </div>
                  <label className={`${styles.field} ${styles.fieldFull}`}>
                    <span>Nota para los votantes (opcional)</span>
                    <textarea rows={3} value={resForm.notas} onChange={e => setResForm(f => ({ ...f, notas: e.target.value }))} placeholder="Ej: El proyecto fue aprobado en segundo debate y pasa a sanción presidencial." disabled={busy} />
                  </label>

                  {!modal.proyecto.enlace_documento && (
                    <p className={styles.resAviso}>Sugerencia: agrega el <strong>enlace al documento oficial</strong> en «Editar» para que el correo lo incluya.</p>
                  )}
                </div>
              ) : (
                <div className={styles.notifBox}>
                  <button type="button" className={styles.volverLink} onClick={() => setPaso('resultado')} disabled={notif.phase === 'enviando' || notif.phase === 'preparando'}>
                    ← Volver al resultado
                  </button>

                  {modal.proyecto.estado_resultado && (
                    <div className={`${styles.resumenChip} ${modal.proyecto.estado_resultado === 'aprobado' ? styles.resumenOk : styles.resumenNo}`}>
                      {modal.proyecto.estado_resultado === 'aprobado' ? '✓ Aprobado' : '✕ No aprobado'}
                      {modal.proyecto.resultado_fecha ? ` · ${fmtFecha(modal.proyecto.resultado_fecha)}` : ''}
                    </div>
                  )}

                  <p className={styles.notifSub}>
                    Se enviará un correo con el diseño de Parada Bridge a cada votante (con su nombre,
                    cédula, el voto que realizó, la fecha y el PDF del proyecto adjunto).
                  </p>

                  {(notif.phase === 'enviando' || notif.phase === 'preparando') && (
                    <div className={styles.progressWrap}>
                      <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${notif.total ? Math.round((notif.done / notif.total) * 100) : 8}%` }} />
                      </div>
                      <span className={styles.progressTxt}>
                        {notif.msg || `Enviando ${notif.done} de ${notif.total}…`}
                      </span>
                    </div>
                  )}
                  {notif.phase === 'done' && notif.msg && (
                    <p className={`${styles.notifResult} ${notif.failed ? styles.notifWarn : styles.notifOk}`}>{notif.msg}</p>
                  )}
                </div>
              )}
            </ModalShell>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
