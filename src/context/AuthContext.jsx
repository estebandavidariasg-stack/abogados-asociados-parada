import { createContext, useContext, useEffect, useRef, useState } from 'react'
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

  // La sesión vive en localStorage, que comparten TODAS las pestañas del
  // navegador. Si en otra pestaña se cerraba sesión o se entraba con otra
  // cuenta, esta seguía con el `user` viejo en memoria mientras sus peticiones
  // ya salían con el token nuevo: todo insert con `from_id = <cuenta vieja>` lo
  // rechazaba la base ("Sin permiso para enviar" en el chat interno, al probar
  // admin y profesional en el mismo navegador). Cuando la cuenta guardada deja
  // de ser la de esta pestaña, se recarga para arrancar con la sesión real.
  //
  // Solo con el evento `storage`, que el navegador entrega a las OTRAS
  // pestañas y nunca a la que escribe. A propósito NO se revisa al volver a
  // la pestaña: el registro (RegisterModal) y la recuperación de contraseña
  // inician sesión por su cuenta, sin pasar por este contexto, y recargar al
  // volver del selector de archivos les borraría el formulario a medias.
  // El refresco de token de la MISMA cuenta no toca `sb_user`: no recarga.
  const idEnMemoria = useRef(null)
  idEnMemoria.current = user?.id || null
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== null && e.key !== 'sb_user') return
      const mio = idEnMemoria.current
      if (!mio) return   // pestaña sin sesión propia: nada que desmentir
      let idGuardado = null
      try { idGuardado = JSON.parse(localStorage.getItem('sb_user') || 'null')?.id || null } catch { /* sb_user ilegible = sin sesión */ }
      if (idGuardado !== mio) window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
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
  // Superadmin o admin: el admin hace todo menos gestionar roles. Úsalo para
  // lo que ambos pueden (editar la home: imágenes, videos, noticias, modelos);
  // isSuperAdmin queda para lo exclusivo del superadmin.
  const isPanelAdmin = isSuperAdmin || profile?.rol === 'admin'
  const isApproved   = profile?.aprobado === true

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isSuperAdmin, isPanelAdmin, isApproved,
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