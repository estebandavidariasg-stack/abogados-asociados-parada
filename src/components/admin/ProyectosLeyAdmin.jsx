import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ResultadosProyecto from '../proyectos/ResultadosProyecto'
import {
  fetchProyectosAdmin, fetchArticulos, crearProyecto, actualizarProyecto,
  eliminarProyecto, reemplazarArticulos, fetchVotosDetalle,
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
  permite_articulado: true, publicado: false,
})
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

export default function ProyectosLeyAdmin() {
  const [proyectos, setProyectos] = useState(null)
  const [busy, setBusy]           = useState(false)
  // modal: null | { tipo: 'edit'|'delete'|'publish'|'resultados', proyecto? }
  const [modal, setModal]         = useState(null)

  const [form, setForm]           = useState(emptyForm())
  const [articulos, setArticulos] = useState([])
  const [selArts, setSelArts]     = useState([])

  const cargar = useCallback(async () => { setProyectos(await fetchProyectosAdmin()) }, [])
  useEffect(() => { cargar() }, [cargar])

  const cerrar = () => { if (!busy) setModal(null) }

  /* ── Abrir modales ── */
  function nuevoProyecto() {
    setForm(emptyForm()); setArticulos([]); setModal({ tipo: 'edit' })
  }
  async function editar(p) {
    setForm({
      id: p.id, nombre: p.nombre || '', numero: p.numero || '',
      descripcion: p.descripcion || '', fecha_radicacion: p.fecha_radicacion || '',
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

  /* ── Editor artículos ── */
  const setArt = (i, patch) => setArticulos(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  const addArt = () => setArticulos(prev => [...prev, emptyArt()])
  const delArt = (i) => setArticulos(prev => prev.filter((_, idx) => idx !== i))

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

  async function descargarDetalle(p) {
    const [votos, arts] = await Promise.all([fetchVotosDetalle(p.id), fetchArticulos(p.id)])
    const artMap = {}; arts.forEach(a => { artMap[a.id] = a })
    const cab = ['Fecha', 'Ámbito', 'Postura', 'Observaciones', 'Nombre', 'Celular', 'Correo', 'Departamento', 'Municipio']
    const filas = votos.map(v => [
      new Date(v.created_at).toLocaleString('es-CO'),
      v.articulo_id ? `Artículo ${artMap[v.articulo_id]?.numero ?? '—'}` : 'Proyecto completo',
      apoyaMeta(v.apoya).label, v.observaciones || '',
      v.nombre || '', v.celular || '', v.correo || '', v.departamento || '', v.municipio || '',
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

      {proyectos === null ? (
        <p className={styles.muted}>Cargando proyectos…</p>
      ) : proyectos.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">🏛️</span>
          <p>Aún no has creado ningún proyecto de ley.</p>
          <button className={styles.newBtn} onClick={nuevoProyecto}>+ Crear el primero</button>
        </div>
      ) : (
        <ul className={styles.list}>
          {proyectos.map(p => (
            <li key={p.id} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.itemMeta}>
                  <span className={`${styles.estado} ${p.publicado ? styles.pub : styles.borrador}`}>
                    {p.publicado ? 'Publicado' : 'Borrador'}
                  </span>
                  {p.numero && <span className={styles.numero}>{p.numero}</span>}
                  {p.fecha_radicacion && <span className={styles.fecha}>Radicado {fmtFecha(p.fecha_radicacion)}</span>}
                </div>
                <h4 className={styles.itemName}>{p.nombre}</h4>
              </div>
              <div className={styles.itemActions}>
                <button className={styles.act} onClick={() => verResultados(p)}>Resultados</button>
                <button className={styles.act} onClick={() => editar(p)}>Editar</button>
                <button className={styles.act} onClick={() => setModal({ tipo: 'publish', proyecto: p })}>
                  {p.publicado ? 'Despublicar' : 'Publicar'}
                </button>
                <button className={`${styles.act} ${styles.danger}`} onClick={() => setModal({ tipo: 'delete', proyecto: p })}>Eliminar</button>
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
                  <span>Descripción</span>
                  <textarea rows={3} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Resumen del proyecto para la ciudadanía…" />
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
                      <textarea rows={2} value={a.contenido} onChange={e => setArt(i, { contenido: e.target.value })} placeholder="Texto del artículo (opcional)" />
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
              <ResultadosProyecto proyecto={modal.proyecto} articulos={selArts} />
            </ModalShell>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
