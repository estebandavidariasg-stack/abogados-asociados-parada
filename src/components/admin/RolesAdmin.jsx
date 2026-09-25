import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { validarCorreo, PASSWORD_RULES, isPasswordValid } from '../../lib/validaciones'
import ConfirmDialog from './ConfirmDialog'
// Reutiliza la hoja del panel de pagos: misma tabla, mismo buscador y mismos
// estados vacíos, para que las pestañas del admin se vean iguales.
import styles from './PagosCobrosAdmin.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   RolesAdmin — el superadmin cambia el rol de cualquier perfil entre
   abogado / contador / gestor. El cambio pasa por la RPC `admin_cambiar_rol`
   (docs/sql/admin-roles-2026-09-17.sql): el trigger guard_profiles_rol
   congela el rol de las cuentas aprobadas y solo esa función puede abrirlo.
   Nunca hacia ni desde 'superadmin', y nunca sobre uno mismo.
   ───────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Esta tabla gobierna SOLO cuentas de panel. Los profesionales y gestores
// se administran en sus propias pestanas.
const ROLES = [
  { v: 'admin',      l: 'Admin' },
  { v: 'superadmin', l: 'Superadmin' },
]
const ROTULO = { abogado: 'Abogado', contador: 'Contador', gestor: 'Gestor', superadmin: 'Superadmin', admin: 'Admin' }

// Roles con acceso al panel. Define que filas se listan aqui.
const ROLES_PANEL = ['superadmin', 'admin']

// Filas por pagina en la tabla.
const POR_PAGINA = 8

// Campos del modal de alta: caja visible (la clase del buscador es sin borde).
const INPUT_MODAL = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9,
  border: '1px solid rgba(109,60,27,0.22)', background: '#fff', color: '#3b2a1e',
  fontFamily: 'inherit', fontSize: '0.9rem', outline: 'none',
}

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const nombreDe = (p) =>
  [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || (p.username ? `@${p.username}` : 'Sin nombre')

// onConteo: conteos por rol → AdminPage los pinta en las tarjetas de arriba.
export default function RolesAdmin({ miId, onChanged, onConteo }) {
  const [perfiles, setPerfiles]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [q, setQ]                 = useState('')
  const [rolFiltro, setRolFiltro] = useState('todos')
  const [pendiente, setPendiente] = useState(null)   // { perfil, nuevoRol } a confirmar
  const [busy, setBusy]           = useState(false)
  const [aviso, setAviso]         = useState('')
  // Edicion y borrado por fila. Disponibles para TODAS las cuentas de panel,
  // incluida la propia y la maestra: lo que no se permite es dejar la
  // plataforma sin ningun superadmin, y de eso se encarga el servidor.
  const [editando, setEditando]   = useState(null)   // perfil en edicion
  const [edicion, setEdicion]     = useState({ nombre: '', apellido: '', username: '', email: '', password: '' })
  const [edError, setEdError]     = useState('')
  const [edBusy, setEdBusy]       = useState(false)
  const [borrando, setBorrando]   = useState(null)   // perfil a borrar
  const [borBusy, setBorBusy]     = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true); setError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=id,nombre,apellido,username,email,rol,aprobado,es_admin_maestro` +
        // Solo cuentas de panel: los profesionales y gestores tienen sus
        // propias pestanas y no se gestionan desde aqui.
        `&rol=in.(${ROLES_PANEL.join(',')})&order=nombre.asc.nullslast`,
        { headers }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPerfiles(Array.isArray(data) ? data : [])
    } catch {
      setError('No se pudieron cargar los perfiles.')
    } finally {
      setLoading(false)
    }
  }

  function flash(t) { setAviso(t); setTimeout(() => setAviso(''), 4000) }

  function abrirEdicion(p) {
    setEdError('')
    setEdicion({ nombre: p.nombre || '', apellido: p.apellido || '', username: p.username || '', email: p.email || '', password: '' })
    setEditando(p)
  }

  // Va por el servidor, no por un PATCH directo: el correo y la contrasena
  // viven en auth.users, y cambiarlos solo en `profiles` dejaria a la persona
  // sin poder entrar. El endpoint toca las dos partes en el orden correcto.
  async function guardarEdicion(e) {
    e?.preventDefault?.()
    if (edBusy || !editando) return
    const u = edicion.username.trim().toLowerCase()
    if (!edicion.nombre.trim()) { setEdError('El nombre no puede quedar vacío.'); return }
    if (u.length < 3 || !/^[a-z0-9._-]+$/.test(u)) { setEdError('Usuario inválido (mínimo 3, sin espacios).'); return }
    if (validarCorreo(edicion.email.trim()).valid !== true) { setEdError('Escribe un correo válido.'); return }
    // Vacia = se deja la que tenia. Si escribe algo, tiene que cumplir.
    if (edicion.password && !isPasswordValid(edicion.password)) { setEdError('La contraseña nueva no cumple los requisitos.'); return }
    setEdBusy(true); setEdError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'editar_cuenta_panel', data: {
          id: editando.id,
          nombre: edicion.nombre.trim(),
          apellido: edicion.apellido.trim(),
          username: u,
          email: edicion.email.trim().toLowerCase(),
          password: edicion.password,
        } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'No se pudo guardar.')
      setEditando(null)
      flash(j?.cambioAcceso ? 'Cuenta actualizada. Los datos de acceso cambiaron.' : 'Cuenta actualizada.')
      cargar(); onChanged?.()
    } catch (err) {
      setEdError(err.message || 'No se pudo guardar.')
    } finally { setEdBusy(false) }
  }

  async function confirmarBorrado() {
    if (borBusy || !borrando) return
    setBorBusy(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'borrar_cuenta_panel', data: { id: borrando.id } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'No se pudo borrar la cuenta.')
      setBorrando(null)
      if (j?.propia) {
        flash('Borraste tu propia cuenta. Se cerrará la sesión.')
        setTimeout(() => window.location.assign('/'), 1500)
        return
      }
      flash('Cuenta borrada.')
      cargar(); onChanged?.()
    } catch (err) {
      setBorrando(null)
      flash(err.message || 'No se pudo borrar la cuenta.')
    } finally { setBorBusy(false) }
  }

  // ── Crear cuenta de superadministrador (correo + contraseña temporal) ──
  // El servidor (api/notify.js, type 'crear_admin') crea el usuario en Auth,
  // deja el perfil aprobado con el rol y manda la contraseña por correo. La
  // contraseña nunca llega al navegador.
  const [crear, setCrear]         = useState(false)
  const [nuevo, setNuevo]         = useState({ nombre: '', apellido: '', email: '', username: '', password: '', rol: 'admin' })
  const [crearBusy, setCrearBusy] = useState(false)
  const [crearError, setCrearError] = useState('')
  useEffect(() => {
    if (!crear) return
    const onKey = (e) => { if (e.key === 'Escape' && !crearBusy) setCrear(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [crear, crearBusy])

  async function crearCuenta(e) {
    e?.preventDefault?.()
    if (crearBusy) return
    const nombre = nuevo.nombre.trim(), apellido = nuevo.apellido.trim(), email = nuevo.email.trim()
    if (!nombre) { setCrearError('Escribe el nombre.'); return }
    if (validarCorreo(email).valid !== true) { setCrearError('Escribe un correo válido.'); return }
    // El usuario es obligatorio: es con lo que se le identifica en el chat
    // interno y en las tablas, y generarlo solo daba nombres ilegibles.
    const usuario = nuevo.username.trim().toLowerCase()
    if (usuario.length < 3) { setCrearError('Escribe un nombre de usuario (mínimo 3 caracteres).'); return }
    if (!/^[a-z0-9._-]+$/.test(usuario)) { setCrearError('El usuario solo admite letras, números, punto, guion y guion bajo.'); return }
    if (!isPasswordValid(nuevo.password)) { setCrearError('La contraseña no cumple los requisitos.'); return }
    if (!['admin', 'superadmin'].includes(nuevo.rol)) { setCrearError('Elige el tipo de cuenta.'); return }
    setCrearBusy(true); setCrearError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'crear_admin', data: {
          nombre, apellido, email,
          username: usuario,
          password: nuevo.password,
          rol: nuevo.rol,
        } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'No se pudo crear la cuenta.')
      setCrear(false); setNuevo({ nombre: '', apellido: '', email: '', username: '', password: '', rol: 'admin' })
      const rotulo = nuevo.rol === 'superadmin' ? 'Superadministrador' : 'Administrador'
      flash(j?.sent === false
        ? `${rotulo} creado para ${email}, pero el correo de aviso no salió. Pásale tú los datos de acceso.`
        : `${rotulo} creado. Ya puede entrar con su correo o con @${usuario}, y la contraseña que definiste.`)
      cargar()
      onChanged?.()
    } catch (err) {
      setCrearError(err.message || 'No se pudo crear la cuenta.')
    } finally {
      setCrearBusy(false)
    }
  }

  async function confirmarCambio() {
    if (!pendiente || busy) return
    const { perfil, nuevoRol } = pendiente
    setBusy(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_cambiar_rol`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: perfil.id, p_rol: nuevoRol }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        const msg = String(j?.message || '')
        if (/could not find the function/i.test(msg)) {
          throw new Error('Falta aplicar docs/sql/admin-roles-2026-09-17.sql en Supabase.')
        }
        if (/no autorizado/i.test(msg)) throw new Error('No autorizado para cambiar roles.')
        throw new Error(msg || 'No se pudo cambiar el rol.')
      }
      // Instantáneo en la tabla; el resto del panel se recarga por onChanged.
      setPerfiles(ps => ps.map(p => (p.id === perfil.id ? { ...p, rol: nuevoRol } : p)))
      setPendiente(null)
      flash(`${nombreDe(perfil)} ahora es ${ROTULO[nuevoRol].toLowerCase()}.`)
      onChanged?.()
    } catch (err) {
      setPendiente(null)
      flash(err.message || 'No se pudo cambiar el rol.')
    } finally {
      setBusy(false)
    }
  }

  const visibles = useMemo(() => {
    const qn = norm(q.trim())
    return perfiles.filter(p => {
      if (rolFiltro !== 'todos' && p.rol !== rolFiltro) return false
      if (!qn) return true
      return norm(`${nombreDe(p)} ${p.email || ''} ${p.username || ''}`).includes(qn)
    })
  }, [perfiles, q, rolFiltro])

  // Paginacion: se corta lo ya filtrado. Al cambiar de filtro o de
  // busqueda se vuelve a la primera pagina, si no se queda uno mirando
  // una pagina que ya no existe.
  const [pagina, setPagina] = useState(1)
  useEffect(() => { setPagina(1) }, [q, rolFiltro])
  const totalPags = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const pagSegura = Math.min(pagina, totalPags)
  const enPagina  = visibles.slice((pagSegura - 1) * POR_PAGINA, pagSegura * POR_PAGINA)

  const conteo = useMemo(() => {
    const c = { todos: perfiles.length }
    for (const r of ROLES_PANEL) c[r] = perfiles.filter(p => p.rol === r).length
    return c
  }, [perfiles])
  useEffect(() => { if (!loading) onConteo?.(conteo) }, [conteo, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const FILTROS = [
    ['todos', 'Todos'], ['superadmin', 'Superadmins'], ['admin', 'Admins'],
  ]

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        {/* flex:1 → el texto usa el ancho sobrante y el botón se queda a la derecha. */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 className={styles.title}>Gestión de Roles</h2>
          {/* A todo el ancho: el tope de 62ch de la hoja compartida partía el texto en tres líneas. */}
          <p className={styles.sub} style={{ maxWidth: 'none' }}>
            Cuentas con acceso al panel. Solo el superadministrador gestiona roles.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
          <button
            type="button"
            className={styles.payConfirm}
            onClick={() => { setCrearError(''); setCrear(true) }}
          >
            + Crear
          </button>
        </div>
      </header>

      {aviso && <p className={styles.strong} role="status">{aviso}</p>}
      {error && <p className={styles.muted}>{error}</p>}

      <div className={styles.chipRow}>
        <div className={styles.filterBar} style={{ flex: '1 1 260px' }}>
          <span className={styles.searchIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            className={styles.searchInput}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por nombre, usuario o correo…"
            aria-label="Buscar perfil"
          />
          {q && (
            <button type="button" className={styles.searchClear}
              onClick={() => setQ('')} aria-label="Limpiar búsqueda">×</button>
          )}
        </div>
        <div className={styles.chipRow} role="tablist" aria-label="Filtrar por rol">
          {FILTROS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={rolFiltro === k}
              className={`${styles.chip} ${rolFiltro === k ? styles.chipActive : ''}`}
              onClick={() => setRolFiltro(k)}>
              {l} <span className={styles.chipCount}>{conteo[k] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className={styles.muted}>Cargando perfiles…</p>
      ) : visibles.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTxt}>{perfiles.length === 0 ? 'No hay perfiles' : 'Ningún perfil coincide con el filtro'}</p>
          <p className={styles.emptySub}>{perfiles.length === 0 ? 'Cuando alguien se registre aparecerá aquí.' : 'Ajusta la búsqueda o el rol.'}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol actual</th>
                <th>Aprobado</th>
                <th>Cambiar rol</th>
                <th className={styles.accionesCell}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {enPagina.map(p => {
                // Solo dos cuentas no se tocan: la propia y la maestra (garantiza
                // que siempre quede un superadmin). Los demás superadmins sí se
                // pueden bajar a un rol público.
                const esMaestro = !!p.es_admin_maestro
                const esYo = p.id === miId
                const bloqueado = esMaestro || esYo
                return (
                  <tr key={p.id}>
                    <td className={styles.strong}>
                      {nombreDe(p)}
                      {/* El usuario solo como subtítulo cuando hay nombre; si no, ya es el título. */}
                      {p.username && nombreDe(p) !== `@${p.username}` && (
                        <span className={styles.gestorTag}>@{p.username}</span>
                      )}
                    </td>
                    <td>{p.email || <span className={styles.muted}>Sin correo</span>}</td>
                    <td>
                      <span className={p.rol === 'contador' ? styles.badgeCont : styles.badgeAbog}>
                        {ROTULO[p.rol] || p.rol || 'Sin rol'}
                      </span>
                    </td>
                    <td>{p.aprobado ? 'Sí' : <span className={styles.muted}>Pendiente</span>}</td>
                    <td>
                      {bloqueado ? (
                        <span className={styles.muted} title={esYo ? 'No puedes cambiar tu propio rol' : 'La cuenta maestra no se puede cambiar'}>
                          {esYo ? 'Tu cuenta' : 'Cuenta maestra'}
                        </span>
                      ) : (
                        <select
                          className={styles.perPageSel}
                          value={p.rol || ''}
                          onChange={e => {
                            const nuevoRol = e.target.value
                            if (nuevoRol && nuevoRol !== p.rol) setPendiente({ perfil: p, nuevoRol })
                          }}
                          aria-label={`Cambiar rol de ${nombreDe(p)}`}
                        >
                          {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                        </select>
                      )}
                    </td>
                    <td className={styles.accionesCell}>
                      <div className={styles.accionesGrupo}>
                        <button type="button" className={styles.iconBtn}
                          title={`Editar ${nombreDe(p)}`}
                          aria-label={`Editar ${nombreDe(p)}`}
                          onClick={() => abrirEdicion(p)}>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          title={`Borrar ${nombreDe(p)}`}
                          aria-label={`Borrar ${nombreDe(p)}`}
                          onClick={() => setBorrando(p)}>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

            {totalPags > 1 && (
              <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}
                aria-label="Paginación de cuentas">
                <button type="button" className={styles.chip}
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={pagSegura <= 1}>← Anterior</button>
                <span style={{ fontSize: '0.78rem', color: '#6f5c48' }}>
                  Página {pagSegura} de {totalPags}
                  <span style={{ opacity: 0.7 }}> · {visibles.length} cuenta{visibles.length === 1 ? '' : 's'}</span>
                </span>
                <button type="button" className={styles.chip}
                  onClick={() => setPagina(p => Math.min(totalPags, p + 1))}
                  disabled={pagSegura >= totalPags}>Siguiente →</button>
              </nav>
            )}
        </div>
      )}

      {/* Edicion de una cuenta de panel. El correo se muestra pero no se edita:
          vive en auth.users y cambiarlo solo aqui dejaria las dos tablas
          diciendo cosas distintas y a la persona sin poder entrar. */}
      {editando && createPortal(
        <div className={styles.payOverlay} onClick={() => !edBusy && setEditando(null)} role="presentation">
          <form className={styles.payModal} onClick={e => e.stopPropagation()} onSubmit={guardarEdicion}
            noValidate role="dialog" aria-modal="true" aria-labelledby="editarTitulo">
            <h3 id="editarTitulo" className={styles.payTitle}>Editar cuenta</h3>
            <p className={styles.paySub}>{ROTULO[editando.rol] || editando.rol}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Nombre</span>
                <input style={INPUT_MODAL} value={edicion.nombre} autoFocus
                  onChange={e => { setEdError(''); setEdicion(v => ({ ...v, nombre: e.target.value })) }} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Apellido</span>
                <input style={INPUT_MODAL} value={edicion.apellido}
                  onChange={e => { setEdError(''); setEdicion(v => ({ ...v, apellido: e.target.value })) }} />
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className={styles.perPageLbl}>Usuario</span>
                <input style={INPUT_MODAL} value={edicion.username}
                  onChange={e => { setEdError(''); setEdicion(v => ({ ...v, username: e.target.value.toLowerCase() })) }} />
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className={styles.perPageLbl}>Correo</span>
                <input style={INPUT_MODAL} type="email" value={edicion.email} autoComplete="off"
                  onChange={e => { setEdError(''); setEdicion(v => ({ ...v, email: e.target.value })) }} />
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className={styles.perPageLbl}>Nueva contraseña</span>
                <input style={INPUT_MODAL} type="text" value={edicion.password} autoComplete="new-password"
                  onChange={e => { setEdError(''); setEdicion(v => ({ ...v, password: e.target.value })) }}
                  placeholder="Déjalo vacío para no cambiarla" />
                {/* Solo se valida si escribe algo: vacio significa dejarla igual. */}
                {edicion.password && (
                  <ul style={{ display: 'grid', gap: 2, margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                    {PASSWORD_RULES.map(r => {
                      const ok = r.test(edicion.password)
                      return (
                        <li key={r.id} style={{ fontSize: '0.7rem', display: 'flex', gap: 6, alignItems: 'center',
                          color: ok ? '#2f855a' : '#8a7663' }}>
                          <span aria-hidden="true">{ok ? '✓' : '·'}</span>{r.label}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </label>
            </div>
            {edError && <p style={{ color: '#a23b3b', fontSize: '0.8rem', margin: '10px 0 0' }}>{edError}</p>}
            <p style={{ fontSize: '0.72rem', color: '#6f5c48', margin: '10px 0 0' }}>
              Cambiar el correo o la contraseña actualiza sus datos de acceso al instante.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className={styles.chip} onClick={() => setEditando(null)} disabled={edBusy}>Cancelar</button>
              <button type="submit" className={styles.payBtn} disabled={edBusy}>{edBusy ? 'Guardando…' : 'Guardar cambios'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Borrado. El servidor se niega si dejaria la plataforma sin ningun
          superadmin, asi que el aviso aqui no es la unica defensa. */}
      {borrando && (
        <ConfirmDialog
          open
          title="Borrar cuenta de panel"
          message={
            borrando.id === miId
              ? `Vas a borrar TU PROPIA cuenta (${borrando.email}). Perderás el acceso al panel de inmediato y no se puede deshacer.`
              : `Se borrará la cuenta de ${nombreDe(borrando)} (${borrando.email}), en la plataforma y en el sistema de acceso. No se puede deshacer.`
          }
          confirmLabel="Borrar cuenta"
          tone="danger"
          busy={borBusy}
          onConfirm={confirmarBorrado}
          onClose={() => setBorrando(null)}
        />
      )}

      {/* Modal de alta (portal: el contenido de la pestaña anima con transform
          y un fixed dentro quedaría atrapado). Misma hoja que el modal de pagos. */}
      {crear && createPortal(
        <div className={styles.payOverlay} onClick={() => !crearBusy && setCrear(false)} role="presentation">
          <form
            className={styles.payModal}
            onClick={e => e.stopPropagation()}
            onSubmit={crearCuenta}
            noValidate
            role="dialog" aria-modal="true" aria-labelledby="crearAdminTitulo"
          >
            <h3 id="crearAdminTitulo" className={styles.payTitle}>Crear cuenta de panel</h3>
            <p className={styles.paySub}>
              La cuenta nace aprobada y lista para entrar con la contraseña que definas aquí.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Nombre</span>
                <input style={INPUT_MODAL} value={nuevo.nombre} autoFocus
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, nombre: e.target.value })) }} placeholder="Nombre" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Apellido</span>
                <input style={INPUT_MODAL} value={nuevo.apellido}
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, apellido: e.target.value })) }} placeholder="Apellido" />
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className={styles.perPageLbl}>Correo</span>
                <input style={INPUT_MODAL} type="email" value={nuevo.email} autoComplete="off"
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, email: e.target.value })) }} placeholder="nombre@paradabridge.com" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Usuario</span>
                <input style={INPUT_MODAL} value={nuevo.username} autoComplete="off"
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, username: e.target.value.toLowerCase() })) }}
                  placeholder="Ej: rparada" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className={styles.perPageLbl}>Tipo de cuenta</span>
                <select style={INPUT_MODAL} value={nuevo.rol}
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, rol: e.target.value })) }}>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className={styles.perPageLbl}>Contraseña</span>
                <input style={INPUT_MODAL} type="text" value={nuevo.password} autoComplete="new-password"
                  onChange={e => { setCrearError(''); setNuevo(n => ({ ...n, password: e.target.value })) }}
                  placeholder="La que le vas a entregar" />
                {/* Visible en texto plano a proposito: la escribe el superadmin
                    para entregarsela, no la teclea su dueno a ciegas. Mismas
                    reglas que el registro de profesionales y gestores. */}
                <ul style={{ display: 'grid', gap: 2, margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                  {PASSWORD_RULES.map(r => {
                    const ok = r.test(nuevo.password)
                    return (
                      <li key={r.id} style={{
                        fontSize: '0.7rem', display: 'flex', gap: 6, alignItems: 'center',
                        color: ok ? '#2f855a' : '#8a7663',
                      }}>
                        <span aria-hidden="true">{ok ? '✓' : '·'}</span>{r.label}
                      </li>
                    )
                  })}
                </ul>
              </label>
            </div>
            {crearError && <p className={styles.payError} role="alert">{crearError}</p>}
            <div className={styles.payActions}>
              <button type="button" className={styles.payCancel} onClick={() => setCrear(false)} disabled={crearBusy}>Cancelar</button>
              <button type="submit" className={styles.payConfirm} disabled={crearBusy}>
                {crearBusy ? 'Creando…' : 'Crear cuenta y enviar contraseña'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={!!pendiente}
        title="Cambiar rol"
        message={pendiente
          ? (pendiente.nuevoRol === 'superadmin'
              ? `${nombreDe(pendiente.perfil)} pasará a Superadmin: tendrá acceso completo al panel de administración (aprobar, pagos, roles). La cuenta queda aprobada.`
              : `${nombreDe(pendiente.perfil)} pasará de ${ROTULO[pendiente.perfil.rol] || pendiente.perfil.rol} a ${ROTULO[pendiente.nuevoRol]}. Su sesión sigue abierta, pero verá el panel del rol nuevo la próxima vez que entre.`)
          : ''}
        confirmLabel="Cambiar rol"
        tone="gold"
        busy={busy}
        onConfirm={confirmarCambio}
        onClose={() => !busy && setPendiente(null)}
      />
    </section>
  )
}
