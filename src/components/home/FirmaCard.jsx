import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LawyerCard, { StarDisplay, Descripcion, Exitosas, irAConsulta } from './LawyerCard'
import TarjetaPreview from '../profile/TarjetaPreview'
import { etiquetaCiudad } from '../../lib/validaciones'
// Misma tarjeta y mismo modal que un profesional: una firma comparte la cinta
// del inicio con ellos y tiene que leerse como parte de la misma casa.
import lc from './LawyerCard.module.css'
import styles from './FirmaCard.module.css'

/* Tarjeta pública de una FIRMA (rol 'firma'): sus datos, su Director y debajo
   sus aliados/colaboradores. Las personas son FICHAS informativas de la firma
   (firma_miembros): cada una tiene su "Iniciar consulta", pero la consulta la
   recibe y atiende LA FIRMA (ella cobra y envía sus fichas de contacto); el
   miembro elegido queda como destinatario. Los datos llegan armados de
   /api/professionals?rol=firma ({...firma, director, miembros[]}). */

export const ALCANCE = {
  nacional:      { corto: 'Atención a nivel nacional',          largo: 'Nivel nacional. Atienden casos en Colombia.' },
  internacional: { corto: 'Atención a nivel internacional',     largo: 'Nivel internacional. Atienden casos fuera del país.' },
  ambos:         { corto: 'Atención nacional e internacional', largo: 'Nacional e internacional. Atienden casos en Colombia y fuera del país.' },
}

const nombreDe  = (p) => `${p?.nombre || ''} ${p?.apellido || ''}`.trim()
const iniciales = (p) => ((p?.nombre?.[0] || '') + (p?.apellido?.[0] || '')).toUpperCase() || '·'
const listaAreas = (txt) => (txt ? txt.split(',').map(a => a.trim()).filter(Boolean) : [])
const esEnlace = (u) => /^https?:\/\//i.test(String(u || '').trim())

const Icono = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" width="18" height="18" aria-hidden="true">{children}</svg>
)

function Dato({ icon, label, children }) {
  if (!children) return null
  return (
    <div className={lc.infoRow}>
      <span className={lc.infoIcon}>{icon}</span>
      <div>
        <span className={lc.infoLabel}>{label}</span>
        <span className={lc.infoValue}>{children}</span>
      </div>
    </div>
  )
}

// Una persona de la firma dentro del modal: quién es, qué atiende, cómo le ha
// ido, y las dos cosas que se pueden hacer con ella. La misma fila la usa la
// ficha de la firma en el panel del admin, sin "Iniciar consulta" (no se pasa
// `onConsulta`) y con `estado` cuando hay algo que avisar de esa persona.
export function Profesional({ p, onPerfil, onConsulta, estado }) {
  const una = p.consultas_exitosas === 1
  return (
    <div className={styles.pro}>
      <span className={styles.proAvatar} aria-hidden="true">
        {p.foto_url
          ? <img src={p.foto_url} alt="" width="60" height="60" loading="lazy" decoding="async" />
          : iniciales(p)}
      </span>
      <div className={styles.proInfo}>
        <h4 className={styles.proNombre}>
          {nombreDe(p)}
          <span className={`${lc.rolPill} ${p.rol === 'contador' ? lc.rolPillContador : lc.rolPillAbogado}`}>
            {p.rol === 'contador' ? 'Contador' : 'Abogado'}
          </span>
        </h4>
        {p.area_derecho && <p className={styles.proAreas}>{listaAreas(p.area_derecho).join(' · ')}</p>}
        {(p.rating_promedio || p.consultas_exitosas > 0 || p.experiencia || estado) && (
          <div className={styles.proCifras}>
            {p.rating_promedio ? <StarDisplay rating={p.rating_promedio} total={p.rating_total || 0} dark /> : null}
            {p.consultas_exitosas > 0 && (
              <span><strong>{Number(p.consultas_exitosas).toLocaleString('es-CO')}</strong> {una ? 'consulta exitosa' : 'consultas exitosas'}</span>
            )}
            {p.experiencia && <span>{p.experiencia} de experiencia</span>}
            {estado && <span className={styles.proEstado}>{estado}</span>}
          </div>
        )}
      </div>
      <div className={styles.proAcciones}>
        <button type="button" className={styles.btnPerfil} onClick={onPerfil}>Ver perfil</button>
        {onConsulta && (
          <button type="button" className={styles.btnConsulta} onClick={onConsulta}>Iniciar consulta</button>
        )}
      </div>
    </div>
  )
}

export default function FirmaCard({ firma, delay = 0, reveal = true, ghost = false }) {
  const [open, setOpen] = useState(false)
  const [verPerfil, setVerPerfil] = useState(null)   // miembro cuyo perfil completo está abierto
  const [docs, setDocs] = useState([])
  const [docsState, setDocsState] = useState('idle') // idle | loading | done

  const equipo  = [firma.director, ...(firma.miembros || [])].filter(Boolean)
  const areas   = listaAreas(firma.area_derecho)
  const lugar   = [firma.ciudad, firma.departamento].filter(Boolean).join(', ')
  const alcance = ALCANCE[firma.alcance_servicio] || null
  // Las consultas (y las calificaciones) son de la firma, no de sus fichas.
  const exitosas = Number(firma.consultas_exitosas) || 0
  // Lo que LawyerCard y la consulta necesitan saber de un miembro.
  const comoMiembro = (p) => ({
    ...p, esMiembro: true, cargo_firma: p.cargo,
    firma: { id: firma.id, nombre: firma.nombre, foto_url: firma.foto_url || null },
  })
  const inicial = (firma.nombre || 'F').charAt(0).toUpperCase()

  // Documento público de la firma (cámara de comercio), firmado en el servidor
  // y pedido solo al abrir: la cinta del inicio sigue costando una petición.
  // El "ya lo pedí" vive en un ref, NO en docsState: si el estado estuviera en
  // las dependencias, ponerlo en 'loading' relanzaría el efecto, su limpieza
  // cancelaría la petición recién lanzada y el esqueleto se quedaría para
  // siempre (mismo cuidado que en LawyerCard).
  const docsPedidos = useRef(false)
  useEffect(() => {
    if (!open || docsPedidos.current) return
    docsPedidos.current = true
    setDocsState('loading')
    fetch(`/api/professionals?docs=${encodeURIComponent(firma.id)}&tipo=firma`)
      .then(r => (r.ok ? r.json() : []))
      .then(j => {
        setDocs((Array.isArray(j) ? j : []).map(d => ({ label: d.label, url: d.url, path: `x.${d.ext || 'pdf'}` })))
      })
      .catch(() => {})
      .finally(() => setDocsState('done'))
  }, [open, firma.id])

  // El perfil de un miembro (LawyerCard) libera el scroll del body al cerrarse;
  // mientras este modal siga abierto hay que volver a bloquearlo. Depende de
  // `verPerfil` para ejecutarse justo después de ese cierre.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open, verPerfil])

  useEffect(() => {
    if (!open) return
    // Escape cierra este modal solo si no hay un perfil abierto encima.
    const onKey = (e) => { if (e.key === 'Escape' && !verPerfil) setOpen(false) }
    // "Iniciar consulta" desde el perfil de un miembro cambia el hash: el
    // visitante se va a la consulta y este modal ya no debe quedar encima.
    const onHash = () => { if (window.location.hash.startsWith('#chat')) { setVerPerfil(null); setOpen(false) } }
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHash)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHash)
    }
  }, [open, verPerfil])

  const consultar = (p) => { setOpen(false); irAConsulta(comoMiembro(p)) }

  return (
    <>
      {/* ── Tarjeta en la cinta ── */}
      <div
        className={`${lc.card}${reveal ? ' fade-up' : ''}`}
        style={reveal ? { transitionDelay: `${delay}s` } : undefined}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={ghost ? -1 : 0}
        aria-hidden={ghost || undefined}
        aria-label={ghost ? undefined : `Ver la firma ${firma.nombre}`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
      >
        {/* El logo va entero y en un cuadro (las personas van en círculo): se
            distingue una firma de un profesional antes de leer nada. */}
        <div className={styles.logo}>
          {firma.foto_url
            ? <img src={firma.foto_url} alt="" width="96" height="96" loading="lazy" decoding="async" />
            : <span className={lc.initials}>{inicial}</span>}
        </div>

        <div className={lc.info}>
          {areas.length > 0 && (
            <p className={lc.areas}>
              {areas.slice(0, 3).map((a, i, arr) => (
                <span key={a}>{a}{i < arr.length - 1 && <span className={lc.areaDot}> · </span>}</span>
              ))}
              {areas.length > 3 && <span><span className={lc.areaDot}> · </span>+{areas.length - 3}</span>}
            </p>
          )}
          <h3 className={lc.name}>
            {firma.nombre}
            <span className={`${lc.rolPill} ${styles.pillFirma}`}>Firma</span>
          </h3>
          {lugar && <p className={lc.location}>{lugar}</p>}
          {alcance && <p className={styles.alcance}>{alcance.corto}</p>}

          {firma.director && (
            <p className={styles.dirige}>
              <span>Director</span>
              {nombreDe(firma.director)}
            </p>
          )}

          <div className={styles.equipo}>
            <span className={styles.pila} aria-hidden="true">
              {equipo.slice(0, 4).map(p => (
                <span key={p.id}>
                  {p.foto_url ? <img src={p.foto_url} alt="" width="30" height="30" loading="lazy" decoding="async" /> : iniciales(p)}
                </span>
              ))}
            </span>
            <span className={styles.equipoTxt}>
              {equipo.length} {equipo.length === 1 ? 'profesional' : 'profesionales'}
            </span>
          </div>

          <span className={styles.centrado}><Exitosas total={exitosas} /></span>
        </div>

        <div className={lc.cardHint}>Ver firma →</div>
      </div>

      {/* ── Modal (portal a <body>: la cinta anima un ancestro con transform) ── */}
      {open && createPortal(
        <div className={lc.overlay} onClick={() => setOpen(false)}>
          <div className={`${lc.modal} ${styles.modalFirma}`} role="dialog" aria-modal="true"
            aria-label={`Firma ${firma.nombre}`} onClick={(e) => e.stopPropagation()}>

            <button className={lc.closeBtn} onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>

            {/* La firma */}
            <div className={lc.modalHeader}>
              <div className={`${styles.logo} ${styles.logoModal}`}>
                {firma.foto_url
                  ? <img src={firma.foto_url} alt={`Logo de ${firma.nombre}`} width="104" height="104" decoding="async" />
                  : <span className={lc.modalInitials}>{inicial}</span>}
              </div>
              <div className={lc.modalHeaderText}>
                <h2 className={lc.modalName}>
                  {firma.nombre}
                  <span className={`${lc.rolPill} ${styles.pillFirma}`}>Firma</span>
                </h2>
                {lugar && <p className={lc.modalLocation}>{lugar}</p>}
                {alcance && <p className={styles.alcance}>{alcance.corto}</p>}
                {firma.rating_promedio ? (
                  <div style={{ marginTop: 6 }}>
                    <StarDisplay rating={firma.rating_promedio} total={firma.rating_total || 0} dark />
                  </div>
                ) : null}
                <Exitosas total={exitosas} />
              </div>
            </div>

            <div className={lc.modalDivider} />

            {firma.video_url && (
              <div className={lc.modalSection}>
                <h4 className={lc.modalSectionTitle}>Presentación</h4>
                <video src={firma.video_url} controls preload="metadata" className={lc.modalVideo}
                  poster={firma.foto_url || undefined} />
              </div>
            )}

            {firma.descripcion && (
              <div className={lc.modalSection}>
                <h4 className={lc.modalSectionTitle}>Sobre la firma</h4>
                <Descripcion texto={firma.descripcion} />
              </div>
            )}

            <div className={lc.modalDetails}>
              <Dato label="Alcance del servicio"
                icon={<Icono><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icono>}>
                {alcance?.largo}
              </Dato>
              <Dato label="Áreas en las que trabaja"
                icon={<Icono><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></Icono>}>
                {areas.join(', ')}
              </Dato>
              <Dato label={firma.ciudad ? `Sede · ${etiquetaCiudad(firma.departamento, firma.ciudad)}` : 'Sede'}
                icon={<Icono><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></Icono>}>
                {lugar}
              </Dato>
              <Dato label="Trayectoria"
                icon={<Icono><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></Icono>}>
                {firma.experiencia}
              </Dato>
              {esEnlace(firma.pagina_web) && (
                <Dato label="Sitio web"
                  icon={<Icono><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></Icono>}>
                  <a className={styles.enlace} href={firma.pagina_web.trim()} target="_blank" rel="noopener noreferrer">
                    {firma.pagina_web.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                  </a>
                </Dato>
              )}
            </div>

            {(docsState === 'loading' || docs.length > 0) && (
              <div className={lc.modalSection}>
                <h4 className={lc.modalSectionTitle}>Documentos</h4>
                {docsState === 'loading' ? (
                  <div className={lc.docsLista} aria-busy="true" aria-label="Cargando documentos">
                    <div className={lc.docSkeleton} />
                  </div>
                ) : (
                  <div className={lc.docsLista}>
                    {docs.map(d => (
                      <TarjetaPreview key={d.label} displayUrl={d.url} storagePath={d.path} label={d.label} variant="row" />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* El Director */}
            {firma.director && (
              <div className={lc.modalSection}>
                <h4 className={lc.modalSectionTitle}>Director</h4>
                <div className={styles.director}>
                  <Profesional p={firma.director}
                    onPerfil={() => setVerPerfil(firma.director)}
                    onConsulta={() => consultar(firma.director)} />
                </div>
              </div>
            )}

            {/* El equipo */}
            <div className={lc.modalSection} style={{ marginBottom: 0 }}>
              <h4 className={lc.modalSectionTitle}>
                Aliados y colaboradores
                {firma.miembros?.length > 0 && <span className={styles.cuenta}> · {firma.miembros.length}</span>}
              </h4>
              {firma.miembros?.length > 0 ? (
                <div className={styles.lista}>
                  {firma.miembros.map(p => (
                    <Profesional key={p.id} p={p}
                      onPerfil={() => setVerPerfil(p)}
                      onConsulta={() => consultar(p)} />
                  ))}
                </div>
              ) : (
                <p className={styles.sinEquipo}>
                  Por ahora esta firma atiende a través de su Director.
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Perfil completo de un miembro: el mismo modal de cualquier profesional
          (documentos, comentarios, presentación), encima del de la firma. */}
      {verPerfil && (
        <LawyerCard
          lawyer={comoMiembro(verPerfil)}
          controlledOpen
          onControlledClose={() => setVerPerfil(null)}
          hideCard
        />
      )}
    </>
  )
}
