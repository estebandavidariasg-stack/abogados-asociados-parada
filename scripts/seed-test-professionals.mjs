/* ────────────────────────────────────────────────────────────────────────
   Sembrar profesionales de PRUEBA (5 abogados + 3 contadores) en Supabase.

   Qué hace:
     1. Crea cada usuario en auth.users vía Admin API (email_confirm:true → no
        envía correos ni necesita OTP). El trigger de la BD crea la fila base
        en `profiles`.
     2. Hace UPSERT en `profiles` (service-role, salta RLS) para fijar rol,
        aprobado:true, area_derecho, ciudad, departamento, descripción, etc.,
        de modo que aparezcan YA en la página y puedan iniciar sesión.

   Es IDEMPOTENTE: si un email ya existe, reutiliza su id y solo actualiza el
   perfil. Se puede volver a correr sin duplicar.

   Uso:
     node scripts/seed-test-professionals.mjs          # crea / actualiza
     node scripts/seed-test-professionals.mjs --clean  # borra los de prueba

   Requiere en .env (ya los tienes):
     VITE_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY

   ⚠️ Escribe en tu Supabase REAL (no hay proyecto de staging aparte). Los
   emails llevan el dominio @aap-prueba.com y username con prefijo test_ para
   que sean fáciles de identificar y borrar con --clean.
──────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── Cargar .env sin dependencias (parser mínimo) ──────────────────────────
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(ROOT, file), 'utf8')
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const key = m[1]
        let val = m[2].trim().replace(/^["']|["']$/g, '')
        if (process.env[key] === undefined) process.env[key] = val
      }
    } catch { /* el archivo puede no existir */ }
  }
}
loadEnv()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ Faltan VITE_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env')
  process.exit(1)
}

const PASSWORD = 'Prueba1234!' // contraseña común para todos los de prueba

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

// ── Datos de prueba ───────────────────────────────────────────────────────
// area_derecho es una lista separada por comas. Para CONTADORES significa
// "especialidades contables" (misma columna, sentido según rol).
const ABOGADOS = [
  { nombre: 'Carlos',     apellido: 'Restrepo', ciudad: 'Bogotá D.C.',   departamento: 'Cundinamarca',    experiencia: '5 - 10 años',    universidad: 'Universidad Nacional de Colombia',      area_derecho: 'Derecho Penal, Derecho Constitucional',                 descripcion: 'Abogado penalista con experiencia en litigio y defensa en procesos de alto impacto.' },
  { nombre: 'Ana María',  apellido: 'Gómez',    ciudad: 'Medellín',      departamento: 'Antioquia',       experiencia: '3 - 5 años',     universidad: 'Universidad de Antioquia',              area_derecho: 'Derecho de Familia, Derecho Civil',                     descripcion: 'Especialista en derecho de familia: divorcios, custodias, sucesiones y conciliación.' },
  { nombre: 'Juan David', apellido: 'Martínez', ciudad: 'Cali',          departamento: 'Valle del Cauca', experiencia: '10 - 15 años',   universidad: 'Universidad del Valle',                 area_derecho: 'Derecho Laboral, Derecho Administrativo',               descripcion: 'Asesoría laboral a empresas y trabajadores; contencioso administrativo.' },
  { nombre: 'Laura',      apellido: 'Herrera',  ciudad: 'Barranquilla',  departamento: 'Atlántico',       experiencia: '1 - 3 años',     universidad: 'Universidad del Norte',                 area_derecho: 'Derecho Comercial, Derecho Corporativo, Derecho Tributario', descripcion: 'Derecho comercial y corporativo: constitución de sociedades, contratos y compliance.' },
  { nombre: 'Andrés',     apellido: 'Parada',   ciudad: 'Bucaramanga',   departamento: 'Santander',       experiencia: 'Más de 15 años', universidad: 'Universidad Industrial de Santander',   area_derecho: 'Derecho Migratorio, Derecho Internacional',             descripcion: 'Derecho migratorio e internacional: visas, nacionalidad y trámites ante consulados.' },
]

const CONTADORES = [
  { nombre: 'Sandra', apellido: 'López',   ciudad: 'Bogotá D.C.', departamento: 'Cundinamarca',    experiencia: '5 - 10 años', universidad: 'Universidad Nacional de Colombia', area_derecho: 'Auditoría, Tributaria',        descripcion: 'Contadora pública con enfoque en auditoría financiera y planeación tributaria.' },
  { nombre: 'Diego',  apellido: 'Ramírez', ciudad: 'Medellín',    departamento: 'Antioquia',       experiencia: '3 - 5 años',  universidad: 'Universidad de Antioquia',         area_derecho: 'NIIF, Costos',                 descripcion: 'Implementación de NIIF y estructuras de costos para pymes.' },
  { nombre: 'Paula',  apellido: 'Ortiz',   ciudad: 'Cali',        departamento: 'Valle del Cauca', experiencia: '1 - 3 años',  universidad: 'Universidad del Valle',            area_derecho: 'Nómina, Tributaria',           descripcion: 'Gestión de nómina, seguridad social y obligaciones tributarias.' },
]

function slug(s) {
  // NFD + quitar marcas diacríticas combinantes (U+0300–U+036F) → sin tildes/ñ.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

// Construye el registro completo con email/username derivados del nombre.
function build(rol, list) {
  return list.map((p, i) => {
    const base = `${slug(p.nombre)}.${slug(p.apellido)}`
    return {
      ...p,
      rol,
      email: `${base}@aap-prueba.com`,
      username: `test_${rol}_${i + 1}_${slug(p.nombre)}`,
      telefono: `+57 30${rol === 'abogado' ? '1' : '2'} ${100 + i}0 ${1000 + i}`,
    }
  })
}

const PROFESIONALES = [...build('abogado', ABOGADOS), ...build('contador', CONTADORES)]

// ── Helpers Admin API + REST ──────────────────────────────────────────────
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
      email: p.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { nombre: p.nombre, apellido: p.apellido, username: p.username, telefono: p.telefono },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok && data?.id) return data.id
  // Ya existe → recuperar su id por el perfil (idempotencia).
  if (res.status === 422 || /already/i.test(data?.msg || data?.error_description || data?.error || '')) {
    const id = await findProfileIdByEmail(p.email)
    if (id) return id
  }
  throw new Error(`auth create falló (${res.status}): ${JSON.stringify(data)}`)
}

async function upsertProfile(id, p) {
  // Ojo: NO enviamos `aprobado`. Un trigger de la BD bloquea cambiar el estado
  // de aprobación salvo que el llamante sea superadmin (auth.uid()), y la
  // service-role no lo cumple. Se aprueban aparte (SQL o panel de admin).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id,
      nombre: p.nombre, apellido: p.apellido, username: p.username,
      telefono: p.telefono, email: p.email,
      rol: p.rol,
      area_derecho: p.area_derecho,
      ciudad: p.ciudad, departamento: p.departamento,
      experiencia: p.experiencia, universidad: p.universidad,
      descripcion: p.descripcion,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`upsert profile falló (${res.status}): ${JSON.stringify(err)}`)
  }
}

async function seed() {
  console.log(`\n🌱 Sembrando ${PROFESIONALES.length} profesionales de prueba en ${SUPABASE_URL}\n`)
  for (const p of PROFESIONALES) {
    try {
      const id = await createAuthUser(p)
      await upsertProfile(id, p)
      console.log(`  ✓ ${p.rol.padEnd(8)} ${p.nombre} ${p.apellido}  ·  ${p.email}`)
    } catch (err) {
      console.error(`  ✗ ${p.email}: ${err.message}`)
    }
  }
  console.log(`\n✅ Perfiles creados/actualizados. Contraseña para todos: ${PASSWORD}`)
  console.log('   (email_confirm activo → pueden iniciar sesión de una).')
  console.log('\n   Quedan como PENDIENTES. Para aprobarlos todos y que salgan en la')
  console.log('   página, corre este SQL en Supabase → SQL Editor:\n')
  console.log('     alter table public.profiles disable trigger user;')
  console.log("     update public.profiles set aprobado = true where email like '%@aap-prueba.com';")
  console.log('     alter table public.profiles enable trigger user;\n')
  console.log('   (o apruébalos uno a uno desde el panel de Admin → Solicitudes)')
  console.log('   Para borrarlos: node scripts/seed-test-professionals.mjs --clean\n')
}

async function clean() {
  console.log(`\n🧹 Borrando profesionales de prueba de ${SUPABASE_URL}\n`)
  for (const p of PROFESIONALES) {
    try {
      const id = await findProfileIdByEmail(p.email)
      if (!id) { console.log(`  – ${p.email} (no existe)`); continue }
      // Borra la fila de profiles y el usuario de auth (por si el FK no cascada).
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'DELETE', headers: adminHeaders })
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders })
      console.log(`  ✓ borrado ${p.email}`)
    } catch (err) {
      console.error(`  ✗ ${p.email}: ${err.message}`)
    }
  }
  console.log('\n✅ Limpieza terminada.\n')
}

const modo = process.argv.includes('--clean') ? clean : seed
modo().catch((e) => { console.error(e); process.exit(1) })
