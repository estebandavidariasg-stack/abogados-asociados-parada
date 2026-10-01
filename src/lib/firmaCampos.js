/* ─────────────────────────────────────────────────────────────────────────
   Dónde va la firma DENTRO del documento.

   Un contrato ya trae su espacio de firma:

       EL ABOGADO
       Nombre: (NOMBRE COMPLETO)
       C.C./T.P.: (NÚMERO)

       EL CLIENTE
       Nombre: (NOMBRE COMPLETO)
       C.C.: (NÚMERO)

   Antes la firma ignoraba ese espacio y estampaba un bloque propio (firma +
   6 renglones) en un punto fijo de la última página. En las plantillas de la
   firma la última página es la contraportada café, así que el bloque quedaba
   en negro sobre café, y como el profesional y el cliente usaban el mismo
   punto, uno encima del otro.

   Aquí se lee el texto del PDF con su posición (pdf.js, el mismo del visor) y
   se busca el bloque de la parte que firma:

     · la etiqueta      "EL ABOGADO", "EL CONTADOR", "EL CLIENTE"… según el rol
     · sus renglones    "Nombre:", "C.C.:", "Cel.:", "Correo:"…
     · qué hay en cada uno: un marcador por llenar — "(NOMBRE COMPLETO)",
       "______" —, nada, o el dato ya escrito por el profesional

   Con eso lib/firmaPdf pone el dibujo de la firma junto a la etiqueta y
   escribe el nombre y el número EN su renglón, tapando el marcador. Un dato
   que ya venía escrito no se toca.

   Si el documento no tiene ese bloque (un poder, una autorización cualquiera)
   no se inventa nada: devuelve la última página con texto de verdad para que
   el bloque clásico vaya debajo del contenido y no sobre una contraportada.

   Las funciones de detección son puras (se prueban con Node); solo
   analizarParaFirma toca pdf.js y el lienzo.
   ───────────────────────────────────────────────────────────────────────── */

// Cómo se llama cada parte en la etiqueta de su bloque de firma.
const ROLES = {
  cliente: /\b(CLIENTE|CONTRATANTE|MANDANTE|PODERDANTE|OTORGANTE)\b/,
  abogado: /\b(ABOGAD[OA]|APODERAD[OA]|CONTRATISTA|PROFESIONAL|MANDATARI[OA]|ASESOR[A]?)\b/,
  contador: /\b(CONTADOR[A]?|CONTRATISTA|PROFESIONAL|ASESOR[A]?)\b/,
  administrador: /\b(ADMINISTRADOR[A]?|PARADA BRIDGE|PLATAFORMA|EMPRESA)\b/,
}
const ALGUN_ROL = new RegExp(Object.values(ROLES).map((r) => r.source).join('|'))

// Qué dato del pie de firma va en cada renglón, según cómo empieza.
const TIPOS = [
  ['nombre', /^nombres?\b/i],
  ['cedula', /^(c\.?\s?c\b|c[eé]dula|identificaci[oó]n|documento|doc\.|nit\b|t\.?\s?p\b|n[uú]mero|no\.)/i],
  ['telefono', /^(cel|tel|m[oó]vil|whatsapp)/i],
  ['correo', /^(correo|e-?mail)/i],
  ['ciudad', /^ciudad/i],
  ['fecha', /^fecha/i],
]
const tipoDeCampo = (rotulo) => (TIPOS.find(([, re]) => re.test(rotulo.trim())) || [])[0] || null

// Marcador por llenar. "(NOMBRE COMPLETO)" en mayúsculas se TAPA y se escribe
// encima; sobre una raya o unos puntos se escribe sin tapar, como a mano.
const esMarcadorTexto = (v) => /^\(\s*[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 .,/°º#-]{1,60}\)\.?$/.test(v)
const esMarcadorRaya = (v) => /^[_.…\-–—\s]{4,}$/.test(v)
const esRaya = (t) => /^_{6,}$/.test(t)
// Renglón "Firma: ______" de un formulario: ahí va el dibujo.
const RE_FIRMA = /^\s*firmas?\s*:\s*/i

const limpio = (c) => c.texto.replace(/\s+/g, ' ').trim()
const palabras = (c) => limpio(c).split(' ').filter(Boolean).length

/* Items de pdf.js → forma plana. Se descarta el texto girado. */
export function itemsPlanos(items, styles = {}) {
  const out = []
  for (const it of items) {
    if (typeof it.str !== 'string' || it.str === '') continue
    const [a, b, c, , e, f] = it.transform
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue
    const familia = /sans/i.test(styles[it.fontName]?.fontFamily || '') ? 'sans' : 'serif'
    out.push({ str: it.str, x: e, y: f, w: it.width, size: Math.abs(a) || it.height || 10, familia })
  }
  return out
}

/* Items → celdas: un renglón, o cada columna de un renglón cuando dos bloques
   de firma van lado a lado. De arriba hacia abajo.
   celda = { texto, x0, x1, y, size, familia, partes: [{ ini, fin, x, w, str }] } */
export function celdasDeItems(items) {
  const orden = [...items].sort((p, q) => q.y - p.y || p.x - q.x)
  const filas = []
  for (const it of orden) {
    const f = filas[filas.length - 1]
    if (f && Math.abs(f.y - it.y) <= Math.max(2, 0.35 * it.size)) f.items.push(it)
    else filas.push({ y: it.y, items: [it] })
  }
  const celdas = []
  for (const f of filas) {
    f.items.sort((p, q) => p.x - q.x)
    let c = null
    for (const it of f.items) {
      const hueco = c ? it.x - c.x1 : 0
      if (!c || hueco > 2.5 * it.size) {
        if (!it.str.trim()) continue          // un espacio suelto no abre celda
        c = { texto: '', x0: it.x, x1: it.x, y: f.y, size: it.size, familia: it.familia, partes: [] }
        celdas.push(c)
      } else if (hueco > 0.2 * it.size && !/\s$/.test(c.texto) && !/^\s/.test(it.str)) {
        c.texto += ' '                        // separación que el PDF no trae como carácter
      }
      c.partes.push({ ini: c.texto.length, fin: c.texto.length + it.str.length, x: it.x, w: it.w, str: it.str })
      c.texto += it.str
      c.x1 = Math.max(c.x1, it.x + it.w)
      c.size = Math.max(c.size, it.size)
    }
  }
  return celdas.filter((c) => c.texto.trim())
}

// Etiqueta de un bloque de firma: renglón corto, todo en mayúsculas, que
// empieza por artículo ("EL ABOGADO") o nombra una de las partes.
function esEtiqueta(c) {
  const s = limpio(c).replace(/[:.]$/, '').trim()
  return s.length >= 5 && s.length <= 40 && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÜÑ]{3}/.test(s) &&
    !/[()_\d]/.test(s) && s.split(' ').length <= 5 &&
    (/^(EL|LA|LOS|LAS)\s/.test(s) || ALGUN_ROL.test(s))
}

// Misma columna: se solapan o arrancan cerca en horizontal.
const mismaColumna = (a, b) => b.x0 < a.x1 + 6 * a.size && b.x1 > a.x0 - 6 * a.size

/* Un renglón "Rótulo: valor" → qué hay que escribir y dónde, o null si no es
   un dato conocido o ya viene escrito. */
function campoDe(c) {
  const m = /^(\s*[^:]{1,40}:)(\s*)(.*?)\s*$/.exec(c.texto)
  if (!m) return null
  const tipo = tipoDeCampo(m[1])
  if (!tipo) return null
  const base = { tipo, y: c.y, size: c.size, x1: c.x1 }
  if (!m[3]) return { ...base, cubrir: false, x: c.x1 + 0.3 * c.size }
  const cubrir = esMarcadorTexto(m[3])
  if (!cubrir && !esMarcadorRaya(m[3])) return null     // ya viene escrito
  // Trozo del PDF donde empieza el valor: firmaPdf afina la x con la métrica
  // real de la letra (aquí no hay fuente con qué medir).
  const ini = m[1].length + m[2].length
  const parte = c.partes.find((p) => ini >= p.ini && ini < p.fin) || c.partes.find((p) => p.ini >= ini)
  if (!parte) return null
  return { ...base, cubrir, parte: { x: parte.x, w: parte.w, str: parte.str, corte: Math.max(0, ini - parte.ini) } }
}

/* Bloques de firma de una página. `alto` de la página, para ignorar el pie.
   → [{ etiqueta, lineas, campos, raya, arriba, despues }] */
function bloquesDePagina(celdas, alto) {
  const cuerpo = celdas.filter((c) => c.y > alto * 0.08)
  const bloques = []
  cuerpo.forEach((et, i) => {
    if (!esEtiqueta(et)) return
    const lineas = []
    let ultY = et.y
    let fin = cuerpo.length
    for (let j = i + 1; j < cuerpo.length; j++) {
      const c = cuerpo[j]
      if (!mismaColumna(et, c)) continue
      // De la etiqueta al primer renglón puede haber un espacio amplio (el de
      // la firma); entre renglones del mismo bloque, no.
      const salto = (lineas.length ? 4.5 : 8) * et.size
      if (esEtiqueta(c) || ultY - c.y > salto || lineas.length >= 8) { fin = j; break }
      lineas.push(c)
      ultY = c.y
    }
    // El renglón de encima: para no subir la firma sobre él, o porque es la
    // raya de firma (hay contratos que la ponen sobre la etiqueta).
    let arriba = null
    for (let j = i - 1; j >= 0; j--) if (mismaColumna(et, cuerpo[j])) { arriba = cuerpo[j]; break }
    const raya = lineas.find((c) => esRaya(limpio(c))) ||
      (arriba && esRaya(limpio(arriba)) && arriba.y - et.y < 3 * et.size ? arriba : null)
    const conDato = lineas.filter((c) => !!tipoDeCampo(limpio(c)) || RE_FIRMA.test(c.texto))
    if (!raya && !conDato.length) return
    bloques.push({
      etiqueta: et, lineas, raya, arriba,
      campos: lineas.map(campoDe).filter(Boolean),
      // ¿Hay texto corrido después del bloque? Entonces no es el de firmas
      // (sería el encabezado de las partes al comienzo del contrato).
      despues: cuerpo.slice(fin).some((c) => !esEtiqueta(c) && palabras(c) >= 14),
    })
  })
  return bloques
}

/* Elige el bloque del rol y calcula la caja de la firma.
   → null | { firma: { x, y, h, wMax, modo }, campos, familia } */
export function buscarBloque(celdas, rol, ancho, alto) {
  const validos = bloquesDePagina(celdas, alto).filter((b) => !b.despues)
  if (!validos.length) return null
  const re = ROLES[rol] || ROLES.cliente
  let b = [...validos].reverse().find((x) => re.test(limpio(x.etiqueta)))
  if (!b && rol !== 'cliente' && validos.length === 2) {
    // Dos partes y una es el cliente: la otra es quien firma.
    const otro = validos.filter((x) => !ROLES.cliente.test(limpio(x.etiqueta)))
    if (otro.length === 1) b = otro[0]
  }
  if (!b) return null

  const et = b.etiqueta
  const s = et.size
  const renglon = b.lineas.find((c) => RE_FIRMA.test(c.texto))
  let firma
  if (renglon) {
    // "Firma: ______": el dibujo va sobre ese renglón, donde empieza la raya
    // (se sube sobre el renglón de encima, como una firma hecha a mano).
    const ini = RE_FIRMA.exec(renglon.texto)[0].length
    const p = renglon.partes.find((q) => ini >= q.ini && ini < q.fin) || renglon.partes.find((q) => q.ini >= ini)
    const x = p ? p.x + p.w * (Math.max(0, ini - p.ini) / Math.max(1, p.str.length)) : renglon.x1 + 0.3 * s
    firma = { modo: 'raya', x: x + 0.3 * s, y: renglon.y + 0.5, h: 2.6 * s, wMax: Math.max(renglon.x1 - x, 8 * s) }
  } else if (b.raya) {
    // Hay raya de firma: el dibujo se apoya sobre ella.
    const encima = celdas.filter((c) => c.y > b.raya.y && mismaColumna(b.raya, c)).pop()
    const tope = encima ? encima.y - 0.3 * encima.size - 1 : Infinity
    firma = {
      modo: 'raya', x: b.raya.x0 + 0.4 * s, y: b.raya.y + 0.5,
      h: Math.max(2.2 * s, Math.min(5 * s, tope - b.raya.y)),
      wMax: Math.min(b.raya.x1 - b.raya.x0, 14 * s),
    }
  } else {
    const prim = b.lineas[0]
    const piso = prim.y + 0.9 * prim.size
    const libre = et.y - 0.3 * s - piso
    if (libre >= 2.2 * s) {
      // Entre la etiqueta y el primer renglón cabe la firma: va ahí, debajo.
      firma = { modo: 'debajo', x: et.x0, y: piso + 0.5, h: Math.min(libre - 1, 5 * s), wMax: 14 * s }
    } else {
      // No cabe: a la derecha de la etiqueta, sin subirse al renglón de encima.
      const tope = b.arriba ? b.arriba.y - 0.3 * b.arriba.size - 1 : Infinity
      firma = {
        modo: 'derecha', x: et.x1 + 1.2 * s, y: piso,
        h: Math.max(2.4 * s, Math.min(5 * s, Math.min(et.y + 1.7 * s, tope) - piso)),
        wMax: 14 * s,
      }
    }
  }
  // Ni fuera de la hoja ni encima de lo que haya a la derecha (otra columna).
  firma.wMax = Math.min(firma.wMax, ancho - firma.x - 1.5 * s)
  for (const c of celdas) {
    if (c.x0 > firma.x + s && c.y < firma.y + firma.h && c.y + c.size > firma.y) {
      firma.wMax = Math.min(firma.wMax, c.x0 - firma.x - 0.5 * s)
    }
  }
  if (firma.wMax < 3 * s) return null
  return { firma, campos: b.campos, familia: et.familia, muestra: b.lineas.find((c) => !esRaya(limpio(c))) || et }
}

/* ── Colores de la hoja ──────────────────────────────────────────────────── */

/* Fondo y tinta alrededor de un renglón, leídos de la página pintada: el
   marcador se tapa con el color del papel (las plantillas no son blancas) y
   el dato se escribe con la tinta del documento. */
async function colores(page, celda) {
  const blanco = { fondo: [255, 255, 255], tinta: [0, 0, 0] }
  try {
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    // Puntos del PDF → píxeles del lienzo. La hoja no está girada ni corrida
    // (analizarParaFirma descarta esas), así que basta escalar e invertir la y.
    const e = viewport.scale
    const x = Math.max(0, Math.floor(celda.x0 * e))
    const y = Math.max(0, Math.floor(viewport.height - (celda.y + 0.9 * celda.size) * e))
    const w = Math.min(canvas.width - x, Math.ceil((celda.x1 - celda.x0) * e))
    const h = Math.min(canvas.height - y, Math.ceil(1.2 * celda.size * e))
    if (w < 2 || h < 2) return blanco
    const px = ctx.getImageData(x, y, w, h).data
    // Fondo = el color que más se repite (el texto ocupa menos que el papel).
    const cuenta = new Map()
    for (let i = 0; i < px.length; i += 4) {
      const k = ((px[i] >> 2) << 12) | ((px[i + 1] >> 2) << 6) | (px[i + 2] >> 2)
      const v = cuenta.get(k)
      if (v) { v.n++; v.r += px[i]; v.g += px[i + 1]; v.b += px[i + 2] }
      else cuenta.set(k, { n: 1, r: px[i], g: px[i + 1], b: px[i + 2] })
    }
    let top = null
    for (const v of cuenta.values()) if (!top || v.n > top.n) top = v
    const fondo = [top.r / top.n, top.g / top.n, top.b / top.n]
    // Tinta = lo más alejado del fondo (el centro del trazo, sin el borde suave).
    const dist = (i) => Math.abs(px[i] - fondo[0]) + Math.abs(px[i + 1] - fondo[1]) + Math.abs(px[i + 2] - fondo[2])
    let max = 0
    for (let i = 0; i < px.length; i += 4) max = Math.max(max, dist(i))
    if (max < 60) return { fondo, tinta: blanco.tinta }
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < px.length; i += 4) {
      if (dist(i) >= max * 0.85) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++ }
    }
    return { fondo, tinta: [r / n, g / n, b / n] }
  } catch {
    return blanco
  }
}

/* PDF → dónde firmar.
   → { campo: null | { pagina, firma, campos, familia, fondo, tinta },
       hoja:  null | { pagina, yMin } }
   `pagina` es el índice (desde 0). `hoja` es la última página con texto de
   verdad y la línea más baja de ese texto, para el bloque clásico. */
export async function analizarParaFirma(pdfBytes, rol) {
  const { abrirPdf } = await import('./pdfARaster.js')
  const pdf = await abrirPdf(pdfBytes)
  try {
    let hoja = null
    for (let i = pdf.numPages; i >= 1; i--) {
      const page = await pdf.getPage(i)
      const [x0, y0, x1, y1] = page.view
      // Hoja girada o con origen corrido: las coordenadas no serían las de
      // pdf-lib. Se deja al bloque clásico.
      if (page.rotate % 360 !== 0 || Math.abs(x0) > 0.5 || Math.abs(y0) > 0.5) continue
      const ancho = x1 - x0
      const alto = y1 - y0
      const { items, styles } = await page.getTextContent()
      const celdas = celdasDeItems(itemsPlanos(items, styles))
      const cuerpo = celdas.filter((c) => c.y > alto * 0.09)
      const nPalabras = cuerpo.reduce((n, c) => n + palabras(c), 0)
      // Una portada o contraportada (el nombre de la firma y poco más) no es
      // lugar para firmar.
      if (!hoja && nPalabras >= 8) hoja = { pagina: i - 1, yMin: Math.min(...cuerpo.map((c) => c.y)) }

      const bloque = buscarBloque(celdas, rol, ancho, alto)
      if (bloque) {
        const { muestra, ...resto } = bloque
        return { campo: { pagina: i - 1, ...resto, ...(await colores(page, muestra)) }, hoja }
      }
      // Ya hay texto corrido en esta página: lo de más atrás no es el final
      // del documento, no se sigue buscando.
      if (celdas.some((c) => palabras(c) >= 14)) break
    }
    return { campo: null, hoja }
  } finally {
    try { await pdf.destroy() } catch { /* ya liberado */ }
  }
}
