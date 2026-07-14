/* ─────────────────────────────────────────────────────────────────────────
   Firma movible dentro de un Word (.docx) — SIN transformar el documento.

   Un .docx es un ZIP de XML. Aquí NO se regenera nada: se abre el .docx
   original tal cual y se le INYECTA solo la imagen de la firma como un dibujo
   FLOTANTE ("delante del texto", sin ajuste de línea). El resultado:
     · todo el contenido y formato del Word original queda intacto y editable,
     · la firma queda como una imagen que el usuario puede AGARRAR y MOVER con
       el mouse en Word hasta el punto exacto que quiera.

   No incluye pie de firma ni datos: solo la firma. Ver el flujo de firma.
   ───────────────────────────────────────────────────────────────────────── */
import JSZip from 'jszip'

const EMU_IN = 914400          // EMU por pulgada
const EMU_TWIP = 635           // EMU por twip (1/20 pt)
const REL_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/* Uint8Array desde un dataURL o los mismos bytes si ya lo son. */
function aBytes(src) {
  if (src instanceof Uint8Array) return src
  if (typeof src === 'string') {
    const base64 = src.includes(',') ? src.split(',')[1] : src
    const bin = atob(base64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(src)
}

/* Dimensiones (px) de un PNG leyendo su cabecera IHDR. */
function tamPng(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // firma PNG (8) + len (4) + "IHDR" (4) → width en 16, height en 20 (BE).
    return { w: dv.getUint32(16), h: dv.getUint32(20) }
  } catch { return { w: 600, h: 200 } }
}

/* Tamaño de página (EMU) leído del sectPr del documento; Letter por defecto. */
function tamPagina(documentXml) {
  const m = documentXml.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"[^>]*\bw:h="(\d+)"/)
  if (m) return { w: (+m[1]) * EMU_TWIP, h: (+m[2]) * EMU_TWIP }
  return { w: Math.round(8.5 * EMU_IN), h: Math.round(11 * EMU_IN) } // Letter
}

/* Siguiente rId libre en un archivo de relaciones. */
function nuevoRelId(relsXml) {
  let max = 0
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, +m[1])
  return `rId${max + 1}`
}

/* Siguiente id de docPr/cNvPr libre en el documento. */
function nuevoDrawingId(documentXml) {
  let max = 0
  for (const m of documentXml.matchAll(/(?:docPr|cNvPr)\b[^>]*\bid="(\d+)"/g)) max = Math.max(max, +m[1])
  return Math.max(max + 1, 9901)
}

/* XML del dibujo flotante (anchor) con la firma. Movible en Word. */
function anchorFirma({ relId, drawId, cx, cy, x, y }) {
  return (
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240"' +
    ' behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/>' +
    `<wp:docPr id="${drawId}" name="Firma electronica"/>` +
    '<wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${drawId}" name="Firma electronica"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr>' +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '</pic:spPr>' +
    '</pic:pic>' +
    '</a:graphicData></a:graphic>' +
    '</wp:anchor>' +
    '</w:drawing></w:r></w:p>'
  )
}

/*
   firmarDocxMovible — devuelve los bytes de un .docx = original + firma flotante.

   docxBytes    Uint8Array/ArrayBuffer del .docx original
   firmaPng     PNG de la firma (Uint8Array o dataURL)
   opts.anchoIn ancho de la firma en pulgadas (por defecto 1.9")
*/
export async function firmarDocxMovible(docxBytes, firmaPng, opts = {}) {
  const anchoIn = opts.anchoIn || 1.9
  const zip = await JSZip.loadAsync(aBytes(docxBytes))

  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('El archivo no parece un Word válido (falta word/document.xml).')
  let documentXml = await docFile.async('string')

  // 1) Imagen de la firma → word/media.
  const pngBytes = aBytes(firmaPng)
  let mediaName = 'firma_aap.png'
  let n = 1
  while (zip.file(`word/media/${mediaName}`)) mediaName = `firma_aap_${n++}.png`
  zip.file(`word/media/${mediaName}`, pngBytes)

  // 2) [Content_Types].xml → asegurar el tipo png.
  const ctFile = zip.file('[Content_Types].xml')
  let ct = await ctFile.async('string')
  if (!/Extension="png"/i.test(ct)) {
    ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
    zip.file('[Content_Types].xml', ct)
  }

  // 3) Relación de la imagen en word/_rels/document.xml.rels.
  const relsPath = 'word/_rels/document.xml.rels'
  const relsFile = zip.file(relsPath)
  let relsXml = relsFile
    ? await relsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const relId = nuevoRelId(relsXml)
  relsXml = relsXml.replace(
    '</Relationships>',
    `<Relationship Id="${relId}" Type="${REL_IMG}" Target="media/${mediaName}"/></Relationships>`
  )
  zip.file(relsPath, relsXml)

  // 4) Geometría: tamaño proporcional + posición inicial (tercio inferior izq.).
  const { w: pxW, h: pxH } = tamPng(pngBytes)
  const cx = Math.round(anchoIn * EMU_IN)
  const cy = Math.round(cx * (pxH / pxW || 0.33))
  const pag = tamPagina(documentXml)
  const x = Math.round(1.0 * EMU_IN)                    // 1" desde el borde izq.
  const y = Math.max(0, pag.h - cy - Math.round(2.2 * EMU_IN)) // ~2.2" sobre el pie

  // 5) Inyectar el dibujo en la última sección (última página).
  const drawId = nuevoDrawingId(documentXml)
  const xml = anchorFirma({ relId, drawId, cx, cy, x, y })
  const idx = documentXml.lastIndexOf('<w:sectPr')
  documentXml = idx >= 0
    ? documentXml.slice(0, idx) + xml + documentXml.slice(idx)
    : documentXml.replace('</w:body>', xml + '</w:body>')
  zip.file('word/document.xml', documentXml)

  return await zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  })
}
