import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Footer from '../components/layout/Footer'
import ResultadosProyecto from '../components/proyectos/ResultadosProyecto'
import { DEPARTAMENTOS, municipiosDe, nivelMunicipalLabel } from '../data/colombia-ubicaciones'
import {
  validarCelular, validarCorreo, normalizarCelular, formatCedula,
} from '../lib/validaciones'
import {
  APOYA, apoyaMeta, OBS_MAX, hashCedula, fmtFecha,
  fetchProyectosPublicos, fetchArticulos, emitirVotos,
  enviarCodigo, verificarCodigo,
  romano, marcasDeTitulo,
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
const LS_VOTED = 'pl_voted'   // formato viejo: { hash: [proyectoId] } — solo decía "ya votó algo"
const LS_VOTOS = 'pl_votos'   // { hash: { proyectoId: { completo, arts: { articuloId: postura } } } }

const leerJson = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def } catch { return def } }
const leerIdent = () => leerJson(LS_IDENT, null)

/* Lo que esta persona ya votó en un proyecto, según este navegador.

   La base guarda un voto por persona y ÁMBITO (el proyecto completo, o cada
   artículo por separado), así que votar tres artículos hoy y otros cinco la
   semana que viene siempre fue posible del lado del servidor. Lo que lo
   impedía era este registro local, que solo anotaba "ya votó en el proyecto"
   y cerraba la tarjeta entera. Ahora anota QUÉ votó:

     completo → postura ('a_favor'…) o true si se sabe que votó pero no qué
     arts     → { articuloId: postura | true }
     legado   → votó antes de este cambio: se sabe que votó algo, no qué

   Es una ayuda de pantalla, no el control: si el navegador no lo recuerda
   (otro equipo, datos borrados), el servidor rechaza el artículo repetido y
   aquí se anota entonces. */
function leerMiVoto(hash, proyectoId) {
  const v = leerJson(LS_VOTOS, {})[hash]?.[proyectoId]
  if (v) return { completo: v.completo || null, arts: v.arts || {}, legado: false }
  return { completo: null, arts: {}, legado: (leerJson(LS_VOTED, {})[hash] || []).includes(proyectoId) }
}
function guardarMiVoto(hash, proyectoId, { completo, arts }) {
  const todo = leerJson(LS_VOTOS, {})
  const proyectos = todo[hash] || (todo[hash] = {})
  const p = proyectos[proyectoId] || (proyectos[proyectoId] = {})
  if (completo) p.completo = completo
  if (arts) p.arts = { ...(p.arts || {}), ...arts }
  try { localStorage.setItem(LS_VOTOS, JSON.stringify(todo)) } catch { /* sin almacenamiento: vale para esta visita */ }
  return { completo: p.completo || null, arts: p.arts || {}, legado: false }
}

/* El articulado se muestra por tandas: una ley de ochenta artículos, todos
   abiertos, es una página que nadie termina de recorrer. */
const ARTS_INICIO = 5
const ARTS_TANDA  = 10
const ART_RENGLONES = 4

/* Texto de un artículo con Ver más / Ver menos. El botón solo aparece si de
   verdad hay más de lo que se ve (se mide: en el celular caben menos palabras
   por renglón que en el escritorio). */
function TextoArticulo({ texto, className }) {
  const [abierto, setAbierto] = useState(false)
  const [sobra, setSobra] = useState(false)
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || abierto) return
    const medir = () => setSobra(el.scrollHeight > el.clientHeight + 1)
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [texto, abierto])

  return (
    <div>
      <p ref={ref} className={`${className}${abierto ? '' : ' ' + styles.textoCorto}`}
        style={abierto ? undefined : { WebkitLineClamp: ART_RENGLONES }}>
        {texto}
      </p>
      {(sobra || abierto) && (
        <button type="button" className={styles.verMasTxt} onClick={() => setAbierto(a => !a)} aria-expanded={abierto}>
          {abierto ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  )
}

/* Pie de una lista de artículos: cuántos faltan por mostrar y cómo recogerla. */
function MasArticulos({ total, visibles, onMas, onMenos }) {
  if (total <= ARTS_INICIO) return null
  const faltan = total - visibles
  return (
    <div className={styles.masArts}>
      {faltan > 0 && (
        <button type="button" className={styles.masArtsBtn} onClick={onMas}>
          Ver más artículos
          <span className={styles.masArtsCuenta}>{faltan === 1 ? 'falta 1' : `faltan ${faltan}`}</span>
        </button>
      )}
      {visibles > ARTS_INICIO && (
        <button type="button" className={`${styles.masArtsBtn} ${styles.masArtsBtnMenos}`} onClick={onMenos}>
          Ver menos
        </button>
      )}
    </div>
  )
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
  // requiere un código 'voto' consumido en las últimas 2 horas. Ya no se salta
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

  /* Corregir el correo sin salir del paso. Es la errata que se descubre al no
     recibir nada, y hasta ahora obligaba a volver atrás y rehacer los datos.
     Si el reenvío falla no se toca nada, para no dejar el paso apuntando a una
     dirección a la que nunca salió un código. */
  async function cambiarCorreoVotante(nuevo) {
    const limpio = String(nuevo || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio)) {
      throw new Error('Escribe un correo válido.')
    }
    if (limpio === String(identPend.correo || '').trim().toLowerCase()) {
      throw new Error('Ese es el mismo correo que ya tienes.')
    }
    const r = await enviarCodigo(limpio)
    if (!r.ok) throw new Error(r.error || 'No se pudo enviar el código.')
    setIdentPend(p => ({ ...p, correo: limpio }))
    setCodeErr('')
  }

  /* ── Paso 3: verificación por correo (OTP) ── */
  if (fase === 'verify' && identPend) {
    return (
      <motion.div
        className={styles.gate}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* El título y el subtítulo los pone VerificationStep, que es el mismo
            componente del registro. Aquí había otro par encima diciendo lo
            mismo: "Verifica Tu Correo" dos veces y la explicación duplicada. */}
        <VerificationStep
          email={identPend.correo}
          error={codeErr}
          submitting={verifying}
          onSubmit={confirmarCodigo}
          onResend={() => enviarCodigo(identPend.correo)}
          onCambiarCorreo={cambiarCorreoVotante}
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

/* Lleva la vista al bloque que acaba de cambiar.

   Sin esto, al pasar a resultados tras votar quince artículos, o al recoger
   una lista con "Ver menos", el bloque se encoge pero el navegador conserva
   el desplazamiento: uno se queda mirando el pie de página y lo que cambió
   está arriba, fuera de pantalla.

   El destino lleva `scroll-margin-top` en el CSS porque el encabezado es
   sticky y si no el título queda tapado debajo. */
function subirA(el) {
  if (!el) return
  const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' })
}

const MSG_OTP_VENCIDO = 'Tu verificación por correo ya no está vigente. Pulsa “Volver” arriba, verifica tu correo otra vez y vuelve a marcar tu postura.'

/* ═══════════════ Formulario de voto de un proyecto ══════════════════════
   `onVotado` recibe { completo, repetido } o { arts: { articuloId: postura|true } }
   cada vez que el servidor acepta un voto; `onTerminar` es el ciudadano
   pidiendo ver resultados con artículos todavía por votar. */
function VotoForm({ proyecto, articulos, identidad, miVoto, onVotado, onTerminar }) {
  /* El toggle aparece SIEMPRE que el proyecto tenga artículos. Antes solo
     salía si además `permite_articulado` estaba activo, y entonces el
     ciudadano no tenía forma de saber que existía esa posibilidad ni por qué
     no la veía: simplemente no estaba.

     `permite_articulado` sigue mandando, pero ahora de forma visible: si el
     administrador no lo habilitó, la opción se muestra deshabilitada y con el
     motivo, en vez de desaparecer. */
  const hayArticulos   = articulos.length > 0
  /* Los titulos de la norma (TITULO I, II...) se pintan donde cambian. El
     numeral sale del orden, no del documento: ver `marcasDeTitulo`. */
  const titulos = useMemo(() => marcasDeTitulo(articulos), [articulos])
  const articuladoOn   = !!proyecto.permite_articulado
  /* Quien ya votó algunos artículos vuelve a este formulario por los que le
     faltan: los ya votados salen cerrados y solo queda el modo por artículos
     (el voto al proyecto completo es para quien no ha empezado). */
  const votados  = miVoto?.arts || {}
  const nVotados = Object.keys(votados).length
  const yaEmpezo = nVotados > 0 || !!miVoto?.legado
  const [modo, setModo] = useState(yaEmpezo ? 'articulado' : 'completo')   // 'completo' | 'articulado'
  const [verN, setVerN] = useState(ARTS_INICIO)         // artículos a la vista (ver más / ver menos)
  const listaRef = useRef(null)
  const verMenos = () => { setVerN(ARTS_INICIO); subirA(listaRef.current) }
  const [comp, setComp] = useState({ apoya: '', obs: '' })
  const [arts, setArts] = useState({})                  // articuloId → { apoya, obs, enviando, err }
  const [estado, setEstado] = useState('idle')          // envío del proyecto completo: idle | enviando
  const [err, setErr] = useState('')                    // error del proyecto completo
  const [verArts, setVerArts] = useState(false)         // revisar articulado (modo completo)

  const setArt = (id, patch) => setArts(p => ({ ...p, [id]: { apoya: '', obs: '', ...p[id], ...patch } }))
  const faltan = articulos.length - nVotados
  /* Marcados pero sin pulsar "Registrar voto": se avisa antes de terminar,
     porque al pasar a resultados esas marcas se pierden. */
  const sinRegistrar = Object.entries(arts).filter(([id, v]) => v.apoya && !votados[id]).length
  const listaLarga = articulos.length > ARTS_INICIO

  const filaBase = () => ({
    cedula_hash: identidad.hash,
    nombre: identidad.nombre, cedula: identidad.cedula, celular: identidad.celular,
    correo: identidad.correo, departamento: identidad.departamento, municipio: identidad.municipio,
  })
  const mensajeDeError = (r) => r.code === 'otp'
    /* No se dice el plazo en el mensaje: el ciudadano no lleva la cuenta
       desde cuándo, y decirle un número solo sirve para discutirlo. */
    ? MSG_OTP_VENCIDO
    : (r.msg || 'No se pudo registrar tu voto. Intenta de nuevo.')

  /* Sin paso de revisión: el voto queda registrado al pulsar el botón (vía el
     RPC seguro pl_emitir_votos). La advertencia de que no se puede cambiar va
     encima del botón, en lugar de una pantalla aparte que obligaba a bajar
     hasta el final para confirmar. */
  async function votarCompleto() {
    if (!comp.apoya || estado === 'enviando') return
    setErr('')
    setEstado('enviando')
    const fila = { proyecto_id: proyecto.id, articulo_id: null, apoya: comp.apoya, observaciones: comp.obs.trim() || null, ...filaBase() }
    const r = await emitirVotos([fila], identidad)
    if (r.ok) return onVotado({ completo: comp.apoya })
    if (r.code === 'duplicado') return onVotado({ completo: true, repetido: true })
    setEstado('idle')
    setErr(mensajeDeError(r))
  }

  /* Cada artículo se registra por sí solo, en cuanto se pulsa su botón. Si el
     servidor dice que ya tenía voto (otro equipo, navegador limpio) se anota
     como votado sin error: el resultado es el mismo. */
  async function votarArticulo(a) {
    const v = arts[a.id]
    if (!v?.apoya || v.enviando) return
    setArt(a.id, { enviando: true, err: '' })
    const fila = { proyecto_id: proyecto.id, articulo_id: a.id, apoya: v.apoya, observaciones: (v.obs || '').trim() || null, ...filaBase() }
    const r = await emitirVotos([fila], identidad)
    if (r.ok) return onVotado({ arts: { [a.id]: v.apoya } })
    if (r.code === 'duplicado') return onVotado({ arts: { [a.id]: true } })
    setArt(a.id, { enviando: false, err: mensajeDeError(r) })
  }

  const btnTerminar = (
    <button type="button" className={styles.terminarBtn} onClick={onTerminar}>
      Terminar y ver resultados
    </button>
  )

  return (
    <div className={styles.voto}>
      {yaEmpezo && (
        <div className={styles.progresoArts}>
          <p className={styles.progresoTxt}>
            {nVotados > 0
              ? <>Ya votaste <strong>{nVotados} de {articulos.length}</strong> artículos. Marca tu postura en los que te faltan; los que ya votaste no se repiten.</>
              : <>Ya habías participado en este proyecto. Puedes votar los artículos que te falten; si alguno ya tiene tu voto, no se repite.</>}
          </p>
          {/* Arriba solo cuando la lista es larga: con cinco artículos el botón
              del final está a la vista y repetirlo sería ruido. */}
          {nVotados > 0 && listaLarga && btnTerminar}
        </div>
      )}
      {hayArticulos && !yaEmpezo && (
        <div className={styles.modoChoice} role="radiogroup" aria-label="¿Cómo quieres votar?">
          <span className={styles.modoChoiceTitle}>¿Cómo quieres votar?</span>
          <div className={styles.modoOpts}>
            {[
              ['completo', 'Proyecto completo', 'Una sola postura y observación para toda la iniciativa.'],
              ['articulado', 'Artículo por artículo', 'Fija tu postura y deja observaciones en cada artículo.'],
            ].map(([k, titulo, desc]) => {
              const bloqueado = k === 'articulado' && !articuladoOn
              return (
                <button key={k} type="button" role="radio" aria-checked={modo === k}
                  aria-disabled={bloqueado || undefined}
                  disabled={bloqueado}
                  className={`${styles.modoOpt} ${modo === k ? styles.modoOptOn : ''}`}
                  onClick={() => { if (!bloqueado) setModo(k) }}>
                  <span className={styles.modoOptCheck} aria-hidden="true" />
                  <strong>{titulo}</strong>
                  <small>{bloqueado
                    ? 'En este proyecto solo se puede votar la iniciativa completa.'
                    : desc}</small>
                </button>
              )
            })}
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
                  <motion.div
                    className={styles.revWrap}
                    ref={listaRef}
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <ol className={styles.revList}>
                      {articulos.slice(0, verN).map((a, i) => (
                        <Fragment key={a.id}>
                        {titulos[i] && (
                          <li className={styles.revSeccion}>
                            <span className={styles.revSeccionNum}>Título {romano(titulos[i].orden)}</span>
                            <span className={styles.revSeccionNom}>{titulos[i].nombre}</span>
                          </li>
                        )}
                        <li className={styles.revItem}>
                          <span className={styles.revNum}>Art. {a.numero ?? '—'}</span>
                          {a.titulo && <strong className={styles.revTitle}>{a.titulo}</strong>}
                          {a.contenido && <TextoArticulo texto={a.contenido} className={styles.revBody} />}
                        </li>
                        </Fragment>
                      ))}
                    </ol>
                    <MasArticulos total={articulos.length} visibles={Math.min(verN, articulos.length)}
                      onMas={() => setVerN(n => n + ARTS_TANDA)} onMenos={verMenos} />
                  </motion.div>
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
        <div className={styles.artList} ref={listaRef}>
          {articulos.slice(0, verN).map((a, i) => {
            const previo = votados[a.id]                       // postura, true (sin saber cuál) o nada
            const meta = typeof previo === 'string' ? apoyaMeta(previo) : null
            return (
              <Fragment key={a.id}>
              {titulos[i] && (
                <div className={styles.artSeccion}>
                  <span className={styles.artSeccionNum}>Título {romano(titulos[i].orden)}</span>
                  <span className={styles.artSeccionNom}>{titulos[i].nombre}</span>
                </div>
              )}
              {previo ? (
                /* Ya votado: se ve que está, con qué postura, y no se puede repetir. */
                <div className={`${styles.artItem} ${styles.artItemVotado}`}>
                  <div className={styles.artHead}>
                    <span className={styles.artNum}>Art. {a.numero ?? '—'}</span>
                    <span className={styles.artTitle}>{a.titulo || 'Artículo'}</span>
                    <span className={styles.artYa} style={meta ? { '--ya': meta.color } : undefined}>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                      {meta ? `Tu voto: ${meta.label}` : 'Ya votaste'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className={styles.artItem}>
                  <div className={styles.artHead}>
                    <span className={styles.artNum}>Art. {a.numero ?? '—'}</span>
                    <span className={styles.artTitle}>{a.titulo || 'Artículo'}</span>
                  </div>
                  {a.contenido && <TextoArticulo texto={a.contenido} className={styles.artBody} />}
                  <div className={styles.votoRow}>
                    <span className={styles.votoLabel}>Apoya</span>
                    <SegmentApoya value={arts[a.id]?.apoya || ''} onChange={v => setArt(a.id, { apoya: v, err: '' })} />
                  </div>
                  <ObsField id={`obs-${a.id}`} value={arts[a.id]?.obs || ''} onChange={v => setArt(a.id, { obs: v })} />
                  {arts[a.id]?.err && <p className={styles.votoErr} role="alert">{arts[a.id].err}</p>}
                  <div className={styles.artAcciones}>
                    <span className={styles.artNota}>Este voto no se puede cambiar.</span>
                    <button type="button" className={styles.votoBtn}
                      onClick={() => votarArticulo(a)}
                      disabled={!arts[a.id]?.apoya || !!arts[a.id]?.enviando}>
                      {arts[a.id]?.enviando ? 'Registrando…' : 'Registrar voto'}
                    </button>
                  </div>
                </div>
              )}
              </Fragment>
            )
          })}
          <MasArticulos total={articulos.length} visibles={Math.min(verN, articulos.length)}
            onMas={() => setVerN(n => n + ARTS_TANDA)} onMenos={verMenos} />
        </div>
      )}

      {modo === 'completo' ? (
        <>
          {err && <p className={styles.votoErr} role="alert">{err}</p>}
          <p className={styles.votoAviso}>Este voto no se puede cambiar. Podrás votar una sola vez por este proyecto.</p>
          <button type="button" className={styles.votoBtn} onClick={votarCompleto} disabled={!comp.apoya || estado === 'enviando'}>
            {estado === 'enviando' ? 'Registrando…' : 'Registrar mi voto'}
          </button>
        </>
      ) : (
        <>
          {nVotados > 0 && btnTerminar}
          <p className={styles.votoNota}>
            {sinRegistrar > 0
              ? `Tienes ${sinRegistrar} artículo${sinRegistrar === 1 ? '' : 's'} marcado${sinRegistrar === 1 ? '' : 's'} sin registrar: pulsa «Registrar voto» en cada uno para que cuente.`
              : nVotados > 0
                ? `Te ${faltan === 1 ? 'falta' : 'faltan'} ${faltan} artículo${faltan === 1 ? '' : 's'} por votar. No tienes que votarlos todos hoy: puedes volver cuando quieras.`
                : 'Cada artículo queda registrado al pulsar su botón y se vota una sola vez. No tienes que votarlos todos hoy: los demás puedes votarlos después.'}
          </p>
        </>
      )}
    </div>
  )
}

/* ═══════════════ Paginación ═════════════════════════════════
   Cada tarjeta abierta es un formulario de voto completo, así que diez por
   página ya es una página larga. Sin selector de cuántos ver: el ciudadano
   viene a votar un proyecto, no a configurar una tabla. */
const POR_PAGINA = 10

function ventanaPags(actual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out = [1]
  const lo = Math.max(2, actual - 1)
  const hi = Math.min(total - 1, actual + 1)
  if (lo > 2) out.push('…')
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < total - 1) out.push('…')
  out.push(total)
  return out
}

function Paginador({ pagina, total, onPagina }) {
  const pags = Math.max(1, Math.ceil(total / POR_PAGINA))
  const actual = Math.min(pagina, pags)
  const desde = total === 0 ? 0 : (actual - 1) * POR_PAGINA + 1
  const hasta = Math.min(actual * POR_PAGINA, total)

  return (
    <div className={styles.pager}>
      <span className={styles.pagerInfo} aria-live="polite">
        Proyectos <strong>{desde}–{hasta}</strong> de {total}
      </span>
      <div className={styles.pagerBtns} role="navigation" aria-label="Paginación de proyectos">
        <button type="button" className={styles.pageBtn} onClick={() => onPagina(actual - 1)} disabled={actual <= 1} aria-label="Página anterior">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        {ventanaPags(actual, pags).map((n, i) => (
          n === '…'
            ? <span key={`s${i}`} className={styles.pageGap}>…</span>
            : (
              <button
                type="button"
                key={n}
                className={`${styles.pageBtn} ${n === actual ? styles.pageBtnActive : ''}`}
                onClick={() => onPagina(n)}
                aria-current={n === actual ? 'page' : undefined}
                aria-label={`Página ${n}`}
              >
                {n}
              </button>
            )
        ))}
        <button type="button" className={styles.pageBtn} onClick={() => onPagina(actual + 1)} disabled={actual >= pags} aria-label="Página siguiente">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  )
}

/* ═══════════════ Tarjeta de un proyecto ═════════════════════════════════ */
function ProyectoCard({ proyecto, identidad, index }) {
  const [abierto, setAbierto]   = useState(false)
  const [miVoto, setMiVoto]     = useState(() => leerMiVoto(identidad.hash, proyecto.id))
  const [articulos, setArticulos] = useState(null)   // null = no cargados
  const [refresh, setRefresh]   = useState(0)
  const [aviso, setAviso]       = useState('')

  /* `votado` = ya dejó algún voto aquí. Eso ya no cierra la tarjeta: si votó
     por artículos y le faltan, puede seguir. Lo que la cierra es haber votado
     el proyecto completo, o no tener ya nada pendiente. Mientras el articulado
     no ha cargado no se sabe cuántos faltan (`pendientes` = null). */
  const nVotados   = Object.keys(miVoto.arts).length
  const votado     = !!miVoto.completo || miVoto.legado || nVotados > 0
  const pendientes = articulos ? articulos.filter(a => !miVoto.arts[a.id]).length : null
  const porArticulos = votado && !miVoto.completo && !!proyecto.permite_articulado
  const puedeSeguir  = porArticulos && pendientes > 0
  const [tab, setTab] = useState(votado ? 'resultados' : 'votar')

  useEffect(() => {
    if (!abierto || articulos !== null) return
    let cancel = false
    fetchArticulos(proyecto.id).then(a => { if (!cancel) setArticulos(a) })
    return () => { cancel = true }
  }, [abierto, articulos, proyecto.id])

  const cardRef = useRef(null)
  /* Lo votado por artículos, al día aunque dos respuestas del servidor
     lleguen casi a la vez (el ciudadano puede pulsar "Registrar voto" en un
     artículo mientras el anterior todavía va). */
  const artsRef = useRef(miVoto.arts)

  function irAResultados(texto) {
    setTab('resultados')
    setAviso(texto)
    // La tarjeta cambia de alto al pasar a resultados: sin esto el aviso de
    // "voto registrado" queda arriba, fuera de la vista.
    subirA(cardRef.current)
  }

  const TODOS_VOTADOS = '¡Gracias! Ya votaste todos los artículos de este proyecto.'

  // `res` = { completo, repetido } | { arts: { articuloId: postura|true } } (ver VotoForm).
  // Por artículos la tarjeta no salta a resultados en cada voto: el artículo
  // queda cerrado en su sitio y se pasa a resultados solo cuando ya no falta
  // ninguno, o cuando el ciudadano pulsa "Terminar y ver resultados".
  function handleVotado(res) {
    const guardado = guardarMiVoto(identidad.hash, proyecto.id, res)
    artsRef.current = { ...artsRef.current, ...guardado.arts }
    const nuevo = { ...guardado, arts: artsRef.current }
    setMiVoto(nuevo)
    setRefresh(x => x + 1)

    if (res.completo) {
      irAResultados(res.repetido
        ? 'Ya habías registrado tu voto para este proyecto. Estos son los resultados.'
        : '¡Gracias! Tu voto quedó registrado.')
      return
    }
    const faltan = (articulos?.length || 0) - Object.keys(nuevo.arts).length
    if (articulos && faltan <= 0) irAResultados(TODOS_VOTADOS)
  }

  function terminarVotacion() {
    const n = Object.keys(artsRef.current).length
    const total = articulos?.length || 0
    const faltan = total - n
    irAResultados(faltan > 0
      ? `¡Gracias! Tu voto quedó registrado en ${n} de ${total} artículos. ${faltan === 1 ? 'El que falta puedes votarlo' : `Los ${faltan} que faltan puedes votarlos`} cuando quieras en «Seguir votando».`
      : TODOS_VOTADOS)
  }

  return (
    <motion.article
      ref={cardRef}
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
        {/* El título legal íntegro, debajo y en pequeño. La tarjeta se lee por
            el nombre corto, pero citar la norma entera es lo correcto y el
            ciudadano tiene derecho a verla tal cual la escribió el Congreso. */}
        {proyecto.titulo_oficial && proyecto.titulo_oficial !== proyecto.nombre && (
          <p className={styles.cardTituloOficial}>{proyecto.titulo_oficial}</p>
        )}
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
                {(!votado
                  ? [['votar', 'Votar'], ['resultados', 'Resultados']]
                  : [['resultados', 'Resultados'], ['votar', puedeSeguir ? 'Seguir votando' : 'Mi voto']]
                ).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k}
                    className={`${styles.innerTab} ${tab === k ? styles.innerTabOn : ''}`}
                    onClick={() => { setTab(k); if (k === 'votar') setAviso('') }}>
                    {l}
                    {k === 'votar' && puedeSeguir && <span className={styles.tabCuenta}>{pendientes}</span>}
                  </button>
                ))}
              </div>

              {aviso && <p className={`${styles.aviso} ${votado ? styles.avisoOk : ''}`}>{aviso}</p>}

              {tab === 'votar' && (
                // Con el articulado sin cargar no se sabe si le queda algo por votar.
                articulos === null && (!votado || porArticulos)
                  ? <p className={styles.cargando}>Cargando proyecto…</p>
                  : (!votado || puedeSeguir)
                    /* Sin `key` por el número de votados: cada artículo se
                       registra por separado y el formulario debe conservar
                       las posturas marcadas en los demás. */
                    ? <VotoForm proyecto={proyecto} articulos={articulos} identidad={identidad} miVoto={miVoto} onVotado={handleVotado} onTerminar={terminarVotacion} />
                    : (
                      <p className={styles.yaVoto}>
                        {miVoto.completo
                          ? <>Votaste el proyecto completo{typeof miVoto.completo === 'string' && <>: <strong>{apoyaMeta(miVoto.completo).label}</strong></>}. Gracias por participar.</>
                          : nVotados > 0 && pendientes === 0
                            ? <>Ya votaste los {nVotados} artículos de este proyecto. Gracias por participar.</>
                            : <>Ya registraste tu voto para este proyecto. Gracias por participar.</>}
                      </p>
                    )
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
  const topRef = useRef(null)

  // Filtros de la lista: texto (nombre/número/tema) + rango de fecha de radicación.
  const [busqueda, setBusqueda] = useState('')
  const [desde, setDesde]       = useState('')
  const [hasta, setHasta]       = useState('')

  const proyectosFiltrados = useMemo(() => {
    if (!proyectos) return []
    const term = busqueda.trim().toLowerCase()
    return proyectos.filter(p => {
      if (term) {
        const heno = `${p.nombre || ''} ${p.numero || ''} ${p.descripcion || ''}`.toLowerCase()
        if (!heno.includes(term)) return false
      }
      const f = (p.fecha_radicacion || '').slice(0, 10)
      if (desde && (!f || f < desde)) return false
      if (hasta && (!f || f > hasta)) return false
      return true
    })
  }, [proyectos, busqueda, desde, hasta])

  const hayFiltro = !!(busqueda.trim() || desde || hasta)

  /* Paginación. Al cambiar de página se sube al principio de la lista: si no,
     uno aterriza a la mitad de la página nueva sin saber dónde quedó. */
  const [pagina, setPagina] = useState(1)
  const listaRef = useRef(null)
  useEffect(() => { setPagina(1) }, [busqueda, desde, hasta])
  const totalPags = Math.max(1, Math.ceil(proyectosFiltrados.length / POR_PAGINA))
  const pagSegura = Math.min(pagina, totalPags)
  const enPagina  = proyectosFiltrados.slice((pagSegura - 1) * POR_PAGINA, pagSegura * POR_PAGINA)
  const irAPagina = (n) => {
    setPagina(n)
    subirA(listaRef.current)
  }
  const limpiarFiltros = () => { setBusqueda(''); setDesde(''); setHasta('') }

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
          <h1 className={styles.heroTitle}>Debate de <em>Proyectos de Ley</em></h1>
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
              <>
                <div className={styles.filtros}>
                  <div className={styles.buscador}>
                    <svg className={styles.buscadorIcon} viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                      type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                      placeholder="Buscar por nombre, número o tema…" aria-label="Buscar proyectos de ley"
                    />
                    {busqueda && (
                      <button type="button" className={styles.buscadorClear} onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda">✕</button>
                    )}
                  </div>
                  <div className={styles.fechas}>
                    <label className={styles.fechaField}>
                      <span>Radicado desde</span>
                      <input type="date" value={desde} onChange={e => setDesde(e.target.value)} max={hasta || undefined} />
                    </label>
                    <label className={styles.fechaField}>
                      <span>Radicado hasta</span>
                      <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} min={desde || undefined} />
                    </label>
                  </div>
                  {hayFiltro && (
                    <button type="button" className={styles.limpiarBtn} onClick={limpiarFiltros}>Limpiar</button>
                  )}
                </div>

                {hayFiltro && (
                  <p className={styles.filtroCount} aria-live="polite">
                    {proyectosFiltrados.length === 0
                      ? 'Sin coincidencias'
                      : `Mostrando ${proyectosFiltrados.length} de ${proyectos.length} proyecto${proyectos.length === 1 ? '' : 's'}`}
                  </p>
                )}

                {proyectosFiltrados.length === 0 ? (
                  <div className={styles.emptyProj}>
                    <span aria-hidden="true">🔎</span>
                    <h2>Sin resultados</h2>
                    <p>Ningún proyecto coincide con tu búsqueda. Prueba con otras palabras o cambia el rango de fechas.</p>
                    <button type="button" className={styles.limpiarBtn} onClick={limpiarFiltros}>Limpiar filtros</button>
                  </div>
                ) : (
                  <>
                    <div className={styles.list} ref={listaRef}>
                      {enPagina.map((p, i) => (
                        <ProyectoCard
                          key={`${identidad.hash}:${p.id}`} proyecto={p} identidad={identidad} index={i}
                        />
                      ))}
                    </div>
                    {/* Fuera de la lista: el paginador no es una tarjeta mas. */}
                    {proyectosFiltrados.length > POR_PAGINA && (
                      <Paginador pagina={pagSegura} total={proyectosFiltrados.length} onPagina={irAPagina} />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
