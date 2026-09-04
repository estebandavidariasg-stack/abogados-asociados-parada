import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import styles from './MisPagos.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Formateador de pesos colombianos (sin decimales).
const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

// Bancos reales que participan en PSE (más las billeteras habituales).
const BANCOS = [
  'Bancolombia',
  'Davivienda',
  'Banco de Bogotá',
  'BBVA Colombia',
  'Banco de Occidente',
  'Scotiabank Colpatria',
  'Nequi',
  'Daviplata',
]

// Fecha + hora exacta (formato es-CO, 12h con a. m./p. m.).
const fmtFechaHora = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return '—' }
}

// YYYY-MM-DD local (para comparar contra los <input type="date">).
function ymdLocal(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ── Iconos SVG (estilo Lucide, currentColor) — consistentes con el perfil ──
const IconWallet = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
    <path d="M3 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3" />
    <circle cx="16" cy="13" r="1.2" />
  </svg>
)
const IconLock = (p) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function MisPagos({ userId }) {
  const [pagos, setPagos]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Filtro de fecha (por created_at). Solo fecha, según lo pedido.
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  // Estado del modal PSE simulado.
  const [pagoActivo, setPagoActivo] = useState(null)  // el pago que se está pagando
  const [banco, setBanco]           = useState('')
  const [tipoPersona, setTipoPersona] = useState('Natural')
  const [fase, setFase]             = useState('form') // 'form' | 'procesando' | 'aprobado' | 'error'
  const [modalError, setModalError] = useState(null)
  // Cuando el pago va por la pasarela real de Wompi, el modal muestra solo el
  // estado (procesando/aprobado/error), no el formulario PSE simulado.
  const [wompiFlow, setWompiFlow]   = useState(false)

  const cargarPagos = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pagos_profesional?profesional_id=eq.${userId}&order=created_at.desc&select=*`,
        { headers }
      )
      if (!res.ok) throw new Error('No se pudieron cargar los pagos')
      const data = await res.json()
      setPagos(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Error cargando pagos')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { cargarPagos() }, [cargarPagos])

  // Lista filtrada por rango de fechas (created_at). El resumen se calcula
  // sobre la lista filtrada para que los totales sigan al filtro.
  const pagosFiltrados = pagos.filter((p) => {
    const dia = ymdLocal(p.created_at)
    if (desde && dia && dia < desde) return false
    if (hasta && dia && dia > hasta) return false
    return true
  })

  const hayFiltro = Boolean(desde || hasta)

  // Presets rápidos (como en PagosCobrosAdmin): Todo / 30 días / 7 días.
  function aplicarPreset(dias) {
    if (dias == null) { setDesde(''); setHasta(''); return }
    const hoy = new Date()
    const ini = new Date(); ini.setDate(hoy.getDate() - dias)
    setDesde(ymdLocal(ini))
    setHasta(ymdLocal(hoy))
  }

  // Sumas para el resumen.
  const totalPendiente = pagosFiltrados
    .filter(p => p.estado === 'pendiente')
    .reduce((acc, p) => acc + Number(p.monto || 0), 0)
  const totalPagado = pagosFiltrados
    .filter(p => p.estado === 'pagado')
    .reduce((acc, p) => acc + Number(p.monto || 0), 0)

  // Carga el widget.js de Wompi una sola vez.
  function ensureWompiScript() {
    return new Promise((resolve, reject) => {
      if (window.WidgetCheckout) return resolve()
      let s = document.querySelector('script[data-wompi]')
      if (s) {
        s.addEventListener('load', () => resolve())
        s.addEventListener('error', () => reject(new Error('wompi')))
        return
      }
      s = document.createElement('script')
      s.src = 'https://checkout.wompi.co/widget.js'
      s.async = true
      s.dataset.wompi = '1'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('No se pudo cargar Wompi'))
      document.body.appendChild(s)
    })
  }

  // Sondea el estado del pago hasta que el webhook de Wompi lo marque 'pagado'
  // (la confirmación real es server-side, nunca el resultado del navegador).
  async function pollPagoPagado(pagoId) {
    for (let i = 0; i < 24; i++) {          // ~72 s (24 × 3 s)
      await new Promise(r => setTimeout(r, 3000))
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pagos_profesional?id=eq.${pagoId}&select=estado`,
          { headers }
        )
        const d = await res.json()
        if (d?.[0]?.estado === 'pagado') return true
      } catch { /* reintenta */ }
    }
    return false
  }

  // Inicia el pago: intenta Wompi (pasarela real); si no está configurada, cae
  // al modal PSE simulado existente.
  async function iniciarPago(pago) {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wompi_firma', data: { pagoId: pago.id } }),
      })
      const firma = await res.json()
      if (firma?.ok && firma.publicKey && typeof window !== 'undefined') {
        await abrirWidgetWompi(pago, firma)
        return
      }
    } catch { /* cae al simulado */ }
    abrirPSE(pago)   // fallback: modal PSE simulado
  }

  async function abrirWidgetWompi(pago, firma) {
    try {
      await ensureWompiScript()
    } catch {
      abrirPSE(pago)   // si el widget no carga, no dejamos al usuario sin opción
      return
    }
    const checkout = new window.WidgetCheckout({
      currency: firma.currency,
      amountInCents: firma.amountInCents,
      reference: firma.reference,
      publicKey: firma.publicKey,
      signature: { integrity: firma.integrity },
      redirectUrl: window.location.origin + '/perfil',
    })
    checkout.open(async () => {
      // No confiamos en el resultado del cliente: confirmamos por el webhook.
      setPagoActivo(pago)
      setWompiFlow(true)
      setModalError(null)
      setFase('procesando')
      const ok = await pollPagoPagado(pago.id)
      if (ok) {
        setFase('aprobado')
        await new Promise(r => setTimeout(r, 1200))
        setPagoActivo(null)
        setWompiFlow(false)
        await cargarPagos()
      } else {
        setFase('error')
        setModalError('Tu pago se está procesando. Si ya pagaste (p. ej. por PSE), esta pantalla se actualizará cuando el banco confirme; puede tardar unos minutos.')
      }
    })
  }

  function abrirPSE(pago) {
    setPagoActivo(pago)
    setBanco('')
    setTipoPersona('Natural')
    setFase('form')
    setModalError(null)
    setWompiFlow(false)
  }

  function cerrarPSE() {
    // En el simulado no dejamos cerrar mientras procesa (evita dobles pagos).
    // En Wompi sí: el sondeo sigue en segundo plano y el webhook confirma igual.
    if (fase === 'procesando' && !wompiFlow) return
    setPagoActivo(null)
    setWompiFlow(false)
  }

  async function confirmarPSE(e) {
    e.preventDefault()
    if (!banco) { setModalError('Selecciona tu banco para continuar.'); return }
    setModalError(null)
    setFase('procesando')
    try {
      // Redirección/confirmación PSE simulada (~1.2 s).
      await new Promise(r => setTimeout(r, 1200))

      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pagar_pago`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_pago_id: pagoActivo.id }),
      })
      if (!res.ok) throw new Error('El banco rechazó la transacción')
      const ok = await res.json()
      if (ok !== true) throw new Error('No se pudo confirmar el pago')

      // Best-effort: emitir la factura de la comisión en Alegra. NO bloquea el
      // pago (que ya quedó registrado); si Alegra falla o no está configurada,
      // el endpoint responde ok:false y aquí lo ignoramos.
      try {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'alegra_factura', data: { pagoId: pagoActivo.id } }),
        })
      } catch { /* noop */ }

      setFase('aprobado')
      // Breve pausa para que el usuario vea el "✓ Pago aprobado".
      await new Promise(r => setTimeout(r, 1100))
      setPagoActivo(null)
      await cargarPagos()
    } catch (err) {
      setModalError(err.message || 'Ocurrió un error procesando el pago. Intenta de nuevo.')
      setFase('error')
    }
  }

  return (
    <div className={styles.wrap}>
      {/* ── Resumen ── */}
      <div className={styles.summary}>
        <div className={`${styles.summaryCard} ${styles.summaryPend}`}>
          <span className={styles.summaryLabel}>Pendiente por pagar</span>
          <strong className={styles.summaryValue}>{COP.format(totalPendiente)}</strong>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryPaid}`}>
          <span className={styles.summaryLabel}>Pagado</span>
          <strong className={styles.summaryValue}>{COP.format(totalPagado)}</strong>
        </div>
      </div>

      {/* ── Filtro de fecha (por created_at) ── */}
      {!loading && !error && pagos.length > 0 && (
        <div className={styles.toolbar}>
          <div className={styles.presets}>
            <button
              type="button"
              className={`${styles.presetBtn} ${!hayFiltro ? styles.presetActive : ''}`}
              onClick={() => aplicarPreset(null)}
            >
              Todo
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => aplicarPreset(30)}>
              Últimos 30 días
            </button>
            <button type="button" className={styles.presetBtn} onClick={() => aplicarPreset(7)}>
              Últimos 7 días
            </button>
          </div>
          <div className={styles.dateGroup}>
            <label className={styles.dateField}>
              <span>Desde</span>
              <input
                type="date"
                className={styles.dateInput}
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <label className={styles.dateField}>
              <span>Hasta</span>
              <input
                type="date"
                className={styles.dateInput}
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
            {hayFiltro && (
              <button type="button" className={styles.clearAll} onClick={() => aplicarPreset(null)}>
                Limpiar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Estados ── */}
      {loading && <p className={styles.muted}>Cargando pagos…</p>}
      {error && !loading && <p className={styles.errorLine}>{error}</p>}

      {!loading && !error && pagos.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><IconWallet width="32" height="32" /></span>
          <h3 className={styles.emptyTitle}>No tienes pagos pendientes</h3>
          <p className={styles.emptyNote}>
            Los cobros aparecerán aquí automáticamente después de que una consulta
            sea verificada por el equipo de Parada Bridge.
          </p>
        </div>
      )}

      {/* Sin resultados para el filtro actual (pero sí hay pagos). */}
      {!loading && !error && pagos.length > 0 && pagosFiltrados.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><IconWallet width="32" height="32" /></span>
          <h3 className={styles.emptyTitle}>Sin pagos en ese rango</h3>
          <p className={styles.emptyNote}>
            No hay pagos entre las fechas seleccionadas. Ajusta o limpia el filtro.
          </p>
        </div>
      )}

      {/* ── Lista de pagos ── */}
      {!loading && !error && pagosFiltrados.length > 0 && (
        <ul className={styles.list}>
          {pagosFiltrados.map((pago) => {
            const pendiente = pago.estado === 'pendiente'
            // El desglose sólo se muestra cuando el backend envía los campos del split.
            const tieneSplit = pago.total_consulta != null || pago.monto_empresa != null || pago.comision_gestor != null
            return (
              <li key={pago.id} className={styles.card}>
                {/* Cabecera: monto + fecha a la izquierda; estado y acción a la derecha */}
                <div className={styles.cardHead}>
                  <div className={styles.headLeft}>
                    <span className={styles.monto}>{COP.format(Number(pago.monto || 0))}</span>
                    <span className={styles.fecha}>{fmtFechaHora(pago.created_at)}</span>
                  </div>
                  <div className={styles.cardSide}>
                    <span className={`${styles.chip} ${pendiente ? styles.chipPend : styles.chipPaid}`}>
                      {pendiente ? 'Pendiente' : 'Pagado'}
                    </span>
                    {pendiente && (
                      <button
                        type="button"
                        className={styles.payBtn}
                        onClick={() => iniciarPago(pago)}
                      >
                        Pagar con PSE
                      </button>
                    )}
                  </div>
                </div>

                {/* Desglose del split: grid equitativo que aprovecha el ancho.
                    "Tu comisión a la plataforma" es la celda enfatizada (oro). */}
                {tieneSplit && (
                  <div className={styles.breakdown}>
                    {pago.total_consulta != null && (
                      <div className={styles.bdStat}>
                        <span className={styles.bdStatLabel}>Total de la consulta</span>
                        <span className={styles.bdStatValue}>{COP.format(Number(pago.total_consulta || 0))}</span>
                      </div>
                    )}
                    <div className={styles.bdStat}>
                      <span className={styles.bdStatLabel}>Empresa</span>
                      <span className={styles.bdStatValue}>{COP.format(Number(pago.monto_empresa || 0))}</span>
                    </div>
                    <div className={styles.bdStat}>
                      <span className={styles.bdStatLabel}>Gestor (de la parte empresa)</span>
                      <span className={styles.bdStatValue}>{COP.format(Number(pago.comision_gestor || 0))}</span>
                    </div>
                    <div className={`${styles.bdStat} ${styles.bdStatStrong}`}>
                      <span className={styles.bdStatLabel}>Tu comisión a la plataforma</span>
                      <span className={styles.bdStatValue}>{COP.format(Number(pago.monto || 0))}</span>
                    </div>
                  </div>
                )}

                {!pendiente && (
                  <p className={styles.paidNote}>
                    <span>
                      {pago.pagado_at
                        ? `Pagado el ${fmtFechaHora(pago.pagado_at)} · `
                        : 'Pago confirmado · '}
                      Se habilitaron los datos de contacto y la descarga de archivos de esa consulta.
                    </span>
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Modal PSE (simulado) ── */}
      {pagoActivo && createPortal(
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="pseTitle" onClick={cerrarPSE}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <div className={styles.pseBrand}>
                <span className={styles.pseLogo}>PSE</span>
                <h2 id="pseTitle" className={styles.modalTitle}>Pago con PSE</h2>
              </div>
              {fase !== 'procesando' && (
                <button type="button" className={styles.closeBtn} onClick={cerrarPSE} aria-label="Cerrar">×</button>
              )}
            </div>

            <div className={styles.amountBox}>
              <span className={styles.amountLabel}>Valor a pagar</span>
              <strong className={styles.amountValue}>{COP.format(Number(pagoActivo.monto || 0))}</strong>
            </div>

            {fase === 'procesando' && (
              <div className={styles.stateBox}>
                <span className={styles.spinner} aria-hidden="true" />
                <p className={styles.stateText}>{wompiFlow ? 'Confirmando tu pago…' : 'Procesando pago…'}</p>
                <p className={styles.stateSub}>
                  {wompiFlow
                    ? 'Esperamos la confirmación de la pasarela. No cierres esta ventana.'
                    : 'Estás siendo redirigido a tu banco de forma segura.'}
                </p>
              </div>
            )}

            {fase === 'aprobado' && (
              <div className={styles.stateBox}>
                <span className={styles.checkMark} aria-hidden="true">✓</span>
                <p className={styles.stateTextOk}>Pago aprobado</p>
                <p className={styles.stateSub}>Tu transacción fue confirmada correctamente.</p>
              </div>
            )}

            {wompiFlow && fase === 'error' && (
              <div className={styles.stateBox}>
                <p className={styles.stateSub} style={{ marginBottom: 16 }}>
                  {modalError || 'Tu pago se está procesando. Se actualizará cuando el banco confirme.'}
                </p>
                <button type="button" className={styles.confirmBtn} onClick={cerrarPSE}>
                  Entendido
                </button>
              </div>
            )}

            {!wompiFlow && (fase === 'form' || fase === 'error') && (
              <form className={styles.pseForm} onSubmit={confirmarPSE}>
                <div className={styles.field}>
                  <label className={styles.label}>Banco</label>
                  <select
                    className={styles.select}
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                  >
                    <option value="">Selecciona tu banco…</option>
                    {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Tipo de persona</label>
                  <select
                    className={styles.select}
                    value={tipoPersona}
                    onChange={(e) => setTipoPersona(e.target.value)}
                  >
                    <option value="Natural">Persona natural</option>
                    <option value="Jurídica">Persona jurídica</option>
                  </select>
                </div>

                {modalError && <p className={styles.modalError}>{modalError}</p>}

                <button type="submit" className={styles.confirmBtn}>
                  Pagar {COP.format(Number(pagoActivo.monto || 0))}
                </button>

                <p className={styles.secureNote}>
                  <IconLock /> Simulación de pago — entorno de pruebas, no se realiza un cobro real.
                </p>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
