/**
 * gen-brand-logos.mjs — Genera los assets de logo de Parada Bridge.
 *
 * Fuente: SVGs de marca recoloreados al café #6d3c1b (assets-source/brand/).
 * Salida en /public:
 *   logo-nav.png / .webp  → navbar + footer (lockup apilado: símbolo + "parada bridge")
 *   logo.png              → OG / schema.org (mismo lockup, mayor resolución)
 *   favicon.png           → solo el símbolo del puente, cuadrado con margen
 *
 * Requiere que la fuente "Century Gothic" (GOTHIC.TTF) esté instalada.
 * Uso: node scripts/gen-brand-logos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BRAND = '#6d3c1b';
const SRC = 'assets-source/brand';
const OUT = 'public';
fs.mkdirSync(SRC, { recursive: true });

// Path del símbolo (puente) — lockup con nombre.
const GLYPH_STACKED =
  'M456.36,445.89c-40.95,33.27-104.77,26.88-135.99-18.66-20.61-30.07-36.4-61.29-54.58-92.93-18.88-33-57.55-46.95-92.5-35.32-34.67,11.58-57.17,46.63-52.31,83.95,4.6,35.32,33.7,63.94,70.1,67.02,36.78,3.08,69.4-18.45,81.62-53.87l10.6,18.34c-15.25,29.21-42.14,47.38-70.97,51.33-36.08,4.92-64.53-7.41-91.47-36.84l-.92,82.22h-16.28l.54-143.4c.11-40.24,29.91-73.56,64.91-84.65,38.57-12.28,81.79.11,104.99,34.13,21.85,31.97,38.4,65.07,58.42,98.07,19.26,31.81,59.99,42.79,93.52,29.37,32.89-13.2,54.04-47.33,47.71-85.52-5.46-32.67-33.97-60.96-70.32-63.99-35.11-2.87-68.53,18.12-81.08,54.42l-11.52-19.96-.32-110.83h16.44l.87,88.55c41.6-39.97,102.23-37.65,138.64,1.41,37.38,40.19,32.24,102.83-10.12,137.17Z';
// Path del símbolo centrado verticalmente (variante "sin nombre").
const GLYPH_ONLY =
  'M456.36,501.89c-40.95,33.27-104.77,26.88-135.99-18.66-20.61-30.07-36.4-61.29-54.58-92.93-18.88-33-57.55-46.95-92.5-35.32-34.67,11.58-57.17,46.63-52.31,83.95,4.6,35.32,33.7,63.94,70.1,67.02,36.78,3.08,69.4-18.45,81.62-53.87l10.6,18.34c-15.25,29.21-42.14,47.38-70.97,51.33-36.08,4.92-64.53-7.41-91.47-36.84l-.92,82.22h-16.28l.54-143.4c.11-40.24,29.91-73.56,64.91-84.65,38.57-12.28,81.79.11,104.99,34.13,21.85,31.97,38.4,65.07,58.42,98.07,19.26,31.81,59.99,42.79,93.52,29.37,32.89-13.2,54.04-47.33,47.71-85.52-5.46-32.67-33.97-60.96-70.32-63.99-35.11-2.87-68.53,18.12-81.08,54.42l-11.52-19.96-.32-110.83h16.44l.87,88.55c41.6-39.97,102.23-37.65,138.64,1.41,37.38,40.19,32.24,102.83-10.12,137.17Z';

const svgStacked = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595.28 841.89">
  <path fill="${BRAND}" d="${GLYPH_STACKED}"/>
  <text fill="${BRAND}" font-family="'Century Gothic', CenturyGothic, sans-serif" font-size="52.27" transform="translate(109.85 584.95)"><tspan x="0" y="0">parada bridge</tspan></text>
</svg>`;

const svgGlyph = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595.28 841.89">
  <path fill="${BRAND}" d="${GLYPH_ONLY}"/>
</svg>`;

fs.writeFileSync(path.join(SRC, 'logo-parada-bridge.svg'), svgStacked);
fs.writeFileSync(path.join(SRC, 'logo-parada-bridge-simbolo.svg'), svgGlyph);

const T = { r: 0, g: 0, b: 0, alpha: 0 }; // fondo transparente

async function render(svg, density = 320) {
  return sharp(Buffer.from(svg), { density }).png().toBuffer();
}

async function main() {
  // ── Lockup apilado (nav / footer / OG) ──
  const stackedBuf = await render(svgStacked);
  const stackedTrim = sharp(stackedBuf).trim(); // recorta márgenes transparentes

  await stackedTrim
    .clone()
    .resize({ height: 220, fit: 'inside' })
    .png()
    .toFile(path.join(OUT, 'logo-nav.png'));

  await stackedTrim
    .clone()
    .resize({ height: 220, fit: 'inside' })
    .webp({ quality: 92 })
    .toFile(path.join(OUT, 'logo-nav.webp'));

  await stackedTrim
    .clone()
    .resize({ height: 512, fit: 'inside' })
    .png()
    .toFile(path.join(OUT, 'logo.png'));

  // ── Favicon: símbolo "pb" espresso sobre azulejo blanco ──
  // Fondo claro para no sumar oscuridad; el glifo espresso se ve a 16px en
  // cualquier pestaña. Cuadro centrado en el lienzo A4 (centro y ≈ 420.9).
  const ESPRESSO = '#362415';
  const VB = '0 123.26 595.28 595.28';
  const svgFaviconTile = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}">
  <rect x="0" y="123.26" width="595.28" height="595.28" rx="104" fill="#ffffff"/>
  <path fill="${ESPRESSO}" d="${GLYPH_ONLY}"/>
</svg>`;
  // Variante Apple: cuadrado lleno sin esquinas redondeadas ni transparencia
  // (iOS aplica su propio redondeo y pinta de negro lo transparente).
  const svgAppleTile = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}">
  <rect x="0" y="123.26" width="595.28" height="595.28" fill="#ffffff"/>
  <path fill="${ESPRESSO}" d="${GLYPH_ONLY}"/>
</svg>`;

  // favicon.svg — nítido en navegadores modernos.
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), svgFaviconTile);
  // favicon.png (192 = 48×4).
  await sharp(Buffer.from(svgFaviconTile), { density: 300 }).resize(192, 192).png().toFile(path.join(OUT, 'favicon.png'));
  // apple-touch-icon (180×180).
  await sharp(Buffer.from(svgAppleTile), { density: 300 }).resize(180, 180).png().toFile(path.join(OUT, 'apple-touch-icon.png'));

  // Reporte de dimensiones
  for (const f of ['logo-nav.png', 'logo.png', 'favicon.png', 'apple-touch-icon.png']) {
    const meta = await sharp(path.join(OUT, f)).metadata();
    console.log(`${f.padEnd(16)} ${meta.width}x${meta.height}`);
  }
  console.log('OK — logos generados.');
}
main().catch((e) => { console.error(e); process.exit(1); });
