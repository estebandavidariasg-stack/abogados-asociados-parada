/* Optimiza las imágenes del hero: lee los PNG fuente desde assets-source/hero/
   y genera variantes responsive en AVIF + WebP + JPG, en 3 anchos:

   Por cada hero-N.png se generan 9 archivos:
     hero-N-480.avif   hero-N-480.webp   hero-N-480.jpg
     hero-N-800.avif   hero-N-800.webp   hero-N-800.jpg
     hero-N-1200.avif  hero-N-1200.webp  hero-N-1200.jpg

   El navegador elige el formato más eficiente que soporta (AVIF > WebP > JPG)
   y el ancho que mejor encaja con su viewport (mobile 480, tablet 800, desktop 1200).

   Uso: npm run optimize:hero
*/

import sharp from 'sharp'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT       = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR    = path.join(ROOT, 'assets-source', 'hero')
const OUT_DIR    = path.join(ROOT, 'public')
const LQIP_OUT   = path.join(ROOT, 'src', 'lqip-hero.js')
const WIDTHS     = [480, 800, 1200]
const AVIF_Q     = 50      // AVIF rinde mejor a calidad menor que WebP/JPG
const WEBP_Q     = 78
const JPG_Q      = 82
// LQIP (placeholder borroso embebido en base64 dentro del bundle JS).
// 24px de ancho con blur fuerte → ~200-400 bytes por imagen.
const LQIP_WIDTH = 24
const LQIP_BLUR  = 1.2

if (!existsSync(SRC_DIR)) {
  console.error(`No existe ${SRC_DIR}. Coloca los PNG fuente ahí.`)
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })

const files = (await readdir(SRC_DIR)).filter(f => /^hero-\d+\.png$/i.test(f))
if (files.length === 0) {
  console.error('No se encontraron archivos hero-*.png en', SRC_DIR)
  process.exit(1)
}

const fmt = b => (b / 1024).toFixed(1) + 'KB'
const totals = { src: 0, avif: 0, webp: 0, jpg: 0, lqip: 0 }

const lqipMap = {}

for (const file of files.sort()) {
  const srcPath = path.join(SRC_DIR, file)
  const base    = file.replace(/\.png$/i, '')
  const srcSize = statSync(srcPath).size
  totals.src += srcSize

  const lineParts = [`${file.padEnd(12)} ${fmt(srcSize).padStart(8)}  →`]

  for (const w of WIDTHS) {
    const pipeline = sharp(srcPath).resize({ width: w, withoutEnlargement: true })

    const avifPath = path.join(OUT_DIR, `${base}-${w}.avif`)
    const webpPath = path.join(OUT_DIR, `${base}-${w}.webp`)
    const jpgPath  = path.join(OUT_DIR, `${base}-${w}.jpg`)

    await pipeline.clone().avif({ quality: AVIF_Q, effort: 6 }).toFile(avifPath)
    await pipeline.clone().webp({ quality: WEBP_Q, effort: 6 }).toFile(webpPath)
    await pipeline.clone().jpeg({ quality: JPG_Q, mozjpeg: true, progressive: true }).toFile(jpgPath)

    const a = statSync(avifPath).size
    const b = statSync(webpPath).size
    const j = statSync(jpgPath).size
    totals.avif += a; totals.webp += b; totals.jpg += j

    lineParts.push(`${w}w[${fmt(a)}/${fmt(b)}/${fmt(j)}]`)
  }

  // LQIP: thumb 24px con blur, codificado a WebP base64 — embebido en el JS.
  const lqipBuffer = await sharp(srcPath)
    .resize({ width: LQIP_WIDTH, withoutEnlargement: true })
    .blur(LQIP_BLUR)
    .webp({ quality: 30, effort: 6 })
    .toBuffer()
  lqipMap[`/${base}`] = `data:image/webp;base64,${lqipBuffer.toString('base64')}`
  totals.lqip += lqipBuffer.length
  lineParts.push(`lqip[${fmt(lqipBuffer.length)}]`)

  console.log(lineParts.join(' '))
}

// Emitir el módulo JS con los placeholders. Se importa desde Hero.jsx.
await writeFile(
  LQIP_OUT,
  `// Auto-generado por scripts/optimize-hero.js — no editar a mano.\n` +
  `// Placeholders borrosos (~200-400 bytes c/u) embebidos en el bundle\n` +
  `// para que el primer slide aparezca instantáneamente sin esperar red.\n` +
  `export const lqipHero = ${JSON.stringify(lqipMap, null, 2)}\n`,
)

console.log('─'.repeat(72))
console.log(
  `TOTAL  src ${fmt(totals.src)}  →  ` +
  `avif ${fmt(totals.avif)}  ·  webp ${fmt(totals.webp)}  ·  jpg ${fmt(totals.jpg)}  ·  lqip ${fmt(totals.lqip)}`
)
console.log(
  `Reducción AVIF: ${(100 - (totals.avif / totals.src) * 100).toFixed(1)}%  ·  ` +
  `WebP: ${(100 - (totals.webp / totals.src) * 100).toFixed(1)}%`
)
console.log(`LQIP escrito en src/lqip-hero.js (${fmt(totals.lqip)} total inline en el bundle)`)
