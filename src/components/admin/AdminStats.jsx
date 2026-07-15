import { useMemo } from 'react'
import { useReducedMotion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import styles from './AdminStats.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   Tarjetas de resumen del panel admin — su contenido CAMBIA según la sección
   activa (activeTab) para dar información útil a cada pantalla — más una
   gráfica histórica (registros y consultas de los últimos 6 meses).
   ───────────────────────────────────────────────────────────────────────── */

// Agrupa una lista de fechas ISO en los últimos `n` meses → [{ mes, count }].
function porMes(fechas, n = 6) {
  const ahora = new Date()
  const buckets = []
  const idx = {}
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    idx[key] = buckets.length
    buckets.push({ mes: d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), count: 0 })
  }
  for (const f of fechas) {
    if (!f) continue
    const d = new Date(f)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (key in idx) buckets[idx[key]].count++
  }
  return buckets
}


export default function AdminStats({
  activeTab, pending = [], approved = [], alertas = [], chatsCerrados = [],
  allRooms = [], extra = {},
}) {
  const reduce = useReducedMotion()

  const pAb = pending.filter(p => p.rol === 'abogado').length
  const pCont = pending.filter(p => p.rol === 'contador').length
  const aAb = approved.filter(p => p.rol === 'abogado').length
  const aCont = approved.filter(p => p.rol === 'contador').length
  const conDescarga = approved.filter(p => p.puede_descargar_archivos).length

  const rTotal = allRooms.length
  const rWaiting = allRooms.filter(r => r.status === 'waiting').length
  const rActive = allRooms.filter(r => r.status === 'active').length
  const rClosed = allRooms.filter(r => r.status === 'closed').length

  const sinProf = alertas.filter(a => !a.lawyer_ids || a.lawyer_ids.length === 0).length
  const conProf = alertas.length - sinProf

  const {
    contratos = 0, firmas = 0,
    resenasTotal = 0, resenasAprob = 0,
    codigos = 0, codigosActivos = 0,
  } = extra

  const cards = useMemo(() => {
    switch (activeTab) {
      case 'approved':
        return [
          { n: approved.length, label: 'Profesionales aprobados', sub: `${aAb} ab · ${aCont} cont`, icon: 'users' },
          { n: aAb, label: 'Abogados', icon: 'scale' },
          { n: aCont, label: 'Contadores', icon: 'calc' },
          { n: conDescarga, label: 'Con descarga habilitada', tone: 'ok', icon: 'download' },
        ]
      case 'chats':
        return [
          { n: rTotal, label: 'Consultas totales', icon: 'chat' },
          { n: rWaiting, label: 'En espera', tone: rWaiting ? 'warn' : 'ok', icon: 'clock' },
          { n: rActive, label: 'Activas', tone: 'ok', icon: 'activity' },
          { n: rClosed, label: 'Cerradas', icon: 'check' },
        ]
      case 'recuperar':
        return [
          { n: rClosed, label: 'Consultas cerradas', icon: 'check' },
          { n: chatsCerrados.length, label: 'Recientes recuperables', icon: 'clock' },
          { n: rActive, label: 'Activas ahora', tone: 'ok', icon: 'activity' },
          { n: rTotal, label: 'Consultas totales', icon: 'chat' },
        ]
      case 'alertas':
        return [
          { n: alertas.length, label: 'Alertas +24h', tone: alertas.length ? 'alert' : 'ok', icon: 'alert' },
          { n: sinProf, label: 'Sin profesional', tone: sinProf ? 'warn' : 'ok', icon: 'userx' },
          { n: conProf, label: 'Con profesional', icon: 'users' },
          { n: rWaiting + rActive, label: 'Consultas abiertas', icon: 'chat' },
        ]
      case 'chat_interno':
        return [
          { n: approved.length, label: 'Profesionales', sub: `${aAb} ab · ${aCont} cont`, icon: 'users' },
          { n: aAb, label: 'Abogados', icon: 'scale' },
          { n: aCont, label: 'Contadores', icon: 'calc' },
          { n: rActive, label: 'Consultas activas', tone: 'ok', icon: 'activity' },
        ]
      case 'contratos':
        return [
          { n: contratos, label: 'Contratos subidos', icon: 'doc' },
          { n: firmas, label: 'Documentos firmados', tone: 'ok', icon: 'firma' },
          { n: approved.length, label: 'Profesionales', icon: 'users' },
          { n: conDescarga, label: 'Con descarga habilitada', icon: 'download' },
        ]
      case 'resenas':
        return [
          { n: resenasTotal, label: 'Reseñas recibidas', icon: 'star' },
          { n: resenasAprob, label: 'Aprobadas (en el home)', tone: 'ok', icon: 'check' },
          { n: Math.max(0, resenasTotal - resenasAprob), label: 'Por moderar', tone: (resenasTotal - resenasAprob) ? 'warn' : 'ok', icon: 'clock' },
          { n: approved.length, label: 'Profesionales', icon: 'users' },
        ]
      case 'codigos':
        return [
          { n: codigos, label: 'Códigos creados', icon: 'grid' },
          { n: codigosActivos, label: 'Activos', tone: 'ok', icon: 'check' },
          { n: Math.max(0, codigos - codigosActivos), label: 'Inactivos', icon: 'grid' },
          { n: approved.length, label: 'Profesionales', icon: 'users' },
        ]
      case 'pending':
      default:
        return [
          { n: pending.length, label: 'Solicitudes pendientes', sub: (pAb || pCont) ? `${pAb} ab · ${pCont} cont` : undefined, tone: pending.length ? 'warn' : 'ok', icon: 'clock' },
          { n: approved.length, label: 'Profesionales aprobados', icon: 'users' },
          { n: approved.length + pending.length, label: 'Total registrados', icon: 'layers' },
          { n: alertas.length, label: 'Alertas inactividad', tone: alertas.length ? 'alert' : 'ok', icon: 'alert' },
        ]
    }
  }, [activeTab, pending, approved, alertas, chatsCerrados, rTotal, rWaiting, rActive, rClosed, aAb, aCont, conDescarga, sinProf, conProf, contratos, firmas, resenasTotal, resenasAprob, codigos, codigosActivos, pAb, pCont])

  // Serie histórica: registros (profiles) y consultas (chat_rooms) por mes.
  const chartData = useMemo(() => {
    const registros = porMes([...pending, ...approved].map(p => p.created_at))
    const consultas = porMes(allRooms.map(r => r.created_at))
    return registros.map((b, i) => ({ mes: b.mes, Registros: b.count, Consultas: consultas[i]?.count || 0 }))
  }, [pending, approved, allRooms])

  // La gráfica histórica es GENERAL: se muestra solo en la primera sección
  // (Solicitudes), no repetida en cada apartado.
  const mostrarGrafica = activeTab === 'pending' && chartData.some(d => d.Registros || d.Consultas)

  return (
    <div className={styles.wrap}>
      <div className={styles.cards}>
        {cards.map((c, i) => (
          <div key={i} className={`${styles.card} ${c.tone ? styles[c.tone] : ''}`}>
            <span className={styles.num}>{c.n}</span>
            <span className={styles.label}>
              {c.label}
              {c.sub && <span className={styles.sub}>{c.sub}</span>}
            </span>
          </div>
        ))}
      </div>

      {mostrarGrafica && (
        <div className={styles.chartCard}>
          <div className={styles.chartHead}>
            <h4 className={styles.chartTitle}>Actividad de los últimos 6 meses</h4>
            <div className={styles.legend}>
              <span className={styles.legItem}><i className={styles.dotGold} /> Registros</span>
              <span className={styles.legItem}><i className={styles.dotNavy} /> Consultas</span>
            </div>
          </div>
          <div className={styles.chartBody}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c9a84c" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#c9a84c" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gNavy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d2d5e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#0d2d5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,45,94,0.08)" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6b7896' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6b7896' }} axisLine={false} tickLine={false} width={34} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid rgba(13,45,94,0.1)', fontSize: 13, fontFamily: 'Raleway, sans-serif' }}
                  labelStyle={{ color: '#0d2d5e', fontWeight: 700 }}
                />
                <Area type="monotone" dataKey="Registros" stroke="#c9a84c" strokeWidth={2} fill="url(#gGold)" isAnimationActive={!reduce} />
                <Area type="monotone" dataKey="Consultas" stroke="#0d2d5e" strokeWidth={2} fill="url(#gNavy)" isAnimationActive={!reduce} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
