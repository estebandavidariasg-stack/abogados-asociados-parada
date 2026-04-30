const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function getHeaders() {
  const token = localStorage.getItem('sb_token')
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token || SUPABASE_KEY}`,
  }
}

async function refreshSession() {
  const refreshToken = localStorage.getItem('sb_refresh_token')
  if (!refreshToken) return false
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) return false
  const data = await res.json()
  localStorage.setItem('sb_token', data.access_token)
  localStorage.setItem('sb_refresh_token', data.refresh_token)
  localStorage.setItem('sb_token_exp', data.expires_at || (Math.floor(Date.now() / 1000) + 3600))
  return true
}

export async function getAuthHeaders() {
  const exp = parseInt(localStorage.getItem('sb_token_exp') || '0')
  const now = Math.floor(Date.now() / 1000)
  if (exp && now >= exp - 300) {
    await refreshSession()
  }
  return getHeaders()
}

// ── Query builder encadenable ─────────────────────────────────────────────
function buildQuery(table, cols = '*') {
  const filters = []
  let _order = null
  let _limit = null

  const builder = {
    eq(col, val)    { filters.push(`${col}=eq.${encodeURIComponent(val)}`); return builder },
    neq(col, val)   { filters.push(`${col}=neq.${encodeURIComponent(val)}`); return builder },
    ilike(col, val) { filters.push(`${col}=ilike.${encodeURIComponent(val)}`); return builder },
    order(col, opts = {}) { _order = `${col}.${opts.ascending === false ? 'desc' : 'asc'}`; return builder },
    limit(n)        { _limit = n; return builder },
    select(newCols) { if (newCols) cols = newCols; return builder },

    single()      { return execSingle() },
    maybeSingle() { return execSingle(true) },

    async then(resolve) {
      try {
        let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(cols)}`
        if (filters.length) url += '&' + filters.join('&')
        if (_order) url += `&order=${_order}`
        if (_limit) url += `&limit=${_limit}`
        const res  = await fetch(url, { headers: getHeaders() })
        const data = await res.json()
        resolve({ data: res.ok ? data : null, error: res.ok ? null : data })
      } catch (err) { resolve({ data: null, error: err }) }
    }
  }

  async function execSingle(maybe = false) {
    try {
      let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(cols)}`
      if (filters.length) url += '&' + filters.join('&')
      if (_order) url += `&order=${_order}`
      if (_limit) url += `&limit=1`
      const headers = { ...getHeaders(), 'Accept': 'application/vnd.pgrst.object+json' }
      const res  = await fetch(url, { headers })
      if (res.status === 406 || res.status === 404) return { data: null, error: null }
      const data = await res.json()
      return { data: res.ok ? data : null, error: res.ok ? null : data }
    } catch (err) { return { data: null, error: err } }
  }

  return builder
}

// ── Realtime WebSocket ────────────────────────────────────────────────────
const WS_URL = SUPABASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')

class RealtimeChannel {
  constructor(name) {
    this.name       = name
    this.pgHandlers = []   // postgres_changes handlers
    this.bcHandlers = {}   // broadcast handlers: { eventName: [cb, ...] }
    this._queue     = []   // sends queued before WS opens
    this.ws         = null
    this.ref        = 1
  }

  on(event, opts, cb) {
    if (event === 'broadcast') {
      const key = opts?.event || '*'
      ;(this.bcHandlers[key] = this.bcHandlers[key] || []).push(cb)
    } else {
      this.pgHandlers.push({ event, opts, cb })
    }
    return this
  }

  // Public send for broadcast messages: { type: 'broadcast', event, payload }
  send({ type, event, payload }) {
    if (type !== 'broadcast') return this
    const msg = {
      topic:   `realtime:${this.name}`,
      event:   'broadcast',
      payload: { event, payload },
      ref:     null,
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this._queue.push(msg)
    }
    return this
  }

  subscribe(statusCb) {
    const token = localStorage.getItem('sb_token') || SUPABASE_KEY
    this.ws = new WebSocket(`${WS_URL}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`)
    const hasBroadcast = Object.keys(this.bcHandlers).length > 0

    this.ws.onopen = () => {
      this._send({ topic: 'phoenix', event: 'phx_join', payload: {}, ref: this._ref() })

      // Subscribe to broadcast channel if needed
      if (hasBroadcast) {
        this._send({
          topic:   `realtime:${this.name}`,
          event:   'phx_join',
          payload: {
            config: {
              broadcast:        { ack: false, self: true },
              presence:         { key: '' },
              postgres_changes: [],
            },
            access_token: token,
          },
          ref: this._ref(),
        })
      }

      // Subscribe to postgres_changes topics
      this.pgHandlers.forEach(h => {
        const { schema, table, filter, event } = h.opts
        const pgEvent = event === 'INSERT' ? 'INSERT' : event === 'UPDATE' ? 'UPDATE' : event === 'DELETE' ? 'DELETE' : '*'
        let topicName = `realtime:${schema || 'public'}:${table || '*'}`
        if (filter) topicName += `:${filter}`

        this._send({
          topic:   topicName,
          event:   'phx_join',
          payload: {
            config: {
              broadcast:        { self: false },
              presence:         { key: '' },
              postgres_changes: [{
                event:  pgEvent,
                schema: schema || 'public',
                table:  table  || '*',
                filter: filter || undefined,
              }],
            },
            access_token: token,
          },
          ref: this._ref(),
        })
      })

      // Flush queued sends
      this._queue.forEach(m => this.ws.send(JSON.stringify(m)))
      this._queue = []

      if (statusCb) statusCb('SUBSCRIBED')
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        // Broadcast events
        if (msg.event === 'broadcast' && msg.payload?.event) {
          const key = msg.payload.event
          const cbs = [...(this.bcHandlers[key] || []), ...(this.bcHandlers['*'] || [])]
          cbs.forEach(cb => cb({ payload: msg.payload.payload ?? msg.payload }))
        }

        // Postgres changes
        if (msg.event === 'postgres_changes' && msg.payload?.data) {
          const change = msg.payload.data
          this.pgHandlers.forEach(h => {
            if (
              (h.opts.event === '*' || h.opts.event === change.type) &&
              (!h.opts.table  || h.opts.table  === change.table)
            ) {
              h.cb({ new: change.record, old: change.old_record, eventType: change.type })
            }
          })
        }

        if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
          setTimeout(() => this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this._ref() }), 25000)
        }
      } catch (_) {}
    }

    this.ws.onerror = () => { if (statusCb) statusCb('CHANNEL_ERROR') }
    this.ws.onclose = () => {}
    return this
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  _ref() { return String(this.ref++) }

  unsubscribe() {
    if (this.ws) { this.ws.close(); this.ws = null }
  }
}

// ── Cliente principal ─────────────────────────────────────────────────────
export const supabase = {
  auth: {
    async signInWithPassword({ email, password }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      localStorage.setItem('sb_token', data.access_token)
      localStorage.setItem('sb_refresh_token', data.refresh_token)
      localStorage.setItem('sb_token_exp', data.expires_at || (Math.floor(Date.now() / 1000) + 3600))
      localStorage.setItem('sb_user', JSON.stringify(data.user))
      return { data: { user: data.user }, error: null }
    },

    async signUp({ email, password, options }) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ email, password, data: options?.data }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: { user: data.user }, error: null }
    },

    async signOut() {
      localStorage.removeItem('sb_token')
      localStorage.removeItem('sb_refresh_token')
      localStorage.removeItem('sb_token_exp')
      localStorage.removeItem('sb_user')
      return { error: null }
    },

    async getSession() {
      const token   = localStorage.getItem('sb_token')
      const userStr = localStorage.getItem('sb_user')
      if (!token || !userStr) return { data: { session: null } }

      const exp = parseInt(localStorage.getItem('sb_token_exp') || '0')
      const now = Math.floor(Date.now() / 1000)
      if (exp && now >= exp - 300) await refreshSession()

      const freshToken = localStorage.getItem('sb_token')
      return { data: { session: { access_token: freshToken, user: JSON.parse(userStr) } } }
    },

    onAuthStateChange() {
      return { data: { subscription: { unsubscribe: () => {} } } }
    }
  },

  from(table) {
    return {
      select(cols = '*') { return buildQuery(table, cols) },

      insert(body) {
        let _select = false
        let _single = false
        const inserter = {
          select() { _select = true; return inserter },
          single()  { _single = true; return inserter },
          async then(resolve) {
            try {
              const headers = { ...getHeaders(), 'Prefer': _select ? 'return=representation' : 'return=minimal' }
              const res  = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
                method: 'POST', headers, body: JSON.stringify(body),
              })
              if (_select) {
                const data = await res.json()
                const result = _single ? (Array.isArray(data) ? data[0] : data) : data
                return resolve({ data: res.ok ? result : null, error: res.ok ? null : data })
              }
              return resolve({ data: null, error: res.ok ? null : await res.json() })
            } catch (err) { resolve({ data: null, error: err }) }
          }
        }
        return inserter
      },

      update(body) {
        const filters = []
        const updater = {
          eq(col, val) { filters.push(`${col}=eq.${encodeURIComponent(val)}`); return updater },
          async then(resolve) {
            try {
              let url = `${SUPABASE_URL}/rest/v1/${table}`
              if (filters.length) url += '?' + filters.join('&')
              const res = await fetch(url, {
                method: 'PATCH',
                headers: { ...getHeaders(), 'Prefer': 'return=minimal' },
                body: JSON.stringify(body),
              })
              resolve({ data: null, error: res.ok ? null : await res.json() })
            } catch (err) { resolve({ data: null, error: err }) }
          }
        }
        return updater
      },

      delete() {
        const filters = []
        const deleter = {
          eq(col, val) { filters.push(`${col}=eq.${encodeURIComponent(val)}`); return deleter },
          async then(resolve) {
            try {
              let url = `${SUPABASE_URL}/rest/v1/${table}`
              if (filters.length) url += '?' + filters.join('&')
              const res = await fetch(url, { method: 'DELETE', headers: getHeaders() })
              resolve({ data: null, error: res.ok ? null : await res.json() })
            } catch (err) { resolve({ data: null, error: err }) }
          }
        }
        return deleter
      },
    }
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  storage: {
    from(bucket) {
      return {
        async upload(path, file, opts = {}) {
          const headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${localStorage.getItem('sb_token') || SUPABASE_KEY}`,
          }
          if (opts.contentType) headers['Content-Type'] = opts.contentType
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
            method: 'POST', headers, body: file,
          })
          const data = await res.json()
          return { data: res.ok ? data : null, error: res.ok ? null : data }
        },

        async createSignedUrl(path, expiresIn = 3600) {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ expiresIn }),
          })
          const data = await res.json()
          const signedUrl = data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null
          return { data: signedUrl ? { signedUrl } : null, error: res.ok ? null : data }
        },

        getPublicUrl(path) {
          return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } }
        },
      }
    }
  },

  // ── Realtime ──────────────────────────────────────────────────────────────
  channel(name) {
    return new RealtimeChannel(name)
  },

  removeChannel(channel) {
    if (channel?.unsubscribe) channel.unsubscribe()
  },
}