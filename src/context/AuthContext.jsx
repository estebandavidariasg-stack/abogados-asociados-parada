import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
  }

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        await loadProfile(session.user.id) // espera a que cargue el perfil
      }
      setLoading(false) // solo después de tener todo
    }
    init()
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
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
