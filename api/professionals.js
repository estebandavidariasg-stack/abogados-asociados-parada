/* ────────────────────────────────────────────────────────────────────────
   Lista pública de profesionales aprobados — endpoint CACHEADO.

   Por qué existe: el home (`LawyersSection`) leía esta lista pegando a
   Supabase en CADA carga. Con miles de visitantes simultáneos eso son miles
   de queries idénticas a Postgres. Aquí la servimos desde una función
   serverless con `Cache-Control`, de modo que el CDN de Vercel responde la
   gran mayoría de las cargas desde el borde y Postgres recibe ~1 query cada
   pocos minutos en lugar de una por visitante.

   Seguridad: SOLO columnas públicas (igual que la whitelist del front). El
   anónimo NO debe recibir email, teléfono, dirección, etc. La enforce aquí
   server-side, no dependiendo de que el cliente pida solo lo público.

   Variables de entorno: SUPABASE_URL (o VITE_SUPABASE_URL) y la anon key
   (SUPABASE_ANON_KEY o VITE_SUPABASE_ANON_KEY) — las mismas que ya usa el
   front; estos datos ya eran accesibles con la anon key vía RLS.
──────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
// Clave para lo que la anon NO puede leer: chat_ratings (sin policy pública) y
// las columnas de documentos de `profiles` (la base tiene GRANT por columna —
// con la anon esa lectura devuelve 42501). Si no está la service-role caemos a
// la anon y cada uso degrada solo (sin calificaciones / sin documentos).
const SUPABASE_PRIV_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY

// Debe coincidir con PUBLIC_COLS de LawyersSection.jsx. Si agregas una
// columna pública nueva, agrégala en AMBOS lugares.
const PUBLIC_COLS = [
  'id', 'nombre', 'apellido', 'area_derecho',
  'ciudad', 'departamento',
  'foto_url', 'video_url', 'descripcion',
  'universidad', 'experiencia', 'rol',
  'instagram', 'linkedin', 'facebook', 'twitter', 'whatsapp', 'tiktok',
].join(',')

const ROLES_VALIDOS = new Set(['abogado', 'contador'])

/* ── Documentos de confianza públicos ────────────────────────────────────
   Los que un cliente puede consultar antes de contratar: la licencia, los
   antecedentes disciplinarios y el modelo de contrato.

   NO incluye `certificado_bancario_url`: ese documento lleva el número de
   cuenta del profesional. Lo sube para cobrar, no para publicarlo, y
   exponerlo a visitantes anónimos sería una fuga de dato financiero ajeno
   (Ley 1581). El superadmin sí lo revisa, desde el panel de admin.

   Los paths tampoco viajan al navegador: el bucket es privado y aquí se
   firma una URL temporal por documento, server-side. */
const DOCS_PUBLICOS = [
  { col: 'tarjeta_archivo_url',           bucket: 'tarjetas-profesionales', label: 'Tarjeta profesional' },
  { col: 'certificado_disciplinario_url', bucket: 'tarjetas-profesionales', label: 'Certificado disciplinario' },
  { col: 'modelo_contrato_path',          bucket: 'contratos',              label: 'Modelo contractual' },
]

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Las URLs firmadas duran 1 h; el CDN no debe cachearlas ni servirlas rancias.
const FIRMA_TTL = 3600

/* GET ?docs=<profileId> → [{label, url, ext}] del profesional APROBADO.
   Responde [] (nunca un error) si no hay documentos o falta la service-role:
   el modal simplemente no pinta la sección. */
async function handleDocs(req, res, id) {
  res.setHeader('Cache-Control', 'no-store')
  if (!ES_UUID.test(id)) return res.status(400).json({ error: 'Id inválido.' })
  try {
    const cols = DOCS_PUBLICOS.map(d => d.col).join(',')
    // Va con la clave privilegiada porque la anon no tiene GRANT sobre estas
    // columnas. Los filtros hacen de policy: `aprobado=eq.true` + rol
    // profesional, para no filtrar documentos de cuentas pendientes,
    // rechazadas o de gestores, y `select` acotado a los tres documentos.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&aprobado=eq.true` +
      `&rol=in.(abogado,contador)&select=${cols}`,
      { headers: { apikey: SUPABASE_PRIV_KEY, Authorization: `Bearer ${SUPABASE_PRIV_KEY}` } }
    )
    if (!r.ok) return res.status(200).json([])
    const [fila] = await r.json()
    if (!fila) return res.status(200).json([])

    // Firma en LOTE, una petición por bucket (endpoint `sign/<bucket>` con
    // `paths[]`) en vez de una por archivo. Con 3 documentos baja de 3 idas y
    // vueltas a 2, y es lo que hacía que la sección tardara en aparecer.
    const porBucket = new Map()   // bucket → [{path, label, ext}]
    const listos = []             // los que ya son URL completa (perfiles viejos)
    for (const { col, bucket, label } of DOCS_PUBLICOS) {
      const path = fila[col]
      if (!path) continue
      const ext = path.split('.').pop()
      if (/^https?:\/\//.test(path)) { listos.push({ label, url: path, ext }); continue }
      if (!porBucket.has(bucket)) porBucket.set(bucket, [])
      porBucket.get(bucket).push({ path, label, ext })
    }

    const lotes = await Promise.all([...porBucket].map(async ([bucket, items]) => {
      const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PRIV_KEY,
          Authorization: `Bearer ${SUPABASE_PRIV_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: FIRMA_TTL, paths: items.map(i => i.path) }),
      })
      if (!s.ok) return []
      const firmas = await s.json()
      if (!Array.isArray(firmas)) return []
      // La respuesta trae `path` por elemento; lo casamos en vez de fiarnos
      // del orden, y descartamos el que venga con error.
      return items.map(item => {
        const f = firmas.find(x => x && !x.error && (x.path === item.path || x.path === `/${item.path}`))
        return f?.signedURL
          ? { label: item.label, url: `${SUPABASE_URL}/storage/v1${f.signedURL}`, ext: item.ext }
          : null
      }).filter(Boolean)
    }))

    // Orden estable: el de DOCS_PUBLICOS, no el de llegada de los lotes.
    const todos = [...listos, ...lotes.flat()]
    const orden = DOCS_PUBLICOS.map(d => d.label)
    todos.sort((a, b) => orden.indexOf(a.label) - orden.indexOf(b.label))
    return res.status(200).json(todos)
  } catch {
    return res.status(200).json([])
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  if (req.query.docs) return handleDocs(req, res, String(req.query.docs))

  // Solo 'abogado' | 'contador' — evita que se inyecte cualquier rol.
  const rol = String(req.query.rol || 'abogado').toLowerCase()
  if (!ROLES_VALIDOS.has(rol)) {
    return res.status(400).json({ error: 'Rol inválido.' })
  }

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/profiles?aprobado=eq.true&rol=eq.${rol}` +
      `&select=${PUBLIC_COLS}`
    const upstream = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    if (!upstream.ok) {
      // No cachear errores. El front cae a lista vacía.
      res.setHeader('Cache-Control', 'no-store')
      return res.status(502).json({ error: 'No se pudo cargar la lista.' })
    }

    const data = await upstream.json()
    const lista = Array.isArray(data) ? data : []

    // Agregar la calificación (promedio + total) de cada profesional en una
    // sola query, en vez de que cada tarjeta del home dispare la suya (N+1).
    const ids = lista.map(p => p.id).filter(Boolean)
    if (ids.length) {
      try {
        const inList = ids.map(encodeURIComponent).join(',')
        const rRes = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_ratings?lawyer_id=in.(${inList})&select=lawyer_id,rating`,
          {
            headers: {
              apikey: SUPABASE_PRIV_KEY,
              Authorization: `Bearer ${SUPABASE_PRIV_KEY}`,
            },
          }
        )
        if (rRes.ok) {
          const ratings = await rRes.json()
          const acc = {} // lawyer_id → { sum, total }
          for (const r of (Array.isArray(ratings) ? ratings : [])) {
            const v = Number(r.rating)
            if (!r.lawyer_id || !Number.isFinite(v)) continue
            const a = acc[r.lawyer_id] || (acc[r.lawyer_id] = { sum: 0, total: 0 })
            a.sum += v; a.total += 1
          }
          for (const p of lista) {
            const a = acc[p.id]
            p.rating_promedio = a ? parseFloat((a.sum / a.total).toFixed(1)) : null
            p.rating_total    = a ? a.total : 0
          }
        }
      } catch { /* si falla, las tarjetas caen a su propia query */ }
    }

    // Cache en el CDN de Vercel: 1 min fresco + 1 min sirviendo stale mientras
    // revalida. Antes era 5 + 10: un profesional recién aprobado podía tardar
    // hasta 15 min en salir en el home. Ahora el tope es 2 min. (El propio
    // superadmin no pasa por aquí: LawyersSection le lee directo de Supabase.)
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60')
    return res.status(200).json(lista)
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'Error al cargar la lista.' })
  }
}
