import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import { getAuthHeaders } from '../../lib/supabase'
import { crearSolicitud, subirDoc, persistirFirma, bytesDeDoc } from '../../lib/firmaService'
import { ROL_LABEL } from '../../lib/firmaPdf'
import { IconFirma } from '../shared/Icons'
import FirmaSigner from './FirmaSigner'
import styles from './EnviarAFirmar.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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
   ───────────────────────────────────────────────────────────────────────── */
export default function EnviarAFirmar({ contrato, abogadoId, onClose, onDone, modo = 'contrato', roomId, cliente, afterCreate, modeloPath }) {
  const esChat = modo === 'chat'
  const { user, profile } = useAuth()
  const [paso, setPaso] = useState('doc')
  const [pdfBytes, setPdfBytes] = useState(null)
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

  // Solo PDF: no convertimos nada (así el documento queda idéntico al original).
  async function procesarArchivo(file) {
    if (!file) return
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
        afterCreate?.(sol, filas, origPath)
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
      afterCreate?.(solicitud, misFilas, r?.docFirmadoPath || solicitud.doc_original_path)
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
            <h3 className={styles.blockTitle}>1 · Documento final (PDF)</h3>
            {!contrato && (
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
                <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={onPickFile} />
                <button
                  type="button"
                  className={`${styles.dropzone} ${dragOver ? styles.dropzoneOver : ''}`}
                  onClick={() => fileRef.current?.click()}
                  disabled={convirtiendo}
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
                    {dragOver ? 'Suelta el archivo aquí' : pdfBytes ? 'Cambiar documento' : 'Selecciona o arrastra el documento'}
                  </span>
                  <span className={styles.dropzoneSub}>Solo PDF (si tienes Word, expórtalo a PDF)</span>
                </button>
              </>
            )}
            {convirtiendo && (
              <p className={styles.muted}><span className={styles.spinner} /> Cargando documento…</p>
            )}
            {pdfUrl && (
              <>
                <div className={styles.preview}><iframe title="Vista previa" src={`${pdfUrl}#zoom=page-width`} className={styles.frame} /></div>
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
