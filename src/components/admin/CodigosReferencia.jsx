import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './CodigosReferencia.module.css'
import { IconPlus, IconX, IconCheck, IconDownload, IconQR, IconPencil } from '../shared/Icons'
import { getQRUrl, downloadQRCard, chatUrlFor } from '../../lib/qrCard'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const APP_URL      = 'https://paradabridge.com'

function generarCodigo() {
  // 32 caracteres (sin I/O para no confundir) → 256 % 32 === 0, así que
  // `byte % 32` no introduce sesgo. Usamos CSPRNG en vez de Math.random()
  // para que el código no sea predecible.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  let code = 'PB-'
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length]
  return code
}

// Descarga la tarjeta de un código de comisionista (QR → chat con código).
function downloadComisionista(codigo, nombre, apellido) {
  return downloadQRCard({
    target: chatUrlFor(codigo),
    codigo, nombre, apellido,
    filename: `Tarjeta_PB_${codigo}.png`,
  })
}

export default function CodigosReferencia() {
  const [codigos, setCodigos]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false) // crear y editar usan el mismo modal
  const [editingId, setEditingId] = useState(null) // null = crear; id = editar
  const [editingCodigo, setEditingCodigo] = useState('')
  const [selectedQR, setSelectedQR] = useState(null)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  // ── Código oficial de la plataforma (fila con es_plataforma=true) ──
  const [plataforma, setPlataforma]   = useState(null)
  const [platModalOpen, setPlatModalOpen] = useState(false)
  const [platDestino, setPlatDestino] = useState(APP_URL)
  const [platCodigo, setPlatCodigo]   = useState('PB-OFICIAL')
  const [platSaving, setPlatSaving]   = useState(false)

  const FORM_VACIO = { nombre: '', apellido: '', cedula: '', correo: '', cuentas_bancarias: '', entidad: '' }

  const [form, setForm] = useState({
    nombre: '', apellido: '', cedula: '',
    correo: '', cuentas_bancarias: '', entidad: '',
  })

  useEffect(() => { fetchCodigos() }, [])

  async function fetchCodigos() {
    setLoading(true)
    const headers = await getAuthHeaders()
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/codigos_referencia?select=*&order=created_at.desc`,
      { headers }
    )
    // Programación defensiva: si el servidor responde 4xx/5xx no intentamos
    // parsear la respuesta como si fuera la lista (evita estados corruptos).
    if (!res.ok) {
      setError('No se pudieron cargar los códigos.')
      setCodigos([]); setPlataforma(null); setLoading(false)
      return
    }
    const data = await res.json()
    const filas = Array.isArray(data) ? data : []
    // Separa el código oficial de la plataforma del resto (comisionistas).
    const plat = filas.find(c => c.es_plataforma) || null
    setPlataforma(plat)
    if (plat) { setPlatDestino(plat.destino_url || APP_URL); setPlatCodigo(plat.codigo || 'PB-OFICIAL') }
    setCodigos(filas.filter(c => !c.es_plataforma))
    setLoading(false)
  }

  // ── Guardar / crear el código oficial de la plataforma ──
  async function savePlataforma() {
    const destino = platDestino.trim()
    if (!/^https?:\/\/.+/i.test(destino)) {
      setError('El destino debe ser una URL válida (empieza por https://).'); return
    }
    setPlatSaving(true); setError(''); setSuccess('')
    try {
      const headers = await getAuthHeaders()
      const codigo = (platCodigo.trim().toUpperCase() || 'PB-OFICIAL')
      if (plataforma) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?id=eq.${plataforma.id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ destino_url: destino, codigo }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error actualizando') }
      } else {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            codigo, es_plataforma: true, destino_url: destino,
            nombre: 'Plataforma', apellido: 'Oficial', cedula: '', correo: '', activo: true,
          }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error creando') }
      }
      setSuccess('Código oficial guardado.')
      setPlatModalOpen(false)
      await fetchCodigos()
    } catch (err) {
      setError(err.message)
    } finally {
      setPlatSaving(false)
    }
  }

  function downloadPlataforma() {
    return downloadQRCard({
      target: platDestino || APP_URL,
      codigo: platCodigo || 'PB-OFICIAL',
      nombre: 'Plataforma oficial', apellido: '',
      subtitulo: 'Sitio oficial', etiqueta: 'CÓDIGO OFICIAL DE LA PLATAFORMA',
      instruccion: 'Escanea para visitar nuestro sitio oficial',
      filename: 'Tarjeta_PB_Oficial.png',
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.apellido.trim() || !form.cedula.trim() || !form.correo.trim()) {
      setError('Nombre, apellido, cédula y correo son obligatorios.'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const headers = await getAuthHeaders()
      if (editingId) {
        // Editar: actualiza solo la información (el código y su QR no cambian).
        const res = await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?id=eq.${editingId}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ ...form }),
        })
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Error actualizando código') }
        setSuccess('Información actualizada correctamente.')
      } else {
        const codigo = generarCodigo()
        const res = await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ ...form, codigo }),
        })
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Error creando código') }
        setSuccess(`Código ${codigo} creado exitosamente.`)
      }
      setForm(FORM_VACIO)
      setModalOpen(false)
      setEditingId(null)
      setEditingCodigo('')
      await fetchCodigos()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(c) {
    setForm({
      nombre: c.nombre || '', apellido: c.apellido || '', cedula: c.cedula || '',
      correo: c.correo || '', cuentas_bancarias: c.cuentas_bancarias || '', entidad: c.entidad || '',
    })
    setEditingId(c.id)
    setEditingCodigo(c.codigo || '')
    setModalOpen(true)
    setError(''); setSuccess('')
  }

  function openCreate() {
    setForm(FORM_VACIO)
    setEditingId(null)
    setEditingCodigo('')
    setModalOpen(true)
    setError(''); setSuccess('')
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null); setEditingCodigo(''); setForm(FORM_VACIO); setError('')
  }

  async function toggleActivo(id, activo) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?id=eq.${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ activo: !activo }),
    })
    fetchCodigos()
  }


  // Campos del formulario (compartidos por el form inline de crear y el modal de editar)
  const camposForm = (
    <div className={styles.formGrid}>
      <div className={styles.field}>
        <label className={styles.label}>Nombre <span className={styles.req}>*</span></label>
        <input className={styles.input} value={form.nombre}
          onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre" />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Apellido <span className={styles.req}>*</span></label>
        <input className={styles.input} value={form.apellido}
          onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} placeholder="Apellido" />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Cédula <span className={styles.req}>*</span></label>
        <input className={styles.input} value={form.cedula}
          onChange={e => setForm(f => ({ ...f, cedula: e.target.value.replace(/\D/g, '') }))}
          placeholder="Número de cédula" maxLength={12} />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Correo <span className={styles.req}>*</span></label>
        <input className={styles.input} type="email" value={form.correo}
          onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="correo@ejemplo.com" />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Entidad en la que trabaja</label>
        <input className={styles.input} value={form.entidad}
          onChange={e => setForm(f => ({ ...f, entidad: e.target.value }))} placeholder="Nombre de la entidad" />
      </div>
      <div className={`${styles.field} ${styles.fullWidth}`}>
        <label className={styles.label}>Cuentas bancarias</label>
        <textarea className={styles.textarea} value={form.cuentas_bancarias} rows={3}
          onChange={e => setForm(f => ({ ...f, cuentas_bancarias: e.target.value }))}
          placeholder="Banco, tipo de cuenta, número..." />
      </div>
    </div>
  )

  return (
    <div className={styles.wrap}>

      {/* Header */}
      <div className={styles.topBar}>
        <div>
          <p className={styles.pageTitle}>Códigos de referencia</p>
          <p className={styles.pageSubtitle}>
            Genera códigos para comisionistas. El QR lleva al chat con el código prellenado.
          </p>
        </div>
        <button
          className={styles.btnNew}
          style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}
          onClick={openCreate}
        >
          <IconPlus /> Nuevo código
        </button>
      </div>

      {/* Mensajes */}
      {error   && !modalOpen && !platModalOpen && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.successMsg}>{success}</p>}

      {/* ── Código oficial de la plataforma (destacado) ── */}
      {!loading && (
        <div className={styles.platCard}>
          <div className={styles.platGlow} aria-hidden="true" />
          <span className={styles.platBadge}>Código oficial</span>

          <div className={styles.platBody}>
            <div className={styles.platQrBox}>
              <img
                src={getQRUrl(platDestino || APP_URL, 260)}
                alt="QR oficial de la plataforma"
                className={styles.platQrImg}
                width="130" height="130" loading="lazy" decoding="async"
              />
            </div>

            <div className={styles.platInfo}>
              <p className={styles.platTitle}>Parada Bridge · Sitio oficial</p>
              <p className={styles.platDesc}>
                Este QR redirige directamente a nuestra página. Compártelo en material impreso o digital.
              </p>
              <p className={styles.platCodigo}>{platCodigo || 'PB-OFICIAL'}</p>
              <a className={styles.platUrl} href={platDestino || APP_URL} target="_blank" rel="noopener noreferrer">
                {(platDestino || APP_URL).replace(/^https?:\/\//, '')}
              </a>
            </div>

            <div className={styles.platActions}>
              <button
                className={styles.btnDownload}
                style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}
                onClick={downloadPlataforma}
              >
                <IconDownload /> Descargar
              </button>
              <button
                className={styles.btnEdit}
                style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}
                onClick={() => {
                  setPlatDestino(plataforma?.destino_url || APP_URL)
                  setPlatCodigo(plataforma?.codigo || 'PB-OFICIAL')
                  setError(''); setSuccess('')
                  setPlatModalOpen(true)
                }}
              >
                <IconPencil /> Editar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.listHeading}>Códigos de comisionistas</div>

      {/* Lista de códigos */}
      {loading ? (
        <p className={styles.empty}>Cargando códigos…</p>
      ) : codigos.length === 0 ? (
        <p className={styles.empty}>No hay códigos generados aún.</p>
      ) : (
        <div className={styles.list}>
          {codigos.map(c => (
            <div key={c.id} className={`${styles.codigoCard} ${!c.activo ? styles.codigoInactivo : ''}`}>

              {/* Info */}
              <div className={styles.codigoInfo}>
                <div className={styles.codigoBadge}>{c.codigo}</div>
                <div className={styles.codigoDetails}>
                  <p className={styles.codigoNombre}>{c.nombre} {c.apellido}</p>
                  <p className={styles.codigoMeta}>CC {c.cedula} · {c.correo}</p>
                  {c.entidad && <p className={styles.codigoMeta}>{c.entidad}</p>}
                  <p className={styles.codigoFecha}>
                    {new Date(c.created_at).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' })}
                  </p>
                </div>
              </div>

              {/* Acciones */}
              <div className={styles.codigoActions}>
                <button
                  className={styles.btnQR}
                  style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}
                  onClick={() => setSelectedQR(selectedQR?.id === c.id ? null : c)}
                  title="Ver QR"
                >
                  <IconQR /> Ver QR
                </button>
                <button
                  className={styles.btnDownload}
                  style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}
                  onClick={() => downloadComisionista(c.codigo, c.nombre, c.apellido)}
                  title="Descargar tarjeta"
                >
                  <IconDownload /> Descargar
                </button>
                <button
                  className={styles.btnEdit}
                  style={{ display:'inline-flex', alignItems:'center', gap:'6px' }}
                  onClick={() => startEdit(c)}
                  title="Editar información"
                >
                  <IconPencil /> Editar
                </button>
                <button
                  className={c.activo ? styles.btnDeactivate : styles.btnActivate}
                  onClick={() => toggleActivo(c.id, c.activo)}
                >
                  {c.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>

              {/* QR expandido */}
              {selectedQR?.id === c.id && (
                <div className={styles.qrExpanded}>

                  <div className={styles.qrCardPreview}>
                    <div className={styles.qrCornerTL} />
                    <div className={styles.qrCornerBR} />

                    <div className={styles.qrCardHeader}>
                      <span className={styles.qrCardDespacho}>Despacho Jurídico</span>
                      <span className={styles.qrCardFirm}>PARADA <span style={{ color: '#9a7a2c' }}>BRIDGE</span></span>
                    </div>

                    <div className={styles.qrDivider} />

                    <div className={styles.qrImageWrap}>
                      <img
                        src={getQRUrl(chatUrlFor(c.codigo), 400)}
                        alt={`QR ${c.codigo}`}
                        className={styles.qrImg}
                        width="400"
                        height="400"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>

                    <div className={styles.qrCodeDisplay}>{c.codigo}</div>

                    <div className={styles.qrDivider} />

                    <div className={styles.qrCardName}>{c.nombre} {c.apellido}</div>
                    <div className={styles.qrCardRole}>Comisionista Autorizado</div>
                    <div className={styles.qrCardUrl}>paradabridge.com</div>
                  </div>

                  <button
                    className={styles.btnDownloadBig}
                    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:'8px' }}
                    onClick={() => downloadComisionista(c.codigo, c.nombre, c.apellido)}
                  >
                    <IconDownload /> Descargar tarjeta en alta resolución
                  </button>

                  <p className={styles.qrHint}>Al escanear → inicia consulta con código prellenado</p>
                </div>
              )}

            </div>
          ))}
        </div>
      )}

      {/* ── Modal para CREAR o EDITAR la información del código ──
          Portal a <body>: el position:fixed se ancla al viewport (no a un
          ancestro con transform/backdrop-filter) → fijo y centrado. */}
      {modalOpen && createPortal(
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qrEditTitle"
          onClick={closeModal}
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="qrEditTitle" className={styles.modalTitle}>
                  {editingId ? 'Editar información' : 'Nuevo código'}
                </h3>
                <p className={styles.modalSub}>
                  {editingId
                    ? <>Código <strong>{editingCodigo}</strong> · el QR no cambia</>
                    : 'El código y su QR se generan automáticamente al guardar.'}
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeModal}
                aria-label="Cerrar"
              >
                <IconX />
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <form onSubmit={handleSubmit}>
              {camposForm}
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className={styles.btnSave} disabled={saving}
                  style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}>
                  {saving
                    ? (editingId ? 'Guardando…' : 'Generando…')
                    : (editingId ? <><IconCheck /> Guardar cambios</> : <><IconCheck /> Generar código</>)}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: editar el código oficial de la plataforma ── */}
      {platModalOpen && createPortal(
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="platEditTitle"
          onClick={() => setPlatModalOpen(false)}
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="platEditTitle" className={styles.modalTitle}>Código oficial de la plataforma</h3>
                <p className={styles.modalSub}>El QR redirige al destino que definas aquí.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setPlatModalOpen(false)} aria-label="Cerrar">
                <IconX />
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <form onSubmit={e => { e.preventDefault(); savePlataforma() }}>
              <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.fullWidth}`}>
                  <label className={styles.label}>Código (etiqueta)</label>
                  <input className={styles.input} value={platCodigo}
                    onChange={e => setPlatCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    placeholder="PB-OFICIAL" maxLength={16}
                    style={{ letterSpacing:'2px', fontWeight:600 }} />
                </div>
                <div className={`${styles.field} ${styles.fullWidth}`}>
                  <label className={styles.label}>Destino del QR <span className={styles.req}>*</span></label>
                  <input className={styles.input} type="url" value={platDestino}
                    onChange={e => setPlatDestino(e.target.value)}
                    placeholder="https://paradabridge.com" />
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={() => setPlatModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className={styles.btnSave} disabled={platSaving}
                  style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}>
                  {platSaving ? 'Guardando…' : <><IconCheck /> Guardar</>}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
