import { useEffect, useState } from 'react'
import { getAuthHeaders } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ─────────────────────────────────────────────────────────────────────────
   Campos de registro configurables — SOLO admin maestro (es_admin_maestro).

   CRUD sobre public.registro_campos: el formulario público de registro pinta
   estos campos en vivo (RegisterModal) y guarda las respuestas del aspirante
   en profiles.datos_adicionales, que el admin ve al revisar la solicitud.
   ───────────────────────────────────────────────────────────────────────── */

const ROLES = [
  { key: 'todos',    label: 'Todos los roles' },
  { key: 'abogado',  label: 'Solo abogados' },
  { key: 'contador', label: 'Solo contadores' },
  { key: 'gestor',   label: 'Solo gestores' },
]

const TIPOS = [
  { key: 'texto',    label: 'Texto' },
  { key: 'numero',   label: 'Número' },
  { key: 'url',      label: 'Enlace (URL)' },
  { key: 'opciones', label: 'Lista de opciones' },
  { key: 'checkbox', label: 'Casilla Sí/No' },
]

const CAMPO_NUEVO = { rol: 'todos', etiqueta: '', tipo: 'texto', opciones: '', requerido: false }

// Campos FIJOS del formulario actual (solo referencia — viven en el código
// del RegisterModal y no se editan desde aquí). Mantener sincronizados si el
// formulario base cambia.
const CAMPOS_FIJOS = [
  { etiqueta: 'Nombre y apellido',            rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Nombre de usuario',            rol: 'todos',              requerido: true },
  { etiqueta: 'Cédula',                        rol: 'todos',              requerido: true },
  { etiqueta: 'Celular',                       rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Correo electrónico',            rol: 'todos',              requerido: true },
  { etiqueta: 'Contraseña',                    rol: 'todos',              requerido: true },
  { etiqueta: 'Áreas / especialidades',        rol: 'abogado y contador', requerido: false },
  { etiqueta: 'Experiencia laboral',           rol: 'abogado y contador', requerido: false },
  { etiqueta: 'Tarjeta profesional (archivo)', rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Comunidad que maneja',          rol: 'gestor',             requerido: false },
  { etiqueta: 'Redes sociales',                rol: 'gestor',             requerido: false },
  { etiqueta: 'Foto de perfil (tras verificar el correo)',            rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Cuenta bancaria certificada (tras verificar)',         rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Certificado disciplinario (tras verificar)',           rol: 'abogado y contador', requerido: true },
  { etiqueta: 'Dirección de oficina (tras verificar)',                rol: 'abogado y contador', requerido: false },
  { etiqueta: 'Página web (tras verificar)',                          rol: 'abogado y contador', requerido: false },
]

// Paleta local (misma de la página, en inline para no crear otro módulo CSS).
const INK = '#472f29', CAFE = '#6d3c1b', GOLD = '#c9a84c'
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid rgba(109,60,27,0.25)', borderRadius: 10,
  background: '#fff', color: INK, fontSize: '0.85rem',
}
const btnGold = {
  border: 'none', cursor: 'pointer', borderRadius: 10, padding: '10px 18px',
  background: 'linear-gradient(135deg,#f2d580,#c9a84c 60%,#b8942f)',
  color: '#4a330f', fontWeight: 700, fontSize: '0.8rem',
}
const btnGhost = {
  border: '1px solid rgba(109,60,27,0.3)', cursor: 'pointer', borderRadius: 8,
  padding: '6px 12px', background: '#fff', color: CAFE, fontWeight: 600, fontSize: '0.72rem',
}

export default function CamposRegistro() {
  const [campos, setCampos]   = useState([])
  const [estado, setEstado]   = useState('cargando')  // cargando | listo | error
  const [nuevo, setNuevo]     = useState(CAMPO_NUEVO)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso]     = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setEstado('cargando')
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/registro_campos?select=*&order=orden.asc,created_at.asc`,
        { headers }
      )
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('respuesta inválida')
      setCampos(data)
      setEstado('listo')
    } catch {
      setEstado('error')
    }
  }

  function avisar(msg) {
    setAviso(msg)
    setTimeout(() => setAviso(''), 3500)
  }

  async function crear(e) {
    e.preventDefault()
    if (!nuevo.etiqueta.trim()) { avisar('Escribe la etiqueta del campo.'); return }
    const opciones = nuevo.tipo === 'opciones'
      ? nuevo.opciones.split(',').map(o => o.trim()).filter(Boolean)
      : null
    if (nuevo.tipo === 'opciones' && (!opciones || opciones.length < 2)) {
      avisar('Una lista necesita al menos 2 opciones (sepáralas con comas).')
      return
    }
    setGuardando(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/registro_campos`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          rol: nuevo.rol,
          etiqueta: nuevo.etiqueta.trim(),
          tipo: nuevo.tipo,
          opciones,
          requerido: nuevo.requerido,
          activo: true,
          orden: campos.length,
        }),
      })
      if (!res.ok) throw new Error()
      setNuevo(CAMPO_NUEVO)
      avisar('Campo creado. Ya aparece en el formulario de registro.')
      cargar()
    } catch {
      avisar('No se pudo crear el campo. ¿Está aplicado el SQL de registro_campos?')
    } finally {
      setGuardando(false)
    }
  }

  async function patch(id, cambios) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/registro_campos?id=eq.${id}`, {
      method: 'PATCH', headers, body: JSON.stringify(cambios),
    })
    cargar()
  }

  async function eliminar(id) {
    const headers = await getAuthHeaders()
    await fetch(`${SUPABASE_URL}/rest/v1/registro_campos?id=eq.${id}`, {
      method: 'DELETE', headers,
    })
    cargar()
  }

  async function mover(idx, dir) {
    const a = campos[idx], b = campos[idx + dir]
    if (!a || !b) return
    // intercambio de orden (optimista + persistencia)
    await Promise.all([patch(a.id, { orden: b.orden }), patch(b.id, { orden: a.orden })])
  }

  return (
    <div>
      <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'rgba(71,47,41,0.75)' }}>
        Estos campos aparecen en el formulario de registro de profesionales,
        además de los fijos (nombre, cédula, celular, tarjeta…). Las respuestas
        llegan a la solicitud para que las revises antes de aprobar.
      </p>

      {aviso && (
        <p style={{
          margin: '0 0 14px', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(201,168,76,0.14)', border: '1px solid rgba(201,168,76,0.4)',
          color: '#6d5426', fontSize: '0.8rem', fontWeight: 600,
        }}>
          {aviso}
        </p>
      )}

      {/* ── Crear campo ── */}
      <form onSubmit={crear} style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
        padding: '16px', borderRadius: 14, marginBottom: 22,
        background: '#fdf8ec', border: '1px solid rgba(201,168,76,0.35)',
      }}>
        <div style={{ flex: '2 1 220px' }}>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: CAFE, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Etiqueta del campo
          </label>
          <input style={inputStyle} placeholder="Ej: Número de tarjeta profesional del colegio"
            value={nuevo.etiqueta} onChange={e => setNuevo(n => ({ ...n, etiqueta: e.target.value }))} />
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: CAFE, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Aplica a
          </label>
          <select style={inputStyle} value={nuevo.rol}
            onChange={e => setNuevo(n => ({ ...n, rol: e.target.value }))}>
            {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: CAFE, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Tipo
          </label>
          <select style={inputStyle} value={nuevo.tipo}
            onChange={e => setNuevo(n => ({ ...n, tipo: e.target.value }))}>
            {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        {nuevo.tipo === 'opciones' && (
          <div style={{ flex: '2 1 240px' }}>
            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: CAFE, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Opciones (separadas por comas)
            </label>
            <input style={inputStyle} placeholder="Ej: Bogotá, Medellín, Cali"
              value={nuevo.opciones} onChange={e => setNuevo(n => ({ ...n, opciones: e.target.value }))} />
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.8rem', color: INK, paddingBottom: 9, cursor: 'pointer' }}>
          <input type="checkbox" checked={nuevo.requerido}
            onChange={e => setNuevo(n => ({ ...n, requerido: e.target.checked }))} />
          Obligatorio
        </label>
        <button type="submit" style={{ ...btnGold, opacity: guardando ? 0.6 : 1 }} disabled={guardando}>
          {guardando ? 'Creando…' : '+ Crear campo'}
        </button>
      </form>

      {/* ── Campos fijos del formulario actual (referencia, no editables) ── */}
      <details style={{ marginBottom: 20 }}>
        <summary style={{
          cursor: 'pointer', fontWeight: 700, color: INK, fontSize: '0.9rem',
          padding: '10px 14px', borderRadius: 12,
          border: '1px solid rgba(109,60,27,0.16)', background: '#fff',
          listStylePosition: 'inside',
        }}>
          Campos fijos del formulario ({CAMPOS_FIJOS.length}) · viven en el código, no se editan aquí
        </summary>
        <div style={{ display: 'grid', gap: 6, padding: '10px 4px 0' }}>
          {CAMPOS_FIJOS.map(c => (
            <div key={c.etiqueta} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '8px 14px', borderRadius: 10,
              border: '1px dashed rgba(109,60,27,0.22)', background: 'rgba(0,0,0,0.02)',
            }}>
              <span aria-hidden="true" style={{ color: 'rgba(109,60,27,0.5)' }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <span style={{ fontSize: '0.82rem', color: INK, fontWeight: 600 }}>
                {c.etiqueta}{c.requerido && <span style={{ color: '#a33a2a' }}> *</span>}
              </span>
              <span style={{ fontSize: '0.68rem', color: 'rgba(71,47,41,0.6)', marginLeft: 'auto' }}>
                {c.rol}
              </span>
            </div>
          ))}
        </div>
      </details>

      {/* ── Lista de campos personalizados ── */}
      <h4 style={{ margin: '0 0 10px', color: INK, fontSize: '0.95rem' }}>Campos personalizados</h4>
      {estado === 'cargando' && <p style={{ color: 'rgba(71,47,41,0.6)', fontSize: '0.85rem' }}>Cargando campos…</p>}
      {estado === 'error' && (
        <p style={{ color: '#a33a2a', fontSize: '0.85rem' }}>
          No se pudieron cargar los campos. Verifica que el SQL
          (superadmin-campos-2026-09-04.sql) esté aplicado en Supabase.
        </p>
      )}
      {estado === 'listo' && campos.length === 0 && (
        <p style={{ color: 'rgba(71,47,41,0.65)', fontSize: '0.85rem' }}>
          Aún no has creado campos. Los que crees aquí aparecerán al final del
          formulario de registro.
        </p>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {campos.map((c, idx) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 14px', borderRadius: 12,
            border: '1px solid rgba(109,60,27,0.16)',
            background: c.activo ? '#fff' : 'rgba(0,0,0,0.035)',
            opacity: c.activo ? 1 : 0.72,
          }}>
            {/* Reordenar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" style={{ ...btnGhost, padding: '1px 8px' }} title="Subir"
                onClick={() => mover(idx, -1)} disabled={idx === 0}>▲</button>
              <button type="button" style={{ ...btnGhost, padding: '1px 8px' }} title="Bajar"
                onClick={() => mover(idx, +1)} disabled={idx === campos.length - 1}>▼</button>
            </div>

            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <p style={{ margin: 0, fontWeight: 700, color: INK, fontSize: '0.9rem' }}>
                {c.etiqueta}
                {c.requerido && <span style={{ color: '#a33a2a', marginLeft: 4 }}>*</span>}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: 'rgba(71,47,41,0.65)' }}>
                {TIPOS.find(t => t.key === c.tipo)?.label || c.tipo}
                {' · '}{ROLES.find(r => r.key === c.rol)?.label || c.rol}
                {c.tipo === 'opciones' && Array.isArray(c.opciones) && ` · ${c.opciones.join(' / ')}`}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button type="button" style={btnGhost}
                onClick={() => patch(c.id, { requerido: !c.requerido })}>
                {c.requerido ? 'Hacer opcional' : 'Hacer obligatorio'}
              </button>
              <button type="button" style={btnGhost}
                onClick={() => patch(c.id, { activo: !c.activo })}>
                {c.activo ? 'Desactivar' : 'Activar'}
              </button>
              <button type="button"
                style={{ ...btnGhost, borderColor: 'rgba(163,58,42,0.4)', color: '#a33a2a' }}
                onClick={() => eliminar(c.id)}>
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Vista previa ── */}
      {campos.some(c => c.activo) && (
        <div style={{ marginTop: 26 }}>
          <h4 style={{ margin: '0 0 10px', color: INK, fontSize: '0.95rem' }}>Vista previa en el registro</h4>
          <div style={{
            maxWidth: 420, padding: '18px', borderRadius: 14,
            border: `1px dashed ${GOLD}`, background: '#fffdf6', display: 'grid', gap: 12,
          }}>
            {campos.filter(c => c.activo).map(c => (
              <div key={c.id}>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: CAFE, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {c.etiqueta}{c.requerido && ' *'}
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.55 }}>
                    {c.rol !== 'todos' && `  (${ROLES.find(r => r.key === c.rol)?.label})`}
                  </span>
                </label>
                {c.tipo === 'checkbox' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: INK }}>
                    <input type="checkbox" disabled /> Sí
                  </label>
                ) : c.tipo === 'opciones' ? (
                  <select style={inputStyle} disabled>
                    <option>Selecciona…</option>
                    {(c.opciones || []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} disabled
                    placeholder={c.tipo === 'numero' ? '0' : c.tipo === 'url' ? 'https://…' : 'Texto'} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
