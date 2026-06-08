import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import HomePage from './pages/HomePage'   // eager: es el landing público (LCP)

// Las páginas privadas/secundarias se cargan bajo demanda: el visitante
// público (la mayoría del tráfico) NO descarga el JS de los dashboards de
// abogado/contador/admin en la carga inicial → bundle inicial más liviano.
const ProfilePage         = lazy(() => import('./pages/ProfilePage'))
const ProfileContadorPage = lazy(() => import('./pages/ProfileContadorPage'))
const AdminPage           = lazy(() => import('./pages/AdminPage'))
const ResetPasswordPage   = lazy(() => import('./pages/ResetPasswordPage'))

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0d2d5e',
      color: '#c9a84c', fontFamily: "'Cinzel', serif", letterSpacing: '0.1em',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/"                 element={<HomePage />} />
        <Route path="/perfil"           element={<ProfilePage />} />
        <Route path="/perfil-contador"  element={<ProfileContadorPage />} />
        <Route path="/admin"            element={<AdminPage />} />
        <Route path="/nueva-contrasena" element={<ResetPasswordPage />} />
      </Routes>
    </Suspense>
  )
}
