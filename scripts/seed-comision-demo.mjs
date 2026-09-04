// Crea comisiones de DEMO para @gestor_demo con el desglose transparente
// (total_consulta / pct_empresa / pct_gestor / monto_empresa), para ver cómo
// se muestra en el panel del gestor → Cobros.
//   Uso: node scripts/seed-comision-demo.mjs
// Requiere VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env.local.
import fs from 'node:fs'

const env = {}
// Carga .env y luego .env.local (este último tiene prioridad si repite claves).
for (const file of ['.env', '.env.local']) {
  let txt
  try { txt = fs.readFileSync(file, 'utf8') } catch { continue }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const URL = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1) }

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// 1. Buscar el gestor de demo.
const gRes = await fetch(`${URL}/rest/v1/profiles?username=eq.gestor_demo&select=id,username&limit=1`, { headers: h })
const g = await gRes.json()
const gid = Array.isArray(g) && g[0]?.id
if (!gid) { console.error('No se encontró @gestor_demo:', JSON.stringify(g)); process.exit(1) }
console.log('gestor_demo id:', gid)

const ahora = new Date()
const menos = (min) => new Date(ahora.getTime() - min * 60000).toISOString()

// 2. Dos comisiones con desglose: Total $200.000 · Empresa 10% ($20.000) · Gestor 5% ($10.000).
const base = {
  gestor_id: gid, codigo: 'AAP-4FZB4Y', casos_exitosos: 1, monto: 10000,
  nota: 'Comisión por consulta aprobada',
  total_consulta: 200000, pct_empresa: 10, pct_gestor: 5, monto_empresa: 20000,
  created_by: gid, solicitado_at: null, pagado_at: null,
}
const filas = [
  { ...base, estado: 'pendiente' },
  { ...base, estado: 'pagado', solicitado_at: menos(120), pagado_at: menos(30) },
]

const res = await fetch(`${URL}/rest/v1/gestor_cobros`, {
  method: 'POST', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(filas),
})
const out = await res.json()
console.log('status:', res.status)
console.log(JSON.stringify(out, null, 2))
if (res.ok) console.log('\nListo. Entra al panel del gestor → Cobros para ver el desglose.')
