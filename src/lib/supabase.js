const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
// En local puede no existir .env. Mantener valores vacios evita una pantalla
// blanca por errores de inicializacion; las vistas usan datos por defecto.

function getHeaders() {
  const token = localStorage.getItem('sb_token')
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token || SUPABASE_KEY}`,
  }
}

// Señal de timeout para fetch; devuelve undefined si el navegador no la soporta
// (fetch ignora signal undefined, así que es seguro en Safari viejos).
// Exportada para los fetch crudos de los pollers (chat interno).
export function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
  } catch (_) { /* noop */ }
  return undefined
}

// Single-flight: GoTrue ROTA el refresh_token en cada uso. Si varios pollers
// (chat interno 3s, sidebar 20s, notificaciones 30s) entran a la ventana de
// refresh a la vez, dos POST paralelos con el mismo refresh_token pueden dejar
// en localStorage un token ya rotado → 400 en el siguiente refresh → sesión
// muerta. Una sola promesa compartida por pestaña evita la carrera, y el
// catch evita que un fallo de red reviente a todos los llamadores.
let _refreshing = null
function refreshSession() {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    const refreshToken = localStorage.getItem('sb_refresh_token')
    if (!refreshToken) return false
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: timeoutSignal(10000),
    })
    if (!res.ok) return false
    const data = await res.json()
    localStorage.setItem('sb_token', data.access_token)
    localStorage.setItem('sb_refresh_token', data.refresh_token)
    localStorage.setItem('sb_token_exp', data.expires_at || (Math.floor(Date.now() / 1000) + 3600))
    return true
  })().catch(() => false).finally(() => { _refreshing = null })
  return _refreshing
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
        const res  = await fetch(url, { headers: getHeaders(), signal: timeoutSignal(15000) })
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
      const res  = await fetch(url, { headers, signal: timeoutSignal(15000) })
      if (res.status === 406 || res.status === 404) return { data: null, error: null }
      const data = await res.json()
      return { data: res.ok ? data : null, error: res.ok ? null : data }
    } catch (err) { return { data: null, error: err } }
  }

  return builder
}

// ── Realtime WebSocket ────────────────────────────────────────────────────
const WS_URL = SUPABASE_URL
  ? SUPABASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
  : ''

class RealtimeChannel {
  constructor(name) {
    this.name       = name
    this.pgHandlers = []   // postgres_changes handlers
    this.bcHandlers = {}   // broadcast handlers: { eventName: [cb, ...] }
    this._queue     = []   // sends queued before WS opens
    this.ws         = null
    this.ref        = 1
    // Reconexión / heartbeat: sin esto, cualquier corte de red (WiFi móvil,
    // suspensión del equipo, expiración del JWT) dejaba el canal muerto en
    // silencio hasta recargar la página.
    this._closedByUser   = false
    this._retry          = 0      // intentos de reconexión (backoff exponencial)
    this._statusCb       = null   // callback de estado, reutilizado al reconectar
    this._hbTimer        = null   // interval único de heartbeat
    this._hbPending      = false  // true = el reply del último heartbeat no llegó (zombi)
    this._reconnectTimer = null
    this._joinToken      = null   // JWT con el que se unieron los topics
    this._topics         = []     // topics unidos (para re-autenticar al renovar token)
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
    if (statusCb) this._statusCb = statusCb
    const notify = (st) => { if (this._statusCb) this._statusCb(st) }
    if (!WS_URL) {
      notify('CHANNEL_ERROR')
      return this
    }
    this._closedByUser = false
    // Si quedó un socket anterior (re-subscribe manual), cerrarlo sin disparar
    // su reconexión automática.
    if (this.ws) {
      try { this.ws.onclose = null; this.ws.close() } catch (_) { /* noop */ }
      this.ws = null
    }
    const token = localStorage.getItem('sb_token') || SUPABASE_KEY
    this._joinToken = token
    this.ws = new WebSocket(`${WS_URL}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`)
    const hasBroadcast = Object.keys(this.bcHandlers).length > 0

    this.ws.onopen = () => {
      this._topics = []
      this._send({ topic: 'phoenix', event: 'phx_join', payload: {}, ref: this._ref() })

      // Subscribe to broadcast channel if needed
      if (hasBroadcast) {
        const bcTopic = `realtime:${this.name}`
        this._topics.push(bcTopic)
        this._send({
          topic:   bcTopic,
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
        if (!this._topics.includes(topicName)) this._topics.push(topicName)

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

      this._startHeartbeat()
      notify('SUBSCRIBED')
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
          if (msg.topic === 'phoenix') {
            // Reply del socket (join/heartbeat): marca vivo el heartbeat.
            this._hbPending = false
          } else if (this._topics.includes(msg.topic)) {
            // Join de DATOS aceptado: la suscripción funciona de verdad. Solo
            // aquí se resetea el backoff — si lo reseteara el heartbeat, un
            // join rechazado en bucle reconectaría cada 2s para siempre.
            this._retry = 0
          }
        }
        if (msg.event === 'phx_reply' && msg.payload?.status === 'error' && this._topics.includes(msg.topic)) {
          // Join de datos RECHAZADO (típico: JWT expirado tras suspender el
          // equipo). Sin esto el socket quedaba "sano" (heartbeats ok) pero
          // sordo para siempre. Cerrar reentra al ciclo de reconexión, que
          // refresca el token antes de reintentar (backoff creciente).
          try { this.ws.close() } catch (_) { /* noop */ }
        }
      } catch (_) { /* noop */ }
    }

    this.ws.onerror = () => { notify('CHANNEL_ERROR') }
    this.ws.onclose = () => {
      this._stopHeartbeat()
      if (this._closedByUser) return
      // Reconexión automática con backoff exponencial + jitter (2s → 30s máx).
      // subscribe() relee el token fresco de localStorage y re-hace todos los
      // phx_join a partir de pgHandlers/bcHandlers, y notifica 'SUBSCRIBED'
      // para que los consumidores puedan re-sincronizar datos perdidos.
      const delay = Math.min(30000, 2000 * Math.pow(2, this._retry++)) + Math.floor(Math.random() * 1000)
      this._reconnectTimer = setTimeout(() => {
        if (this._closedByUser) return
        // Tras una suspensión larga el JWT de localStorage suele estar
        // expirado y el join sería rechazado: refrescarlo primero si hace
        // falta (single-flight, jamás lanza) y reconectar con token fresco.
        const exp = parseInt(localStorage.getItem('sb_token_exp') || '0')
        const now = Math.floor(Date.now() / 1000)
        if (localStorage.getItem('sb_refresh_token') && exp && now >= exp - 300) {
          refreshSession().then(() => { if (!this._closedByUser) this.subscribe() })
        } else {
          this.subscribe()
        }
      }, delay)
    }
    return this
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    this._hbPending = false
    this._hbTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      if (this._hbPending) {
        // El reply del heartbeat anterior nunca llegó: conexión zombi
        // (half-open, típica en WiFi/red móvil). Cerrar dispara la
        // reconexión automática de onclose.
        try { this.ws.close() } catch (_) { /* noop */ }
        return
      }
      // Si AuthContext renovó el JWT, re-autenticar los topics unidos para que
      // Supabase Realtime no expulse las suscripciones al expirar el token
      // (~1h). Mismo mecanismo que usa el SDK oficial.
      const cur = localStorage.getItem('sb_token') || SUPABASE_KEY
      if (cur !== this._joinToken) {
        this._joinToken = cur
        this._topics.forEach(t => this._send({ topic: t, event: 'access_token', payload: { access_token: cur }, ref: this._ref() }))
      }
      this._hbPending = true
      this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this._ref() })
    }, 25000)
  }

  _stopHeartbeat() {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null }
    this._hbPending = false
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  _ref() { return String(this.ref++) }

  unsubscribe() {
    this._closedByUser = true
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    this._stopHeartbeat()
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

    /* ── Reset de contraseña ──
       Dispara el correo de recovery de Supabase (template configurado en
       Auth > Email Templates > Reset Password). El usuario llega a
       redirectTo con #access_token=...&type=recovery en el hash. */
    async resetPasswordForEmail(email, { redirectTo } = {}) {
      const url = `${SUPABASE_URL}/auth/v1/recover${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        return { data: null, error: { message: detail.msg || detail.error_description || `HTTP ${res.status}` } }
      }
      return { data: {}, error: null }
    },

    /* ── Actualizar el usuario autenticado ──
       Usado en /nueva-contrasena para cambiar la contraseña usando el
       access_token de tipo recovery que Supabase puso en el hash. */
    async updateUser({ password }) {
      const token = localStorage.getItem('sb_token')
      if (!token) return { data: null, error: { message: 'No hay sesión activa' } }
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { data: null, error: { message: data.msg || data.error_description || `HTTP ${res.status}` } }
      }
      return { data: { user: data }, error: null }
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
        let _cols   = '*'
        const inserter = {
          // Permite acotar las columnas devueltas por RETURNING. Sin esto,
          // un INSERT como anon en una tabla con column-level GRANTs falla
          // porque el RETURNING * intenta leer columnas a las que el rol
          // no tiene SELECT permission.
          select(cols) { _select = true; if (cols) _cols = cols; return inserter },
          single()     { _single = true; return inserter },
          async then(resolve) {
            try {
              const headers = { ...getHeaders(), 'Prefer': _select ? 'return=representation' : 'return=minimal' }
              let url = `${SUPABASE_URL}/rest/v1/${table}`
              if (_select && _cols !== '*') url += `?select=${encodeURIComponent(_cols)}`
              const res = await fetch(url, {
                method: 'POST', headers, body: JSON.stringify(body),
                signal: timeoutSignal(15000),
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
                signal: timeoutSignal(15000),
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
              const res = await fetch(url, { method: 'DELETE', headers: getHeaders(), signal: timeoutSignal(15000) })
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
          // Sin timeout: las subidas de archivos grandes en redes lentas tardan
          // legítimamente minutos. Sí capturamos fallos de red para mantener el
          // contrato { data, error } — antes un throw dejaba UIs colgadas en
          // "Subiendo…" (ChatSection.handleFile, ModelosContractualesSection).
          try {
            const headers = {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${localStorage.getItem('sb_token') || SUPABASE_KEY}`,
            }
            if (opts.contentType) headers['Content-Type'] = opts.contentType
            const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
              method: 'POST', headers, body: file,
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) return { data: null, error: data.message ? data : { message: `HTTP ${res.status}`, ...data } }
            return { data, error: null }
          } catch (err) { return { data: null, error: err } }
        },

        async createSignedUrl(path, expiresIn = 3600) {
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ expiresIn }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            console.warn('[storage.createSignedUrl] API error', res.status, data)
            return { data: null, error: data }
          }
          // Supabase Storage API: versiones viejas devuelven `signedURL` (URL
          // mayúsculas), versiones nuevas devuelven `signedUrl` (camelCase).
          // Esto causaba que TODOS los audios viejos del chat interno cayeran
          // al fallback "Audio no disponible" — el wrapper devolvía null aunque
          // la API hubiera firmado bien.
          const rel = data.signedURL || data.signedUrl
          if (!rel) {
            console.warn('[storage.createSignedUrl] respuesta sin signedURL/signedUrl', data)
            return { data: null, error: { message: 'No signed URL in response', raw: data } }
          }
          const tail = rel.startsWith('/') ? rel : `/${rel}`
          return { data: { signedUrl: `${SUPABASE_URL}/storage/v1${tail}` }, error: null }
        },

        async remove(paths) {
          try {
            const list = Array.isArray(paths) ? paths : [paths]
            const headers = {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${localStorage.getItem('sb_token') || SUPABASE_KEY}`,
            }
            const results = await Promise.all(list.map(p =>
              fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${p}`, { method: 'DELETE', headers, signal: timeoutSignal(20000) })
            ))
            const failed = results.filter(r => !r.ok)
            if (failed.length) return { data: null, error: { message: 'Failed to remove some files' } }
            return { data: list.map(name => ({ name })), error: null }
          } catch (err) { return { data: null, error: err } }
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
