import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  APOYA, apoyaMeta, fetchResumen, fetchComentarios,
} from '../../lib/proyectosLey'
import { nivelMunicipalLabel } from '../../data/colombia-ubicaciones'
import styles from './ResultadosProyecto.module.css'

/* Donut SVG propio (stroke-dasharray). No depende de medir el contenedor, así
   que SIEMPRE se dibuja — incluso dentro del acordeón animado y en móvil,
   donde ResponsiveContainer de recharts a veces medía 0 y no aparecía. */
function DonutSVG({ data, total }) {
  const size = 200, c = size / 2, R = 72, sw = 34
  const CIRC = 2 * Math.PI * R
  const segs = total > 0 ? data.filter(d => d.value > 0) : []
  let off = 0
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={styles.donutSvg} role="img" aria-label="Distribución de votos por postura">
      <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(109,60,27,0.09)" strokeWidth={sw} />
      {segs.map(d => {
        const len = (d.value / total) * CIRC
        const el = (
          <circle key={d.key} cx={c} cy={c} r={R} fill="none" stroke={d.color} strokeWidth={sw}
            strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-off}
            transform={`rotate(-90 ${c} ${c})`} />
        )
        off += len
        return el
      })}
    </svg>
  )
}

const fmtDia = (iso) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '' }
}

const TODOS = '__todos__'

/* Resultados de un proyecto: torta por postura, filtrable por ámbito
   (proyecto completo / artículo) y por departamento + municipio.
   Reutilizado por la página pública y por el panel de administración. */
export default function ResultadosProyecto({ proyecto, articulos = [], refreshKey = 0 }) {
  const [resumen, setResumen]       = useState(null)   // null = cargando
  const [comentarios, setComentarios] = useState([])
  const [scope, setScope]     = useState('all')  // 'all' = proyecto completo | articulo_id
  const [nivel, setNivel]     = useState('nacional') // 'nacional' | 'departamento' | 'municipio'
  const [depto, setDepto]     = useState(TODOS)
  const [muni,  setMuni]      = useState(TODOS)
  const [comLimit, setComLimit] = useState(5)   // comentarios visibles (ver más)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [dlOpen, setDlOpen]   = useState(false) // panel de descarga específica
  const [dlScope, setDlScope] = useState('completo') // ámbito elegido para el PDF

  useEffect(() => {
    let cancel = false
    setResumen(null)
    fetchResumen(proyecto.id).then(r => { if (!cancel) setResumen(r) })
    fetchComentarios(proyecto.id).then(c => { if (!cancel) setComentarios(Array.isArray(c) ? c : []) })
    return () => { cancel = true }
  }, [proyecto.id, refreshKey])

  // Filas del ámbito activo (proyecto completo → articulo_id null).
  const rowsScope = useMemo(() => {
    if (!resumen) return []
    return resumen.filter(r => scope === 'all' ? r.articulo_id == null : r.articulo_id === scope)
  }, [resumen, scope])

  // Departamentos y municipios presentes en el ámbito.
  const deptos = useMemo(() => {
    const s = new Set(rowsScope.map(r => r.departamento).filter(Boolean))
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))
  }, [rowsScope])

  const munis = useMemo(() => {
    if (depto === TODOS) return []
    const s = new Set(rowsScope.filter(r => r.departamento === depto).map(r => r.municipio).filter(Boolean))
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))
  }, [rowsScope, depto])

  // Reset del municipio cuando cambia el departamento o el ámbito.
  useEffect(() => { setMuni(TODOS) }, [depto, scope])
  // Al cambiar de ámbito o filtro, se colapsan de nuevo los comentarios.
  useEffect(() => { setComLimit(5) }, [scope, depto, muni])

  // Modal de descarga: cerrar con Escape + bloquear scroll del fondo.
  useEffect(() => {
    if (!dlOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setDlOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [dlOpen])

  // Cambio de nivel territorial: Nacional / Departamento / Municipio.
  function cambiarNivel(n) {
    setNivel(n)
    if (n === 'nacional') { setDepto(TODOS); setMuni(TODOS) }
    else if (depto === TODOS) { setDepto(deptos[0] || TODOS) }
  }

  const rowsFiltradas = useMemo(() => rowsScope.filter(r =>
    (depto === TODOS || r.departamento === depto) &&
    (muni  === TODOS || r.municipio === muni)
  ), [rowsScope, depto, muni])

  // Comentarios visibles bajo el mismo ámbito + filtros que la torta.
  const comentariosFiltrados = useMemo(() => comentarios.filter(c =>
    (scope === 'all' ? c.articulo_id == null : c.articulo_id === scope) &&
    (depto === TODOS || c.departamento === depto) &&
    (muni  === TODOS || c.municipio === muni)
  ), [comentarios, scope, depto, muni])

  // Agregado por postura → datos de la torta.
  const { pieData, total } = useMemo(() => {
    const acc = { a_favor: 0, en_contra: 0, neutral: 0 }
    for (const r of rowsFiltradas) acc[r.apoya] = (acc[r.apoya] || 0) + r.total
    const t = acc.a_favor + acc.en_contra + acc.neutral
    const data = APOYA.map(a => ({ key: a.key, name: a.label, value: acc[a.key] || 0, color: a.color }))
    return { pieData: data, total: t }
  }, [rowsFiltradas])

  // Etiqueta del tercer nivel (Municipio o Localidad de Bogotá) según el depto.
  const muniLabel = nivelMunicipalLabel(depto === TODOS ? '' : depto)

  // Descripción legible de la cobertura territorial activa (para el panel/PDF).
  const coberturaTxt = nivel === 'nacional'
    ? 'Nacional'
    : nivel === 'departamento'
      ? `Departamental — ${depto === TODOS ? 'sin departamento' : depto}`
      : `${muniLabel} — ${muni === TODOS ? 'todas' : muni}${depto !== TODOS ? ` (${depto})` : ''}`

  async function descargarPdf(scopeSel) {
    if (pdfBusy || !resumen) return
    setPdfBusy(true)
    try {
      const { descargarReportePDF } = await import('../../lib/proyectosPdf')
      await descargarReportePDF({
        proyecto,
        articulos,
        resumen,
        scopeSel,
        filtro: {
          nivel,
          depto: depto === TODOS ? null : depto,
          muni:  muni === TODOS ? null : muni,
        },
      })
      setDlOpen(false)
    } catch (e) {
      console.error('[pdf] error', e)
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    } finally { setPdfBusy(false) }
  }

  if (resumen === null) return <p className={styles.cargando}>Cargando resultados…</p>

  const pct = (v) => total ? Math.round((v / total) * 100) : 0

  return (
    <motion.div
      className={styles.wrap}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Controles */}
      <div className={styles.controls}>
        {articulos.length > 0 && (
          <label className={styles.control}>
            <span>Ver</span>
            <select value={scope} onChange={e => setScope(e.target.value)}>
              <option value="all">Proyecto completo</option>
              {articulos.map(a => (
                <option key={a.id} value={a.id}>
                  Artículo {a.numero ?? ''}{a.titulo ? ` — ${a.titulo}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.nivelWrap}>
          <div className={`${styles.control} ${styles.controlNivel}`}>
            <span>Nivel</span>
            <div className={styles.nivelSeg} role="radiogroup" aria-label="Nivel territorial">
              {[['nacional', 'Nacional'], ['departamento', 'Departamento'], ['municipio', muniLabel]].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={nivel === k}
                  className={`${styles.nivelBtn} ${nivel === k ? styles.nivelBtnOn : ''}`}
                  onClick={() => cambiarNivel(k)}>{l}</button>
              ))}
            </div>
          </div>
          {nivel !== 'nacional' && (
            <div className={styles.deptoMuni}>
              <label className={styles.control}>
                <span>Departamento</span>
                <select value={depto === TODOS ? '' : depto} onChange={e => setDepto(e.target.value || TODOS)}>
                  {deptos.length === 0 && <option value="">Sin datos</option>}
                  {deptos.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              {nivel === 'municipio' && (
                <label className={`${styles.control} ${munis.length === 0 ? styles.controlOff : ''}`}>
                  <span>{muniLabel}</span>
                  <select value={muni} onChange={e => setMuni(e.target.value)} disabled={depto === TODOS || munis.length === 0}>
                    <option value={TODOS}>Todas</option>
                    {munis.map(mn => <option key={mn} value={mn}>{mn}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className={styles.vacio}>
          <span className={styles.vacioIcon} aria-hidden="true">📊</span>
          <p>Aún no hay votos {depto !== TODOS ? 'para este filtro' : 'registrados'}.</p>
          <p className={styles.vacioSub}>Sé la primera persona en dejar tu postura.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          <div className={styles.chartBox}>
            <DonutSVG data={pieData} total={total} />
            <div className={styles.chartCenter} aria-hidden="true">
              <span className={styles.centerNum}>{total}</span>
              <span className={styles.centerLbl}>{total === 1 ? 'voto' : 'votos'}</span>
            </div>
          </div>

          <div className={styles.side}>
            <ul className={styles.legend}>
              {pieData.map(d => (
                <li key={d.key} className={styles.legendRow}>
                  <span className={styles.legendDot} style={{ background: d.color }} />
                  <span className={styles.legendName}>{d.name}</span>
                  <span className={styles.legendBarTrack}>
                    <span className={styles.legendBar} style={{ width: `${pct(d.value)}%`, background: d.color }} />
                  </span>
                  <span className={styles.legendVal}>{pct(d.value)}%<small>{d.value}</small></span>
                </li>
              ))}
            </ul>
            <div className={styles.downloads}>
              <button type="button" className={styles.downloadPdf} onClick={() => { setDlScope(scope === 'all' ? 'completo' : scope); setDlOpen(true) }} aria-haspopup="dialog">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 18h4" />
                </svg>
                Descargar PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opiniones de la ciudadanía (anónimas: postura + texto + lugar + fecha) */}
      {comentariosFiltrados.length > 0 && (
        <div className={styles.comentarios}>
          <h4 className={styles.comTitle}>
            Comentarios <span>{comentariosFiltrados.length}</span>
          </h4>
          <ul className={styles.comList}>
            {comentariosFiltrados.slice(0, comLimit).map(c => {
              const m = apoyaMeta(c.apoya)
              return (
                <li key={c.id} className={styles.comCard}>
                  <div className={styles.comHead}>
                    <span className={styles.comNombre}>{c.nombre || 'Ciudadano/a'}</span>
                    <span className={styles.comBadge} style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 13%, transparent)` }}>{m.label}</span>
                    {c.created_at && <span className={styles.comFecha}>{fmtDia(c.created_at)}</span>}
                  </div>
                  {[c.municipio, c.departamento].filter(Boolean).length > 0 && (
                    <span className={styles.comLugar}>{[c.municipio, c.departamento].filter(Boolean).join(', ')}</span>
                  )}
                  <p className={styles.comTexto}>{c.observaciones}</p>
                </li>
              )
            })}
          </ul>
          {comentariosFiltrados.length > comLimit ? (
            <button type="button" className={styles.verMas} onClick={() => setComLimit(n => n + 8)}>
              Mostrar más comentarios ({comentariosFiltrados.length - comLimit} restantes)
            </button>
          ) : comLimit > 5 && comentariosFiltrados.length > 5 ? (
            <button type="button" className={styles.verMas} onClick={() => setComLimit(5)}>
              Mostrar menos
            </button>
          ) : null}
        </div>
      )}

      {/* Modal de descarga específica (portaleado a <body> para no recortarse
          dentro del acordeón / del modal del admin). */}
      {createPortal(
        <AnimatePresence>
          {dlOpen && (
            <motion.div
              className={styles.dlBackdrop}
              onClick={() => setDlOpen(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className={styles.dlModal} role="dialog" aria-modal="true" aria-label="Descargar PDF"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.96, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.dlModalHead}>
                  <h3 className={styles.dlModalTitle}>Descargar PDF</h3>
                  <button type="button" className={styles.dlClose} onClick={() => setDlOpen(false)} aria-label="Cerrar">✕</button>
                </div>
                <div className={styles.dlModalBody}>
                  <p className={styles.dlHint}>Elige qué incluir. El PDF se genera para la cobertura territorial activa.</p>
                  <div className={styles.dlField}>
                    <span className={styles.dlLabel}>Cobertura territorial</span>
                    <span className={styles.dlCobertura}>{coberturaTxt}</span>
                  </div>
                  <label className={styles.dlField}>
                    <span className={styles.dlLabel}>Ámbito del proyecto</span>
                    <select value={dlScope} onChange={e => setDlScope(e.target.value)}>
                      <option value="completo">Solo el proyecto completo</option>
                      {articulos.map(a => (
                        <option key={a.id} value={a.id}>Solo el artículo {a.numero ?? ''}{a.titulo ? ` — ${a.titulo}` : ''}</option>
                      ))}
                      {articulos.length > 0 && <option value="todos">Todo (completo + cada artículo)</option>}
                    </select>
                  </label>
                </div>
                <div className={styles.dlModalFoot}>
                  <button type="button" className={styles.dlCancel} onClick={() => setDlOpen(false)} disabled={pdfBusy}>Cancelar</button>
                  <button type="button" className={styles.dlGo} onClick={() => descargarPdf(dlScope)} disabled={pdfBusy}>
                    {pdfBusy ? 'Generando PDF…' : 'Descargar PDF'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  )
}
