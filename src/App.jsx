import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense, Component } from 'react'
import HomePage from './pages/HomePage'   // eager: es el landing público (LCP)

// Las páginas privadas/secundarias se cargan bajo demanda: el visitante
// público (la mayoría del tráfico) NO descarga el JS de los dashboards de
// abogado/contador/admin en la carga inicial → bundle inicial más liviano.
const ProfilePage         = lazy(() => import('./pages/ProfilePage'))
const ProfileContadorPage = lazy(() => import('./pages/ProfileContadorPage'))
const ProfileGestorPage   = lazy(() => import('./pages/ProfileGestorPage'))
const AdminPage           = lazy(() => import('./pages/AdminPage'))
const ResetPasswordPage   = lazy(() => import('./pages/ResetPasswordPage'))
const OpinarPage          = lazy(() => import('./pages/OpinarPage'))
const LegalPage           = lazy(() => import('./pages/LegalPage'))
const ProyectosLeyPage    = lazy(() => import('./pages/ProyectosLeyPage'))

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#6d3c1b',
      color: '#c9a84c', fontFamily: "'Cinzel', serif", letterSpacing: '0.1em',
    }}>
      Cargando…
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Red de seguridad de render.

   Sin esto, CUALQUIER error dentro de una página (o un trozo de JS que no
   llegue a descargarse) deja la pantalla COMPLETAMENTE en blanco: React
   desmonta todo el árbol y solo queda el fondo, sin riel, sin menú y sin
   ninguna pista de qué pasó. Era justo el síntoma reportado en el celular.

   Dos casos, dos respuestas:
   · Trozo de JS que no carga (típico tras un despliegue: el teléfono guardó
     el HTML viejo y pide un archivo que ya no existe). Se recarga UNA vez de
     forma automática; el candado en sessionStorage evita el bucle.
   · Cualquier otro error: se muestra el mensaje real, con un botón para
     recargar y otro para volver al inicio. El detalle sirve para reportarlo.
   ───────────────────────────────────────────────────────────────────────── */
const CLAVE_RECARGA = 'aap_recarga_por_chunk'
const esErrorDeChunk = (e) =>
  /Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
    .test(String(e?.message || e || ''))

class LimiteDeError extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    console.error('[app] error de render:', error, info?.componentStack)
    if (esErrorDeChunk(error)) {
      let yaRecargado = false
      try { yaRecargado = sessionStorage.getItem(CLAVE_RECARGA) === '1' } catch { /* modo privado */ }
      if (!yaRecargado) {
        try { sessionStorage.setItem(CLAVE_RECARGA, '1') } catch { /* no-op */ }
        window.location.reload()
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const detalle = String(this.state.error?.message || this.state.error || '').slice(0, 300)
    const btn = {
      fontFamily: 'inherit', fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer',
      borderRadius: 10, padding: '11px 18px',
    }
    return (
      <div role="alert" style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
        background: '#fbf4ee', color: '#472f29', fontFamily: "'Poppins', sans-serif",
      }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: '1.3rem', color: '#6d3c1b', margin: '0 0 10px' }}>
            Se interrumpió la pantalla
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: '0.92rem', lineHeight: 1.6, color: '#5b4633' }}>
            No pudimos mostrar esta sección. Vuelve a cargar; si sigue igual, envía
            este detalle a soporte para que lo revisemos.
          </p>
          <p style={{
            margin: '0 0 20px', padding: '10px 12px', borderRadius: 10,
            background: '#fff', border: '1px solid rgba(109,60,27,0.18)',
            fontSize: '0.76rem', color: '#7a6655', wordBreak: 'break-word', textAlign: 'left',
          }}>
            {detalle || 'Error desconocido'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={{ ...btn, border: 'none', background: '#6d3c1b', color: '#fff' }}
              onClick={() => { try { sessionStorage.removeItem(CLAVE_RECARGA) } catch { /* no-op */ } window.location.reload() }}>
              Recargar la página
            </button>
            <button type="button" style={{ ...btn, border: '1px solid rgba(109,60,27,0.25)', background: '#fff', color: '#6d3c1b' }}
              onClick={() => { window.location.href = '/' }}>
              Ir al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default function App() {
  return (
    <LimiteDeError>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/"                 element={<HomePage />} />
        <Route path="/perfil"           element={<ProfilePage />} />
        <Route path="/perfil-contador"  element={<ProfileContadorPage />} />
        <Route path="/perfil-gestor"    element={<ProfileGestorPage />} />
        <Route path="/admin"            element={<AdminPage />} />
        <Route path="/nueva-contrasena" element={<ResetPasswordPage />} />
        <Route path="/opinar"           element={<OpinarPage />} />
        <Route path="/proyectos-ley"    element={<ProyectosLeyPage />} />
        <Route path="/terminos"         element={<LegalPage doc="terminos" />} />
        <Route path="/privacidad"       element={<LegalPage doc="privacidad" />} />
      </Routes>
    </Suspense>
    </LimiteDeError>
  )
}
