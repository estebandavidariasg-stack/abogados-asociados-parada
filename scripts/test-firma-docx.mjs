/* Prueba aislada de firmarDocxMovible: genera un .docx, inyecta una firma PNG
   y valida que el resultado sea un .docx válido con el dibujo flotante. */
import { Document, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'
import { firmarDocxMovible } from '../src/lib/firmaDocx.js'

// PNG 4x2 rojo (mínimo válido, para probar cabecera IHDR + embed).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4EIwESMolGF' +
  'lAoAAPmQBOa5oCFsAAAAAElFTkSuQmCC'
const pngBytes = Uint8Array.from(Buffer.from(PNG_B64, 'base64'))

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ children: [new TextRun('CONTRATO DE PRESTACIÓN DE SERVICIOS')] }),
      new Paragraph({ children: [new TextRun('Cláusula primera: objeto del contrato...')] }),
      new Paragraph({ children: [new TextRun('Firma:')] }),
    ],
  }],
})

const original = await Packer.toBuffer(doc)
const firmado = await firmarDocxMovible(new Uint8Array(original), pngBytes)

writeFileSync('docs/ejemplo-word-firmado.docx', Buffer.from(firmado))

// Validaciones estructurales.
const zip = await JSZip.loadAsync(firmado)
const documentXml = await zip.file('word/document.xml').async('string')
const rels = await zip.file('word/_rels/document.xml.rels').async('string')
const ct = await zip.file('[Content_Types].xml').async('string')
const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'))

const checks = [
  ['media contiene la firma', media.some((f) => f.endsWith('.png'))],
  ['document.xml tiene wp:anchor', documentXml.includes('<wp:anchor')],
  ['document.xml tiene a:blip r:embed', /<a:blip r:embed="rId\d+"/.test(documentXml)],
  ['rels apunta a la imagen', /Type="[^"]*\/image"[^>]*media\//.test(rels)],
  ['content-types declara png', /Extension="png"/i.test(ct)],
  ['anchor antes de sectPr', documentXml.indexOf('<wp:anchor') < documentXml.lastIndexOf('<w:sectPr')],
  ['conserva el texto original', documentXml.includes('CONTRATO DE PRESTACIÓN')],
]

let ok = true
for (const [nombre, pasa] of checks) {
  console.log(`${pasa ? '✓' : '✗'} ${nombre}`)
  if (!pasa) ok = false
}
console.log(ok ? '\nOK — .docx firmado válido en docs/ejemplo-word-firmado.docx' : '\nFALLÓ')
process.exit(ok ? 0 : 1)
