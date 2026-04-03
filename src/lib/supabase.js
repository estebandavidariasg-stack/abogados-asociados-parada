const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = {
  auth: {
    async signInWithPassword({ email, password }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      // Guardar token Y usuario
      localStorage.setItem('sb_token', data.access_token)
      localStorage.setItem('sb_user', JSON.stringify(data.user))
      return { data: { user: data.user }, error: null }
    },

    async signUp({ email, password, options }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ email, password, data: options?.data }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: { user: data.user }, error: null }
    },

    async signOut() {
      localStorage.removeItem('sb_token')
      localStorage.removeItem('sb_user')
      return { error: null }
    },

    async getSession() {
      const token = localStorage.getItem('sb_token')
      const userStr = localStorage.getItem('sb_user')
      if (!token || !userStr) return { data: { session: null } }
      const user = JSON.parse(userStr)
      return { data: { session: { access_token: token, user } } }
    },

    onAuthStateChange() {
      return { data: { subscription: { unsubscribe: () => {} } } }
    }
  },

  from(table) {
    const token = localStorage.getItem('sb_token')
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token || SUPABASE_KEY}`,
    }
    return {
      select(cols = '*') {
        return {
          eq(col, val) {
            return {
              async single() {
                const res = await fetch(
                  `${SUPABASE_URL}/rest/v1/${table}?select=${cols}&${col}=eq.${val}`,
                  { headers }
                )
                const data = await res.json()
                return { data: data[0] || null, error: null }
              }
            }
          }
        }
      },
      async insert(body) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        return { data, error: res.ok ? null : data }
      }
    }
  }
}