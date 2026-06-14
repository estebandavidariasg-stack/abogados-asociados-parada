import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './CodigosReferencia.module.css'
import { IconPlus, IconX, IconCheck, IconDownload, IconQR, IconPencil } from '../shared/Icons'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const APP_URL      = 'https://abogadosparada.com'

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'AAP-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function getQRUrl(codigo, size = 320) {
  const chatUrl = `${APP_URL}/#chat?codigo=${encodeURIComponent(codigo)}`
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(chatUrl)}&color=1A1A2E&bgcolor=FAFAFA&margin=2&qzone=1`
}

export default function CodigosReferencia() {
  const [codigos, setCodigos]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null) // null = crear; id = editar (abre modal)
  const [editingCodigo, setEditingCodigo] = useState('')
  const [selectedQR, setSelectedQR] = useState(null)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

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
    const data = await res.json()
    setCodigos(Array.isArray(data) ? data : [])
    setLoading(false)
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
      setShowForm(false)
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
    setShowForm(false)   // el inline es solo para crear; editar usa el modal
    setError(''); setSuccess('')
  }

  function closeEdit() {
    setEditingId(null); setEditingCodigo(''); setForm(FORM_VACIO); setError('')
  }

  function toggleForm() {
    setError(''); setSuccess('')
    setShowForm(s => !s)
    setForm(FORM_VACIO)
  }

  async function toggleActivo(id, activo) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/codigos_referencia?id=eq.${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ activo: !activo }),
    })
    fetchCodigos()
  }

  async function downloadQR(codigo, nombre, apellido) {
    const chatUrl = `${APP_URL}/#chat?codigo=${encodeURIComponent(codigo)}`

    const SCALE = 2
    const W = 600, H = 860

    const canvas = document.createElement('canvas')
    canvas.width  = W * SCALE
    canvas.height = H * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    // Fondo degradado navy (tono de marca, no casi-negro: mejor legibilidad)
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0,   '#15376b')
    bg.addColorStop(0.5, '#1d4d86')
    bg.addColorStop(1,   '#15376b')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Textura sutil
    ctx.fillStyle = 'rgba(255,255,255,0.013)'
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

    // Marco exterior
    ctx.strokeStyle = 'rgba(201,168,76,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(24, 24, W - 48, H - 48)

    // Líneas acento superior e inferior
    ctx.strokeStyle = '#C9A84C'
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(110, 24); ctx.lineTo(W - 110, 24); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(110, H - 24); ctx.lineTo(W - 110, H - 24); ctx.stroke()

    // Esquinas decorativas
    const corners = [[44,44],[W-44,44],[44,H-44],[W-44,H-44]]
    const dirs    = [[1,1],[-1,1],[1,-1],[-1,-1]]
    ctx.strokeStyle = 'rgba(201,168,76,0.65)'
    ctx.lineWidth = 2
    corners.forEach(([cx,cy], i) => {
      const [dx,dy] = dirs[i]
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+dx*24,cy); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+dy*24); ctx.stroke()
    })

    // Cabecera firma
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(232,201,106,0.85)'
    ctx.font = '600 9px sans-serif'
    ctx.fillText('─── DESPACHO JURÍDICO ───', W / 2, 74)

    ctx.fillStyle = '#C9A84C'
    ctx.font = 'bold 16px serif'
    ctx.fillText('ABOGADOS Y ASOCIADOS', W / 2, 100)
    ctx.font = 'bold 21px serif'
    ctx.fillText('PARADA', W / 2, 126)

    // Separador 1
    ctx.strokeStyle = 'rgba(201,168,76,0.2)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(100,148); ctx.lineTo(W-100,148); ctx.stroke()
    ctx.fillStyle = 'rgba(201,168,76,0.55)'
    ctx.beginPath(); ctx.moveTo(W/2,143); ctx.lineTo(W/2+5,148); ctx.lineTo(W/2,153); ctx.lineTo(W/2-5,148); ctx.closePath(); ctx.fill()

    // Etiqueta
    ctx.fillStyle = 'rgba(255,255,255,0.62)'
    ctx.font = '600 10px sans-serif'
    ctx.fillText('CÓDIGO DE REFERENCIA AUTORIZADO', W / 2, 178)

    // QR a 700px — nítido en canvas 2x
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=700x700&data=${encodeURIComponent(chatUrl)}&color=1A1A2E&bgcolor=FAFAFA&margin=2&qzone=1`
    const qrImg = new Image()
    qrImg.crossOrigin = 'anonymous'
    await new Promise((res, rej) => { qrImg.onload = res; qrImg.onerror = rej; qrImg.src = qrApiUrl })

    // Fondo blanco redondeado para el QR
    const qrX = 148, qrY = 196, qrSize = 304, r = 10
    ctx.fillStyle = '#FAFAFA'
    ctx.shadowColor = 'rgba(201,168,76,0.2)'
    ctx.shadowBlur = 24
    ctx.beginPath()
    ctx.moveTo(qrX+r,qrY)
    ctx.arcTo(qrX+qrSize,qrY,qrX+qrSize,qrY+qrSize,r)
    ctx.arcTo(qrX+qrSize,qrY+qrSize,qrX,qrY+qrSize,r)
    ctx.arcTo(qrX,qrY+qrSize,qrX,qrY,r)
    ctx.arcTo(qrX,qrY,qrX+qrSize,qrY,r)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.strokeStyle = 'rgba(201,168,76,0.4)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.drawImage(qrImg, qrX+10, qrY+10, qrSize-20, qrSize-20)

    // Código
    ctx.fillStyle = '#C9A84C'
    ctx.font = 'bold 26px monospace'
    ctx.shadowColor = 'rgba(201,168,76,0.35)'
    ctx.shadowBlur = 12
    ctx.fillText(codigo, W/2, 562)
    ctx.shadowBlur = 0

    // Separador 2
    ctx.strokeStyle = 'rgba(201,168,76,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(100,582); ctx.lineTo(W-100,582); ctx.stroke()
    ctx.fillStyle = 'rgba(201,168,76,0.45)'
    ctx.beginPath(); ctx.moveTo(W/2,577); ctx.lineTo(W/2+4,582); ctx.lineTo(W/2,587); ctx.lineTo(W/2-4,582); ctx.closePath(); ctx.fill()

    // Nombre
    ctx.fillStyle = '#fbf7ec'
    ctx.font = 'bold 20px serif'
    ctx.fillText(`${nombre} ${apellido}`, W/2, 632)

    ctx.fillStyle = 'rgba(232,201,106,0.8)'
    ctx.font = '600 9.5px sans-serif'
    ctx.fillText('COMISIONISTA AUTORIZADO', W/2, 656)

    // Instrucción
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '11px sans-serif'
    ctx.fillText('Escanea el código QR para iniciar tu consulta jurídica', W/2, 722)

    // URL
    ctx.fillStyle = 'rgba(232,201,106,0.85)'
    ctx.font = '600 12px sans-serif'
    ctx.fillText('abogadosparada.com', W/2, 806)

    // Descargar
    const link = document.createElement('a')
    link.download = `Tarjeta_AAP_${codigo}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
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
          onClick={toggleForm}
        >
          {showForm ? <><IconX /> Cancelar</> : <><IconPlus /> Nuevo código</>}
        </button>
      </div>

      {/* Mensajes */}
      {error   && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.successMsg}>{success}</p>}

      {/* Formulario para CREAR (inline). Editar usa el modal de abajo. */}
      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <p className={styles.formTitle}>Datos del comisionista</p>
          {camposForm}
          <div className={styles.formActions}>
            <button type="submit" className={styles.btnSave} disabled={saving}
              style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}>
              {saving ? 'Generando…' : <><IconCheck /> Generar código</>}
            </button>
          </div>
        </form>
      )}

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
                  onClick={() => downloadQR(c.codigo, c.nombre, c.apellido)}
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
                      <span className={styles.qrCardFirm}>ABOGADOS Y ASOCIADOS PARADA</span>
                    </div>

                    <div className={styles.qrDivider} />

                    <div className={styles.qrImageWrap}>
                      <img
                        src={getQRUrl(c.codigo, 400)}
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
                    <div className={styles.qrCardUrl}>abogadosparada.com</div>
                  </div>

                  <button
                    className={styles.btnDownloadBig}
                    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:'8px' }}
                    onClick={() => downloadQR(c.codigo, c.nombre, c.apellido)}
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

      {/* ── Ventana (modal) para editar la información del código ──
          Portal a <body>: el position:fixed se ancla al viewport (no a un
          ancestro con transform/backdrop-filter) → fijo y centrado. */}
      {editingId && createPortal(
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qrEditTitle"
          onClick={closeEdit}
        >
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div>
                <h3 id="qrEditTitle" className={styles.modalTitle}>Editar información</h3>
                <p className={styles.modalSub}>
                  Código <strong>{editingCodigo}</strong> · el QR no cambia
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeEdit}
                aria-label="Cerrar"
              >
                <IconX />
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <form onSubmit={handleSubmit}>
              {camposForm}
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnCancel} onClick={closeEdit}>
                  Cancelar
                </button>
                <button type="submit" className={styles.btnSave} disabled={saving}
                  style={{ display:'inline-flex', alignItems:'center', gap:'7px' }}>
                  {saving ? 'Guardando…' : <><IconCheck /> Guardar cambios</>}
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
