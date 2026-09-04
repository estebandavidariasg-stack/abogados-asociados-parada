/* ────────────────────────────────────────────────────────────────────────
   Sembrar un GESTOR de PRUEBA (aprobado) para ingresar rápido.

   Alternativa 100% fiable al bloque de auth.users del SQL: usa la Admin API
   (igual que seed-test-professionals.mjs), así el login funciona seguro en
   cualquier versión de Supabase/GoTrue.

   Uso:
     node scripts/seed-test-gestor.mjs          # crea / actualiza
     node scripts/seed-test-gestor.mjs --clean  # borra el gestor de prueba

   Requiere en .env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
──────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(ROOT, file), 'utf8')
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    } catch { /* puede no existir */ }
  }
}
loadEnv()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ Faltan VITE_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env')
  process.exit(1)
}

const GESTOR = {
  email:    'gestor.demo@abogadosparada.com',
  password: 'Gestor1234!',
  username: 'gestor_demo',
  cedula:   '1010101010',
}

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

async function findProfileIdByEmail(email) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`,
    { headers: adminHeaders }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null
}

async function createAuthUser(p) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email: p.email, password: p.password, email_confirm: true,
      user_metadata: { username: p.username },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok && data?.id) return data.id
  if (res.status === 422 || /already/i.test(data?.msg || data?.error_description || data?.error || '')) {
    const id = await findProfileIdByEmail(p.email)
    if (id) return id
  }
  throw new Error(`auth create falló (${res.status}): ${JSON.stringify(data)}`)
}

async function seed() {
  console.log(`\n🌱 Sembrando gestor de prueba en ${SUPABASE_URL}\n`)
  const id = await createAuthUser(GESTOR)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id, rol: 'gestor', username: GESTOR.username,
      email: GESTOR.email, cedula: GESTOR.cedula,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`upsert profile falló (${res.status}): ${JSON.stringify(err)}`)
  }
  console.log(`  ✓ gestor  ${GESTOR.username}  ·  ${GESTOR.email}`)
  console.log(`\n  Contraseña: ${GESTOR.password}`)
  console.log('\n  ⚠️  Queda PENDIENTE de aprobación. Apruébalo desde el panel de')
  console.log('     Admin → Gestores, o corre este SQL:')
  console.log("       alter table public.profiles disable trigger user;")
  console.log(`       update public.profiles set aprobado = true where email = '${GESTOR.email}';`)
  console.log("       alter table public.profiles enable trigger user;\n")
}

async function clean() {
  console.log(`\n🧹 Borrando gestor de prueba de ${SUPABASE_URL}\n`)
  const id = await findProfileIdByEmail(GESTOR.email)
  if (!id) { console.log('  – no existe'); return }
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'DELETE', headers: adminHeaders })
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders })
  console.log(`  ✓ borrado ${GESTOR.email}\n`)
}

const modo = process.argv.includes('--clean') ? clean : seed
modo().catch((e) => { console.error(e); process.exit(1) })
