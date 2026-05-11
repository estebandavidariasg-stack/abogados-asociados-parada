import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, profile, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!user) { navigate('/'); return }
    if (requireAdmin && profile?.rol !== 'superadmin') { navigate('/'); return }
  }, [user, profile, loading, navigate, requireAdmin])

  // Mientras carga, mostrar pantalla de espera
  if (loading) return (
    <div style={{
      minHeight: '100vh', background: 'var(--navy)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--gold)', fontFamily: 'Cinzel, serif', letterSpacing: '0.3em',
      fontSize: '0.8rem'
    }}>
      CARGANDO...
    </div>
  )

  // Si está cargando el perfil pero ya hay usuario, esperar
  if (user && requireAdmin && !profile) return (
    <div style={{
      minHeight: '100vh', background: 'var(--navy)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--gold)', fontFamily: 'Cinzel, serif', letterSpacing: '0.3em',
      fontSize: '0.8rem'
    }}>
      CARGANDO...
    </div>
  )

  if (!user) return null
  if (requireAdmin && profile?.rol !== 'superadmin') return null

  return children
}
