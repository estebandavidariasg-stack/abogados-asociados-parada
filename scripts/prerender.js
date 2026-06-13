/**
 * Pre-rendering estático del homepage.
 *
 * Se ejecuta DESPUÉS de `vite build` y sobrescribe dist/index.html con el HTML
 * completamente renderizado por React (incluye contenido cargado desde Supabase).
 * Googlebot recibe el HTML listo sin necesidad de ejecutar JavaScript.
 *
 * En caso de fallo el script termina con exit 0 para no romper el deploy:
 * Vercel sirve el SPA normal como fallback.
 */

import { preview } from 'vite'
import puppeteer from 'puppeteer'
import { writeFileSync, readFileSync } from 'fs'

const PORT = 4174   // Puerto separado del dev (5173) y preview por defecto (4173)
const URL  = `http://127.0.0.1:${PORT}/`

async function run() {
  // ── 1. Levantar el servidor Vite preview sobre dist/ ─────────────────────
  console.log('[prerender] iniciando servidor preview...')
  const server = await preview({
    preview: { port: PORT, host: '127.0.0.1', strictPort: true },
    logLevel: 'silent',
  })

  let browser
  try {
    // ── 2. Lanzar Chromium ─────────────────────────────────────────────────
    console.log('[prerender] lanzando Chromium...')
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',   // evita OOM en contenedores con /dev/shm limitado
      ],
    })

    const page = await browser.newPage()

    // Silenciar errores de la app (Supabase puede fallar si env vars no están
    // disponibles en el entorno de build local sin .env).
    page.on('pageerror', () => {})
    page.on('requestfailed', () => {})

    // ── 3. Navegar y esperar renderizado completo ──────────────────────────
    console.log(`[prerender] navegando a ${URL}...`)
    await page.goto(URL, {
      waitUntil: 'networkidle2',   // espera a que cesen las llamadas a Supabase
      timeout: 30_000,
    })

    // Confirmación adicional: esperar al H1 del IntroSection
    await page.waitForSelector('#intro-heading', { timeout: 8_000 }).catch(() => {
      console.warn('[prerender] #intro-heading no encontrado — usando DOM tal cual')
    })

    // ── 4. Capturar el HTML renderizado ────────────────────────────────────
    const html = await page.evaluate(
      () => '<!DOCTYPE html>' + document.documentElement.outerHTML
    )

    // ── 5. Sobreescribir dist/index.html ───────────────────────────────────
    writeFileSync('dist/index.html', html, 'utf-8')
    console.log('[prerender] ✓ dist/index.html actualizado con HTML pre-renderizado')

    // ── Actualizar lastmod del sitemap con la fecha del build actual ──────
    const today = new Date().toISOString().split('T')[0]
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://abogadosyasociadosparada.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`
    writeFileSync('dist/sitemap.xml', sitemap, 'utf-8')
    console.log(`[prerender] ✓ dist/sitemap.xml lastmod actualizado a ${today}`)

  } finally {
    if (browser) await browser.close()
    server.httpServer.close()
  }
}

run().catch(err => {
  // El fallo en pre-rendering NO debe romper el deploy.
  // Vercel sirve el SPA (dist/index.html original) como fallback válido.
  console.warn('[prerender] omitido — el build SPA sigue siendo válido:', err.message)
  process.exit(0)
})
