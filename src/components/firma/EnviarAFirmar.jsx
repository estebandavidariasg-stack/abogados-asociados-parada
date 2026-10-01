import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import { getAuthHeaders } from '../../lib/supabase'
import { crearSolicitud, subirDoc, persistirFirma, bytesDeDoc } from '../../lib/firmaService'
import { ROL_LABEL } from '../../lib/firmaPdf'
import { IconFirma, IconCheck } from '../shared/Icons'
import { PdfVisor } from '../../lib/chatFiles'
import { plantillaDe, validarContrato, DOC_CONTRATO_SERVICIOS } from '../../lib/contratoServicios'
import FirmaSigner from './FirmaSigner'
import styles from './EnviarAFirmar.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* Resultado de comparar el archivo subido con la plantilla oficial. Dice
   QUÉ hay que corregir y DÓNDE (cláusula + lo que debe decir + lo que dice),
   para que el profesional lo arregle en Word sin adivinar. */
function Veredicto({ v, plantilla }) {
  if (v.estado === 'validando') {
    return (
      <div className={`${styles.veredicto} ${styles.veredictoNeutro}`} role="status">
        <span className={styles.spinner} />
        <div><strong>Comparando con la plantilla oficial…</strong><p>{v.nombre}</p></div>
      </div>
    )
  }
  if (v.sinTexto) {
    return (
      <div className={`${styles.veredicto} ${styles.veredictoMal}`} role="alert">
        <IconAviso />
        <div>
          <strong>No se pudo leer el texto de este PDF</strong>
          <p>Parece un escaneo o una foto. Guárdalo directamente desde Word (Archivo → Guardar como → PDF) y súbelo de nuevo.</p>
        </div>
      </div>
    )
  }
  if (!v.reconocido) {
    return (
      <div className={`${styles.veredicto} ${styles.veredictoMal}`} role="alert">
        <IconAviso />
        <div>
          <strong>Este archivo no es el {plantilla.titulo.toLowerCase()}</strong>
          <p>Descarga la plantilla de arriba, llénala y sube ese archivo. Para otra clase de documento usa «Otro documento».</p>
        </div>
      </div>
    )
  }
  if (v.ok) {
    return v.tipoArchivo === 'pdf' ? (
      <div className={`${styles.veredicto} ${styles.veredictoOk}`} role="status">
        <span className={styles.veredictoCheck}><IconCheck size={13} /></span>
        <div>
          <strong>Estructura verificada</strong>
          <p>Coincide con la plantilla oficial y no quedan espacios sin llenar. Ya puedes enviarlo a firma.</p>
        </div>
      </div>
    ) : (
      <div className={`${styles.veredicto} ${styles.veredictoAviso}`} role="status">
        <span className={styles.veredictoCheck}><IconCheck size={13} /></span>
        <div>
          <strong>La estructura está bien. Falta guardarlo como PDF</strong>
          <p>En Word: Archivo → Guardar como → PDF. Sube ese PDF aquí y queda listo para enviar a firma.</p>
        </div>
      </div>
    )
  }

  // Con observaciones: los espacios sin llenar se agrupan por cláusula.
  const porClausula = {}
  for (const s of v.sinLlenar) (porClausula[s.clausula] ||= []).push(s.etiqueta)
  const n = v.cambios.length + v.agregados.length + v.sinLlenar.length
  return (
    <div className={`${styles.veredicto} ${styles.veredictoMal}`} role="alert">
      <IconAviso />
      <div>
        <strong>{n === 1 ? 'Hay 1 punto por corregir' : `Hay ${n} puntos por corregir`} antes de enviarlo</strong>

        {v.cambios.length > 0 && (
          <>
            <p className={styles.veredictoGrupo}>Texto de la plantilla que cambió</p>
            <ul className={styles.veredictoLista}>
              {v.cambios.map((c, i) => (
                <li key={i}>
                  <span className={styles.veredictoClausula}>{c.clausula}</span>
                  <span className={styles.cita}><em>Debe decir</em>{c.debeDecir}</span>
                  <span className={styles.cita}>
                    <em>En tu archivo</em>{c.dice || 'Ese texto no aparece: se borró o se reescribió.'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {v.agregados.length > 0 && (
          <>
            <p className={styles.veredictoGrupo}>Texto agregado</p>
            <ul className={styles.veredictoLista}>
              {v.agregados.map((a, i) => (
                <li key={i}>
                  <span className={styles.veredictoClausula}>{a.clausula}</span>
                  <span className={styles.cita}>
                    <em>{a.motivo === 'clausula' ? 'Cláusula nueva en un espacio' : 'Demasiado texto en un espacio'}</em>{a.texto}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {v.sinLlenar.length > 0 && (
          <>
            <p className={styles.veredictoGrupo}>Espacios sin llenar</p>
            <ul className={styles.veredictoLista}>
              {Object.entries(porClausula).map(([clausula, etiquetas]) => (
                <li key={clausula}>
                  <span className={styles.veredictoClausula}>{clausula}</span>
                  <span className={styles.espacios}>
                    {etiquetas.map((e, i) => <span key={i} className={styles.espacio}>{e.length > 46 ? `${e.slice(0, 44)}…` : e}</span>)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className={styles.veredictoPie}>Corrígelo en Word, guárdalo y vuelve a subirlo.</p>
      </div>
    </div>
  )
}

const IconAviso = () => (
  <svg className={styles.veredictoIcono} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

/* ─────────────────────────────────────────────────────────────────────────
   EnviarAFirmar — inicia una solicitud de firma. El documento debe llegar YA
   FINAL en PDF: la edición previa (Word) ocurre por fuera, en el intercambio de
   archivos del chat o en el repositorio de Contratos. Aquí solo se firma. Pasos:
     1) Documento: subir el PDF final + previsualizar.
     2) Firmantes: el iniciador (prellenado) + la contraparte por correo.
     3) Crear la solicitud y firmar la parte del iniciador (FirmaSigner).

   Props:
     contrato    (opcional) fila de `contratos` a firmar; si viene, se carga su
                 archivo en vez de pedir uno nuevo.
     abogadoId   dueño del contrato (para rutas de storage y creador_id lógico).
     onClose()   cerrar
     onDone()    refrescar la lista de evidencia del padre

   Chat — dos clases de documento (`tipoDoc`):
     · 'contrato'  Contrato de prestación de servicios (abogacía / contables):
                   el profesional descarga la plantilla oficial en Word, la
                   llena, la guarda en PDF y la sube. Antes de dejarla pasar
                   se COMPARA con la plantilla (lib/contratoServicios): las
                   cláusulas no pueden haber cambiado y no puede quedar ningún
                   espacio sin llenar. Solo un PDF verificado se envía a firma.
     · 'otro'      Cualquier PDF ya final (poderes, autorizaciones…), sin
                   verificación. Es el flujo que ya existía.
     tipoProfesional  'abogado' | 'contador' → qué plantilla aplica.
     inicio           con cuál de las dos abre el modal.
   ───────────────────────────────────────────────────────────────────────── */
export default function EnviarAFirmar({ contrato, abogadoId, onClose, onDone, modo = 'contrato', roomId, cliente, afterCreate, modeloPath, tipoProfesional, inicio = 'contrato' }) {
  const esChat = modo === 'chat'
  const { user, profile } = useAuth()
  const [paso, setPaso] = useState('doc')
  const [pdfBytes, setPdfBytes] = useState(null)
  // Clase de documento (solo chat) y veredicto de la comparación con la plantilla.
  const [tipoDoc, setTipoDoc] = useState(esChat ? inicio : 'otro')
  const esContratoServicios = esChat && tipoDoc === 'contrato'
  const plantilla = plantillaDe(tipoProfesional || profile?.rol)
  const [validacion, setValidacion] = useState(null)   // null | { estado: 'validando' | 'listo', nombre, ...veredicto }
  const metaDoc = esContratoServicios ? { doc: DOC_CONTRATO_SERVICIOS, titulo: plantilla.titulo } : undefined
  const [pdfUrl, setPdfUrl] = useState('')
  const [convirtiendo, setConvirtiendo] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // Chat: el profesional puede firmar SU parte antes de enviárselo al cliente.
  const [firmarYo, setFirmarYo] = useState(false)
  // Firma guardada del perfil (dataURL) — se precarga en el lienzo de firma.
  const [firmaGuardada, setFirmaGuardada] = useState(null)
  const fileRef = useRef(null)

  const yo = {
    nombre: [profile?.nombre, profile?.apellidos].filter(Boolean).join(' ') || profile?.nombre || '',
    cedula: profile?.cedula || '',
    telefono: profile?.celular || profile?.telefono || '',
    correo: user?.email || '',
    ciudad: profile?.ciudad || '',
    rol: profile?.rol === 'contador' ? 'contador' : profile?.rol === 'superadmin' ? 'administrador' : 'abogado',
  }
  const [firmantes, setFirmantes] = useState(
    esChat
      // Chat: el cliente ya se conoce (viene del formulario de la consulta). El
      // profesional NO escribe nada del firmante: solo elige el documento.
      ? [{
          nombre: cliente?.nombre || '', correo: cliente?.correo || '',
          telefono: cliente?.telefono || '', rol: 'cliente', cedula: '', ciudad: '',
        }]
      // Contratos: el profesional firma su propio contrato. Sin administrador
      // obligatorio; si hiciera falta otra parte, se agrega con "Agregar firmante".
      : [{ ...yo, iniciador: true }]
  )

  const [solicitud, setSolicitud] = useState(null)
  const [misFilas, setMisFilas] = useState(null) // filas creadas de firmantes

  // Vista previa del PDF resultante.
  useEffect(() => {
    if (!pdfBytes) { setPdfUrl(''); return }
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfBytes])

  // Firma guardada en el perfil (profiles.firma_path, bucket privado): la
  // convertimos a dataURL para precargar el lienzo sin "taint" del canvas.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user?.id}&select=firma_path&limit=1`, { headers })
        const rows = await r.json()
        const path = rows?.[0]?.firma_path
        if (!path || cancel) return
        const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/tarjetas-profesionales/${path}`,
          { method: 'POST', headers, body: JSON.stringify({ expiresIn: 600 }) })
        const d = await signRes.json()
        if (!d?.signedURL || cancel) return
        const blob = await (await fetch(`${SUPABASE_URL}/storage/v1${d.signedURL}`)).blob()
        const reader = new FileReader()
        reader.onload = () => { if (!cancel) setFirmaGuardada(reader.result) }
        reader.readAsDataURL(blob)
      } catch { /* sin firma guardada: se dibuja normal */ }
    })()
    return () => { cancel = true }
  }, [user?.id])

  // Guarda (best-effort) la firma dibujada para reutilizarla la próxima vez.
  async function guardarFirmaPerfil(firmaPng) {
    try {
      if (!firmaPng || !user?.id) return
      const blob = await (await fetch(firmaPng)).blob()
      const headers = await getAuthHeaders()
      const path = `${user.id}/firma.png`
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: blob })
      if (!up.ok) return
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), Prefer: 'return=minimal' },
        body: JSON.stringify({ firma_path: path }),
      })
    } catch { /* best-effort */ }
  }

  // Modelo contractual del perfil (bucket contratos): cargarlo como documento.
  async function usarModelo() {
    if (!modeloPath) return
    setConvirtiendo(true); setError('')
    try {
      const headers = await getAuthHeaders()
      const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/contratos/${modeloPath}`,
        { method: 'POST', headers, body: JSON.stringify({ expiresIn: 3600 }) })
      const data = await signRes.json()
      if (!data?.signedURL) throw new Error('No se pudo cargar el modelo.')
      const buf = await (await fetch(`${SUPABASE_URL}/storage/v1${data.signedURL}`)).arrayBuffer()
      setPdfBytes(new Uint8Array(buf))
    } catch (e) {
      setError('No se pudo cargar tu modelo contractual. ' + (e?.message || ''))
    } finally { setConvirtiendo(false); setStage('') }
  }

  // Si viene un contrato existente, cargar su archivo (debe ser PDF).
  useEffect(() => {
    if (!contrato) return
    ;(async () => {
      const esPdf = /\.pdf$/i.test(contrato.nombre_archivo || '')
      if (!esPdf) {
        setError('Este contrato no es PDF. Para firmarlo, súbelo en PDF (exporta tu Word a PDF).')
        return
      }
      setConvirtiendo(true); setError('')
      try {
        const headers = await getAuthHeaders()
        const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/contratos/${contrato.storage_path}`,
          { method: 'POST', headers, body: JSON.stringify({ expiresIn: 3600 }) })
        const data = await signRes.json()
        const url = `${SUPABASE_URL}/storage/v1${data.signedURL}`
        const buf = await (await fetch(url)).arrayBuffer()
        setPdfBytes(new Uint8Array(buf))
      } catch (e) {
        setError('No se pudo cargar el documento. ' + (e?.message || ''))
      } finally { setConvirtiendo(false); setStage('') }
    })()
  }, [contrato])

  async function onPickFile(e) {
    const file = e.target.files?.[0]
    if (file) await procesarArchivo(file)
    if (e.target) e.target.value = ''
  }

  function cambiarTipoDoc(t) {
    if (t === tipoDoc) return
    setTipoDoc(t); setPdfBytes(null); setValidacion(null); setError('')
  }

  // Contrato de servicios: leer el archivo y compararlo con la plantilla
  // oficial. Solo un PDF que pasa la comparación queda cargado para firmar.
  async function procesarContrato(file) {
    setPdfBytes(null); setError('')
    setValidacion({ estado: 'validando', nombre: file.name })
    try {
      const v = await validarContrato(file, tipoProfesional || profile?.rol)
      setValidacion({ estado: 'listo', nombre: file.name, ...v })
      if (v.ok && v.tipoArchivo === 'pdf') setPdfBytes(v.bytes)
    } catch (err) {
      setValidacion(null)
      setError(err?.message || 'No se pudo revisar el archivo.')
    }
  }

  // Solo PDF: no convertimos nada (así el documento queda idéntico al original).
  async function procesarArchivo(file) {
    if (!file) return
    if (esContratoServicios) return procesarContrato(file)
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
    if (!esPdf) {
      setError('Solo se admite PDF. Si tienes un Word, ábrelo y expórtalo a PDF (Archivo → Guardar como → PDF) y sube ese archivo.')
      return
    }
    setConvirtiendo(true); setError('')
    try {
      setPdfBytes(new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      setError(err?.message || 'No se pudo leer el archivo.')
    } finally { setConvirtiendo(false); setStage('') }
  }

  function updFirmante(i, k, v) {
    setFirmantes((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)))
  }
  function addFirmante() {
    setFirmantes((fs) => [...fs, { nombre: '', correo: '', rol: 'cliente', cedula: '', telefono: '', ciudad: '' }])
  }
  function delFirmante(i) {
    setFirmantes((fs) => fs.filter((_, j) => j !== i))
  }

  const firmantesOk = esChat
    ? !!firmantes[0]?.correo
    : firmantes.length >= 1 && firmantes.every((f) => f.correo && f.nombre)

  async function crear() {
    if (!pdfBytes || !firmantesOk) { setError('Completa el documento y al menos un firmante con nombre y correo.'); return }
    setError('')
    try {
      const headers = await getAuthHeaders()
      const origPath = `${abogadoId}/${Date.now()}-original.pdf`
      await subirDoc(origPath, pdfBytes, headers)
      // Chat + "firmar yo": el profesional firma primero (iniciador) y el
      // cliente firma después sobre el documento ya firmado.
      const lista = esChat && firmarYo ? [{ ...yo, iniciador: true }, ...firmantes] : firmantes
      const { solicitud: sol, firmantes: filas } = await crearSolicitud({
        origen: esChat ? 'chat' : 'contrato',
        roomId: esChat ? roomId : undefined,
        contratoId: esChat ? undefined : contrato?.id,
        creadorId: user.id, docOriginalPath: origPath, firmantes: lista,
      }, headers)
      setSolicitud(sol)
      setMisFilas(filas)
      if (esChat && !firmarYo) {
        // El profesional no firma aquí: notifica al padre para publicar el
        // mensaje de firma en el hilo, y cierra.
        afterCreate?.(sol, filas, origPath, metaDoc)
        onClose?.()
      } else {
        setPaso('firmar')
      }
    } catch (e) {
      setError(e?.message || 'No se pudo crear la solicitud de firma.')
    }
  }

  // La fila del iniciador = la que coincide por correo con el usuario actual.
  const miFila = misFilas?.find((f) => (f.correo || '').toLowerCase() === (user?.email || '').toLowerCase()) || misFilas?.[0]

  async function firmarIniciador(signedBytes, pie, firmaPng, firmaProof) {
    const headers = await getAuthHeaders()
    const r = await persistirFirma({ solicitud, firmante: miFila, signedBytes, pie, firmaProof, headers })
    // La firma dibujada queda guardada en el perfil para la próxima vez.
    guardarFirmaPerfil(firmaPng)
    if (esChat) {
      // Publicar en el hilo el documento YA firmado por el profesional para
      // que el cliente firme encima.
      afterCreate?.(solicitud, misFilas, r?.docFirmadoPath || solicitud.doc_original_path, metaDoc)
      onClose?.()
      return
    }
    onDone?.()
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (paso === 'firmar' && solicitud && miFila) {
    return (
      <FirmaSigner
        pdfBytes={pdfBytes}
        firmante={{ ...yo, correo: miFila.correo, rol: miFila.rol_firma }}
        firmaGuardada={firmaGuardada}
        onComplete={firmarIniciador}
        onCancel={() => { onDone?.(); onClose?.() }}
      />
    )
  }

  // Portal a document.body: sin esto el modal queda atrapado bajo la barra
  // lateral del perfil (que tiene backdrop-filter + z-index propio).
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>Enviar a firmar</h2>
            <p className={styles.sub}>{esChat ? 'Enviar documento al cliente' : 'Firma de contrato'}</p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        {error && <div className={styles.errBar} role="alert">{error}</div>}

        <div className={styles.body}>
          {/* ── Documento ── */}
          <section className={styles.block}>
            <h3 className={styles.blockTitle}>1 · {esChat ? 'Documento' : 'Documento final (PDF)'}</h3>

            {/* Chat: qué se va a firmar. El contrato de servicios pasa por la
                verificación contra la plantilla; "otro documento" no. */}
            {esChat && !contrato && (
              <div className={styles.tipoDoc} role="radiogroup" aria-label="Clase de documento">
                {[
                  ['contrato', 'Contrato de prestación de servicios', 'Plantilla oficial · se verifica antes de enviar'],
                  ['otro', 'Otro documento', 'Cualquier PDF ya listo para firmar'],
                ].map(([k, titulo, sub]) => (
                  <button
                    key={k} type="button" role="radio" aria-checked={tipoDoc === k}
                    className={`${styles.tipoOpcion} ${tipoDoc === k ? styles.tipoOpcionOn : ''}`}
                    onClick={() => cambiarTipoDoc(k)}
                  >
                    <span className={styles.tipoRadio} aria-hidden="true" />
                    <span className={styles.tipoTexto}>
                      <strong>{titulo}</strong>
                      <small>{sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!contrato && (
              <>
                {esContratoServicios ? (
                  <>
                    {/* La plantilla: la fila entera descarga el Word. */}
                    <a className={styles.plantilla} href={plantilla.docx} download={plantilla.archivo}>
                      <span className={styles.plantillaIcono} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
                        </svg>
                      </span>
                      <span className={styles.plantillaInfo}>
                        <strong>{plantilla.titulo}</strong>
                        <small>Plantilla oficial en Word · descárgala y llena los espacios entre paréntesis</small>
                      </span>
                      <span className={styles.plantillaBajar} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
                        </svg>
                      </span>
                    </a>
                    <p className={styles.hint} style={{ marginTop: 0 }}>
                      Llena solo los espacios en MAYÚSCULAS, como <strong>(NOMBRE DEL CLIENTE)</strong>; el resto del
                      texto no se cambia. Al terminar, guárdala como PDF (en Word: Archivo → Guardar como → PDF) y súbela aquí.
                    </p>
                  </>
                ) : (
                  <>
                    <p className={styles.hint} style={{ marginTop: 0 }}>
                      Sube el documento <strong>ya listo</strong> para firmar. Si el cliente debía editarlo,
                      primero intercambien el Word por el chat y luego exporta la versión final a PDF.
                    </p>
                    {esChat && modeloPath && (
                      <button
                        type="button"
                        className={styles.addBtn}
                        style={{ marginBottom: 10 }}
                        onClick={usarModelo}
                        disabled={convirtiendo}
                      >
                        📄 Usar mi modelo contractual
                      </button>
                    )}
                  </>
                )}

                <input
                  ref={fileRef} type="file" hidden onChange={onPickFile}
                  accept={esContratoServicios
                    ? '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    : '.pdf,application/pdf'}
                />
                <button
                  type="button"
                  className={`${styles.dropzone} ${dragOver ? styles.dropzoneOver : ''}`}
                  onClick={() => fileRef.current?.click()}
                  disabled={convirtiendo || validacion?.estado === 'validando'}
                  onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
                  onDrop={(e) => {
                    e.preventDefault(); setDragOver(false)
                    const f = e.dataTransfer?.files?.[0]
                    if (f) procesarArchivo(f)
                  }}
                >
                  <IconFirma size={22} />
                  <span className={styles.dropzoneMain}>
                    {dragOver ? 'Suelta el archivo aquí'
                      : esContratoServicios
                        ? (validacion ? 'Subir otra versión' : 'Sube el contrato diligenciado')
                        : pdfBytes ? 'Cambiar documento' : 'Selecciona o arrastra el documento'}
                  </span>
                  <span className={styles.dropzoneSub}>
                    {esContratoServicios
                      ? 'PDF para enviarlo a firma · o el Word, para revisar la estructura antes de exportarlo'
                      : 'Solo PDF (si tienes Word, expórtalo a PDF)'}
                  </span>
                </button>

                {/* Veredicto de la comparación con la plantilla oficial */}
                {esContratoServicios && validacion && (
                  <Veredicto v={validacion} plantilla={plantilla} />
                )}
              </>
            )}
            {convirtiendo && (
              <p className={styles.muted}><span className={styles.spinner} /> Cargando documento…</p>
            )}
            {pdfUrl && (
              <>
                {/* Páginas rasterizadas: un <iframe> con PDF queda en blanco en Android. */}
                <div className={styles.preview}>
                  <PdfVisor url={pdfUrl} titulo="Vista previa del documento" fondo="#f1ede9" maxPaginas={40} />
                </div>
                <p className={styles.hint}>Revisa el documento antes de enviarlo al cliente.</p>
              </>
            )}
          </section>

          {/* ── Firmantes ── */}
          <section className={styles.block}>
            <h3 className={styles.blockTitle}>2 · {esChat ? 'Firmante' : 'Firmantes'}</h3>

            {esChat ? (
              // Chat: el cliente se toma del formulario de la consulta (solo lectura).
              firmantes[0]?.correo ? (
                <div className={styles.clienteRO}>
                  <span className={styles.clienteAvatar}>{(firmantes[0].nombre || 'C').charAt(0).toUpperCase()}</span>
                  <div>
                    <p className={styles.clienteNombre}>{firmantes[0].nombre || 'Cliente'}</p>
                    <p className={styles.clienteCorreo}>{firmantes[0].correo}</p>
                  </div>
                  <span className={styles.tag}>Firmará en el chat</span>
                </div>
              ) : (
                <p className={styles.hint}>
                  Esta consulta no tiene el correo del cliente registrado, así que no se puede enviar a firma por aquí.
                </p>
              )
            ) : (
            <ul className={styles.signers}>
              {firmantes.map((f, i) => (
                <li key={i} className={styles.signer}>
                  <div className={styles.signerGrid}>
                    <input className={styles.in} placeholder="Nombre" value={f.nombre}
                      onChange={(e) => updFirmante(i, 'nombre', e.target.value)} disabled={f.iniciador} />
                    <input className={styles.in} placeholder="Correo" type="email" value={f.correo}
                      onChange={(e) => updFirmante(i, 'correo', e.target.value)} disabled={f.iniciador} />
                    <select className={styles.in} value={f.rol}
                      onChange={(e) => updFirmante(i, 'rol', e.target.value)} disabled={f.iniciador}>
                      {Object.entries(ROL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {f.iniciador
                    ? <span className={styles.tag}>Tú firmas ahora</span>
                    : <button className={styles.del} onClick={() => delFirmante(i)} aria-label="Quitar firmante">✕</button>}
                </li>
              ))}
            </ul>
            )}
            {!esChat && (
              <button className={styles.addBtn} onClick={addFirmante}>＋ Agregar firmante</button>
            )}

            {/* Chat: firmar mi parte ANTES de enviárselo al cliente (la firma
                dibujada queda guardada en el perfil para reutilizarla). */}
            {esChat && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: '0.82rem', cursor: 'pointer', lineHeight: 1.45 }}>
                <input type="checkbox" checked={firmarYo}
                  onChange={e => setFirmarYo(e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#c9a84c' }} />
                <span>
                  Firmar yo también antes de enviarlo
                  <span style={{ display: 'block', fontSize: '0.72rem', opacity: 0.65 }}>
                    Dibujas (o reutilizas) tu firma y el cliente recibe el documento ya firmado por ti.
                  </span>
                </span>
              </label>
            )}
          </section>
        </div>

        <footer className={styles.foot}>
          <button className={styles.btnGhost} onClick={onClose}>Cancelar</button>
          <button className={styles.btnSolid} onClick={crear} disabled={!pdfBytes || !firmantesOk || convirtiendo}>
            {esChat ? (firmarYo ? 'Firmar y enviar al cliente' : 'Enviar al cliente para firmar') : 'Crear y firmar mi parte'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
