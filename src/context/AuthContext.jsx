import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // `profile === null` con sesión viva significa "esta cuenta ya no existe", y
  // las páginas de perfil lo usan para cerrar sesión. Por eso hay que separar
  // los dos casos: si la consulta FALLÓ (red, timeout) se conserva el perfil
  // que ya había, porque un corte momentáneo no puede expulsar a nadie. Solo
  // se pone a null cuando la consulta respondió bien y la fila no está.
  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) return
    setProfile(data ?? null)
  }

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        await loadProfile(session.user.id)
      }
      setLoading(false)
    }
    init()

    // Refresca el token cada 50 minutos automáticamente
    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
      }
    }, 50 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  async function signUp({ nombre, apellido, username, telefono, email, password }) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { nombre, apellido, username, telefono } }
    })
    if (error) throw error
    return data
  }

  async function signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setUser(data.user)
    if (data.user?.id) await loadProfile(data.user.id)
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const isSuperAdmin = profile?.rol === 'superadmin'
  const isApproved   = profile?.aprobado === true

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isSuperAdmin, isApproved,
      signUp, signIn, signOut,
      // Releer el perfil desde la base. Las páginas de perfil guardaban con un
      // PATCH pero este `profile` se quedaba con los valores viejos, y como los
      // formularios se rehidratan desde él al volver a su pestaña, los cambios
      // recién guardados "desaparecían" hasta recargar la página.
      refreshProfile: async () => { if (user?.id) await loadProfile(user.id) },
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)