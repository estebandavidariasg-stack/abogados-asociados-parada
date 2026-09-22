import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthHeaders } from '../../lib/supabase'
import { validarCorreo } from '../../lib/validaciones'
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

const ROLES = [
  { v: 'abogado',    l: 'Abogado' },
  { v: 'contador',   l: 'Contador' },
  { v: 'gestor',     l: 'Gestor' },
  { v: 'superadmin', l: 'Superadmin' },
]
const ROTULO = { abogado: 'Abogado', contador: 'Contador', gestor: 'Gestor', superadmin: 'Superadmin' }

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

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true); setError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=id,nombre,apellido,username,email,rol,aprobado,es_admin_maestro&order=nombre.asc.nullslast`,
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

  // ── Crear cuenta de superadministrador (correo + contraseña temporal) ──
  // El servidor (api/notify.js, type 'crear_admin') crea el usuario en Auth,
  // deja el perfil aprobado con el rol y manda la contraseña por correo. La
  // contraseña nunca llega al navegador.
  const [crear, setCrear]         = useState(false)
  const [nuevo, setNuevo]         = useState({ nombre: '', apellido: '', email: '' })
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
    setCrearBusy(true); setCrearError('')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
        body: JSON.stringify({ type: 'crear_admin', data: { nombre, apellido, email, rol: 'superadmin' } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'No se pudo crear la cuenta.')
      setCrear(false); setNuevo({ nombre: '', apellido: '', email: '' })
      flash(j?.sent === false
        ? `Cuenta creada para ${email}, pero el correo con la contraseña no salió. Pídele que use "¿Olvidaste tu contraseña?".`
        : `Cuenta de superadministrador creada. La contraseña temporal se envió a ${email}.`)
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

  const conteo = useMemo(() => {
    const c = { todos: perfiles.length }
    for (const r of ['abogado', 'contador', 'gestor', 'superadmin']) c[r] = perfiles.filter(p => p.rol === r).length
    return c
  }, [perfiles])
  useEffect(() => { if (!loading) onConteo?.(conteo) }, [conteo, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const FILTROS = [
    ['todos', 'Todos'], ['abogado', 'Abogados'], ['contador', 'Contadores'],
    ['gestor', 'Gestores'], ['superadmin', 'Superadmins'],
  ]

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        {/* flex:1 → el texto usa el ancho sobrante y el botón se queda a la derecha. */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 className={styles.title}>Gestión de Roles</h2>
          {/* A todo el ancho: el tope de 62ch de la hoja compartida partía el texto en tres líneas. */}
          <p className={styles.sub} style={{ maxWidth: 'none' }}>
            Cambia el rol de cualquier cuenta entre abogado, contador, gestor y superadministrador,
            o crea una cuenta de superadministrador nueva. La cuenta conserva sus datos; solo cambia
            lo que puede hacer en la plataforma. Tu propia cuenta y la cuenta maestra no se tocan.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={styles.refresh} onClick={cargar}>↻ Actualizar</button>
          <button
            type="button"
            className={styles.payConfirm}
            onClick={() => { setCrearError(''); setCrear(true) }}
          >
            + Crear superadministrador
          </button>
        </div>
      </header>

      {aviso && <p className={styles.strong} role="status">{aviso}</p>}
      {error && <p className={styles.muted}>{error}</p>}

      <div className={styles.chipRow}>
        <input
          className={styles.searchInput}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre, usuario o correo…"
          aria-label="Buscar perfil"
          style={{ flex: '1 1 260px' }}
        />
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
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => {
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
            <h3 id="crearAdminTitulo" className={styles.payTitle}>Crear superadministrador</h3>
            <p className={styles.paySub}>
              La cuenta nace aprobada y con acceso completo al panel. La contraseña temporal
              se envía al correo; la persona la cambia al entrar.
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
