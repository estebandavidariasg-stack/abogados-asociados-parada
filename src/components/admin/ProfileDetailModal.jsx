import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import SocialLinks from '../profile/SocialLinks'
import TarjetaPreview from '../profile/TarjetaPreview'
import { etiquetaCiudad } from '../../lib/validaciones'
// Reusamos los estilos del modal de LawyerCard — mismo lenguaje visual.
import styles from '../home/LawyerCard.module.css'
// Logo en cuadro y pastilla "Firma": las mismas piezas de la tarjeta pública.
import fStyles from '../home/FirmaCard.module.css'
// Y la misma fila de persona que muestra el modal de la firma en el inicio.
import { Profesional } from '../home/FirmaCard'

function StarDisplay({ rating, total }) {
  if (!rating) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1,2,3,4,5].map(s => (
          <span key={s} style={{
            color: s <= Math.round(rating) ? 'var(--gold)' : 'rgba(109,60,27,0.18)',
            fontSize: '0.85rem',
          }}>★</span>
        ))}
      </div>
      <span style={{ color: '#888', fontSize: '0.73rem' }}>
        {rating} ({total})
      </span>
    </div>
  )
}

function InfoRow({ icon, label, value, isLink, href }) {
  if (!value) return null
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoIcon}>{icon}</span>
      <div>
        <span className={styles.infoLabel}>{label}</span>
        {isLink
          ? <a href={href || value} target="_blank" rel="noopener noreferrer" className={styles.infoValue} style={{ color:'var(--gold-dk, #8a6a28)', textDecoration:'underline' }}>{value}</a>
          : <span className={styles.infoValue}>{value}</span>}
      </div>
    </div>
  )
}

const goldStroke = { fill:'none', stroke:'var(--gold)', strokeWidth:1.5, width:18, height:18 }

const ICONS = {
  user:        <svg viewBox="0 0 24 24" {...goldStroke}><circle cx="12" cy="8" r="4"/><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
  email:       <svg viewBox="0 0 24 24" {...goldStroke}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  phone:       <svg viewBox="0 0 24 24" {...goldStroke}><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.91 10.6a16 16 0 0 0 6.49 6.49l1.43-1.43a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>,
  uni:         <svg viewBox="0 0 24 24" {...goldStroke}><path d="M12 3L1 9l11 6 11-6-11-6z"/><path d="M1 9v6"/><path d="M5 11.18v5.64L12 21l7-4.18v-5.64"/></svg>,
  briefcase:   <svg viewBox="0 0 24 24" {...goldStroke}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></svg>,
  pin:         <svg viewBox="0 0 24 24" {...goldStroke}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  building:    <svg viewBox="0 0 24 24" {...goldStroke}><path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M7 11h2v2H7zM15 11h2v2h-2zM7 16h2v2H7zM15 16h2v2h-2zM11 11h2v6h-2z"/></svg>,
  clock:       <svg viewBox="0 0 24 24" {...goldStroke}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>,
  card:        <svg viewBox="0 0 24 24" {...goldStroke}><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M8 3v5"/></svg>,
  paperclip:   <svg viewBox="0 0 24 24" {...goldStroke}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  home:        <svg viewBox="0 0 24 24" {...goldStroke}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  globe:       <svg viewBox="0 0 24 24" {...goldStroke}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
}

// `docsFirmados`: enlaces ya firmados ({ tarjeta, banc, disc }) para quien
// no puede firmar documentos ajenos desde el navegador. La firma ve así los
// de su equipo (los firma el servidor); mientras llegan vale null. Si no se
// pasa, la ficha los firma ella misma, como siempre en el panel del admin.
// `volver`: la ficha se abrió encima de otra (un miembro desde la ficha de
// su firma); además de la X muestra "Volver".
export default function ProfileDetailModal({ profile, onClose, docsFirmados, volver = false }) {
  const firmadosFuera = docsFirmados !== undefined
  const [rating, setRating] = useState(null)
  const [tarjetaDisplayUrl, setTarjetaDisplayUrl] = useState(null)
  const [certBancUrl, setCertBancUrl] = useState(null)
  const [certDiscUrl, setCertDiscUrl] = useState(null)
  const [camaraUrl, setCamaraUrl] = useState(null)
  // Firma: su equipo (Director + aliados). Miembro: la firma a la que pertenece.
  const [equipo, setEquipo] = useState([])
  const [firmaDe, setFirmaDe] = useState(null)
  // Miembro de la firma cuya ficha está abierta ENCIMA de esta.
  const [verMiembro, setVerMiembro] = useState(null)

  // Se devuelve el valor que había (no ''): al cerrar la ficha de un miembro,
  // la de la firma sigue abierta debajo y el fondo debe seguir bloqueado.
  useEffect(() => {
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [])

  useEffect(() => {
    async function load() {
      if (!profile?.id) return
      const { data } = await supabase
        .from('chat_ratings')
        .select('rating')
        .eq('lawyer_id', profile.id)
      if (Array.isArray(data) && data.length) {
        const total = data.length
        const promedio = parseFloat((data.reduce((s, r) => s + r.rating, 0) / total).toFixed(1))
        setRating({ promedio, total })
      }
    }
    load()
  }, [profile?.id])

  /* Resolver de la tarjeta profesional — el bucket es privado, pedimos un
     signed URL al vuelo. Compat hacia atrás: si el campo es una URL completa
     (perfiles guardados antes del fix), úsala directamente. */
  useEffect(() => {
    if (firmadosFuera) return
    const v = profile?.tarjeta_archivo_url
    if (!v) { setTarjetaDisplayUrl(null); return }
    if (/^https?:\/\//.test(v)) { setTarjetaDisplayUrl(v); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.storage
        .from('tarjetas-profesionales')
        .createSignedUrl(v, 3600)
      if (!cancelled && data?.signedUrl) setTarjetaDisplayUrl(data.signedUrl)
    })()
    return () => { cancelled = true }
  }, [profile?.tarjeta_archivo_url, firmadosFuera])

  /* Certificados bancario y disciplinario — mismo bucket privado, mismo patrón. */
  useEffect(() => {
    if (firmadosFuera) return
    let cancelled = false
    async function firmar(path, set) {
      if (!path) { set(null); return }
      if (/^https?:\/\//.test(path)) { set(path); return }
      const { data } = await supabase.storage
        .from('tarjetas-profesionales')
        .createSignedUrl(path, 3600)
      if (!cancelled && data?.signedUrl) set(data.signedUrl)
    }
    firmar(profile?.certificado_bancario_url, setCertBancUrl)
    firmar(profile?.certificado_disciplinario_url, setCertDiscUrl)
    firmar(profile?.camara_comercio_url, setCamaraUrl)
    return () => { cancelled = true }
  }, [profile?.certificado_bancario_url, profile?.certificado_disciplinario_url, profile?.camara_comercio_url, firmadosFuera])

  /* Firma ↔ equipo. El equipo son fichas informativas (firma_miembros):
     quien revisa una firma ve a quién tiene, y la ficha de un miembro dice de
     qué firma es. Si la tabla aún no existe la lectura falla y la sección
     simplemente no se pinta. */
  useEffect(() => {
    let cancelled = false
    setEquipo([]); setFirmaDe(null)
    ;(async () => {
      if (profile?.rol === 'firma') {
        const { data } = await supabase
          .from('firma_miembros')
          // Fila completa: cada persona abre su propia ficha desde aquí.
          .select('*')
          .eq('firma_id', profile.id)
        if (!cancelled && Array.isArray(data)) setEquipo(data)
      } else if (profile?.firma_id) {
        const { data } = await supabase
          .from('profiles')
          .select('id,nombre')
          .eq('id', profile.firma_id)
          .single()
        if (!cancelled && data) setFirmaDe(data)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.id, profile?.rol, profile?.firma_id])

  if (!profile) return null

  // Documentos presentes, en orden fijo. `url` es el enlace firmado; mientras
  // llega se pinta un esqueleto del mismo tamaño para que la rejilla no salte.
  const documentos = [
    { key: 'camara',  label: 'Cámara de comercio',         path: profile.camara_comercio_url,           url: camaraUrl },
    { key: 'tarjeta', label: 'Tarjeta profesional',        path: profile.tarjeta_archivo_url,           url: tarjetaDisplayUrl },
    { key: 'banc',    label: 'Cuenta bancaria certificada', path: profile.certificado_bancario_url,      url: certBancUrl },
    { key: 'disc',    label: 'Certificado disciplinario',   path: profile.certificado_disciplinario_url, url: certDiscUrl },
  ]
    .map(d => (firmadosFuera ? { ...d, url: docsFirmados?.[d.key] || null } : d))
    // Con enlaces de fuera: mientras llegan, esqueleto; el que no llegó no se pinta.
    .filter(d => d.path && !(firmadosFuera && docsFirmados && !d.url))

  const esGestor = profile.rol === 'gestor'
  const esFirma  = profile.rol === 'firma'
  // El gestor se registra solo con usuario (sin nombre/apellido) → iniciales y
  // nombre caen al @username para que el modal no quede vacío.
  const initials = (profile.nombre?.[0] || profile.username?.[0] || '?').toUpperCase() + (profile.apellido?.[0] || '')
  const rolLabel = profile.rol === 'contador' ? 'Contador' : esGestor ? 'Gestor' : esFirma ? 'Firma' : 'Abogado'
  const rolPillClass = profile.rol === 'contador'
    ? styles.rolPillContador
    : esGestor ? styles.rolPillGestor : esFirma ? fStyles.pillFirma : styles.rolPillAbogado
  const alcanceTxt = profile.alcance_servicio === 'internacional' ? 'Nivel internacional'
    : profile.alcance_servicio === 'nacional' ? 'Nivel nacional'
    : profile.alcance_servicio === 'ambos' ? 'Nacional e internacional' : null
  const cargoTxt = (c) => (c === 'director' ? 'Director' : 'Aliado/Colaborador')
  // Como en el inicio: el Director aparte y los aliados debajo, por nombre.
  const directorEq = equipo.find(m => m.cargo === 'director') || null
  const aliadosEq = equipo.filter(m => m.cargo !== 'director')
    .sort((a, b) => `${a.nombre || ''}`.localeCompare(`${b.nombre || ''}`, 'es'))
  // La ficha de un miembro se abre con esta misma ventana: se le da la forma
  // de un perfil (cargo_firma, aprobado) para que pinte lo mismo.
  const comoPerfil = (m) => ({ ...m, aprobado: true, cargo_firma: m.cargo, esMiembroFirma: true })
  const ciudadDB = profile.ciudad || ''
  const tieneBarrio = ciudadDB.includes(' - ')
  const ciudadVisible = tieneBarrio ? ciudadDB.split(' - ')[0] : ciudadDB
  const barrioVisible = tieneBarrio ? ciudadDB.split(' - ')[1] : null

  // Hay redes si al menos uno de los campos viene con valor
  const tieneRedes = !!(
    profile.instagram || profile.linkedin || profile.facebook ||
    profile.twitter   || profile.tiktok   || profile.whatsapp
  )

  return createPortal(
    <>
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: 28 }}
      >

        {/* Siempre a la vista: la ficha es larga y esta franja no se va con el scroll. */}
        <div className={styles.barraFija}>
          {volver && (
            <button type="button" className={styles.volverBtn} onClick={onClose}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
              Volver
            </button>
          )}
          <button type="button" className={`${styles.closeBtn} ${styles.closeBtnFijo}`} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Header */}
        <div className={styles.modalHeader}>
          {esFirma ? (
            <div className={`${fStyles.logo} ${fStyles.logoModal}`}>
              {profile.foto_url
                ? <img src={profile.foto_url} alt={`Logo de ${profile.nombre || 'la firma'}`} width="104" height="104" loading="lazy" decoding="async" />
                : <span className={styles.modalInitials}>{initials}</span>}
            </div>
          ) : (
          <div className={styles.modalPhotoWrap}>
            {profile.foto_url
              ? <img src={profile.foto_url} alt={profile.nombre} className={styles.modalPhoto} width="84" height="84" loading="lazy" decoding="async" />
              : <span className={styles.modalInitials}>{initials}</span>}
          </div>
          )}
          <div className={styles.modalHeaderText}>
            {profile.area_derecho && (
              <p className={styles.modalAreas}>
                {profile.area_derecho.split(',').map((a, i, arr) => (
                  <span key={i}>
                    {a.trim()}{i < arr.length - 1 && <span className={styles.areaDot}> · </span>}
                  </span>
                ))}
              </p>
            )}
            <h2 className={styles.modalName}>
              {[profile.nombre, profile.apellido].filter(Boolean).join(' ') ||
                (profile.username ? `@${profile.username}` : '—')}
              <span className={`${styles.rolPill} ${rolPillClass}`}>
                {rolLabel}
              </span>
            </h2>
            {(ciudadVisible || profile.departamento) && (
              <p className={styles.modalLocation}>
                {[ciudadVisible, profile.departamento].filter(Boolean).join(', ')}
              </p>
            )}
            <p style={{
              margin: '6px 0 0',
              fontSize: '0.72rem',
              color: profile.aprobado ? '#1a8c4e' : '#a07c20',
              fontWeight: 600,
              letterSpacing: '0.06em',
            }}>
              {/* A quien registra una firma no lo aprueba el admin: o está
                  activo o su registro quedó a medias. */}
              {profile.firma_id
                ? '✦ Ficha del equipo de la firma'
                : profile.cuenta_eliminada_en
                  ? '◌ Cuenta eliminada por la firma'
                  : (profile.aprobado ? '✦ Aprobado' : '◌ Pendiente de aprobación')}
            </p>
            {rating && (
              <div style={{ marginTop: 8 }}>
                <StarDisplay rating={rating.promedio} total={rating.total} />
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalDivider} />

        {/* Video */}
        {profile.video_url && (
          <div className={styles.modalSection}>
            <h4 className={styles.modalSectionTitle}>Presentación</h4>
            <video src={profile.video_url} controls preload="metadata" className={styles.modalVideo}
              poster={profile.foto_url || undefined} />
          </div>
        )}

        {/* Descripción */}
        {profile.descripcion && (
          <div className={styles.modalSection}>
            <h4 className={styles.modalSectionTitle}>{esFirma ? 'Sobre la firma' : 'Sobre mí'}</h4>
            <p className={styles.modalDesc}>{profile.descripcion}</p>
          </div>
        )}

        {/* Datos de contacto */}
        <div className={styles.modalDetails}>
          <InfoRow icon={ICONS.user}  label="Usuario"  value={profile.username ? `@${profile.username}` : null} />
          <InfoRow icon={ICONS.email} label="Email"    value={profile.email}    isLink href={`mailto:${profile.email}`} />
          <InfoRow icon={ICONS.phone} label="Teléfono" value={profile.telefono} />
          {/* El gestor se registra con cédula (los profesionales no la traen aquí). */}
          <InfoRow icon={ICONS.card}  label="Cédula"   value={profile.cedula} />
          <InfoRow icon={ICONS.card}  label="NIT"      value={profile.nit} />
          <InfoRow icon={ICONS.globe} label="Alcance del servicio" value={alcanceTxt} />
          {/* Profesional registrado por una firma (no pasó por Solicitudes). */}
          {profile.firma_id && (
            <InfoRow icon={ICONS.building} label="Firma"
              value={`${cargoTxt(profile.cargo_firma)} · ${firmaDe?.nombre || 'Firma'}`} />
          )}
        </div>

        {/* Comunidad del gestor (su "hoja de vida" para aprobarlo) */}
        {esGestor && profile.comunidad_descripcion && (
          <>
            <div className={styles.modalDivider} />
            <div className={styles.modalSection}>
              <h4 className={styles.modalSectionTitle}>Comunidad que maneja</h4>
              <p className={styles.modalDesc}>{profile.comunidad_descripcion}</p>
            </div>
          </>
        )}

        <div className={styles.modalDivider} />

        {/* Información profesional */}
        <div className={styles.modalDetails}>
          <InfoRow icon={ICONS.uni}       label="Universidad" value={profile.universidad} />
          <InfoRow icon={ICONS.briefcase}
            label={profile.rol === 'contador' ? 'Especialidades' : esFirma ? 'Áreas en las que trabaja' : 'Áreas de derecho'}
            value={profile.area_derecho} />
          <InfoRow icon={ICONS.pin}      label={etiquetaCiudad(profile.departamento, ciudadVisible)} value={ciudadVisible} />
          {barrioVisible && <InfoRow icon={ICONS.pin} label="Barrio / Comuna" value={barrioVisible} />}
          <InfoRow icon={ICONS.building} label="Departamento"  value={profile.departamento} />
          <InfoRow icon={ICONS.home}     label="Dirección de oficina" value={profile.direccion_oficina || profile.direccion} />
          <InfoRow icon={ICONS.building} label="Página web"           value={profile.pagina_web} isLink />
          <InfoRow icon={ICONS.clock}    label={esFirma ? 'Trayectoria' : 'Años de experiencia'}  value={profile.experiencia} />
          {/* Respuestas a los campos personalizados del admin maestro */}
          {profile.datos_adicionales && typeof profile.datos_adicionales === 'object' &&
            Object.entries(profile.datos_adicionales).map(([etiqueta, valor]) => (
              <InfoRow key={etiqueta} icon={ICONS.card} label={etiqueta} value={String(valor)}
                isLink={/^https?:\/\//i.test(String(valor))} />
            ))}
          <InfoRow icon={ICONS.card}
            label="Tarjeta profesional (número)"
            value={profile.tarjeta_profesional} />
        </div>

        {/* ── Documentos ─────────────────────────────────────────────────
            Sección propia, fuera de la rejilla de datos. Antes eran filas de
            esa rejilla: una miniatura de 220px no cabe en una celda pensada
            para un valor de texto, así que se desbordaba y el tercero
            quedaba suelto. Aquí las tres son mosaicos iguales. */}
        {documentos.length > 0 && (
          <>
            <div className={styles.modalDivider} />
            <div className={styles.modalSection}>
              <h4 className={styles.modalSectionTitle}>Documentos</h4>
              <div className={styles.docsGrid}>
                {documentos.map(d => (
                  <div key={d.key} className={styles.docTile}>
                    <span className={styles.docTileLabel}>{d.label}</span>
                    {d.url
                      ? <TarjetaPreview displayUrl={d.url} storagePath={d.path} label={d.label} />
                      : <div className={styles.docTileEsqueleto} aria-label="Generando enlace seguro" />
                    }
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Equipo de la firma: a estas personas no las aprueba el admin, así
            que aquí es donde las ve. */}
        {esFirma && (
          <>
            <div className={styles.modalDivider} />
            {/* Director */}
            <div className={styles.modalSection}>
              <h4 className={styles.modalSectionTitle}>Director</h4>
              {directorEq ? (
                <div className={fStyles.director}>
                  <Profesional p={directorEq} onPerfil={() => setVerMiembro(comoPerfil(directorEq))} />
                </div>
              ) : (
                <p className={styles.modalDesc}>
                  {profile.aprobado
                    ? 'Todavía no ha registrado a su Director. Sin Director la firma no aparece en el inicio.'
                    : 'Podrá registrar a su Director y a su equipo cuando la firma esté aprobada.'}
                </p>
              )}
            </div>
            {/* Aliados / colaboradores */}
            {(directorEq || aliadosEq.length > 0) && (
              <div className={styles.modalSection}>
                <h4 className={styles.modalSectionTitle}>
                  Aliados y colaboradores
                  {aliadosEq.length > 0 && <span className={fStyles.cuenta}> · {aliadosEq.length}</span>}
                </h4>
                {aliadosEq.length > 0 ? (
                  <div className={fStyles.lista}>
                    {aliadosEq.map(m => (
                      <Profesional key={m.id} p={m} onPerfil={() => setVerMiembro(comoPerfil(m))} />
                    ))}
                  </div>
                ) : (
                  <p className={fStyles.sinEquipo}>Todavía no ha registrado aliados ni colaboradores.</p>
                )}
              </div>
            )}
          </>
        )}

        {tieneRedes && (
          <>
            <div className={styles.modalDivider} />
            <div className={styles.modalSection}>
              <h4 className={styles.modalSectionTitle}>Redes sociales</h4>
              <SocialLinks profile={profile} />
            </div>
          </>
        )}
      </div>
    </div>
    {/* Ficha de un miembro, encima de la de su firma. Va FUERA del velo de
        esta: en React un clic dentro de un portal sube por el árbol de
        componentes, y cerrar la de arriba cerraría también la de abajo. */}
    {verMiembro && (
      <ProfileDetailModal profile={verMiembro} volver onClose={() => setVerMiembro(null)} />
    )}
    </>,
    document.body
  )
}
