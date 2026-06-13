/* ────────────────────────────────────────────────────────────────────────
   Videos del carrusel del home — endpoint CACHEADO.

   Igual que /api/professionals: el home leía `videos_carrusel` en cada carga.
   Lo servimos desde el CDN de Vercel. El admin edita pocas veces; tras editar
   el front refresca directo contra Supabase (no este endpoint) para ver su
   cambio al instante — ver `fetchVideos(true)` en VideoCarousel.jsx.
──────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/videos_carrusel?select=*&order=orden.asc&activo=eq.true`
    const upstream = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(502).json({ error: 'No se pudo cargar el carrusel.' })
    }

    const data = await upstream.json()
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(Array.isArray(data) ? data : [])
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'Error al cargar el carrusel.' })
  }
}
