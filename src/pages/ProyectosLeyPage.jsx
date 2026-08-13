import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Footer from '../components/layout/Footer'
import ResultadosProyecto from '../components/proyectos/ResultadosProyecto'
import { DEPARTAMENTOS, municipiosDe, nivelMunicipalLabel } from '../data/colombia-ubicaciones'
import {
  validarCelular, validarCorreo, normalizarCelular, formatCedula,
} from '../lib/validaciones'
import {
  APOYA, apoyaMeta, OBS_MAX, hashCedula, fmtFecha, DEMO_CODIGO,
  fetchProyectosPublicos, fetchArticulos, emitirVotos,
  enviarCodigo, verificarCodigo, otpSimulado,
} from '../lib/proyectosLey'
import VerificationStep from '../components/auth/VerificationStep'
import styles from './ProyectosLeyPage.module.css'

/* ═══════════════════════════════════════════════════════════════════════════
   /proyectos-ley — Debate ciudadano de proyectos de ley.

   Flujo: identificación (nombre, cédula, celular, correo, ubicación) → lista de
   proyectos publicados por el admin → votar por el proyecto completo o artículo
   por artículo (postura "Apoya" + observaciones ≤500) → resultados en torta
   filtrable por departamento/municipio, con descarga de reporte.

   Confidencialidad: la cédula solo se usa hasheada (SHA-256) para impedir el
   doble voto; los datos personales viajan al registro pero NO son legibles
   públicamente (RLS). Sin funciones serverless — REST directo con anon key.
   ═══════════════════════════════════════════════════════════════════════════ */

const LS_IDENT = 'pl_identidad'
const LS_VOTED = 'pl_voted'

const leerIdent = () => { try { return JSON.parse(localStorage.getItem(LS_IDENT) || 'null') } catch { return null } }
const leerVotados = () => { try { return JSON.parse(localStorage.getItem(LS_VOTED) || '{}') } catch { return {} } }
function marcarVotado(hash, proyectoId) {
  const map = leerVotados()
  const arr = new Set(map[hash] || [])
  arr.add(proyectoId)
  map[hash] = Array.from(arr)
  localStorage.setItem(LS_VOTED, JSON.stringify(map))
}

const deptos = DEPARTAMENTOS

/* ── Control segmentado de postura ("Apoya") ─────────────────────────────── */
function SegmentApoya({ value, onChange, name }) {
  return (
    <div className={styles.segment} role="radiogroup" aria-label="Postura">
      {APOYA.map(a => (
        <button
          key={a.key} type="button" role="radio" aria-checked={value === a.key}
          className={`${styles.segBtn} ${value === a.key ? styles.segOn : ''}`}
          style={value === a.key ? { '--seg': a.color } : undefined}
          onClick={() => onChange(value === a.key ? '' : a.key)}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/* ── Textarea de observaciones con contador ──────────────────────────────── */
function ObsField({ value, onChange, id }) {
  return (
    <div className={styles.obsWrap}>
      <textarea
        id={id} className={styles.obs} rows={3} maxLength={OBS_MAX}
        placeholder="Observaciones (opcional): ¿por qué apoyas o no? ¿qué mejorarías?"
        value={value} onChange={e => onChange(e.target.value.slice(0, OBS_MAX))}
      />
      <span className={styles.obsCount}>{value.length}/{OBS_MAX}</span>
    </div>
  )
}

/* ═══════════════ Identificación (portón de entrada) ═════════════════════ */
function IdentidadGate({ onListo, initial }) {
  const [nombre, setNombre]   = useState(initial?.nombre || '')
  const [cedula, setCedula]   = useState(initial?.cedula || '')
  const [celular, setCelular] = useState(initial?.celular || '')
  const [correo, setCorreo]   = useState(initial?.correo || '')
  const [depto, setDepto]     = useState(initial?.departamento || '')
  const [muni, setMuni]       = useState(initial?.municipio || '')
  const [err, setErr]         = useState('')
  const [busy, setBusy]       = useState(false)

  // form → review (confirmar datos) → verify (OTP). El estado del formulario se
  // conserva siempre: volver a "Corregir" nunca borra lo que la persona escribió.
  const [fase, setFase]           = useState('form')   // 'form' | 'review' | 'verify'
  const [identPend, setIdentPend] = useState(null)
  const [codeErr, setCodeErr]     = useState('')
  const [verifying, setVerifying] = useState(false)

  const cedNum = cedula.replace(/\D/g, '')
  const muniLabel = nivelMunicipalLabel(depto)   // "Municipio" o "Localidad" (Bogotá)

  // Paso 1 → 2: valida y pasa a la pantalla de revisión (sin enviar código aún).
  async function revisar(e) {
    e.preventDefault()
    if (!nombre.trim()) return setErr('Escribe tu nombre completo.')
    if (cedNum.length < 6 || cedNum.length > 10) return setErr('Ingresa un número de cédula válido.')
    const vc = validarCelular(celular)
    if (!celular.trim()) return setErr('Ingresa tu número de celular.')
    if (vc.valid === false) return setErr('Celular: ' + vc.msg)
    if (!correo.trim()) return setErr('Ingresa tu correo electrónico.')
    const ve = validarCorreo(correo)
    if (ve.valid === false) return setErr('Correo: ' + ve.msg)
    if (!depto) return setErr('Selecciona tu departamento.')
    if (!muni) return setErr(`Selecciona tu ${muniLabel.toLowerCase()}.`)

    setErr('')
    const hash = await hashCedula(cedNum)
    setIdentPend({
      nombre: nombre.trim(),
      cedula: formatCedula(cedNum),
      cedulaNum: cedNum,           // dígitos en claro → el servidor hashea con sal secreta
      celular: normalizarCelular(celular),
      correo: correo.trim(),
      departamento: depto,
      municipio: muni,
      muniLabel,
      hash,
      email_verificado: false,
    })
    setFase('review')
  }

  // Paso 2 → 3: confirma los datos y dispara SIEMPRE el código de verificación.
  // (Seguridad: cada sesión de voto exige un OTP fresco; el RPC pl_emitir_votos
  // requiere un código 'voto' consumido en los últimos 15 min. Ya no se salta
  // la verificación aunque el correo no haya cambiado.)
  async function confirmarDatos() {
    if (!identPend) return
    setErr(''); setBusy(true)
    try {
      const r = await enviarCodigo(identPend.correo)
      if (!r.ok) { setErr(r.error || 'No se pudo enviar el código a tu correo.'); return }
      setCodeErr('')
      setFase('verify')
    } finally { setBusy(false) }
  }

  async function confirmarCodigo(code) {
    if (!identPend) return
    setVerifying(true); setCodeErr('')
    try {
      const r = await verificarCodigo(identPend.correo, code)
      if (!r.ok) { setCodeErr(r.error || 'Código inválido o expirado'); return }
      const ident = { ...identPend, email_verificado: true }
      localStorage.setItem(LS_IDENT, JSON.stringify(ident))
      onListo(ident)
    } finally { setVerifying(false) }
  }

  /* ── Paso 3: verificación por correo (OTP) ── */
  if (fase === 'verify' && identPend) {
    return (
      <motion.div
        className={styles.gate}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className={styles.gateTitle}>Verifica tu correo</h2>
        <p className={styles.gateSub}>
          Enviamos un código de 6 dígitos a <strong>{identPend.correo}</strong> para confirmar que eres una persona real.
          {otpSimulado() && <> <strong>Modo de prueba:</strong> usa el código <strong>{DEMO_CODIGO}</strong>.</>}
        </p>
        <VerificationStep
          email={identPend.correo}
          error={codeErr}
          submitting={verifying}
          onSubmit={confirmarCodigo}
          onResend={() => enviarCodigo(identPend.correo)}
          onBack={() => { setFase('review'); setCodeErr('') }}
        />
      </motion.div>
    )
  }

  /* ── Paso 2: revisión de datos antes de verificar ── */
  if (fase === 'review' && identPend) {
    const filas = [
      ['Nombre completo', identPend.nombre],
      ['Cédula', identPend.cedula],
      ['Celular', identPend.celular],
      ['Correo electrónico', identPend.correo],
      ['Departamento', identPend.departamento],
      [identPend.muniLabel, identPend.municipio],
    ]
    return (
      <motion.div
        className={styles.gate}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className={styles.gateTitle}>Revisa tus datos</h2>
        <p className={styles.gateSub}>
          Confirma que todo esté correcto. Si algo está mal, vuelve a <strong>Corregir</strong>: no
          se borrará nada de lo que escribiste.
        </p>

        <dl className={styles.reviewGrid}>
          {filas.map(([k, v]) => (
            <div key={k} className={styles.reviewRow}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {err && <p className={styles.gateErr} role="alert">{err}</p>}

        <div className={styles.reviewActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => { setErr(''); setFase('form') }} disabled={busy}>
            ← Corregir datos
          </button>
          <button type="button" className={styles.gateBtn} onClick={confirmarDatos} disabled={busy}>
            {busy ? 'Enviando código…' : 'Confirmar y verificar correo'}
          </button>
        </div>
      </motion.div>
    )
  }

  /* ── Paso 1: formulario ── */
  return (
    <motion.form
      className={styles.gate} onSubmit={revisar}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2 className={styles.gateTitle}>Identifícate para participar</h2>
      <p className={styles.gateSub}>
        Tu cédula se usa <strong>solo para garantizar un voto por persona</strong> y se guarda de
        forma reservada (solo la ve la administración). Tu <strong>nombre aparecerá junto a tu
        opinión</strong> en los resultados. Enviaremos un código a tu correo para verificar que
        eres una persona real.
      </p>

      <div className={styles.gateGrid}>
        <label className={styles.field}>
          <span>Nombre completo</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellidos" autoComplete="name" />
        </label>
        <label className={styles.field}>
          <span>Cédula</span>
          <input
            inputMode="numeric" value={cedula}
            onChange={e => setCedula(formatCedula(e.target.value))}
            placeholder="Número de documento" autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Celular</span>
          <input inputMode="tel" value={celular} onChange={e => setCelular(e.target.value)} placeholder="3001234567" autoComplete="tel" />
        </label>
        <label className={styles.field}>
          <span>Correo electrónico</span>
          <input type="email" value={correo} onChange={e => setCorreo(e.target.value)} placeholder="tucorreo@ejemplo.com" autoComplete="email" />
        </label>
        <label className={styles.field}>
          <span>Departamento</span>
          <select value={depto} onChange={e => { setDepto(e.target.value); setMuni('') }}>
            <option value="">Selecciona…</option>
            {deptos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>{muniLabel}</span>
          <select value={muni} onChange={e => setMuni(e.target.value)} disabled={!depto}>
            <option value="">{depto ? 'Selecciona…' : 'Elige departamento'}</option>
            {municipiosDe(depto).map(mn => <option key={mn} value={mn}>{mn}</option>)}
          </select>
        </label>
      </div>

      {err && <p className={styles.gateErr} role="alert">{err}</p>}

      <button type="submit" className={styles.gateBtn}>Continuar</button>
    </motion.form>
  )
}

/* ═══════════════ Formulario de voto de un proyecto ══════════════════════ */
function VotoForm({ proyecto, articulos, identidad, onVotado }) {
  const puedeArticular = proyecto.permite_articulado && articulos.length > 0
  const [modo, setModo] = useState('completo')          // 'completo' | 'articulado'
  const [comp, setComp] = useState({ apoya: '', obs: '' })
  const [arts, setArts] = useState({})                  // articuloId → { apoya, obs }
  const [estado, setEstado] = useState('idle')          // idle | enviando | error
  const [err, setErr] = useState('')
  const [verArts, setVerArts] = useState(false)         // revisar articulado (modo completo)
  const [paso, setPaso] = useState('form')              // 'form' | 'revisar'
  const [filasPend, setFilasPend] = useState([])        // votos listos por confirmar

  const setArt = (id, patch) => setArts(p => ({ ...p, [id]: { apoya: '', obs: '', ...p[id], ...patch } }))
  const artsConPostura = Object.entries(arts).filter(([, v]) => v.apoya)
  const artById = (id) => articulos.find(a => a.id === id)

  // Paso 1 → 2: valida y arma las filas, luego muestra la confirmación.
  function irARevisar() {
    setErr('')
    const base = {
      cedula_hash: identidad.hash,
      nombre: identidad.nombre, cedula: identidad.cedula, celular: identidad.celular,
      correo: identidad.correo, departamento: identidad.departamento, municipio: identidad.municipio,
    }
    let filas = []
    if (modo === 'completo') {
      if (!comp.apoya) return setErr('Elige tu postura sobre el proyecto (A favor, En contra o Neutral).')
      filas = [{ proyecto_id: proyecto.id, articulo_id: null, apoya: comp.apoya, observaciones: comp.obs.trim() || null, ...base }]
    } else {
      if (artsConPostura.length === 0) return setErr('Marca tu postura en al menos un artículo.')
      filas = artsConPostura.map(([id, v]) => ({
        proyecto_id: proyecto.id, articulo_id: id, apoya: v.apoya, observaciones: (v.obs || '').trim() || null, ...base,
      }))
    }
    setFilasPend(filas)
    setPaso('revisar')
  }

  // Paso 2 → registro definitivo (vía RPC seguro pl_emitir_votos).
  async function enviar() {
    setErr('')
    setEstado('enviando')
    const r = await emitirVotos(filasPend, identidad)
    if (r.ok) { marcarVotado(identidad.hash, proyecto.id); onVotado() }
    else if (r.code === 'duplicado') { marcarVotado(identidad.hash, proyecto.id); onVotado('duplicado') }
    else if (r.code === 'otp') {
      setEstado('error')
      setErr('Tu verificación por correo expiró (más de 15 min). Pulsa “Volver” arriba para verificar tu correo otra vez y luego vota.')
    }
    else { setEstado('error'); setErr(r.msg || 'No se pudo registrar tu voto. Intenta de nuevo.') }
  }

  /* ── Paso 2: confirmación del voto (evita registrar por error uno irreversible) ── */
  if (paso === 'revisar') {
    return (
      <motion.div
        className={styles.voto}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.confirmHead}>
          <h4 className={styles.confirmTitle}>Confirma tu voto</h4>
          <p className={styles.confirmSub}>Revisa tu postura antes de registrarla. Solo podrás votar una vez por este proyecto.</p>
        </div>
        <ul className={styles.confirmList}>
          {filasPend.map((f, i) => {
            const m = apoyaMeta(f.apoya)
            const a = f.articulo_id ? artById(f.articulo_id) : null
            return (
              <li key={i} className={styles.confirmItem}>
                <div className={styles.confirmItemHead}>
                  <span className={styles.confirmAmbito}>
                    {a ? `Artículo ${a.numero ?? ''}${a.titulo ? ` — ${a.titulo}` : ''}` : 'Proyecto completo'}
                  </span>
                  <span className={styles.confirmBadge} style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}>
                    {m.label}
                  </span>
                </div>
                {f.observaciones && <p className={styles.confirmObs}>“{f.observaciones}”</p>}
              </li>
            )
          })}
        </ul>

        {err && <p className={styles.votoErr} role="alert">{err}</p>}

        <div className={styles.reviewActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => { setErr(''); setEstado('idle'); setPaso('form') }} disabled={estado === 'enviando'}>
            ← Corregir
          </button>
          <button type="button" className={styles.votoBtn} onClick={enviar} disabled={estado === 'enviando'}>
            {estado === 'enviando' ? 'Registrando…' : 'Confirmar y registrar voto'}
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <div className={styles.voto}>
      {puedeArticular && (
        <div className={styles.modoChoice} role="radiogroup" aria-label="¿Cómo quieres votar?">
          <span className={styles.modoChoiceTitle}>¿Cómo quieres votar?</span>
          <div className={styles.modoOpts}>
            {[
              ['completo', 'Proyecto completo', 'Una sola postura y observación para toda la iniciativa.'],
              ['articulado', 'Artículo por artículo', 'Fija tu postura y deja observaciones en cada artículo.'],
            ].map(([k, titulo, desc]) => (
              <button key={k} type="button" role="radio" aria-checked={modo === k}
                className={`${styles.modoOpt} ${modo === k ? styles.modoOptOn : ''}`}
                onClick={() => setModo(k)}>
                <span className={styles.modoOptCheck} aria-hidden="true" />
                <strong>{titulo}</strong>
                <small>{desc}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {modo === 'completo' ? (
        <div className={styles.votoBlock}>
          {articulos.length > 0 && (
            <div className={styles.revisar}>
              <button type="button" className={styles.revisarBtn} onClick={() => setVerArts(v => !v)} aria-expanded={verArts}>
                <svg className={`${styles.revChev} ${verArts ? styles.revChevUp : ''}`} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                {verArts ? 'Ocultar articulado' : `Revisar el articulado (${articulos.length} artículo${articulos.length === 1 ? '' : 's'})`}
              </button>
              <AnimatePresence initial={false}>
                {verArts && (
                  <motion.ol
                    className={styles.revList}
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {articulos.map(a => (
                      <li key={a.id} className={styles.revItem}>
                        <span className={styles.revNum}>Art. {a.numero ?? '—'}</span>
                        {a.titulo && <strong className={styles.revTitle}>{a.titulo}</strong>}
                        {a.contenido && <p className={styles.revBody}>{a.contenido}</p>}
                      </li>
                    ))}
                  </motion.ol>
                )}
              </AnimatePresence>
            </div>
          )}
          <div className={styles.votoRow}>
            <span className={styles.votoLabel}>Apoya</span>
            <SegmentApoya value={comp.apoya} onChange={v => setComp(c => ({ ...c, apoya: v }))} />
          </div>
          <span className={styles.votoLabel}>Observaciones</span>
          <ObsField id={`obs-${proyecto.id}`} value={comp.obs} onChange={v => setComp(c => ({ ...c, obs: v }))} />
        </div>
      ) : (
        <div className={styles.artList}>
          {articulos.map(a => (
            <div key={a.id} className={styles.artItem}>
              <div className={styles.artHead}>
                <span className={styles.artNum}>Art. {a.numero ?? '—'}</span>
                <span className={styles.artTitle}>{a.titulo || 'Artículo'}</span>
              </div>
              {a.contenido && <p className={styles.artBody}>{a.contenido}</p>}
              <div className={styles.votoRow}>
                <span className={styles.votoLabel}>Apoya</span>
                <SegmentApoya value={arts[a.id]?.apoya || ''} onChange={v => setArt(a.id, { apoya: v })} />
              </div>
              <ObsField id={`obs-${a.id}`} value={arts[a.id]?.obs || ''} onChange={v => setArt(a.id, { obs: v })} />
            </div>
          ))}
        </div>
      )}

      {err && <p className={styles.votoErr} role="alert">{err}</p>}

      <button type="button" className={styles.votoBtn} onClick={irARevisar}>
        Revisar mi voto
      </button>
      <p className={styles.votoNota}>Podrás votar una sola vez por este proyecto.</p>
    </div>
  )
}

/* ═══════════════ Tarjeta de un proyecto ═════════════════════════════════ */
function ProyectoCard({ proyecto, identidad, votadoInicial, index }) {
  const [abierto, setAbierto]   = useState(false)
  const [tab, setTab]           = useState(votadoInicial ? 'resultados' : 'votar')
  const [articulos, setArticulos] = useState(null)   // null = no cargados
  const [votado, setVotado]     = useState(votadoInicial)
  const [refresh, setRefresh]   = useState(0)
  const [aviso, setAviso]       = useState('')

  useEffect(() => {
    if (!abierto || articulos !== null) return
    let cancel = false
    fetchArticulos(proyecto.id).then(a => { if (!cancel) setArticulos(a) })
    return () => { cancel = true }
  }, [abierto, articulos, proyecto.id])

  function handleVotado(motivo) {
    setVotado(true)
    setTab('resultados')
    setRefresh(x => x + 1)
    setAviso(motivo === 'duplicado'
      ? 'Ya habías registrado tu voto para este proyecto. Estos son los resultados.'
      : '¡Gracias! Tu voto quedó registrado.')
  }

  return (
    <motion.article
      className={styles.card}
      initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.06, 0.3), ease: [0.16, 1, 0.3, 1] }}
    >
      <button type="button" className={styles.cardHead} onClick={() => setAbierto(o => !o)} aria-expanded={abierto}>
        <div className={styles.cardMeta}>
          {proyecto.numero && <span className={styles.cardNumero}>{proyecto.numero}</span>}
          {proyecto.estado_resultado && (
            <span className={`${styles.cardEstado} ${proyecto.estado_resultado === 'aprobado' ? styles.cardEstadoOk : styles.cardEstadoNo}`}>
              {proyecto.estado_resultado === 'aprobado' ? '✓ Aprobado' : '✕ No aprobado'}
            </span>
          )}
          {proyecto.fecha_radicacion && (
            <span className={styles.cardFecha}>Radicado el {fmtFecha(proyecto.fecha_radicacion)}</span>
          )}
        </div>
        <h3 className={styles.cardTitle}>{proyecto.nombre}</h3>
        {proyecto.descripcion && <p className={styles.cardDesc}>{proyecto.descripcion}</p>}
        <span className={styles.cardCta}>
          {votado ? 'Ver resultados' : 'Participar en el debate'}
          <svg className={`${styles.chev} ${abierto ? styles.chevUp : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            className={styles.cardBody}
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.cardBodyInner}>
              {proyecto.estado_resultado && proyecto.resultado_notas && (
                <p className={`${styles.resultadoNota} ${proyecto.estado_resultado === 'aprobado' ? styles.resultadoNotaOk : styles.resultadoNotaNo}`}>
                  {proyecto.resultado_notas}
                </p>
              )}
              {proyecto.enlace_documento && (
                <a className={styles.docLink} href={proyecto.enlace_documento} target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  Ver el proyecto de ley completo
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto' }}>
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </a>
              )}
              <div className={styles.innerTabs} role="tablist">
                {(!votado ? [['votar', 'Votar'], ['resultados', 'Resultados']] : [['resultados', 'Resultados'], ['votar', 'Mi voto']]).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k}
                    className={`${styles.innerTab} ${tab === k ? styles.innerTabOn : ''}`}
                    onClick={() => setTab(k)} disabled={k === 'votar' && votado}>{l}</button>
                ))}
              </div>

              {aviso && <p className={`${styles.aviso} ${votado ? styles.avisoOk : ''}`}>{aviso}</p>}

              {tab === 'votar' && !votado && (
                articulos === null
                  ? <p className={styles.cargando}>Cargando proyecto…</p>
                  : <VotoForm proyecto={proyecto} articulos={articulos} identidad={identidad} onVotado={handleVotado} />
              )}
              {tab === 'votar' && votado && (
                <p className={styles.yaVoto}>Ya registraste tu voto para este proyecto. Gracias por participar.</p>
              )}
              {tab === 'resultados' && (
                <ResultadosProyecto proyecto={proyecto} articulos={articulos || []} refreshKey={refresh} autor={identidad?.nombre} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

/* ═══════════════════════════ Página ═════════════════════════════════════ */
export default function ProyectosLeyPage() {
  const [identidad, setIdentidad] = useState(leerIdent)
  const [prefill, setPrefill]     = useState(null)   // datos para reeditar al "Volver"
  const [proyectos, setProyectos] = useState(null)   // null = cargando
  const votados = useMemo(() => (identidad ? (leerVotados()[identidad.hash] || []) : []), [identidad])
  const topRef = useRef(null)

  useEffect(() => { window.scrollTo(0, 0) }, [])

  useEffect(() => {
    if (!identidad) return
    let cancel = false
    fetchProyectosPublicos().then(p => { if (!cancel) setProyectos(p) })
    return () => { cancel = true }
  }, [identidad])

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brand} aria-label="Parada Bridge — inicio">
          <picture>
            <source srcSet="/logo-nav.webp" type="image/webp" />
            <img src="/logo-nav.png" alt="Parada Bridge" className={styles.brandLogo} width="150" height="150" decoding="async" />
          </picture>
        </Link>
        <Link to="/" className={styles.volver}>← Volver al inicio</Link>
      </header>

      <section className={styles.hero} ref={topRef}>
        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className={styles.heroEyebrow}>Participación ciudadana</span>
          <h1 className={styles.heroTitle}>Debate de <em>proyectos de ley</em></h1>
          <p className={styles.heroLead}>
            Lee los proyectos en trámite, deja tu postura sobre el articulado y observa,
            en tiempo real, lo que opina el país. Tu voz cuenta: un voto por persona, con tu cédula bajo reserva.
          </p>
        </motion.div>
      </section>

      <main className={styles.main}>
        {!identidad ? (
          <IdentidadGate initial={prefill} onListo={(id) => { setIdentidad(id); setPrefill(null) }} />
        ) : (
          <>
            <div className={styles.identBar}>
              <span>Participas como <strong>{identidad.nombre}</strong> · {identidad.municipio}, {identidad.departamento}</span>
              <button type="button" className={styles.cambiar}
                onClick={() => { setPrefill(identidad); setIdentidad(null); setProyectos(null) }}>
                Volver
              </button>
            </div>

            {proyectos === null ? (
              <div className={styles.loaderList}>
                {[0, 1, 2].map(i => <div key={i} className={styles.skeleton} />)}
              </div>
            ) : proyectos.length === 0 ? (
              <div className={styles.emptyProj}>
                <span aria-hidden="true">🏛️</span>
                <h2>Aún no hay proyectos abiertos</h2>
                <p>Cuando el equipo publique un proyecto de ley para debate, aparecerá aquí para que dejes tu voto.</p>
              </div>
            ) : (
              <div className={styles.list}>
                {proyectos.map((p, i) => (
                  <ProyectoCard
                    key={p.id} proyecto={p} identidad={identidad}
                    votadoInicial={votados.includes(p.id)} index={i}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
