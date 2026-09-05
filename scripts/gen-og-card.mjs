/* Genera la tarjeta social (Open Graph) 1200×630 de Parada Bridge:
   fondo crema de marca + logo centrado. Es la imagen que se ve al
   compartir el enlace por WhatsApp / redes.
   Uso: node scripts/gen-og-card.mjs   →   public/og-card.png */

import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200, H = 630

// Fondo crema con un halo dorado sutil arriba (SVG → PNG base).
const fondo = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#fffdf6"/>
      <stop offset="60%" stop-color="#faf3e6"/>
      <stop offset="100%" stop-color="#f3e9d6"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="18"
        fill="none" stroke="rgba(201,168,76,0.55)" stroke-width="2"/>
  <text x="${W / 2}" y="${H - 74}" text-anchor="middle"
        font-family="Georgia, serif" font-size="30" fill="#6d3c1b" letter-spacing="1">
    Asesoría jurídica y contable a nivel global
  </text>
  <text x="${W / 2}" y="${H - 40}" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="20" fill="#9a7a2c" letter-spacing="3">
    paradabridge.com
  </text>
</svg>`)

const logo = await sharp(join(ROOT, 'public', 'logo.png'))
  .resize({ width: 360, withoutEnlargement: false })
  .toBuffer()
const logoMeta = await sharp(logo).metadata()

await sharp(fondo)
  .composite([{
    input: logo,
    top: Math.round((H - logoMeta.height) / 2) - 46,
    left: Math.round((W - logoMeta.width) / 2),
  }])
  .png()
  .toFile(join(ROOT, 'public', 'og-card.png'))

console.log('✓ public/og-card.png generado (1200×630)')
