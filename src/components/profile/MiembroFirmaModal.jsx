import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { compressImage } from '../../utils/compressMedia'
import { validarCelular, normalizarCelular, validarCorreo } from '../../lib/validaciones'
import { AREAS_DERECHO } from '../../lib/areasDerecho'
import { AREAS_CONTADURIA } from '../../lib/areasContaduria'
import { UNIVERSIDADES } from '../../lib/universidades'
import UbicacionSelector from './UbicacionSelector'
import { IconX } from '../shared/Icons'
// Mismo cuadro y mismos campos que el registro de un profesional: una ficha
// del equipo se llena igual que un perfil, solo que la llena la firma.
import styles from '../auth/AuthModal.module.css'
import extra from '../auth/RegisterModal.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ══════════════════════════════════════════════════════════════════
   Ficha de un miembro de la firma (Director o aliado/colaborador).

   Un miembro NO es una cuenta: es información que la firma publica en su
   tarjeta (tabla firma_miembros). Por eso aquí no hay correo de acceso ni
   contraseña ni código, y tampoco certificado bancario: las consultas, los
   cobros y los pagos son de la firma. Todo lo demás es obligatorio, como en
   el registro de cualquier profesional (foto, tarjeta profesional y
   certificado disciplinario incluidos).

   Sirve para crear (`miembro` = null) y para editar (`miembro` = la fila):
   al editar, los archivos solo se piden si se quieren reemplazar.
   Los archivos viven en las carpetas de la FIRMA (el bucket privado solo
   deja escribir en la carpeta propia): tarjetas-profesionales/<firma>/
   miembros/<id>/… y profile-photos/avatars/miembros/<id>.jpg.
   ══════════════════════════════════════════════════════════════════ */

const EXPERIENCIA_OPTIONS = [
  'Menos de 1 año', '1 - 3 años', '3 - 5 años',
  '5 - 10 años', '10 - 15 años', 'Más de 15 años',
]
const DESCRIPCION_MIN = 60
const DESCRIPCION_MAX = 500
const DOC_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'
const DOC_TIPOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

const rotulo = (cargo) => (cargo === 'director' ? 'Director' : 'Aliado/Colaborador')
const partirAreas = (txt) => (txt ? String(txt).split(',').map(a => a.trim()).filter(Boolean) : [])
const partirCiudad = (txt) => {
  const [ciudad = '', barrio = ''] = String(txt || '').split(' - ')
  return { ciudad: ciudad.trim(), barrio: barrio.trim() }
}

export default function MiembroFirmaModal({ firmaId, cargo, miembro = null, onClose, onGuardado }) {
  const editando = !!miembro?.id
  const fotoRef = useRef(null)
  const tarjetaRef = useRef(null)
  const discRef = useRef(null)

  const [rol, setRol]               = useState(miembro?.rol || 'abogado')
  const [nombre, setNombre]         = useState(miembro?.nombre || '')
  const [apellido, setApellido]     = useState(miembro?.apellido || '')
  const [cedula, setCedula]         = useState(miembro?.cedula || '')
  const [telefono, setTelefono]     = useState(miembro?.telefono || '')
  const [email, setEmail]           = useState(miembro?.email || '')
  const uniGuardada = miembro?.universidad || ''
  const [universidadOtra, setUniversidadOtra] = useState(!!uniGuardada && !UNIVERSIDADES.includes(uniGuardada))
  const [universidad, setUniversidad] = useState(uniGuardada)
  const [areas, setAreas]           = useState(() => {
    // Lo guardado que no está en la lista es el texto de "Otro".
    const lista = rol === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO
    return partirAreas(miembro?.area_derecho).filter(a => lista.includes(a))
  })
  const [areaOtraTexto, setAreaOtraTexto] = useState(() => {
    const lista = (miembro?.rol === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO)
    return partirAreas(miembro?.area_derecho).filter(a => !lista.includes(a)).join(', ')
  })
  const [areaOtraOn, setAreaOtraOn] = useState(() => {
    const lista = (miembro?.rol === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO)
    return partirAreas(miembro?.area_derecho).some(a => !lista.includes(a))
  })
  const [experiencia, setExperiencia] = useState(miembro?.experiencia || '')
  const [departamento, setDepartamento] = useState(miembro?.departamento || '')
  const [ciudad, setCiudad]         = useState(() => partirCiudad(miembro?.ciudad).ciudad)
  const [barrio, setBarrio]         = useState(() => partirCiudad(miembro?.ciudad).barrio)
  const [descripcion, setDescripcion] = useState(miembro?.descripcion || '')
  const [fotoFile, setFotoFile]     = useState(null)
  const [fotoPreview, setFotoPreview] = useState(miembro?.foto_url || null)
  const [tarjetaFile, setTarjetaFile] = useState(null)
  const [discFile, setDiscFile]     = useState(null)
  const [errores, setErrores]       = useState({})
  const [error, setError]           = useState('')
  const [guardando, setGuardando]   = useState('')   // '' | 'datos' | 'foto' | 'tarjeta' | 'disc'

  const AREAS_LIST = rol === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO
  // El contador trae "Otro" en su lista; al abogado se le añade "Otra".
  const OTRO = rol === 'contador' ? 'Otro' : 'Otra'
  const areasFinales = areas.filter(a => a !== 'Otro' && a !== 'Otra')
    .concat(areaOtraOn && areaOtraTexto.trim() ? [areaOtraTexto.trim()] : [])

  useEffect(() => {
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !guardando) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [guardando, onClose])

  const cls = (campo) => `${styles.input}${errores[campo] ? ` ${extra.inputError}` : ''}`
  const limpiar = (campo) => setErrores(p => (p[campo] ? { ...p, [campo]: undefined } : p))

  function cambiarRol(r) {
    if (r === rol) return
    setRol(r); setAreas([]); setAreaOtraOn(false); setAreaOtraTexto('')
  }
  function toggleArea(a) {
    if (a === OTRO) { setAreaOtraOn(v => !v); if (areaOtraOn) setAreaOtraTexto(''); limpiar('areas'); return }
    setAreas(prev => (prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]))
    limpiar('areas')
  }

  function onFoto(e) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    if (!raw.type.startsWith('image/')) { setError('La foto debe ser una imagen.'); return }
    setError('')
    compressImage(raw, 1200, 0.85, 'image/jpeg')
      .then(f => {
        setFotoFile(f)
        setFotoPreview(prev => { if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
        limpiar('foto')
      })
      .catch(() => setError('No se pudo procesar la foto. Intenta con otra imagen.'))
  }
  function onDoc(e, set, campo) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!DOC_TIPOS.includes(file.type)) { setError('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setError('El archivo no puede superar 10 MB.'); return }
    setError(''); set(file); limpiar(campo)
  }

  function validar() {
    const e = {}
    if (!nombre.trim())   e.nombre = 'Escribe el nombre'
    if (!apellido.trim()) e.apellido = 'Escribe el apellido'
    if (!/^\d{6,12}$/.test(cedula.trim())) e.cedula = 'La cédula debe tener entre 6 y 12 dígitos'
    if (validarCelular(telefono).valid !== true) e.telefono = 'El celular debe tener 10 dígitos y empezar por 3'
    if (!validarCorreo(email.trim()).valid) e.email = 'Escribe un correo válido'
    if (!universidad.trim()) e.universidad = 'Selecciona la universidad'
    if (areasFinales.length === 0) e.areas = rol === 'contador' ? 'Marca al menos una especialidad' : 'Marca al menos un área'
    else if (areaOtraOn && !areaOtraTexto.trim()) e.areas = `Escribe cuál es esa ${rol === 'contador' ? 'otra especialidad' : 'otra área'}`
    if (!experiencia) e.experiencia = 'Indica los años de experiencia'
    if (!departamento || !ciudad.trim()) e.ubicacion = 'Selecciona departamento y municipio'
    if (descripcion.trim().length < DESCRIPCION_MIN) e.descripcion = `La presentación necesita al menos ${DESCRIPCION_MIN} caracteres`
    if (!fotoFile && !miembro?.foto_url) e.foto = 'Sube la foto'
    if (!tarjetaFile && !miembro?.tarjeta_archivo_url) e.tarjeta = 'Sube la tarjeta profesional'
    if (!discFile && !miembro?.certificado_disciplinario_url) e.disc = 'Sube el certificado disciplinario'
    setErrores(e)
    return e
  }

  async function subir(bucket, path, file, headers) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file,
    })
    if (!r.ok) throw new Error(`No se pudo subir el archivo (error ${r.status}).`)
  }

  async function guardar(ev) {
    ev.preventDefault()
    setError('')
    const e = validar()
    if (Object.keys(e).length) { setError(`${Object.values(e)[0]}.`); return }
    setGuardando('datos')
    try {
      const headers = await getAuthHeaders()
      const datos = {
        cargo, rol,
        nombre: nombre.trim(), apellido: apellido.trim(),
        cedula: cedula.trim(), telefono: normalizarCelular(telefono), email: email.trim().toLowerCase(),
        universidad: universidad.trim(),
        area_derecho: areasFinales.join(', '),
        experiencia,
        departamento,
        // Mismo formato que un perfil: el barrio va dentro de `ciudad`.
        ciudad: barrio.trim() ? `${ciudad.trim()} - ${barrio.trim()}` : ciudad.trim(),
        descripcion: descripcion.trim(),
      }
      let id = miembro?.id
      if (editando) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/firma_miembros?id=eq.${id}&firma_id=eq.${firmaId}`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(datos),
        })
        if (!r.ok) throw new Error(await motivo(r, 'No se pudieron guardar los cambios.'))
      } else {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/firma_miembros`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ ...datos, firma_id: firmaId }),
        })
        const j = await r.json().catch(() => null)
        if (!r.ok || !j?.[0]?.id) throw new Error(await motivo(r, 'No se pudo crear la ficha.', j))
        id = j[0].id
      }

      // Archivos: cada uno sube y se apunta en la fila. Si uno falla, la
      // ficha ya existe y el aviso dice cuál faltó: se vuelve a subir editando.
      const urls = {}
      if (fotoFile) {
        setGuardando('foto')
        const path = `avatars/miembros/${id}.jpg`
        await subir('profile-photos', path, fotoFile, headers)
        urls.foto_url = `${SUPABASE_URL}/storage/v1/object/public/profile-photos/${path}?t=${Date.now()}`
      }
      if (tarjetaFile) {
        setGuardando('tarjeta')
        const ext = (tarjetaFile.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
        const path = `${firmaId}/miembros/${id}/tarjeta.${ext}`
        await subir('tarjetas-profesionales', path, tarjetaFile, headers)
        urls.tarjeta_archivo_url = path
      }
      if (discFile) {
        setGuardando('disc')
        const ext = (discFile.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
        const path = `${firmaId}/miembros/${id}/disciplinario.${ext}`
        await subir('tarjetas-profesionales', path, discFile, headers)
        urls.certificado_disciplinario_url = path
      }
      if (Object.keys(urls).length) {
        setGuardando('datos')
        const r = await fetch(`${SUPABASE_URL}/rest/v1/firma_miembros?id=eq.${id}&firma_id=eq.${firmaId}`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(urls),
        })
        if (!r.ok) throw new Error('Los archivos subieron pero no quedaron apuntados en la ficha. Edítala y súbelos de nuevo.')
      }
      onGuardado?.(id)
      onClose()
    } catch (err) {
      setError(err.message || 'No se pudo guardar. Intenta de nuevo.')
    } finally {
      setGuardando('')
    }
  }

  async function motivo(r, generico, j) {
    const body = j || (await r.json().catch(() => ({})))
    const msg = String(body?.message || '')
    if (r.status === 404 || /relation .* does not exist|schema cache/i.test(msg)) return 'Falta aplicar docs/sql/perfil-firma-v2-2026-10-05.sql en Supabase.'
    if (/firma_miembros_un_director/.test(msg)) return 'La firma ya tiene Director.'
    if (r.status === 401 || r.status === 403 || body?.code === '42501') return 'Tu firma debe estar aprobada para registrar a su equipo.'
    return generico
  }

  const ocupado = !!guardando
  const textoBoton = guardando === 'foto' ? 'Subiendo foto…'
    : guardando === 'tarjeta' ? 'Subiendo tarjeta…'
    : guardando === 'disc' ? 'Subiendo certificado…'
    : guardando ? 'Guardando…'
    : editando ? 'Guardar cambios' : `Registrar ${rotulo(cargo)}`

  return createPortal(
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget && !ocupado) onClose() }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="miembro-titulo">
        <button type="button" className={styles.close} onClick={onClose} aria-label="Cerrar" disabled={ocupado}><IconX /></button>
        <p className={styles.eyebrow}><span style={{ color: 'var(--navy)' }}>Parada</span> Bridge</p>
        <h3 className={styles.title} id="miembro-titulo">
          {editando ? `Editar ${rotulo(cargo)}` : `Registrar ${rotulo(cargo)}`}
        </h3>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          {editando
            ? 'Cambia lo que haga falta. Los archivos solo se piden si quieres reemplazarlos.'
            : 'Es un perfil informativo de tu equipo. Aparece en la tarjeta de la firma y las consultas le llegan a la firma. No crea una cuenta ni necesita certificado bancario.'}
        </p>

        {error && <p className={styles.msgError} role="alert">{error}</p>}

        <form className={styles.form} onSubmit={guardar} noValidate>
          {/* Profesión */}
          <div className={styles.field}>
            <span className={styles.label}>Profesión <span className={styles.req}>*</span></span>
            <div className={`${extra.roleSelector} ${extra.roleCols2}`} role="radiogroup" aria-label="Profesión">
              {[['abogado', 'Abogado'], ['contador', 'Contador']].map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={rol === k}
                  className={`${extra.roleBtn} ${rol === k ? extra.roleBtnActive : ''}`}
                  onClick={() => cambiarRol(k)} disabled={ocupado}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mb-nombre">Nombre <span className={styles.req}>*</span></label>
              <input id="mb-nombre" className={cls('nombre')} value={nombre} placeholder="Nombre" maxLength={60}
                onChange={(e) => { setNombre(e.target.value); limpiar('nombre') }} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mb-apellido">Apellido <span className={styles.req}>*</span></label>
              <input id="mb-apellido" className={cls('apellido')} value={apellido} placeholder="Apellido" maxLength={60}
                onChange={(e) => { setApellido(e.target.value); limpiar('apellido') }} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mb-cedula">Cédula <span className={styles.req}>*</span></label>
              <input id="mb-cedula" className={cls('cedula')} inputMode="numeric" value={cedula} placeholder="Número de cédula" maxLength={12}
                onChange={(e) => { setCedula(e.target.value.replace(/\D/g, '')); limpiar('cedula') }} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mb-tel">Celular <span className={styles.req}>*</span></label>
              <input id="mb-tel" className={cls('telefono')} type="tel" inputMode="numeric" value={telefono} placeholder="3001234567" maxLength={10}
                onChange={(e) => { setTelefono(normalizarCelular(e.target.value)); limpiar('telefono') }} />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mb-email">Correo electrónico <span className={styles.req}>*</span></label>
            <input id="mb-email" className={cls('email')} type="email" value={email} placeholder="correo@ejemplo.com" maxLength={120}
              onChange={(e) => { setEmail(e.target.value); limpiar('email') }} />
            <span className={styles.hint} style={{ marginTop: 4 }}>Solo lo ve la administración. Las consultas de los clientes llegan al correo de la firma.</span>
          </div>

          {/* Universidad */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="mb-uni">Universidad <span className={styles.req}>*</span></label>
            <select id="mb-uni" className={cls('universidad')} value={universidadOtra ? 'Otra' : universidad}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'Otra') { setUniversidadOtra(true); setUniversidad('') }
                else { setUniversidadOtra(false); setUniversidad(v) }
                limpiar('universidad')
              }}>
              <option value="">Selecciona…</option>
              {UNIVERSIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            {universidadOtra && (
              <input type="text" className={cls('universidad')} style={{ marginTop: '0.5rem' }}
                placeholder="Escribe el nombre de la universidad" aria-label="Nombre de la universidad" maxLength={120}
                value={universidad} onChange={(e) => { setUniversidad(e.target.value); limpiar('universidad') }} />
            )}
          </div>

          {/* Áreas */}
          <div className={styles.field}>
            <span className={styles.label}>
              {rol === 'contador' ? 'Especialidades que ejerce' : 'Áreas que ejerce'} <span className={styles.req}>*</span>
            </span>
            <div className={extra.areasBox} data-error={errores.areas ? '1' : undefined}>
              {AREAS_LIST.map(a => (
                <label key={a} className={extra.areaItem}>
                  <input type="checkbox" className={extra.areaCheck}
                    checked={a === OTRO ? areaOtraOn : areas.includes(a)} onChange={() => toggleArea(a)} />
                  <span>{a}</span>
                </label>
              ))}
              {rol === 'abogado' && (
                <label className={extra.areaItem}>
                  <input type="checkbox" className={extra.areaCheck} checked={areaOtraOn} onChange={() => toggleArea('Otra')} />
                  <span>Otra</span>
                </label>
              )}
            </div>
            {areaOtraOn && (
              <input type="text" className={cls('areas')} style={{ marginTop: '0.6rem' }} maxLength={60}
                placeholder={rol === 'contador' ? 'Escribe la otra especialidad' : 'Escribe la otra área'}
                aria-label={rol === 'contador' ? 'Otra especialidad' : 'Otra área'}
                value={areaOtraTexto} onChange={(e) => { setAreaOtraTexto(e.target.value); limpiar('areas') }} />
            )}
            <div className={extra.areasCount}>{areasFinales.length} seleccionada{areasFinales.length === 1 ? '' : 's'}</div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mb-exp">Experiencia laboral <span className={styles.req}>*</span></label>
            <select id="mb-exp" className={cls('experiencia')} value={experiencia}
              onChange={(e) => { setExperiencia(e.target.value); limpiar('experiencia') }}>
              <option value="">Selecciona…</option>
              {EXPERIENCIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <UbicacionSelector
            departamento={departamento}
            municipio={ciudad}
            barrio={barrio}
            required
            classes={{ field: styles.field, label: styles.label, select: cls('ubicacion') }}
            onChange={({ departamento: d, municipio, barrio: b }) => {
              setDepartamento(d); setCiudad(municipio); setBarrio(b); limpiar('ubicacion')
            }}
          />

          {/* Presentación */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="mb-desc">Presentación <span className={styles.req}>*</span></label>
            <textarea id="mb-desc" className={cls('descripcion')} rows={4} maxLength={DESCRIPCION_MAX}
              placeholder="A quién atiende, en qué casos tiene más recorrido y cómo trabaja."
              value={descripcion} onChange={(e) => { setDescripcion(e.target.value.slice(0, DESCRIPCION_MAX)); limpiar('descripcion') }}
              style={{ resize: 'vertical', minHeight: 100, lineHeight: 1.6 }} />
            <span className={styles.hint} style={{ marginTop: 4, textAlign: 'right' }}>
              {descripcion.length}/{DESCRIPCION_MAX} · mínimo {DESCRIPCION_MIN}
            </span>
          </div>

          {/* Foto */}
          <div className={styles.field}>
            <span className={styles.label}>
              Foto <span className={styles.req}>*</span>
              <span className={`${extra.tag} ${extra.tagReq}`}>Obligatorio</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div aria-hidden="true" style={{
                width: 72, height: 72, borderRadius: '50%', flex: '0 0 auto',
                background: fotoPreview ? `#fff center / cover no-repeat url(${fotoPreview})` : 'rgba(120,120,120,0.08)',
                border: fotoPreview ? '2px solid #c9a84c' : `2px dashed ${errores.foto ? '#c0392b' : 'rgba(120,120,120,0.4)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {!fotoPreview && (
                  <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#9a938c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                )}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <button type="button" className={extra.uploadBtn} onClick={() => fotoRef.current?.click()} disabled={ocupado}>
                  {fotoPreview ? 'Cambiar foto' : 'Subir foto'}
                </button>
                <span style={{ fontSize: '0.68rem', opacity: 0.65 }}>Aparece en la tarjeta de la firma. JPG/PNG.</span>
              </div>
            </div>
            <input ref={fotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFoto} />
          </div>

          {/* Documentos */}
          <fieldset className={extra.docGroup}>
            <legend className={styles.label}>
              Documentos <span className={styles.req}>*</span>
              <span className={`${extra.tag} ${extra.tagReq}`}>Obligatorio · ambos</span>
            </legend>
            <p className={extra.docHint} style={{ marginTop: 0 }}>PDF o imagen, máx. 10 MB cada uno.</p>
            {[
              ['tarjeta', 'Tarjeta profesional', tarjetaFile, setTarjetaFile, tarjetaRef, miembro?.tarjeta_archivo_url],
              ['disc',    'Certificado disciplinario', discFile, setDiscFile, discRef, miembro?.certificado_disciplinario_url],
            ].map(([campo, nombreDoc, file, set, ref, existente]) => (
              <div key={campo} className={extra.docSlot} data-error={errores[campo] ? '1' : undefined}>
                <span className={extra.docSlotName}>{nombreDoc}</span>
                <button type="button" className={extra.uploadBtn} onClick={() => ref.current?.click()} disabled={ocupado}>
                  {file || existente ? 'Cambiar archivo' : `Subir ${nombreDoc.toLowerCase()}`}
                </button>
                <input ref={ref} type="file" accept={DOC_ACCEPT} style={{ display: 'none' }} onChange={(e) => onDoc(e, set, campo)} />
                {file ? (
                  <div className={extra.fileRow}>
                    <span className={extra.fileName}>✓ {file.name}</span>
                    <button type="button" className={extra.linkMini} onClick={() => set(null)}>Quitar</button>
                  </div>
                ) : existente ? (
                  <div className={extra.fileRow}><span className={extra.fileName}>✓ Ya está cargado</span></div>
                ) : null}
              </div>
            ))}
          </fieldset>

          <button type="submit" className={`btn-solid ${styles.submit}`} disabled={ocupado}>
            {textoBoton}
          </button>
          {!editando && (
            <p className={styles.hint}>Queda publicado de inmediato en la tarjeta de tu firma.</p>
          )}
        </form>
      </div>
    </div>,
    document.body
  )
}
