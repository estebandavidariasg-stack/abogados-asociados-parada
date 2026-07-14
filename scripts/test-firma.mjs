/* Prueba del motor de firma (src/lib/firmaPdf.js) sin navegador.
   Genera un contrato base, una firma PNG realista (sharp), la estampa, anexa el
   certificado y valida el PDF resultante. Deja docs/ejemplo-firmado.pdf. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { estamparFirma, anexarCertificado, hashDocumento } from '../src/lib/firmaPdf.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let fails = 0
const ok = (cond, msg) => { console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`); if (!cond) fails++ }

// ── 1. Firma PNG realista a partir de un SVG (trazo manuscrito) ───────────
async function firmaPng(nombre) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="90">
    <path d="M10 60 C 40 10, 60 90, 90 50 S 140 10, 170 55 S 220 90, 260 40 L 300 55"
      fill="none" stroke="#0d2d5e" stroke-width="3.2" stroke-linecap="round"/>
    <text x="14" y="82" font-family="cursive" font-size="14" fill="#1a5276">${nombre}</text>
  </svg>`
  return await sharp(Buffer.from(svg)).png().toBuffer()
}

// ── 2. Contrato base ──────────────────────────────────────────────────────
async function contratoBase() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  page.drawText('CONTRATO DE PRESTACION DE SERVICIOS', { x: 56, y: 780, size: 15, font: bold, color: rgb(0.05, 0.18, 0.37) })
  const body = [
    'Entre los suscritos, PARADA ABOGADOS Y ASOCIADOS, y el CLIENTE, se celebra el',
    'presente contrato de prestacion de servicios profesionales, que se regira por',
    'las siguientes clausulas y por la legislacion colombiana vigente.',
    '',
    'PRIMERA. Objeto. El profesional prestara asesoria juridica al cliente.',
    'SEGUNDA. Honorarios. Las partes acuerdan el valor definido en el anexo.',
    'TERCERA. Vigencia. El presente contrato rige desde su firma.',
  ]
  body.forEach((ln, i) => page.drawText(ln, { x: 56, y: 740 - i * 20, size: 10.5, font, color: rgb(0.12, 0.14, 0.2) }))
  return pdf.save()
}

async function main() {
  console.log('\n── Prueba: motor de firma electronica ──\n')

  const base = await contratoBase()
  ok(base.length > 500, 'Contrato base generado')

  const pieCliente = {
    nombre: 'María Fernanda Gómez Ríos', cedula: '1020345678', telefono: '3001234567',
    correo: 'maria.gomez@correo.com', ciudad: 'Bogotá D.C.', fecha: new Date().toISOString(), rol: 'cliente',
  }
  const pieAbogado = {
    nombre: 'Carlos Andrés Parada', cedula: '79458123', telefono: '3109876543',
    correo: 'carlos.parada@paradaabogados.com', ciudad: 'Bogotá D.C.', fecha: new Date().toISOString(), rol: 'abogado',
  }

  // Firma 1 (cliente) abajo-izquierda; firma 2 (abogado) abajo-derecha.
  let signed = await estamparFirma(base, { firmaPng: await firmaPng('M. Gomez'), pie: pieCliente, posicion: { x: 56, y: 150 } })
  ok(signed.length > base.length, 'Firma del cliente estampada')

  signed = await estamparFirma(signed, { firmaPng: await firmaPng('C. Parada'), pie: pieAbogado, posicion: { x: 320, y: 150 } })
  ok(signed.length > 500, 'Firma del abogado estampada')

  let check = await PDFDocument.load(signed)
  ok(check.getPageCount() === 1, `PDF firmado mantiene 1 pagina (tiene ${check.getPageCount()})`)

  const docHash = await hashDocumento(signed)
  ok(/^[0-9a-f]{64}$/.test(docHash), `Hash SHA-256 valido (${docHash.slice(0, 16)}…)`)

  const withCert = await anexarCertificado(signed, {
    solicitudId: 'a1b2c3d4-0000-4444-8888-abcdef123456',
    docHash,
    firmantes: [
      { ...pieCliente, firmado_at: new Date().toISOString(), ip: '190.85.12.34', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' },
      { ...pieAbogado, firmado_at: new Date().toISOString(), ip: '181.49.22.10', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/605' },
    ],
  })
  check = await PDFDocument.load(withCert)
  ok(check.getPageCount() === 2, `Certificado anexado como pagina extra (total ${check.getPageCount()})`)

  const out = join(__dirname, '..', 'docs', 'ejemplo-firmado.pdf')
  writeFileSync(out, withCert)
  console.log(`\n  📄 PDF de muestra: ${out}`)

  console.log(`\n${fails === 0 ? '✅ TODAS LAS PRUEBAS PASARON' : `❌ ${fails} PRUEBA(S) FALLARON`}\n`)
  process.exit(fails === 0 ? 0 : 1)
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
