import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ResultadosProyecto from '../proyectos/ResultadosProyecto'
import {
  fetchProyectosAdmin, fetchArticulos, crearProyecto, actualizarProyecto,
  eliminarProyecto, reemplazarArticulos, fetchVotosDetalle,
  construirVotantes, notificarResultadoVotantes,
  apoyaMeta, toCSV, descargarArchivo, fmtFecha,
  romano, marcasDeTitulo, tituloCase,
} from '../../lib/proyectosLey'
import { getAuthHeaders } from '../../lib/supabase'
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
  // Los identifica el parser; se guardan si la BD ya tiene las columnas
  // (docs/sql/proyectos-2026-09-17.sql). Si no, `guardar` reintenta sin ellas.
  autores: '', exposicion_motivos: '',
  // El título legal completo va aparte del nombre: `nombre` es el rótulo
  // corto de las tarjetas y `titulo_oficial` la fórmula "por medio de la
  // cual...", que en una ley real pasa de los 300 caracteres.
  titulo_oficial: '',
  // Guardado solo para que el formulario sepa qué campos aplican.
  tipo_doc: '',
})
// Fecha local YYYY-MM-DD (para inputs de tipo date sin desfase de zona horaria).
const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const emptyArt = () => ({ numero: '', seccion: '', titulo: '', contenido: '' })

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

/* ── Paginación ───────────────────────────────────────────────
   Con cientos de proyectos la lista entera es inmanejable: hay que recorrerla
   a rueda y el navegador pinta cada fila con sus cinco botones. Mismo patrón
   que el resto del panel (Pagos y cobros, PQRS): selector de cuántos por
   página, rango visible y ventana de números. */
const POR_PAGINA_OPTS = [10, 20, 50]

// Ventana de numeros: extremos siempre, y el vecindario de la actual. Con 67
// paginas, pintarlas todas seria peor que no paginar.
function ventanaPags(actual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out = [1]
  const lo = Math.max(2, actual - 1)
  const hi = Math.min(total - 1, actual + 1)
  if (lo > 2) out.push('…')
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < total - 1) out.push('…')
  out.push(total)
  return out
}

const IconChevL = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
)
const IconChevR = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

function Pager({ pagina, porPagina, total, onPagina, onPorPagina }) {
  const pags = Math.max(1, Math.ceil(total / porPagina))
  const actual = Math.min(pagina, pags)
  const desde = total === 0 ? 0 : (actual - 1) * porPagina + 1
  const hasta = Math.min(actual * porPagina, total)

  return (
    <div className={styles.pager}>
      <div className={styles.perPage}>
        <label htmlFor="pl-porpagina" className={styles.perPageLbl}>Proyectos por página</label>
        <select
          id="pl-porpagina"
          className={styles.perPageSel}
          value={porPagina}
          onChange={(e) => onPorPagina(Number(e.target.value))}
        >
          {POR_PAGINA_OPTS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <span className={styles.pagerInfo} aria-live="polite">
        <strong>{desde}–{hasta}</strong> de {total}
      </span>

      <div className={styles.pagerBtns} role="navigation" aria-label="Paginación de proyectos">
        <button className={styles.pageBtn} onClick={() => onPagina(actual - 1)} disabled={actual <= 1} aria-label="Página anterior">
          <IconChevL />
        </button>
        {ventanaPags(actual, pags).map((n, i) => (
          n === '…'
            ? <span key={`s${i}`} className={styles.pageGap}>…</span>
            : (
              <button
                key={n}
                className={`${styles.pageBtn} ${n === actual ? styles.pageBtnActive : ''}`}
                onClick={() => onPagina(n)}
                aria-current={n === actual ? 'page' : undefined}
                aria-label={`Página ${n}`}
              >
                {n}
              </button>
            )
        ))}
        <button className={styles.pageBtn} onClick={() => onPagina(actual + 1)} disabled={actual >= pags} aria-label="Página siguiente">
          <IconChevR />
        </button>
      </div>
    </div>
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

  // Paginación. Filtrar o cambiar el tamaño de página devuelve a la primera:
  // si no, uno se queda mirando una página 12 que ya no existe.
  const [pagina, setPagina]     = useState(1)
  const [porPagina, setPorPagina] = useState(20)
  useEffect(() => { setPagina(1) }, [busqueda, desde, hasta, porPagina])
  const totalPags  = Math.max(1, Math.ceil(proyectosFiltrados.length / porPagina))
  const pagSegura  = Math.min(pagina, totalPags)
  const enPagina   = proyectosFiltrados.slice((pagSegura - 1) * porPagina, pagSegura * porPagina)
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
      autores: p.autores || '', exposicion_motivos: p.exposicion_motivos || '',
      titulo_oficial: p.titulo_oficial || '',
      tipo_doc: '',
    })
    setArticulos([])
    setModal({ tipo: 'edit', proyecto: p })
    const arts = await fetchArticulos(p.id)
    setArticulos(arts.map(a => ({ numero: a.numero ?? '', seccion: a.seccion || '', titulo: a.titulo || '', contenido: a.contenido || '' })))
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

  /* ── Títulos del articulado ──────────────────────────────────────────────
     El título vive dentro de cada artículo (`seccion`), no en una lista
     aparte: la cabecera se pinta donde el nombre cambia. Por eso crear,
     renombrar o quitar un título es escribir en el BLOQUE entero de artículos
     que lo comparten, no en uno solo. El numeral romano no se guarda: sale
     del orden (ver `marcasDeTitulo`), así que añadir o quitar un título
     renumera lo que sigue sin que nadie lo toque. */
  const marcas = useMemo(() => marcasDeTitulo(articulos), [articulos])
  // Mientras se escribe el nombre, la cabecera no puede desaparecer al
  // quedar vacía: el campo se esfumaría debajo del cursor.
  const [tituloFoco, setTituloFoco] = useState(null)
  const ordenTitulo = (i) => marcas[i]?.orden || (marcas.slice(0, i).filter(Boolean).length + 1)

  const pintarBloque = (i, nombre) => setArticulos(prev => {
    const actual = prev[i]?.seccion || ''
    let hasta = i
    while (hasta + 1 < prev.length && (prev[hasta + 1].seccion || '') === actual) hasta += 1
    return prev.map((a, idx) => (idx >= i && idx <= hasta ? { ...a, seccion: nombre } : a))
  })
  // Quitar un título no borra artículos: los devuelve al título anterior (o
  // los deja sueltos, si era el primero).
  const quitarTitulo = (i) => pintarBloque(i, i === 0 ? '' : (articulos[i - 1]?.seccion || ''))
  // Abrir un título aquí. El nombre por defecto no puede repetir el del
  // bloque anterior: si se repitiera, no habría cambio y la cabecera no se
  // pintaría.
  const abrirTitulo = (i) => {
    const previo = (articulos[i - 1]?.seccion || '').trim()
    let nombre = 'Título sin nombre'
    for (let n = 2; nombre === previo; n++) nombre = `Título sin nombre ${n}`
    pintarBloque(i, nombre)
    setTituloFoco(i)
  }

  /* ── Importar desde archivo: extrae el texto en el navegador y detecta
     número, título, fecha y articulado para prellenar el formulario. No usa
     IA ni funciones serverless (respeta el tope de 12 de Vercel). Acepta el
     archivo por arrastre (escritorio) o por selección/toque (móvil). ── */
  // El tipo lo trae el lector; sin él (alta manual) no se asume nada.
  const esLey = form.tipo_doc === 'ley' || form.tipo_doc === 'acto_legislativo'
  const importBusy = imp.phase === 'leyendo' || busy

  /* El núcleo: documento → datos. No toca el formulario ni el estado de
     la importación, para que sirva igual al alta de uno y a la carga masiva.
     Lanza con un mensaje legible cuando el documento no da para más.

     Tres pasos, y el reparto no es caprichoso: cada herramienta hace lo que
     sabe hacer.

     1. El parser de regex SEPARA el articulado. Eso lo hace bien: en la Ley
        2173 encuentra los 19 artículos sin colarse ni uno de los que el texto
        cita. Lo que no sabe es limpiar.
     2. La IA lee la CABECERA (número, título, fecha, autores, descripción).
        Ahí la regex se equivocaba de ley y arrastraba la basura del OCR.
     3. La IA limpia los artículos POR LOTES de cinco.

     Por qué por lotes y no de una: una función de Vercel en Hobby muere a los
     60 segundos, y transcribir 19 artículos son dos o tres minutos de salida.
     La llamada única se cortaba y todo caía al respaldo: era exactamente lo
     que se veía en pantalla. En lotes, cada llamada cabe de sobra. */
  async function leerDocumento(file, onPaso = () => {}) {
    if (file.size > 25 * 1024 * 1024) throw new Error('El archivo supera los 25 MB.')
    const { extractDocText } = await import('../../utils/extractDocText')
    const { text } = await extractDocText(file, { onProgress: (p) => onPaso(p * 0.2, 'Leyendo el documento…') })
    if (!text || text.trim().length < 40) {
      throw new Error('No se encontró texto legible. Si el PDF es una imagen escaneada sin capa de texto, no hay nada que extraer: usa un PDF con texto seleccionable o un Word.')
    }

    // Paso 1 · estructura, en el navegador y gratis.
    const { parseProyectoLey } = await import('../../utils/parseProyectoLey')
    const base = parseProyectoLey(text)

    // Paso 2 · cabecera.
    onPaso(0.25, 'Identificando número, título y fecha…')
    const meta = await pedirEtapa({ etapa: 'meta', texto: text })

    // Paso 3 · articulos por lotes, con avance real.
    let arts = base.articulos.map(a => ({ numero: a.numero, seccion: a.seccion || '', titulo: a.titulo, contenido: a.contenido }))
    let limpiados = 0
    if (meta && arts.length > 0) {
      const LOTE = 5
      const salida = []
      for (let i = 0; i < arts.length; i += LOTE) {
        const trozo = arts.slice(i, i + LOTE)
        onPaso(0.3 + 0.65 * (i / arts.length), `Limpiando artículos ${i + 1}-${Math.min(i + LOTE, arts.length)} de ${arts.length}…`)
        const r = await pedirEtapa({ etapa: 'articulos', articulos: trozo })
        if (r?.articulos?.length) {
          // Lo que la IA marca como basura (firmas, sellos) no entra.
          salida.push(...r.articulos.filter(a => !a.descartar && a.contenido))
          limpiados += trozo.length
        } else {
          salida.push(...trozo)   // ese lote se queda como vino
        }
      }
      if (salida.length > 0) arts = salida
    }

    /* Paso 4 · la exposicion de motivos, resumida.
       Literal del documento eran quince paginas con notas al pie y
       bibliografia intercaladas. Se le pide al modelo un resumen ordenado y
       el literal se queda donde estaba: en el documento original. */
    let exposicion = base.exposicion_motivos
    if (meta && exposicion && exposicion.length > 400) {
      onPaso(0.96, 'Ordenando la exposición de motivos…')
      const r = await pedirEtapa({ etapa: 'exposicion', texto: exposicion })
      if (r?.resumen) exposicion = r.resumen
    }

    const datos = {
      tipo:               meta?.tipo || base.tipo,
      numero:             meta?.numero || base.numero,
      // Los documentos vienen GRITADOS; en las tarjetas se ve el nombre.
      nombre:             tituloCase(meta?.nombre || base.nombre),
      titulo_oficial:     meta?.titulo_oficial || base.nombre,
      fecha_radicacion:   meta?.fecha_radicacion || base.fecha_radicacion,
      autores:            meta?.autores || base.autores,
      exposicion_motivos: exposicion,
      descripcion:        meta?.descripcion || base.descripcion,
      articulos: arts,
    }
    if (!datos.numero && !datos.nombre && datos.articulos.length === 0) {
      throw new Error('Se leyó el archivo pero no se reconoció la estructura de un proyecto de ley.')
    }
    return { datos, usoIA: !!meta, limpiados }
  }

  /* Alta de UNO: lee el documento y RELLENA EL FORMULARIO (uno solo, no
     dos: el importador escribe directo sobre los campos que se van a
     guardar). El trabajo pesado es de `leerDocumento`. */
  async function procesarArchivo(file) {
    if (!file) return
    fallo.current = ''
    setImp({ phase: 'leyendo', progress: 0, msg: 'Leyendo el documento…', resumen: null })
    try {
      const { datos, usoIA, limpiados } = await leerDocumento(file, (progress, msg) =>
        setImp(s => ({ ...s, progress, msg })))

      setForm(f => ({
        ...f,
        nombre:             datos.nombre || f.nombre,
        titulo_oficial:     datos.titulo_oficial || f.titulo_oficial,
        tipo_doc:           datos.tipo || f.tipo_doc,
        numero:             datos.numero || f.numero,
        fecha_radicacion:   datos.fecha_radicacion || f.fecha_radicacion,
        descripcion:        datos.descripcion || f.descripcion,
        autores:            datos.autores || f.autores,
        exposicion_motivos: datos.exposicion_motivos || f.exposicion_motivos,
        permite_articulado: datos.articulos.length > 0 ? true : f.permite_articulado,
      }))
      if (datos.articulos.length > 0) setArticulos(datos.articulos.map(a => ({ ...a })))

      setImp({
        phase: 'done', progress: 1, msg: '',
        resumen: { via: usoIA ? 'ia' : 'regex', tipo: datos.tipo, totalArticulos: datos.articulos.length, limpiados, motivo: fallo.current },
      })
    } catch (err) {
      setImp({ phase: 'error', progress: 0, resumen: null, msg: err.message || 'No se pudo procesar el archivo.' })
    }
  }

  /* Una etapa del lector asistido. Devuelve null (no lanza) ante cualquier
     fallo: quien llama decide si sigue con lo que tenga. */
  /* Guarda por qué falló el lector asistido, para poder DECIRLO en pantalla.
     Vivía solo en la consola y eso costó dos rondas de "sigue igual" sin saber
     si era autenticación, la clave o el modelo. */
  const fallo = useRef('')

  async function pedirEtapa(cuerpo) {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'proyecto', ...cuerpo }),
      })
      if (!res.ok) {
        const cuerpoErr = await res.text().catch(() => '')
        // El fallback del SPA responde HTML: señal inequívoca de que las
        // funciones de api/ no están corriendo (falta `vercel dev`).
        const esHtml = /^\s*</.test(cuerpoErr)
        fallo.current =
          esHtml ? 'Las funciones del servidor no están activas. Levanta el proyecto con «vercel dev».'
          : res.status === 401 ? 'Tu sesión no llegó al servidor (401). Vuelve a entrar al panel.'
          : res.status === 403 ? 'Tu cuenta no tiene permiso para usar el lector (403).'
          : res.status === 502 ? (() => {
              // El servidor manda el error real del modelo; mostrarlo ahorra
              // tener que abrir la terminal de `vercel dev` para verlo.
              let d = ''
              try { d = JSON.parse(cuerpoErr)?.detalle || '' } catch { /* sin detalle */ }
              return d ? `El modelo falló: ${d}` : 'El modelo no respondió o devolvió algo ilegible (502).'
            })()
          : `El servidor respondió ${res.status}. ${cuerpoErr.slice(0, 160)}`
        console.warn('[proyectos] etapa', cuerpo.etapa, '→', res.status, cuerpoErr.slice(0, 400))
        return null
      }
      const d = await res.json().catch(() => null)
      if (!d?.ok) {
        fallo.current = 'El servidor contestó sin datos utilizables.'
        return null
      }
      return d
    } catch (e) {
      fallo.current = `No se pudo contactar al servidor: ${e?.message || 'error de red'}.`
      console.warn('[proyectos] etapa', cuerpo.etapa, 'falló:', e)
      return null
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
  /* Escribe el proyecto y su articulado. Lo usan el alta de uno y la carga
     masiva, por eso no toca estado de UI.

     `autores`, `titulo_oficial` y `exposicion_motivos` son columnas nuevas
     (docs/sql/proyectos-2026-09-17.sql). Mientras ese SQL no esté aplicado,
     PostgREST responde 400 por columna desconocida y se perdería el guardado
     entero. Se intenta con ellas y, si las rechaza, se reintenta sin ellas: el
     proyecto se guarda igual y solo esos campos quedan pendientes. */
  const esColumnaAusente = (e) =>
    /column .* does not exist|PGRST204|schema cache/i.test(e?.message || String(e))

  async function persistir(id, campos, arts) {
    const { autores, titulo_oficial, exposicion_motivos, ...base } = campos
    const escribir = async (body) => {
      if (id) { await actualizarProyecto(id, body); return id }
      const creado = await crearProyecto(body)
      return creado?.id
    }
    let destino
    try {
      destino = await escribir(campos)
    } catch (e) {
      if (!esColumnaAusente(e)) throw e
      console.warn('[proyectos] autores/titulo_oficial/exposicion_motivos aún no existen en la BD; se guarda sin ellos.')
      destino = await escribir(base)
    }
    if (!destino) throw new Error('No se pudo guardar el proyecto.')
    await reemplazarArticulos(destino, arts)
    return destino
  }

  async function guardar() {
    if (!form.nombre.trim()) return alert('El nombre del proyecto es obligatorio.')
    setBusy(true)
    try {
      await persistir(form.id, {
        nombre: form.nombre.trim(),
        numero: form.numero.trim() || null,
        descripcion: form.descripcion.trim() || null,
        fecha_radicacion: form.fecha_radicacion || null,
        enlace_documento: form.enlace_documento.trim() || null,
        permite_articulado: form.permite_articulado,
        publicado: form.publicado,
        autores: form.autores.trim() || null,
        titulo_oficial: form.titulo_oficial.trim() || null,
        exposicion_motivos: form.exposicion_motivos.trim() || null,
      }, articulos)
      await cargar()
      setModal(null)
    } catch (e) { alert(e.message || 'Error al guardar.') }
    finally { setBusy(false) }
  }

  /* ── Carga masiva ───────────────────────────────────────────
     Dos tiempos: primero se ARMA la lista (elegir, quitar, añadir más) y solo
     después se procesa. Antes arrancaba al elegir, y eso dejaba sin salida al
     que se equivocaba de carpeta: cada documento cuesta dinero, así que la
     lista tiene que poder revisarse antes de gastarlo.

     El proceso es la misma tubería del alta de uno, en fila: leer → limpiar
     con el lector → guardar SIN PUBLICAR. Sin publicar a propósito: son
     cientos de documentos y ninguno se ha revisado, así que entran a la lista
     para abrirlos, corregirlos y publicarlos cuando estén.

     De a uno y no en paralelo: cada documento son varias llamadas al lector, y
     dispararlas todas a la vez es la forma más rápida de chocar con el límite
     de la API y perder media tanda. */
  const [lote, setLote]   = useState(null)   // null | { items, activo }
  const cancelarLote      = useRef(false)
  const loteFileRef       = useRef(null)

  const upItem = (i, patch) => setLote(l => l && ({
    ...l, items: l.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
  }))

  function abrirLote() {
    cancelarLote.current = false
    setLote({ items: [], activo: false })
    setModal({ tipo: 'lote' })
  }
  function cerrarLote() {
    if (lote?.activo) return
    setLote(null); setModal(null)
  }

  // Añadir a la lista, no reemplazarla: se puede elegir en varias tandas.
  // El mismo archivo dos veces sería el mismo proyecto dos veces en la BD, así
  // que se descarta por nombre y tamaño.
  function agregarArchivos(files) {
    const nuevos = Array.from(files || [])
    if (!nuevos.length) return
    setLote(l => {
      const items = l?.items ? [...l.items] : []
      const clave = (f) => `${f.name}|${f.size}`
      const vistos = new Set(items.map(it => clave(it.file)))
      for (const f of nuevos) {
        if (vistos.has(clave(f))) continue
        vistos.add(clave(f))
        items.push({ file: f, nombre: f.name, peso: f.size, estado: 'espera', msg: '', progress: 0, id: null })
      }
      return { items, activo: l?.activo || false }
    })
  }
  const quitarItem    = (i) => setLote(l => l && ({ ...l, items: l.items.filter((_, idx) => idx !== i) }))
  const reintentarItem = (i) => upItem(i, { estado: 'espera', msg: '', progress: 0 })
  const vaciarLote    = () => setLote(l => l && ({ ...l, items: [] }))

  /* Procesa SOLO lo que está en espera: lo ya guardado no se repite, y un
     documento que falló vuelve a la cola con su botón de reintentar. */
  async function correrLote() {
    const pendientes = (lote?.items || [])
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.estado === 'espera')
    if (!pendientes.length) return
    cancelarLote.current = false
    setLote(l => l && ({ ...l, activo: true }))
    for (const { it, i } of pendientes) {
      if (cancelarLote.current) {
        upItem(i, { estado: 'cancelado', msg: 'No se procesó: la carga se detuvo antes.' })
        continue
      }
      upItem(i, { estado: 'proceso', msg: 'Leyendo el documento…' })
      try {
        fallo.current = ''
        const { datos, usoIA } = await leerDocumento(it.file, (progress, msg) => upItem(i, { progress, msg }))
        // Un proyecto sin nombre no se puede listar. Si el lector no lo sacó,
        // manda el nombre del archivo: es corregible, perder el documento no.
        const nombre = (datos.nombre || '').trim() || it.nombre.replace(/\.[^.]+$/, '')
        const id = await persistir(null, {
          nombre,
          numero: datos.numero || null,
          descripcion: datos.descripcion || null,
          fecha_radicacion: datos.fecha_radicacion || null,
          enlace_documento: null,
          permite_articulado: datos.articulos.length > 0,
          publicado: false,
          autores: datos.autores || null,
          titulo_oficial: datos.titulo_oficial || null,
          exposicion_motivos: datos.exposicion_motivos || null,
        }, datos.articulos)
        upItem(i, {
          estado: 'ok', progress: 1, id,
          msg: `${datos.articulos.length} artículo${datos.articulos.length === 1 ? '' : 's'}${usoIA ? '' : ' · sin lector asistido'}`,
        })
      } catch (e) {
        upItem(i, { estado: 'error', progress: 0, msg: e?.message || fallo.current || 'No se pudo procesar.' })
      }
    }
    setLote(l => l && ({ ...l, activo: false }))
    await cargar()
  }

  function onLoteInput(e) {
    /* Copiar ANTES de limpiar el input. `e.target.files` es una lista viva:
       al poner value = '' se vacía también la referencia que ya tenías, y la
       selección entera se perdía sin decir nada. */
    const files = Array.from(e.target.files || [])
    e.target.value = ''          // permite volver a elegir el mismo archivo
    agregarArchivos(files)
  }

  // Arrastrar y soltar (escritorio). `dragLote` solo pinta el resaltado.
  const [dragLote, setDragLote] = useState(false)
  function onLoteDrop(e) {
    e.preventDefault(); setDragLote(false)
    if (lote?.activo) return
    agregarArchivos(e.dataTransfer?.files)
  }
  function onLoteDragOver(e) { e.preventDefault() }
  function onLoteDragEnter(e) { e.preventDefault(); if (!lote?.activo) setDragLote(true) }
  function onLoteDragLeave(e) {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget)) return   // sigue dentro de la zona
    setDragLote(false)
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

  // Contadores del lote (pie, barra de avance y rótulo del botón).
  const loteItems   = lote?.items || []
  const loteEspera  = loteItems.filter(x => x.estado === 'espera').length
  const loteHechos  = loteItems.filter(x => x.estado !== 'espera' && x.estado !== 'proceso').length
  const loteOk      = loteItems.filter(x => x.estado === 'ok').length
  const loteErr     = loteItems.filter(x => x.estado === 'error').length
  const lotePeso    = loteItems.reduce((n, x) => n + (x.peso || 0), 0)

  /* ═══════════════ Lista ═══════════════ */
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>Proyectos de ley</h3>
          <p className={styles.sub}>Publica proyectos para el debate ciudadano y consulta los resultados.</p>
        </div>
        <div className={styles.headAcciones}>
          <button className={styles.loteBtn} onClick={abrirLote}>Carga masiva</button>
          <button className={styles.newBtn} onClick={nuevoProyecto}>+ Nuevo proyecto</button>
        </div>
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
          {enPagina.map(p => (
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

      {/* El pie solo aparece cuando hay más de una página: con ocho proyectos
          un paginador es ruido. */}
      {Array.isArray(proyectos) && proyectosFiltrados.length > porPagina && (
        <Pager
          pagina={pagSegura}
          porPagina={porPagina}
          total={proyectosFiltrados.length}
          onPagina={setPagina}
          onPorPagina={setPorPagina}
        />
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
                    ✓ {imp.resumen.totalArticulos} artículo{imp.resumen.totalArticulos === 1 ? '' : 's'} en el formulario.
                    {imp.resumen.tipo === 'ley' && ' Es una ley ya sancionada, así que no trae exposición de motivos ni autores.'}
                  </p>
                )}
                {imp.phase === 'done' && imp.resumen?.via === 'regex' && (
                  <p className={styles.importAviso}>
                    <strong>El lector asistido no se usó</strong>, así que el texto trae el ruido
                    del escaneo tal cual: títulos sin separar, frases cortadas y símbolos sueltos.
                    {imp.resumen.motivo ? ` Motivo: ${imp.resumen.motivo}` : ''}
                    {' '}Revisa y pulsa «Guardar».
                  </p>
                )}
                {imp.phase === 'error' && (
                  <p className={styles.importErr}>{imp.msg}</p>
                )}
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Nombre del proyecto * <small className={styles.fieldNota}>corto: es el que se ve en las tarjetas</small></span>
                  <input autoFocus value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Reforma al Código de Comercio" />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Título oficial <small className={styles.fieldNota}>la fórmula «por medio de la cual…», completa</small></span>
                  <textarea rows={3} value={form.titulo_oficial}
                    onChange={e => setForm(f => ({ ...f, titulo_oficial: e.target.value }))}
                    placeholder="Se rellena solo al importar el documento" />
                </label>
                <label className={styles.field}>
                  <span>Número / radicado <small className={styles.fieldNota}>vacío si aún no se ha radicado</small></span>
                  <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Proyecto de Ley 123 de 2026" />
                </label>
                <label className={styles.field}>
                  <span>Fecha <small className={styles.fieldNota}>radicación del proyecto, o sanción de la ley</small></span>
                  <input type="date" value={form.fecha_radicacion || ''} onChange={e => setForm(f => ({ ...f, fecha_radicacion: e.target.value }))} />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Enlace al documento oficial</span>
                  <input type="url" value={form.enlace_documento} onChange={e => setForm(f => ({ ...f, enlace_documento: e.target.value }))} placeholder="https://www.camara.gov.co/…  (donde está colgado el proyecto completo)" />
                </label>
                {/* Dos campos distintos porque son dos cosas distintas, y de ahí
                    que en una ley publicada uno salga vacío: quien la firma no
                    la propuso. Cuando el documento es una ley, el de autores se
                    marca como «no aplica» en vez de parecer un hueco por llenar. */}
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>
                    Autor(es)
                    <small className={styles.fieldNota}>
                      {esLey
                        ? 'No aplica: los autores figuran en el proyecto de ley original, no en la ley publicada.'
                        : 'Los congresistas que propusieron la norma.'}
                    </small>
                  </span>
                  <input value={form.autores}
                    onChange={e => setForm(f => ({ ...f, autores: e.target.value }))}
                    placeholder={esLey ? 'No aplica en una ley sancionada' : 'Nombres separados por coma'} />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Descripción</span>
                  <textarea rows={5} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Resumen del proyecto para la ciudadanía…" />
                </label>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span>Exposición de motivos <small className={styles.fieldNota}>resumen ordenado; el texto completo está en el documento oficial</small></span>
                  <textarea rows={6} value={form.exposicion_motivos} onChange={e => setForm(f => ({ ...f, exposicion_motivos: e.target.value }))} placeholder="Por qué se propone la norma, en lenguaje llano…" />
                </label>
              </div>

              <div className={styles.switches}>
                <label className={styles.switch}>
                  <input type="checkbox" checked={form.permite_articulado} onChange={e => setForm(f => ({ ...f, permite_articulado: e.target.checked }))} />
                  <span>
                    Permitir voto por artículo
                    <small className={styles.switchNota}>
                      {articulos.length === 0
                        ? 'Sin artículos cargados no hay nada que votar por separado.'
                        : form.permite_articulado
                          ? `La ciudadanía podrá fijar postura en cada uno de los ${articulos.length} artículos.`
                          : 'La opción se verá en la página, deshabilitada y explicando que solo se vota la iniciativa completa.'}
                    </small>
                  </span>
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
                  <div key={i} className={styles.artBloque}>
                    {/* El título del que cuelga el artículo se pinta como cabecera
                        cuando cambia, no dentro de cada fila: así el editor
                        refleja la estructura de la norma en vez de una lista
                        plana de 19 elementos sueltos. Es editable porque el
                        primero de cada bloque manda sobre los que le siguen. */}
                    {(marcas[i] || tituloFoco === i) ? (
                      <div className={styles.artSeccion}>
                        <span className={styles.artSeccionEtiqueta}>Título {romano(ordenTitulo(i))}</span>
                        <input
                          value={a.seccion || ''}
                          autoFocus={tituloFoco === i}
                          onChange={e => pintarBloque(i, e.target.value)}
                          onFocus={() => setTituloFoco(i)}
                          onBlur={() => setTituloFoco(f => (f === i ? null : f))}
                          placeholder="Nombre del título"
                        />
                        <button
                          className={styles.artSeccionQuitar}
                          onClick={() => quitarTitulo(i)}
                          title="Quitar este título (los artículos pasan al anterior)"
                          aria-label={`Quitar el título ${romano(ordenTitulo(i))}`}
                        >✕</button>
                      </div>
                    ) : (
                      <button
                        className={styles.artSeccionAdd}
                        onClick={() => abrirTitulo(i)}
                        title="Empezar aquí un título nuevo"
                      >+ Título aquí</button>
                    )}
                    <div className={styles.artRow}>
                      <input className={styles.artNum} value={a.numero} onChange={e => setArt(i, { numero: e.target.value })} placeholder="N°" inputMode="numeric" />
                      <div className={styles.artFields}>
                        <input value={a.titulo} onChange={e => setArt(i, { titulo: e.target.value })} placeholder="Sin título (así viene en la norma)" />
                        <textarea rows={5} value={a.contenido} onChange={e => setArt(i, { contenido: e.target.value })} placeholder="Texto del artículo (opcional)" />
                      </div>
                      <button className={styles.delBtn} onClick={() => delArt(i)} title="Eliminar artículo" aria-label="Eliminar artículo">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </ModalShell>
          )}

          {modal?.tipo === 'lote' && (
            <ModalShell
              key="lote"
              onClose={cerrarLote}
              closeDisabled={!!lote?.activo}
              size="lg"
              title="Carga masiva de proyectos"
              subtitle="Arma la lista, revísala y luego procésala. Entran sin publicar."
              footer={
                lote?.activo ? (
                  <>
                    <span className={styles.lotePie}>
                      {loteHechos} de {loteItems.length} · {loteOk} guardado{loteOk === 1 ? '' : 's'}{loteErr > 0 ? `, ${loteErr} con error` : ''}
                    </span>
                    <button className={styles.delDanger} onClick={() => { cancelarLote.current = true }}>
                      Detener al acabar este
                    </button>
                  </>
                ) : (
                  <>
                    <button className={styles.cancel} onClick={cerrarLote}>Cerrar</button>
                    <button className={styles.save} onClick={correrLote} disabled={loteEspera === 0}>
                      {loteEspera === 0
                        ? 'Nada por procesar'
                        : `Procesar ${loteEspera} documento${loteEspera === 1 ? '' : 's'}`}
                    </button>
                  </>
                )
              }
            >
              <input
                ref={loteFileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={onLoteInput}
                hidden
              />

              <div
                className={`${styles.loteZona} ${dragLote ? styles.loteZonaDrag : ''} ${lote?.activo ? styles.loteZonaBusy : ''} ${loteItems.length ? styles.loteZonaMini : ''}`}
                role="button" tabIndex={lote?.activo ? -1 : 0}
                onClick={() => { if (!lote?.activo) loteFileRef.current?.click() }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !lote?.activo) { e.preventDefault(); loteFileRef.current?.click() } }}
                onDragOver={onLoteDragOver} onDragEnter={onLoteDragEnter} onDragLeave={onLoteDragLeave} onDrop={onLoteDrop}
                aria-label="Añadir documentos: arrastra los archivos aquí o toca para elegirlos"
              >
                <span className={styles.loteZonaIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 15 3-3 3 3" /><path d="M12 12v6" />
                  </svg>
                </span>
                <span className={styles.loteZonaTexto}>
                  <strong>{loteItems.length ? 'Añadir más documentos' : 'Elegir los documentos'}</strong>
                  <span>
                    <span className={styles.soloDesktop}>Arrástralos aquí o haz clic para elegirlos</span>
                    <span className={styles.soloMovil}>Toca para elegirlos</span>
                    {' '}(PDF con texto, Word .docx o TXT). Puedes elegir varios a la vez.
                  </span>
                </span>
              </div>

              {loteItems.length === 0 ? (
                <div className={styles.loteIntro}>
                  <ul className={styles.loteLista}>
                    <li>De cada documento se saca número, título, fecha, autores y el articulado.</li>
                    <li>Se guardan <strong>sin publicar</strong>: los revisas en la lista y los publicas cuando estén.</li>
                    <li>Se procesan de a uno y puedes detener la carga: lo ya guardado se queda.</li>
                    <li>No cierres la pestaña mientras corre. Un documento tarda entre medio minuto y dos.</li>
                  </ul>
                </div>
              ) : (
                <div className={styles.loteBox}>
                  <div className={styles.loteCabecera}>
                    <span className={styles.loteCuenta}>
                      {loteItems.length} documento{loteItems.length === 1 ? '' : 's'}
                      {lotePeso > 0 && ` · ${(lotePeso / 1024 / 1024).toFixed(1)} MB`}
                    </span>
                    {!lote.activo && (
                      <button className={styles.loteVaciar} onClick={vaciarLote}>Vaciar lista</button>
                    )}
                  </div>

                  {(lote.activo || loteHechos > 0) && (
                    <>
                      <div className={styles.loteBarra}>
                        <div
                          className={styles.loteBarraFill}
                          style={{ width: `${Math.round((loteHechos / Math.max(1, loteItems.length)) * 100)}%` }}
                        />
                      </div>
                      <p className={styles.loteEstado} role="status">
                        {lote.activo
                          ? `Procesando ${loteHechos + 1} de ${loteItems.length}…`
                          : `${loteOk} guardado${loteOk === 1 ? '' : 's'}${loteErr > 0 ? `, ${loteErr} con error` : ''}.`}
                        {!lote.activo && loteOk > 0 && ' Revísalos en la lista y publícalos cuando estén.'}
                      </p>
                    </>
                  )}

                  <ul className={styles.loteList}>
                    {loteItems.map((it, i) => (
                      <li key={`${it.nombre}-${it.peso}-${i}`} className={`${styles.loteItem} ${styles['lote_' + it.estado] || ''}`}>
                        <span className={styles.loteChip}>
                          {it.estado === 'ok' ? 'Guardado'
                            : it.estado === 'error' ? 'Error'
                            : it.estado === 'proceso' ? 'Procesando'
                            : it.estado === 'cancelado' ? 'Detenido'
                            : 'En espera'}
                        </span>
                        <div className={styles.loteCuerpo}>
                          <strong className={styles.loteNombre}>{it.nombre}</strong>
                          {it.msg && <span className={styles.loteMsg}>{it.msg}</span>}
                          {it.estado === 'proceso' && (
                            <div className={styles.loteMini}>
                              <div className={styles.loteMiniFill} style={{ width: `${Math.max(6, Math.round(it.progress * 100))}%` }} />
                            </div>
                          )}
                        </div>
                        {!lote.activo && (it.estado === 'error' || it.estado === 'cancelado') && (
                          <button className={styles.loteReintentar} onClick={() => reintentarItem(i)}>
                            Reintentar
                          </button>
                        )}
                        {!lote.activo && it.estado !== 'ok' && (
                          <button
                            className={styles.loteQuitar}
                            onClick={() => quitarItem(i)}
                            title="Quitar de la lista"
                            aria-label={`Quitar ${it.nombre} de la lista`}
                          >✕</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
