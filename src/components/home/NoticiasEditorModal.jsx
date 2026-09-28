import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { compressImage } from '../../utils/compressMedia'
import styles from './NoticiasEditorModal.module.css'
import tarjeta from './NoticiasSection.module.css'

/* ── Editor de noticias del home (superadmin o admin) ─────────────────────
   Modal propio, cargado con lazy() desde NoticiasSection: quien visita la
   home no descarga nada de esto. Reemplaza al editor en línea, que tenía
   tres trampas:
     · Eliminar borraba al instante, aunque después se pulsara "Cancelar".
     · "Guardar" no revisaba la respuesta: si la base rechazaba el cambio,
       parecía guardado y no lo estaba.
     · Mientras la tabla estaba vacía decía "No hay noticias" aunque la home
       mostraba tres (las de ejemplo del código). Ahora se explica y se
       ofrece guardarlas para poder editarlas.
   Cada acción se guarda al momento y se verifica. */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const VACIA = { titulo: '', resumen: '', fuente: '', fecha: '', url: '', imagen_url: '', activo: true }
const MAX_TITULO  = 160
const MAX_RESUMEN = 400
const IMAGEN_MAX_MB = 15

// 'AAAA-MM-DD' como fecha LOCAL: new Date('2026-09-28') es medianoche UTC,
// que en Colombia (UTC-5) cae el día anterior.
function fechaLarga(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

const MSG_PERMISO = 'Tu cuenta no tiene permiso para editar noticias. Solo la administración (superadmin o admin) puede hacerlo.'

/* PostgREST con la sesión de quien edita. Ojo: con RLS, un UPDATE o DELETE
   que la política no deja pasar NO da error, responde 204 sin tocar nada.
   Por eso las escrituras piden return=representation y se exige que vuelva
   al menos una fila. */
async function api(path, { method = 'GET', body, exigeFilas = false } = {}) {
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' }
  if (method !== 'GET') headers.Prefer = 'return=representation'
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    const permiso = res.status === 401 || res.status === 403 || d.code === '42501'
    throw new Error(permiso ? MSG_PERMISO : (d.message || `La base respondió ${res.status}.`))
  }
  const data = await res.json().catch(() => null)
  if (exigeFilas && !(Array.isArray(data) && data.length)) throw new Error(MSG_PERMISO)
  return data
}

// "dian.gov.co" → "https://dian.gov.co". Vacío sigue vacío.
function normalizarUrl(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export default function NoticiasEditorModal({ ejemplos = [], onClose, onCambio }) {
  const [lista, setLista]       = useState(null)    // null = cargando
  const [error, setError]       = useState('')
  const [aviso, setAviso]       = useState('')      // confirmación breve
  const [busy, setBusy]         = useState(false)
  const [form, setForm]         = useState(null)    // null = vista de lista
  const [original, setOriginal] = useState(null)    // para saber si hay cambios
  const [borrando, setBorrando] = useState(null)    // id con la confirmación abierta
  const [subiendo, setSubiendo] = useState(false)
  const [salida, setSalida]     = useState(null)    // 'cerrar' | 'volver' con cambios sin guardar
  const [intento, setIntento]   = useState(false)   // ya intentó guardar (muestra errores de campo)
  const panelRef  = useRef(null)
  const cuerpoRef = useRef(null)
  const fileRef   = useRef(null)

  const sucio = !!form && JSON.stringify(form) !== JSON.stringify(original)

  async function cargar() {
    try {
      const rows = await api('noticias?select=*&order=orden.asc,created_at.desc')
      setLista(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e.message)
      setLista([])
    }
  }
  useEffect(() => { cargar() }, [])

  // Foco al abrir, scroll de la página bloqueado y foco de vuelta al cerrar.
  useEffect(() => {
    const previo = document.activeElement
    panelRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previo?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 3000)
    return () => clearTimeout(t)
  }, [aviso])

  // Escape = cerrar (con la misma protección de cambios sin guardar) y Tab
  // no se escapa a la página de atrás mientras el modal está abierto.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); pedirSalida('cerrar'); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const foco = [...panelRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), [href]'
      )]
      if (!foco.length) return
      const primero = foco[0], ultimo = foco[foco.length - 1]
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === panelRef.current)) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault(); primero.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  function pedirSalida(tipo) {
    if (busy || subiendo) return
    if (sucio) { setSalida(tipo); return }
    ejecutarSalida(tipo)
  }
  function ejecutarSalida(tipo) {
    setSalida(null)
    if (tipo === 'cerrar') { onClose(); return }
    setForm(null); setOriginal(null); setIntento(false); setError('')
  }

  function abrirForm(n) {
    // Los null de la base pasan a '' (los campos y contadores trabajan con texto).
    const base = { ...VACIA }
    if (n) {
      for (const k of Object.keys(VACIA)) base[k] = n[k] ?? VACIA[k]
      base.id = n.id
      base.fecha = n.fecha ? String(n.fecha).slice(0, 10) : ''
    }
    setForm(base); setOriginal(base); setIntento(false); setError(''); setBorrando(null)
    cuerpoRef.current?.scrollTo?.(0, 0)
  }
  const campo = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(f => ({ ...f, [k]: v }))
  }

  async function correr(fn, ok) {
    setBusy(true); setError('')
    try {
      await fn()
      if (ok) setAviso(ok)
      onCambio?.()
    } catch (e) {
      setError(e.message || 'No se pudo completar. Intenta de nuevo.')
      await cargar()
    } finally {
      setBusy(false)
    }
  }

  async function guardar() {
    setIntento(true)
    const titulo = form.titulo.trim()
    if (!titulo) return
    const payload = {
      titulo,
      resumen:    form.resumen.trim() || null,
      fuente:     form.fuente.trim() || null,
      fecha:      form.fecha || null,
      url:        normalizarUrl(form.url) || null,
      imagen_url: form.imagen_url || null,
      activo:     !!form.activo,
    }
    await correr(async () => {
      if (form.id) {
        await api(`noticias?id=eq.${encodeURIComponent(form.id)}`, { method: 'PATCH', body: payload, exigeFilas: true })
      } else {
        // Las nuevas entran ARRIBA: es lo más reciente.
        const min = (lista || []).reduce((m, n) => Math.min(m, n.orden ?? 0), 0)
        await api('noticias', { method: 'POST', body: { ...payload, orden: min - 1 }, exigeFilas: true })
      }
      await cargar()
      setForm(null); setOriginal(null); setIntento(false)
    }, form.id ? 'Cambios guardados.' : 'Noticia publicada.')
  }

  async function mover(i, dir) {
    const j = i + dir
    if (!lista || j < 0 || j >= lista.length) return
    const nueva = lista.slice()
    ;[nueva[i], nueva[j]] = [nueva[j], nueva[i]]
    setLista(nueva)   // se ve al instante; si falla, cargar() la devuelve
    await correr(async () => {
      // Se renumera todo 0..n-1: los "orden" viejos pueden venir repetidos.
      const cambios = nueva
        .map((n, idx) => ({ n, idx }))
        .filter(({ n, idx }) => n.orden !== idx)
      await Promise.all(cambios.map(({ n, idx }) =>
        api(`noticias?id=eq.${encodeURIComponent(n.id)}`, { method: 'PATCH', body: { orden: idx }, exigeFilas: true })))
      setLista(nueva.map((n, idx) => ({ ...n, orden: idx })))
    })
  }

  async function alternarVisible(n) {
    await correr(async () => {
      await api(`noticias?id=eq.${encodeURIComponent(n.id)}`, { method: 'PATCH', body: { activo: !n.activo }, exigeFilas: true })
      setLista(l => l.map(x => x.id === n.id ? { ...x, activo: !n.activo } : x))
    }, n.activo ? 'Noticia oculta: ya no sale en la home.' : 'Noticia visible en la home.')
  }

  async function eliminar(n) {
    await correr(async () => {
      await api(`noticias?id=eq.${encodeURIComponent(n.id)}`, { method: 'DELETE', exigeFilas: true })
      setLista(l => l.filter(x => x.id !== n.id))
      setBorrando(null)
    }, 'Noticia eliminada.')
  }

  async function guardarEjemplos() {
    await correr(async () => {
      const filas = ejemplos.map((e, idx) => ({
        titulo: e.title, resumen: e.excerpt || null, fuente: e.source || null,
        url: e.link || null, imagen_url: e.image || null, fecha: null, orden: idx, activo: true,
      }))
      await api('noticias', { method: 'POST', body: filas, exigeFilas: true })
      await cargar()
    }, 'Las noticias de ejemplo quedaron guardadas: ya puedes editarlas.')
  }

  async function subirImagen(e) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    if (!/^image\//.test(raw.type)) { setError('Elige una imagen (JPG, PNG o WebP).'); return }
    if (raw.size > IMAGEN_MAX_MB * 1024 * 1024) { setError(`La imagen pesa más de ${IMAGEN_MAX_MB} MB.`); return }
    setSubiendo(true); setError('')
    try {
      // JPEG a 1200 px: es la imagen PÚBLICA de la home. AVIF no se ve en
      // iPhone anteriores a iOS 16; JPEG lo muestra cualquier navegador.
      const file = await compressImage(raw, 1200, 0.82, 'image/jpeg')
      // Si recomprimir la agrandaba, compressImage devuelve el original: la
      // extensión y el tipo salen del archivo real, no se asumen.
      const tipo = file.type || 'image/jpeg'
      const ext  = (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const auth = await getAuthHeaders()
      const path = `noticias/${Date.now()}.${ext}`
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/noticias/${path}`, {
        method: 'POST',
        headers: { apikey: auth.apikey, Authorization: auth.Authorization, 'x-upsert': 'true', 'Content-Type': tipo },
        body: file,
      })
      if (!res.ok) {
        throw new Error(res.status === 401 || res.status === 403
          ? 'Tu cuenta no tiene permiso para subir imágenes de noticias.'
          : 'No se pudo subir la imagen. Intenta de nuevo.')
      }
      setForm(f => ({ ...f, imagen_url: `${SUPABASE_URL}/storage/v1/object/public/noticias/${path}` }))
    } catch (err) {
      setError(err.message || 'No se pudo subir la imagen.')
    } finally {
      setSubiendo(false)
    }
  }

  const tituloFalta = intento && form && !form.titulo.trim()

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) pedirSalida('cerrar') }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notiEditorTitulo"
        tabIndex={-1}
      >
        <header className={styles.head}>
          {form && (
            <button type="button" className={styles.volver} onClick={() => pedirSalida('volver')}
              disabled={busy || subiendo} aria-label="Volver a la lista de noticias">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          <div className={styles.headTexto}>
            <h2 id="notiEditorTitulo" className={styles.titulo}>
              {form ? (form.id ? 'Editar noticia' : 'Nueva noticia') : 'Noticias de la home'}
            </h2>
            {!form && (
              <p className={styles.sub}>Lo que guardes aquí es lo que ve la gente en la sección Noticias.</p>
            )}
          </div>
          <button type="button" className={styles.cerrar} onClick={() => pedirSalida('cerrar')}
            disabled={busy || subiendo} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        {(error || aviso) && (
          <div className={styles.mensajes}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {!error && aviso && <p className={styles.aviso} role="status">{aviso}</p>}
          </div>
        )}

        <div className={styles.cuerpo} ref={cuerpoRef}>
          {form ? (
            /* ── Formulario + vista previa ─────────────────────────── */
            <div className={styles.formGrid}>
              <div className={styles.campos}>
                <div className={styles.campo}>
                  <span className={styles.etiqueta}>Imagen</span>
                  <button type="button" className={styles.imagen} onClick={() => fileRef.current?.click()}
                    disabled={subiendo || busy}
                    style={form.imagen_url ? { backgroundImage: `url("${form.imagen_url}")` } : undefined}
                    aria-label={form.imagen_url ? 'Cambiar imagen' : 'Subir imagen'}>
                    <span className={styles.imagenPill}>
                      {subiendo ? 'Subiendo…' : form.imagen_url ? 'Cambiar imagen' : '+ Subir imagen'}
                    </span>
                  </button>
                  {form.imagen_url && !subiendo && (
                    <button type="button" className={styles.linkQuitar}
                      onClick={() => setForm(f => ({ ...f, imagen_url: '' }))}>
                      Quitar imagen
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={subirImagen} />
                </div>

                <label className={styles.campo}>
                  <span className={styles.etiqueta}>
                    Título <span className={styles.req} aria-hidden="true">*</span>
                    <span className={styles.contador}>{form.titulo.length}/{MAX_TITULO}</span>
                  </span>
                  <input className={styles.input} value={form.titulo} onChange={campo('titulo')}
                    maxLength={MAX_TITULO} required aria-invalid={tituloFalta || undefined}
                    placeholder="Ej: DIAN amplía el plazo de la declaración de renta" />
                  {tituloFalta && <span className={styles.errCampo}>Escribe el título de la noticia.</span>}
                </label>

                <label className={styles.campo}>
                  <span className={styles.etiqueta}>
                    Resumen
                    <span className={styles.contador}>{form.resumen.length}/{MAX_RESUMEN}</span>
                  </span>
                  <textarea className={styles.input} rows={4} value={form.resumen} onChange={campo('resumen')}
                    maxLength={MAX_RESUMEN} placeholder="Dos o tres líneas: en la tarjeta se ven hasta tres." />
                </label>

                <div className={styles.fila2}>
                  <label className={styles.campo}>
                    <span className={styles.etiqueta}>Fuente</span>
                    <input className={styles.input} value={form.fuente} onChange={campo('fuente')}
                      maxLength={60} placeholder="Ej: DIAN" />
                  </label>
                  <label className={styles.campo}>
                    <span className={styles.etiqueta}>Fecha</span>
                    <input className={styles.input} type="date" value={form.fecha} onChange={campo('fecha')} />
                  </label>
                </div>

                <label className={styles.campo}>
                  <span className={styles.etiqueta}>Enlace a la noticia</span>
                  <input className={styles.input} type="url" inputMode="url" value={form.url} onChange={campo('url')}
                    placeholder="https://…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                </label>

                <label className={styles.check}>
                  <input type="checkbox" checked={!!form.activo} onChange={campo('activo')} />
                  <span>Mostrar en la home</span>
                </label>
              </div>

              <aside className={styles.preview} aria-label="Vista previa">
                <span className={styles.etiqueta}>Así se verá</span>
                <div className={`${tarjeta.card} ${styles.previewCard}`} aria-hidden="true">
                  <div className={tarjeta.media}>
                    {form.imagen_url
                      ? <img src={form.imagen_url} alt="" className={tarjeta.image} />
                      : <span className={tarjeta.mediaFallback}>PB</span>}
                  </div>
                  <div className={tarjeta.body}>
                    {(form.fuente || form.fecha) && (
                      <div className={tarjeta.meta}>
                        {form.fuente && <span className={tarjeta.source}>{form.fuente}</span>}
                        {form.fecha && <span className={tarjeta.date}>{fechaLarga(form.fecha)}</span>}
                      </div>
                    )}
                    <h3 className={tarjeta.cardTitle}>{form.titulo || 'Título de la noticia'}</h3>
                    {form.resumen && <p className={tarjeta.excerpt}>{form.resumen}</p>}
                    {form.url && <span className={tarjeta.leer}>Leer más →</span>}
                  </div>
                </div>
                {!form.activo && <p className={styles.previewNota}>Oculta: no saldrá en la home hasta que la muestres.</p>}
              </aside>
            </div>
          ) : lista === null ? (
            /* ── Cargando ─────────────────────────────────────────── */
            <ul className={styles.lista} aria-busy="true" aria-label="Cargando noticias">
              {[0, 1, 2].map(i => (
                <li key={i} className={`${styles.item} ${styles.itemEsqueleto}`}>
                  <span className={styles.thumb} /><span className={styles.esqLinea} />
                </li>
              ))}
            </ul>
          ) : lista.length === 0 ? (
            /* ── Tabla vacía: la home está mostrando las de ejemplo ── */
            <div className={styles.vacio}>
              <p className={styles.vacioTitulo}>La home está mostrando {ejemplos.length} noticias de ejemplo</p>
              <p className={styles.vacioTexto}>
                No están guardadas: son un respaldo para que la sección no quede vacía. En cuanto
                publiques una noticia propia dejan de mostrarse. Si te sirven, guárdalas y edítalas.
              </p>
              <ul className={styles.lista}>
                {ejemplos.map((e, i) => (
                  <li key={i} className={styles.item}>
                    <span className={styles.thumb}>
                      {e.image ? <img src={e.image} alt="" loading="lazy" decoding="async" /> : <span>PB</span>}
                    </span>
                    <span className={styles.itemTexto}>
                      <span className={styles.itemTitulo}>{e.title}</span>
                      <span className={styles.itemMeta}>
                        {e.source}<span className="aap-chip aap-chip--espera">Ejemplo</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {ejemplos.length > 0 && (
                <button type="button" className="aap-accion aap-accion--neutra" onClick={guardarEjemplos} disabled={busy}>
                  {busy ? 'Guardando…' : `Guardar estas ${ejemplos.length} para editarlas`}
                </button>
              )}
            </div>
          ) : (
            /* ── Lista de noticias guardadas ─────────────────────── */
            <ol className={styles.lista}>
              {lista.map((n, i) => (
                <li key={n.id} className={styles.item} data-oculta={!n.activo || undefined}>
                  <span className={styles.thumb}>
                    {n.imagen_url ? <img src={n.imagen_url} alt="" loading="lazy" decoding="async" /> : <span>PB</span>}
                  </span>
                  <span className={styles.itemTexto}>
                    <span className={styles.itemTitulo}>{n.titulo}</span>
                    <span className={styles.itemMeta}>
                      {[n.fuente, fechaLarga(n.fecha)].filter(Boolean).join(' · ') || 'Sin fuente ni fecha'}
                      {!n.activo && <span className="aap-chip aap-chip--espera">Oculta</span>}
                    </span>
                  </span>

                  {borrando === n.id ? (
                    <span className={styles.confirmar} role="group" aria-label="Confirmar eliminación">
                      <span className={styles.confirmarTexto}>¿Eliminarla? No se puede deshacer.</span>
                      <button type="button" className="aap-accion aap-accion--neutra" onClick={() => setBorrando(null)} disabled={busy}>
                        Cancelar
                      </button>
                      <button type="button" className="aap-accion aap-accion--peligro" onClick={() => eliminar(n)} disabled={busy}>
                        {busy ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </span>
                  ) : (
                    <span className={styles.acciones}>
                      <button type="button" className={styles.icono} onClick={() => mover(i, -1)}
                        disabled={busy || i === 0} aria-label={`Subir «${n.titulo}»`} title="Subir">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
                      </button>
                      <button type="button" className={styles.icono} onClick={() => mover(i, 1)}
                        disabled={busy || i === lista.length - 1} aria-label={`Bajar «${n.titulo}»`} title="Bajar">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      <button type="button" className="aap-accion aap-accion--neutra" onClick={() => alternarVisible(n)} disabled={busy}>
                        {n.activo ? 'Ocultar' : 'Mostrar'}
                      </button>
                      <button type="button" className="aap-accion aap-accion--neutra" onClick={() => abrirForm(n)} disabled={busy}>
                        Editar
                      </button>
                      <button type="button" className="aap-accion aap-accion--peligro" onClick={() => setBorrando(n.id)} disabled={busy}>
                        Eliminar
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className={styles.pie}>
          {salida ? (
            <>
              <span className={styles.pieTexto}>Hay cambios sin guardar.</span>
              <button type="button" className="aap-accion aap-accion--neutra" onClick={() => setSalida(null)}>
                Seguir editando
              </button>
              <button type="button" className="aap-accion aap-accion--peligro" onClick={() => ejecutarSalida(salida)}>
                Descartar cambios
              </button>
            </>
          ) : form ? (
            <>
              <button type="button" className="aap-accion aap-accion--neutra" onClick={() => pedirSalida('volver')}
                disabled={busy || subiendo}>
                Cancelar
              </button>
              <button type="button" className="aap-accion aap-accion--primaria" onClick={guardar}
                disabled={busy || subiendo}>
                {busy ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Publicar noticia'}
              </button>
            </>
          ) : (
            <button type="button" className="aap-accion aap-accion--primaria" onClick={() => abrirForm(null)}
              disabled={busy || lista === null}>
              + Nueva noticia
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}
