import { useEffect, useRef, useState } from 'react'
import { getAuthHeaders } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/* ─────────────────────────────────────────────────────────────────────────
   Documentos de confianza del profesional (perfil abogado/contador).

   Los clientes los consultan SOLO-VER dentro del chat (fila de confianza) y
   el certificado bancario es el que respalda el cobro de asesoría. Los
   registros nuevos los suben en el modal post-OTP; esta sección permite a los
   profesionales existentes completarlos (y corregirlos) desde su perfil.

   Campos: cédula, dirección de oficina, página web (texto) + certificado
   bancario y certificado disciplinario (archivos, bucket privado
   tarjetas-profesionales con RLS auth.uid() = carpeta).
───────────────────────────────────────────────────────────────────────── */

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

export default function DocumentosConfianza({ userId }) {
  const [cedula, setCedula]       = useState('')
  const [direccion, setDireccion] = useState('')
  const [paginaWeb, setPaginaWeb] = useState('')
  const [certBanc, setCertBanc]   = useState(null)   // path guardado
  const [certDisc, setCertDisc]   = useState(null)
  const [modelo, setModelo]       = useState(null)   // modelo contractual (PDF único)
  const [cargando, setCargando]   = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo]   = useState('')     // 'banc' | 'disc' | ''
  const [msg, setMsg]             = useState('')
  const [err, setErr]             = useState('')
  const bancRef = useRef(null)
  const discRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    let cancel = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}` +
          `&select=cedula,direccion_oficina,pagina_web,certificado_bancario_url,certificado_disciplinario_url,modelo_contrato_path&limit=1`,
          { headers }
        )
        const rows = await res.json()
        const p = Array.isArray(rows) ? rows[0] : null
        if (cancel || !p) return
        setCedula(p.cedula || '')
        setDireccion(p.direccion_oficina || '')
        setPaginaWeb(p.pagina_web || '')
        setCertBanc(p.certificado_bancario_url || null)
        setCertDisc(p.certificado_disciplinario_url || null)
        setModelo(p.modelo_contrato_path || null)
      } catch { /* la sección queda editable en blanco */ }
      finally { if (!cancel) setCargando(false) }
    })()
    return () => { cancel = true }
  }, [userId])

  async function patch(campos) {
    const headers = await getAuthHeaders()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(campos),
    })
    if (!res.ok) throw new Error('No se pudo guardar')
  }

  async function subirDoc(e, tipo) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ALLOWED.includes(file.type)) { setErr('Formato no permitido. Usa PDF, PNG, JPG o WEBP.'); return }
    if (file.size / (1024 * 1024) > 10) { setErr('El archivo no puede superar 10 MB.'); return }
    setErr(''); setMsg(''); setSubiendo(tipo)
    try {
      const ext  = file.name.split('.').pop().toLowerCase()
      const path = tipo === 'banc'
        ? `${userId}/certificados/certificado.${ext}`
        : `${userId}/certificado-disciplinario.${ext}`
      const headers = await getAuthHeaders()
      const up = await fetch(
        `${SUPABASE_URL}/storage/v1/object/tarjetas-profesionales/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': file.type, 'x-upsert': 'true' }, body: file }
      )
      if (!up.ok) throw new Error('upload')
      await patch(tipo === 'banc'
        ? { certificado_bancario_url: path }
        : { certificado_disciplinario_url: path })
      if (tipo === 'banc') setCertBanc(path); else setCertDisc(path)
      setMsg('Documento guardado. Los clientes ya pueden consultarlo en el chat.')
    } catch {
      setErr('No se pudo subir el documento. Intenta de nuevo.')
    } finally {
      setSubiendo('')
    }
  }

  // Modelo contractual: UN solo PDF, disponible en todos los chats para
  // firmarlo y enviarlo al cliente (bucket contratos, carpeta del dueño).
  const modeloRef = useRef(null)
  async function subirModelo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
    if (!esPdf) { setErr('El modelo contractual debe ser un PDF.'); return }
    if (file.size / (1024 * 1024) > 10) { setErr('El archivo no puede superar 10 MB.'); return }
    setErr(''); setMsg(''); setSubiendo('modelo')
    try {
      const path = `${userId}/modelo-contractual.pdf`
      const headers = await getAuthHeaders()
      const up = await fetch(
        `${SUPABASE_URL}/storage/v1/object/contratos/${path}`,
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: file }
      )
      if (!up.ok) throw new Error('upload')
      await patch({ modelo_contrato_path: path })
      setModelo(path)
      setMsg('Modelo contractual guardado. Aparecerá en todos tus chats al enviar a firma.')
    } catch {
      setErr('No se pudo subir el modelo. Intenta de nuevo.')
    } finally {
      setSubiendo('')
    }
  }

  async function guardarTexto() {
    if (guardando) return
    const ced = cedula.replace(/\D/g, '')
    if (ced && !/^\d{6,12}$/.test(ced)) { setErr('La cédula debe tener entre 6 y 12 dígitos.'); return }
    setGuardando(true); setErr(''); setMsg('')
    try {
      await patch({
        cedula: ced || null,
        direccion_oficina: direccion.trim() || null,
        pagina_web: paginaWeb.trim() || null,
      })
      setMsg('Datos guardados.')
    } catch {
      setErr('No se pudieron guardar los datos. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const S = {
    wrap: {
      marginTop: 18, padding: '16px 18px', borderRadius: 16,
      border: '1px solid rgba(109,60,27,0.15)', background: 'rgba(255,255,255,0.55)',
    },
    titulo: { margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#6d3c1b' },
    sub: { margin: '4px 0 14px', fontSize: '0.76rem', color: 'rgba(109,60,27,0.65)', lineHeight: 1.5 },
    label: { display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#6d3c1b', letterSpacing: '0.04em', marginBottom: 4 },
    input: {
      width: '100%', boxSizing: 'border-box', borderRadius: 10,
      border: '1px solid rgba(109,60,27,0.25)', padding: '9px 12px',
      fontSize: '0.84rem', fontFamily: 'inherit', background: '#fff',
    },
    field: { marginBottom: 12 },
    docBtn: {
      width: '100%', textAlign: 'left', background: '#fff',
      border: '1px dashed rgba(109,60,27,0.35)', borderRadius: 10,
      padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600,
      color: '#6d3c1b', cursor: 'pointer',
    },
    guardar: {
      marginTop: 4, background: 'linear-gradient(135deg,#f2d580,#c9a84c 55%,#9a7a2c)',
      color: '#5a3d12', border: 'none', borderRadius: 10, padding: '10px 18px',
      fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
    },
  }

  return (
    <div style={S.wrap}>
      <h4 style={S.titulo}>Documentos de confianza</h4>
      <p style={S.sub}>
        Los clientes pueden consultarlos (solo lectura) dentro del chat para
        confiar en ti. El certificado bancario respalda el cobro de tus asesorías.
      </p>

      {cargando ? (
        <p style={{ fontSize: '0.8rem', color: 'rgba(109,60,27,0.6)' }}>Cargando…</p>
      ) : (
        <>
          <div style={S.field}>
            <label style={S.label}>Cédula</label>
            <input style={S.input} type="text" inputMode="numeric" maxLength={12}
              value={cedula}
              onChange={e => { setCedula(e.target.value.replace(/\D/g, '')); setErr('') }}
              placeholder="Número de cédula" />
          </div>
          <div style={S.field}>
            <label style={S.label}>Dirección de oficina (opcional)</label>
            <input style={S.input} type="text" value={direccion}
              onChange={e => setDireccion(e.target.value)}
              placeholder="Cra 7 # 12-34, oficina 501, Bogotá" />
          </div>
          <div style={S.field}>
            <label style={S.label}>Página web (opcional)</label>
            <input style={S.input} type="url" value={paginaWeb}
              onChange={e => setPaginaWeb(e.target.value)}
              placeholder="https://tusitio.com" />
          </div>

          <div style={S.field}>
            <label style={S.label}>Cuenta bancaria certificada</label>
            <button type="button" style={S.docBtn} disabled={subiendo === 'banc'}
              onClick={() => bancRef.current?.click()}>
              {subiendo === 'banc' ? 'Subiendo…'
                : certBanc ? '✓ Certificado bancario cargado — cambiar'
                : 'Subir certificado bancario (PDF o imagen)'}
            </button>
            <input ref={bancRef} type="file" accept={ALLOWED.join(',')}
              style={{ display: 'none' }} onChange={e => subirDoc(e, 'banc')} />
          </div>

          <div style={S.field}>
            <label style={S.label}>Certificado disciplinario</label>
            <button type="button" style={S.docBtn} disabled={subiendo === 'disc'}
              onClick={() => discRef.current?.click()}>
              {subiendo === 'disc' ? 'Subiendo…'
                : certDisc ? '✓ Certificado disciplinario cargado — cambiar'
                : 'Subir certificado disciplinario (PDF o imagen)'}
            </button>
            <input ref={discRef} type="file" accept={ALLOWED.join(',')}
              style={{ display: 'none' }} onChange={e => subirDoc(e, 'disc')} />
          </div>

          <div style={S.field}>
            <label style={S.label}>Modelo contractual (PDF único)</label>
            <button type="button" style={S.docBtn} disabled={subiendo === 'modelo'}
              onClick={() => modeloRef.current?.click()}>
              {subiendo === 'modelo' ? 'Subiendo…'
                : modelo ? '✓ Modelo contractual cargado — cambiar'
                : 'Subir modelo contractual (PDF)'}
            </button>
            <input ref={modeloRef} type="file" accept=".pdf,application/pdf"
              style={{ display: 'none' }} onChange={subirModelo} />
            <span style={{ display: 'block', marginTop: 4, fontSize: '0.68rem', color: 'rgba(109,60,27,0.55)' }}>
              Es uno solo y aparece en todos tus chats: lo firmas ahí mismo y se lo envías al cliente.
            </span>
          </div>

          {err && <p style={{ margin: '6px 0', color: '#8f2f22', fontSize: '0.78rem' }}>{err}</p>}
          {msg && <p style={{ margin: '6px 0', color: '#2f855a', fontSize: '0.78rem' }}>{msg}</p>}

          <button type="button" style={S.guardar} disabled={guardando} onClick={guardarTexto}>
            {guardando ? 'Guardando…' : 'Guardar datos'}
          </button>
        </>
      )}
    </div>
  )
}
