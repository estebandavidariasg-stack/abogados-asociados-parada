/* ─────────────────────────────────────────────────────────────────────────
   Contrato de prestación de servicios (abogacía / contables)

   El profesional descarga la plantilla oficial en Word, llena los espacios y
   sube el resultado. Antes de mandarlo a firma se COMPARA con la plantilla:
   las cláusulas deben seguir diciendo exactamente lo mismo y solo pueden
   cambiar los espacios pensados para llenarse.

   Cómo se comparan dos documentos que ya no son el mismo archivo:

     · Los espacios de la plantilla van entre paréntesis y en MAYÚSCULAS:
       "(NOMBRE DEL CLIENTE)", "(VALOR EN PESOS COLOMBIANOS)". Eso parte el
       texto en tramos FIJOS (lo que no se toca) y HUECOS (lo que se llena).
     · El documento subido tiene que contener todos los tramos fijos, en el
       mismo orden. Lo que quede entre dos tramos es lo que se escribió en
       el hueco.
     · Se compara sin espacios ni saltos de línea y sin distinguir
       mayúsculas: un PDF exportado de Word parte las líneas donde quiere y
       eso no es un cambio. Las tildes y la puntuación SÍ cuentan.

   La plantilla se lee en el momento (public/legal/modelos/*.docx), así que
   si la firma actualiza el Word, la validación se actualiza sola: no hay
   una copia del texto dentro del código.

   Todo corre en el navegador. Las funciones de comparación son puras (se
   pueden probar con Node); solo la lectura de archivos carga librerías.
   ───────────────────────────────────────────────────────────────────────── */

export const PLANTILLAS_CONTRATO = {
  abogado: {
    titulo: 'Contrato de prestación de servicios de abogacía',
    corto: 'Contrato de servicios de abogacía',
    docx: '/legal/modelos/contrato-servicios-abogacia.docx',
    archivo: 'Contrato de prestacion de servicios - Abogacia.docx',
  },
  contador: {
    titulo: 'Contrato de prestación de servicios contables',
    corto: 'Contrato de servicios contables',
    docx: '/legal/modelos/contrato-servicios-contables.docx',
    archivo: 'Contrato de prestacion de servicios - Contables.docx',
  },
}
export const plantillaDe = (tipo) => PLANTILLAS_CONTRATO[tipo === 'contador' ? 'contador' : 'abogado']

// Marca que viaja en el mensaje de firma del chat para rotularlo como contrato.
export const DOC_CONTRATO_SERVICIOS = 'contrato_servicios'

/* ── Lectura de archivos ─────────────────────────────────────────────────── */

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/* Texto de un .docx, en orden de lectura. Un .docx es un ZIP; el cuerpo está
   en word/document.xml. Se recorre en orden: <w:t> es texto, </w:p> un salto.
   El texto eliminado con control de cambios va en <w:delText> y no se lee:
   se valida el documento tal como quedaría al aceptar los cambios. */
export async function textoDeDocx(bytes) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const parte = zip.file('word/document.xml')
  if (!parte) throw new Error('El archivo no es un Word válido (.docx).')
  let xml = await parte.async('string')
  // Las formas traen una copia de respaldo (VML): fuera, o el texto saldría doble.
  xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
  let out = ''
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<\/w:p>/g
  let m
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += m[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTIDADES[e])
    else if (m[0].startsWith('<w:tab')) out += ' '
    else out += '\n'
  }
  return out
}

/* Texto de un PDF (pdf.js, el mismo que usa el visor). Un PDF escaneado no
   tiene texto: devuelve cadena vacía y quien llama lo explica. */
export async function textoDePdfBytes(bytes) {
  const { textoDePdf } = await import('./pdfARaster')
  return textoDePdf(bytes)
}

const esPdf  = (f) => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '')
const esDocx = (f) => /\.docx$/i.test(f?.name || '') ||
  f?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/* Lee un archivo subido → { tipo: 'pdf' | 'docx', bytes, texto }. */
export async function leerContratoSubido(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (esPdf(file))  return { tipo: 'pdf',  bytes, texto: await textoDePdfBytes(bytes) }
  if (esDocx(file)) return { tipo: 'docx', bytes, texto: await textoDeDocx(bytes) }
  throw new Error('Sube el contrato en PDF o en Word (.docx).')
}

// La plantilla se pide una vez por tipo y se recuerda mientras dure la página.
const _patrones = {}
export function patronDePlantilla(tipo) {
  const clave = tipo === 'contador' ? 'contador' : 'abogado'
  if (!_patrones[clave]) {
    _patrones[clave] = (async () => {
      const res = await fetch(PLANTILLAS_CONTRATO[clave].docx)
      if (!res.ok) throw new Error('No se pudo cargar la plantilla oficial.')
      return construirPatron(await textoDeDocx(new Uint8Array(await res.arrayBuffer())))
    })().catch((e) => { delete _patrones[clave]; throw e })
  }
  return _patrones[clave]
}

/* ── Normalización ───────────────────────────────────────────────────────── */

const COMILLAS = /[“”„«»″]/g       // “ ” „ « » ″ → "
const APOSTROFOS = /[‘’‚´`′]/g      // ‘ ’ ‚ ´ ` ′ → '
const GUIONES = /[‐-―−]/g                          // ‐ ‑ ‒ – — ― − → -
const INVISIBLES = /[­​-‍⁠﻿]/g           // guion blando, anchos cero

/* Texto → forma comparable + mapa de cada carácter a su posición original
   (para poder señalar DÓNDE está la diferencia en el texto legible). */
export function normalizar(texto) {
  // Palabra cortada con guion al final de línea (solo pasa en PDF).
  const crudo = String(texto || '').replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])-\n\s*(?=[a-záéíóúüñ])/g, '$1')
  let n = ''
  const mapa = []
  for (let i = 0; i < crudo.length; i++) {
    const c = crudo[i]
    if (/\s/.test(c)) continue
    const t = c.normalize('NFKC').toLowerCase()
      .replace(COMILLAS, '"').replace(APOSTROFOS, "'").replace(GUIONES, '-').replace(INVISIBLES, '')
    for (const ch of t) {
      if (/\s/.test(ch)) continue
      n += ch
      mapa.push(i)
    }
  }
  return { n, mapa, crudo }
}
const soloN = (t) => normalizar(t).n

/* ── Patrón de la plantilla ──────────────────────────────────────────────── */

const RE_PARENTESIS = /\(([^()]{1,260})\)/g
// Hueco obligatorio: empieza por una palabra en MAYÚSCULAS ("NOMBRE…", "DÍA").
const esHuecoObligatorio = (t) => /^[A-ZÁÉÍÓÚÜÑ]{2,}/.test(t.trim())
// Hueco opcional: orientación que se puede dejar, ajustar o borrar.
const esHuecoOpcional = (t) => /según se pacte|^por ejemplo/i.test(t.trim())

const RE_TITULO = /(MODELO\s*:\s*)?CONTRATO DE PRESTACI[ÓO]N DE SERVICIOS PROFESIONALES/i
const RE_CLAUSULA = /CL[ÁA]USULA\s+[A-ZÁÉÍÓÚÜÑ ]+?\.\s*[A-ZÁÉÍÓÚÜÑ ,]+?\.|CONSIDERACIONES|En constancia, se firma/g

// Un tramo fijo de menos de esto (un "de", un punto) no sirve de ancla: se
// confundiría con lo escrito en el hueco. Se funde con los huecos vecinos.
const MIN_ANCLA = 6

/* texto de la plantilla → { tramos: [{ fijo, mapa, ini } | { huecos: [...] }], crudo, titulos } */
export function construirPatron(textoPlantilla) {
  const crudo = String(textoPlantilla || '')
  const t = RE_TITULO.exec(crudo)
  if (!t) throw new Error('La plantilla oficial no tiene el título esperado.')
  // "MODELO:" no hace parte del contrato real: se puede quitar.
  const inicio = t.index + (t[1] ? t[1].length : 0)

  // Se recorre desde el título hasta el último hueco (lo que sigue es pie de página).
  const piezas = []   // { tipo: 'fijo', ini, fin } | { tipo: 'hueco', etiqueta, opcional }
  let cursor = inicio
  let finUtil = inicio
  RE_PARENTESIS.lastIndex = inicio
  let m
  while ((m = RE_PARENTESIS.exec(crudo))) {
    const dentro = m[1]
    const obligatorio = esHuecoObligatorio(dentro)
    if (!obligatorio && !esHuecoOpcional(dentro)) continue   // "(a)", "(Código…)": texto fijo
    if (m.index > cursor) piezas.push({ tipo: 'fijo', ini: cursor, fin: m.index })
    piezas.push({ tipo: 'hueco', etiqueta: dentro.replace(/\s+/g, ' ').trim(), opcional: !obligatorio, en: m.index })
    cursor = m.index + m[0].length
    finUtil = cursor
  }

  const tramos = []
  const huecoAbierto = () => {
    const ult = tramos[tramos.length - 1]
    if (ult && ult.huecos) return ult
    const h = { huecos: [] }
    tramos.push(h)
    return h
  }
  for (const p of piezas) {
    if (p.fin !== undefined && p.ini >= finUtil) break
    if (p.tipo === 'hueco') {
      huecoAbierto().huecos.push({ etiqueta: p.etiqueta, opcional: p.opcional, en: p.en })
      continue
    }
    const { n, mapa } = normalizar(crudo.slice(p.ini, p.fin))
    if (n.length < MIN_ANCLA) {
      // Tramo demasiado corto para anclar: pasa a ser parte del hueco.
      if (tramos.length) huecoAbierto()
      continue
    }
    tramos.push({ fijo: n, mapa: mapa.map((i) => i + p.ini), ini: p.ini })
  }

  const titulos = []
  RE_CLAUSULA.lastIndex = 0
  while ((m = RE_CLAUSULA.exec(crudo))) {
    const nombre = m[0].startsWith('En constancia') ? 'Firmas' : m[0].replace(/\s+/g, ' ').replace(/\.$/, '').trim()
    titulos.push({ en: m.index, nombre: nombre === 'CONSIDERACIONES' ? 'Consideraciones' : nombre })
  }
  return { tramos, crudo, titulos }
}

function clausulaEn(patron, posCruda) {
  let nombre = 'Partes del contrato'   // lo que va antes de "CONSIDERACIONES"
  for (const t of patron.titulos) { if (t.en <= posCruda) nombre = t.nombre; else break }
  return nombre
}

/* Trozo legible alrededor de una posición: empieza y termina en palabra
   completa, con puntos suspensivos donde se cortó. */
function recorte(texto, desde, largo = 120) {
  let ini = Math.max(0, desde)
  if (ini > 0 && /\S/.test(texto[ini - 1] || '')) {
    const sig = texto.slice(ini).search(/\s/)
    if (sig >= 0 && sig < 24) ini += sig
  }
  let fin = Math.min(texto.length, ini + largo)
  if (fin < texto.length) {
    const corte = texto.lastIndexOf(' ', fin)
    if (corte > ini + largo * 0.6) fin = corte
  }
  const cuerpo = texto.slice(ini, fin).replace(/\s+/g, ' ').trim()
  return `${ini > 0 ? '…' : ''}${cuerpo}${fin < texto.length ? '…' : ''}`
}

/* Mayor k tal que los primeros k caracteres de `aguja` aparecen en `pajar`
   desde `pos`. Vale la búsqueda binaria: si aparece un prefijo, aparecen
   todos los más cortos. */
function prefijoMasLargo(pajar, aguja, pos) {
  let lo = 0, hi = aguja.length, donde = -1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const i = pajar.indexOf(aguja.slice(0, mid), pos)
    if (i >= 0) { lo = mid; donde = i } else hi = mid - 1
  }
  return { k: lo, donde: lo ? pajar.indexOf(aguja.slice(0, lo), pos) : donde }
}
function sufijoMasLargo(pajar, aguja, pos) {
  let lo = 0, hi = aguja.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (pajar.indexOf(aguja.slice(aguja.length - mid), pos) >= 0) lo = mid; else hi = mid - 1
  }
  return { k: lo, donde: lo ? pajar.indexOf(aguja.slice(aguja.length - lo), pos) : -1 }
}

const MIN_COINCIDENCIA = 14     // por debajo, un prefijo "encontrado" es casualidad
const MAX_CAMBIOS = 6
// Tope de lo escrito en un hueco, sin contar espacios (~250 palabras). La
// descripción del servicio puede ser un párrafo; más que eso es texto agregado.
const MAX_HUECO = 1400

/* Compara el texto subido con el patrón.
   → { ok, cambios: [{ clausula, debeDecir, dice }], sinLlenar: [{ etiqueta, clausula }],
       agregados: [{ clausula, texto }], reconocido } */
export function compararConPlantilla(textoSubido, patron) {
  const { n: sub, mapa: mapaSub, crudo: crudoSub } = normalizar(textoSubido)
  const cambios = []
  const sinLlenar = []
  const agregados = []
  let pos = 0
  let huecoPend = null      // hueco cuyo contenido termina donde empiece el próximo tramo fijo
  let inicioHueco = 0
  let hallados = 0
  const fijos = patron.tramos.filter((t) => t.fijo)

  // `final`: el último hueco llega hasta el fin del archivo (incluye el pie
  // de página), así que ahí no se mide el largo.
  const cerrarHueco = (hasta, final = false) => {
    if (!huecoPend) return
    const contenido = sub.slice(inicioHueco, Math.max(inicioHueco, hasta))
    for (const h of huecoPend.huecos) {
      if (h.opcional) continue
      const marca = soloN(`(${h.etiqueta})`)
      if (!contenido.length || contenido.includes(marca)) {
        sinLlenar.push({ etiqueta: h.etiqueta, clausula: clausulaEn(patron, h.en) })
      }
    }
    // Un hueco es para un dato o una descripción, no para cláusulas nuevas
    // ni para párrafos enteros colados junto al dato.
    const iClausula = contenido.search(/cl[áa]usula/)
    if (huecoPend.huecos.length && (iClausula >= 0 || (!final && contenido.length > MAX_HUECO))) {
      agregados.push({
        clausula: clausulaEn(patron, huecoPend.huecos[0].en),
        etiqueta: huecoPend.huecos[0].etiqueta,
        motivo: iClausula >= 0 ? 'clausula' : 'largo',
        texto: recorte(crudoSub, mapaSub[inicioHueco + Math.max(0, iClausula)] ?? 0, 120),
      })
    }
    huecoPend = null
  }

  for (const tramo of patron.tramos) {
    if (tramo.huecos) { huecoPend = tramo; inicioHueco = pos; continue }

    const i = sub.indexOf(tramo.fijo, pos)
    if (i >= 0) {
      cerrarHueco(i)
      pos = i + tramo.fijo.length
      hallados++
      continue
    }

    // El tramo no está tal cual: se localiza hasta dónde coincide.
    const pre = prefijoMasLargo(sub, tramo.fijo, pos)
    const suf = sufijoMasLargo(sub, tramo.fijo, pos)
    const hayPre = pre.k >= MIN_COINCIDENCIA
    const haySuf = suf.k >= MIN_COINCIDENCIA
    if (cambios.length < MAX_CAMBIOS) {
      const kPlantilla = hayPre ? pre.k : 0
      const posCruda = tramo.mapa[Math.min(kPlantilla, tramo.mapa.length - 1)]
      const posSub = hayPre ? pre.donde + pre.k : (haySuf ? Math.max(pos, suf.donde - 60) : pos)
      cambios.push({
        clausula: clausulaEn(patron, posCruda),
        debeDecir: recorte(patron.crudo, posCruda - 12),
        dice: hayPre || haySuf
          ? recorte(crudoSub, (mapaSub[Math.min(posSub, mapaSub.length - 1)] ?? 0) - 12)
          : '',   // no aparece en ninguna parte: se borró o se reescribió
      })
    }
    if (hayPre) cerrarHueco(pre.donde); else huecoPend = null
    // Se reengancha después de lo que sí coincida, para seguir revisando el resto.
    if (haySuf) pos = suf.donde + suf.k
    else if (hayPre) pos = pre.donde + pre.k
  }
  cerrarHueco(sub.length, true)

  // ¿Es siquiera este contrato? Si casi nada coincide, es otro documento.
  const reconocido = fijos.length > 0 && hallados / fijos.length >= 0.3
  return {
    ok: reconocido && !cambios.length && !sinLlenar.length && !agregados.length,
    reconocido, cambios, sinLlenar, agregados,
  }
}

/* Todo junto: archivo subido → veredicto. `tipoArchivo` dice si lo subido
   sirve ya para firmar (PDF) o solo se revisó (Word). */
export async function validarContrato(file, tipoProfesional) {
  const [subido, patron] = await Promise.all([leerContratoSubido(file), patronDePlantilla(tipoProfesional)])
  if (!subido.texto.trim()) {
    return {
      ok: false, reconocido: false, sinTexto: true, tipoArchivo: subido.tipo, bytes: subido.bytes,
      cambios: [], sinLlenar: [], agregados: [],
    }
  }
  return { ...compararConPlantilla(subido.texto, patron), tipoArchivo: subido.tipo, bytes: subido.bytes }
}
