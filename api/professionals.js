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
// Para leer chat_ratings sin depender de una policy pública: si está la
// service-role la usamos (salta RLS); si no, caemos a la anon.
const SUPABASE_RATINGS_KEY =
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

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
              apikey: SUPABASE_RATINGS_KEY,
              Authorization: `Bearer ${SUPABASE_RATINGS_KEY}`,
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

    // Cache en el CDN de Vercel: 5 min fresco + 10 min sirviendo stale
    // mientras revalida en background. La lista cambia solo cuando el admin
    // aprueba/revoca un profesional → 5 min de desfase es irrelevante.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(lista)
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'Error al cargar la lista.' })
  }
}
