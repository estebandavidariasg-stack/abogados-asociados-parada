/* ────────────────────────────────────────────────────────────────────────
   parseProyectoLey — extrae la estructura de un proyecto de ley colombiano a
   partir del TEXTO plano de su documento (PDF / Word / TXT). Se ejecuta en el
   navegador tras extractDocText(); NO usa IA ni funciones serverless (respeta
   el tope de 12 funciones de Vercel) y es 100 % determinista → testeable.

   Devuelve: {
     numero,            // "Proyecto de Ley N° 123 de 2026 (Cámara)" | ''
     nombre,            // "por medio de la cual se ..." | ''  (título oficial)
     fecha_radicacion,  // "YYYY-MM-DD" | ''
     descripcion,       // resumen breve (objeto del proyecto) | ''
     articulos: [ { numero, titulo, contenido } ],
     meta: { totalArticulos, detecto: {...} }   // para el resumen en la UI
   }

   El PDF, al extraerse con pdf.js, llega como un bloque con los saltos de
   línea perdidos (los ítems se unen con espacios). Por eso el parser se apoya
   en MARCADORES textuales ("ARTÍCULO N°", "por la cual…") y no en renglones.
──────────────────────────────────────────────────────────────────────── */

// Colapsa espacios/saltos redundantes sin perder los marcadores.
function normalizar(txt) {
  return String(txt || '')
    .replace(/\r/g, '\n')
    .replace(/ /g, ' ')      // nbsp
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Ordinales escritos con letra → número (1..30). Los proyectos reales usan
// casi siempre numerales, pero algunos artículos van "ARTÍCULO PRIMERO".
const ORDINALES = {
  primero: 1, segundo: 2, tercero: 3, cuarto: 4, quinto: 5, sexto: 6,
  septimo: 7, octavo: 8, noveno: 9, decimo: 10,
  undecimo: 11, 'decimo primero': 11, duodecimo: 12, 'decimo segundo': 12,
  'decimo tercero': 13, 'decimo cuarto': 14, 'decimo quinto': 15,
  'decimo sexto': 16, 'decimo septimo': 17, 'decimo octavo': 18,
  'decimo noveno': 19, vigesimo: 20,
}
const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Traduce el token que sigue a "ARTÍCULO" en un número, o null si no lo es.
function tokenANumero(raw) {
  const t = sinTilde(String(raw || '').toLowerCase().trim())
  const num = t.match(/^0*(\d{1,4})/)
  if (num) return parseInt(num[1], 10)
  // Ordinal compuesto ("decimo primero") o simple ("primero").
  const dos = t.split(/\s+/).slice(0, 2).join(' ')
  if (ORDINALES[dos] != null) return ORDINALES[dos]
  const uno = t.split(/\s+/)[0]
  if (ORDINALES[uno] != null) return ORDINALES[uno]
  return null
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // Abreviaturas del sello de promulgación ("30 DIC 2021").
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
}

// ── Número / radicado ───────────────────────────────────────────────────────
/* Dos formas, porque llegan las dos:

     · PROYECTO de ley, aún en trámite → "Proyecto de Ley No. 123 de 2026 (Cámara)"
     · LEY ya sancionada              → "LEY No. 2173 30 DIC 2021"

   El parser solo conocía la primera, así que con una ley publicada en el
   Diario Oficial devolvía vacío. En la ley sancionada el año no viene en un
   "de YYYY": está en la fecha de promulgación de al lado, así que se toma de
   ahí. */
function extraerNumeroProyecto(txt) {
  const m = txt.match(
    /PROYECT[OÓ]'?\s+DE\s+LEY\s*(?:ESTATUTARIA\s*)?(?:N[°ºo.]*\s*|No\.?\s*|N[úu]mero\s*)?0*(\d{1,4})\s+DE\s+(\d{4})/i
  )
  if (!m) return ''
  const camara = txt.slice(m.index, m.index + 120).match(/\b(C[ÁA]MARA|SENADO)\b/i)
  const base = `Proyecto de Ley N° ${m[1]} de ${m[2]}`
  if (camara) {
    const c = camara[1].toUpperCase().startsWith('C') ? 'Cámara' : 'Senado'
    return `${base} (${c})`
  }
  return base
}

function extraerNumeroLey(txt) {
  // "LEY No. 2173 de 2021" o "LEY No. 2173  30 DIC 2021" (sin el "de <año>").
  const m = txt.match(
    /\b(LEY|ACTO\s+LEGISLATIVO)\s*(?:ESTATUTARIA\s*)?(?:N[°ºo.]*\s*|No\.?\s*|N[úu]mero\s*)?0*(\d{1,4})\b/i
  )
  if (!m) return ''
  const etiqueta = /ACTO/i.test(m[1]) ? 'Acto Legislativo' : 'Ley'
  // El año: "de 2021" pegado, o el primer año plausible en las 150 letras
  // siguientes (la fecha de promulgación suele ir justo al lado).
  const cerca = txt.slice(m.index, m.index + 150)
  const conDe = cerca.match(/\bde\s+((?:19|20)\d{2})\b/i)
  const suelto = cerca.match(/\b((?:19|20)\d{2})\b/)
  const anio = (conDe && conDe[1]) || (suelto && suelto[1]) || ''
  return anio ? `${etiqueta} ${m[2]} de ${anio}` : `${etiqueta} ${m[2]}`
}

function extraerNumero(txt, tipo) {
  /* El proyecto manda. Y si el documento ES un proyecto, la busqueda de "Ley
     N de AAAA" NO se intenta siquiera: todo proyecto cita leyes vigentes, y
     la primera que aparezca (la Ley 99 de 1993, pongamos) se colaba como si
     fuera el numero del documento. Un proyecto aun sin radicar sencillamente
     no tiene numero, y vacio es la respuesta correcta. */
  const delProyecto = extraerNumeroProyecto(txt)
  if (delProyecto) return delProyecto
  if (tipo === 'proyecto') return ''
  return extraerNumeroLey(txt)
}

// ── Título oficial ("por la cual se …") ─────────────────────────────────────
function extraerNombre(txt) {
  const m = txt.match(/por\s+(?:medio\s+de\s+)?(?:la|el)\s+cual(?:es)?\b/i)
  if (!m) return ''
  const desde = m.index
  const resto = txt.slice(desde)
  // El título termina donde arranca el articulado o la fórmula "DECRETA".
  const fin = resto.search(
    /(»|”|"|\bEL\s+CONGRESO\b|\bDECRETA\b|\bART[IÍ]CULO\b|\bLA\s+ASAMBLEA\b|\bEXPOSICI[ÓO]N\b)/i
  )
  let nombre = (fin > 0 ? resto.slice(0, fin) : resto.slice(0, 320))
  nombre = nombre
    .replace(/[«»"“”]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:]+$/, '')
    .trim()
  // Mayúscula inicial, respetando el resto.
  return nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : ''
}

// ── Fecha de radicación (best-effort) ───────────────────────────────────────
function armarFecha(dia, nombreMes, anio) {
  const mes = MESES[sinTilde(String(nombreMes).toLowerCase())]
  if (!mes || dia < 1 || dia > 31 || anio < 1990 || anio > 2100) return ''
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function extraerFecha(txt) {
  // "22 de julio de 2026" | "22 de Julio del año 2026".
  const larga = txt.match(
    /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:del?\s+a[ñn]o\s+|de\s+)?(\d{4})/i
  )
  if (larga) {
    const f = armarFecha(parseInt(larga[1], 10), larga[2], parseInt(larga[3], 10))
    if (f) return f
  }
  /* Sello de promulgación: "30 DIC 2021", sin preposiciones y con el mes
     abreviado. Es como viene en toda ley del Diario Oficial, y era la razón de
     que la fecha saliera vacía con documentos ya sancionados. */
  const corta = txt.match(/\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SEPT|OCT|NOV|DIC)\.?\s+((?:19|20)\d{2})\b/i)
  if (corta) return armarFecha(parseInt(corta[1], 10), corta[2], parseInt(corta[3], 10))
  return ''
}

/* ── Autores ────────────────────────────────────────────────────────────────
   En los proyectos colombianos los firmantes aparecen de dos formas: en la
   portada bajo un rótulo ("AUTORES:", "Ponente:") o al final del articulado
   tras "De los honorables congresistas" / "Cordialmente". Se prueban los
   rótulos por orden y se recorta el bloque de nombres que sigue.

   Los nombres se devuelven tal cual vienen, separados por coma: corregirlos
   es trabajo del admin en el preview, y adivinar aquí produciría basura con
   aire de dato bueno. */
const ROTULOS_AUTOR = [
  /\bAUTOR(?:ES)?\s*(?:DEL\s+PROYECTO)?\s*[:.]/i,
  /\bPONENTES?\s*[:.]/i,
  /\bDe\s+los?\s+[Hh]onorables?\s+[Cc]ongresistas?\s*[:.]?/,
  /\bPRESENTADO\s+POR\s*[:.]?/i,
  /\bCordialmente\s*[,.]?/,
]
// Corta el bloque de firmas: lo que sigue ya no son nombres.
/* Corta el bloque de firmas. Sin `\b` de cierre a propósito: en JavaScript
   sin la bandera `u`, una vocal acentuada no es carácter de palabra, así que
   /\bBOGOTÁ\b/ no casa NUNCA con "Bogotá D.C." y el corte no ocurría. */
const FIN_AUTORES = /\b(?:EXPOSICI[ÓO]N|C[ÁA]MARA\s+DE\s+REPRESENTANTES|SENADO\s+DE\s+LA\s+REP|PROYECTO\s+DE\s+LEY|ART[IÍ]CULO|BOGOT[ÁA]|\d{4})/i

// Ruido típico de las firmas que no es parte del nombre. Se come también la
// puntuación del tratamiento ("H.R." entero), que si no dejaba un "." suelto
// pegado al primer nombre.
const TRATAMIENTOS = /(?:\bH\s*\.\s*[RS]\s*\.?|\bHonorable\s+(?:Representante|Senador[a]?)|\bRepresentante\s+a\s+la\s+C[áa]mara|\bSenador[a]?\s+de\s+la\s+Rep[úu]blica|\bPartido\s+[A-Za-zÁÉÍÓÚáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñ]+)?)/gi

// Palabras que delatan que el fragmento no es un nombre de persona.
const NO_ES_NOMBRE = /\b(?:bogot|d\.?c\.?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|c[áa]mara|senado|congreso|rep[úu]blica|proyecto|ley)\b/i

function extraerAutores(txt) {
  for (const rotulo of ROTULOS_AUTOR) {
    const m = txt.match(rotulo)
    if (!m) continue
    let bloque = txt.slice(m.index + m[0].length, m.index + m[0].length + 500)
    const fin = bloque.search(FIN_AUTORES)
    if (fin > 0) bloque = bloque.slice(0, fin)
    const nombres = bloque
      .replace(TRATAMIENTOS, ' ')
      .split(/[\n,;·•]|\s{3,}/)
      .map(x => x.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, ' ').replace(/\s+/g, ' ').trim())
      // Un nombre tiene dos o más palabras, no es una frase larga y no
      // contiene ciudades, meses ni nombres de corporación.
      .filter(x => {
        const palabras = x.split(' ').filter(Boolean)
        if (palabras.length < 2 || palabras.length > 6 || x.length > 60) return false
        return !NO_ES_NOMBRE.test(x)
      })
    if (nombres.length) return [...new Set(nombres)].slice(0, 12).join(', ')
  }
  return ''
}

/* ── Exposición de motivos ──────────────────────────────────────────────────
   Va entre su encabezado y lo que venga después (referencias, proposición o
   el final). Se devuelve completa: el admin la recorta en el preview si
   quiere, y truncarla aquí le quitaría material sin preguntarle. */
// Sin `\b` de cierre: ver la nota de FIN_AUTORES. Incluye la fórmula de
// promulgación porque ahí acaba la exposición y empieza el articulado:
// sin ella la exposición se tragaba la ley entera.
const FIN_EXPOSICION = /\b(?:EL\s+CONGRESO\s+DE\s+COLOMBIA|EL\s+CONGRESO\s+DE\s+LA\s+REP[ÚU]BLICA|\bDECRETA\b|BIBLIOGRAF[ÍI]A|REFERENCIAS\s+BIBLIOGR|PROPOSICI[ÓO]N|CONFLICTO\s+DE\s+INTER[ÉE]S|IMPACTO\s+FISCAL\s+FINAL|De\s+los\s+[Hh]onorables)/

/* Renglones que NO son el argumento sino el aparato que lo acompana: la
   bibliografia, las notas al pie, los enlaces y los numeros de pagina. En el
   PDF van al margen; al extraer el texto caen en medio de las frases y dejan
   la exposicion hecha un revoltijo. */
const RENGLON_BASURA = [
  /^\s*\d{1,4}\s*$/,                              // numero de pagina suelto
  /^\s*P[áa]gina\s+\d+/i,
  /https?:\/\//i,
  /^\s*Disponible\s+en\s*:/i,
  /^\s*(?:Ibid|Op\.\s*cit|Vease|Véase|Cfr)\b/i,
  /^\s*\[\d+\]/,                               // marca de nota: [12]
  // Nota al pie: empieza con el numero de la nota y acaba citando un anio o
  // una pagina ("12 Ministerio de Agricultura, Informe de riego, 2019, p. 44").
  /^\s*\d{1,3}\s+[A-ZÁÉÍÓÚÑ][^\n]*?(?:,\s*(?:19|20)\d{2}|\bpp?\.\s*\d+)/,
  /^\s*Recuperado\s+de\b/i,
  /^\s*\(\d{4}\)/,                             // "(2019)" al inicio de renglon
]

function limpiarExposicion(bloque) {
  const renglones = bloque
    .split(/\r?\n/)
    .filter(r => !RENGLON_BASURA.some(re => re.test(r)))
    // Restos de OCR sin letras (rayas, guiones bajos, tildes sueltas).
    .filter(r => !r.trim() || /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3}/.test(r))
  return renglones
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')      // no mas de un renglon en blanco seguido
    .trim()
}

function extraerExposicion(txt) {
  const m = txt.match(/\bEXPOSICI[ÓO]N\s+DE\s+MOTIVOS\b/i)
  if (!m) return ''
  const desde = m.index + m[0].length
  let bloque = txt.slice(desde)
  const fin = bloque.search(FIN_EXPOSICION)
  if (fin > 0) bloque = bloque.slice(0, fin)
  return limpiarExposicion(bloque.replace(/^[\s.:\-–]+/, ''))
}

/* ── Titulos y capitulos ───────────────────────────────────────────────────
   Una norma se divide en TITULO I, TITULO II... (a veces CAPITULOS), y cada
   articulo cuelga de uno. Eso es informacion real que se perdia: el articulado
   salia como una lista plana de 19 elementos sin decir que el 4 y el 5 son
   "Del ciudadano" y el 17 al 19 "Otras disposiciones".

   El reparto es POSICIONAL, asi que lo hace el parser y no la IA: a cada
   articulo se le asigna el ultimo encabezado que aparecio antes de el. El
   numero romano no se lee (el OCR lo destroza: "TITULO 11" por "TITULO II");
   lo que importa es el NOMBRE de la seccion, que va en el renglon siguiente. */
const SECCION_RE = /\b(T[IÍ1l]TUL[O0]|CAP[IÍ1l]TUL[O0])[\s.·:]+([IVXLCDM0-9]{1,6}|[A-Za-z]+)/gi

// El nombre va justo despues del encabezado y antes del primer ARTICULO.
function nombreSeccion(region, desde) {
  const trozo = region.slice(desde, desde + 220)
  ART_RE.lastIndex = 0
  const hastaArt = ART_RE.exec(trozo)
  /* Se conservan la coma y el guion: son parte del nombre. Quitandolos,
     "Financiacion, cofinanciacion e incentivos" quedaba como una ristra de
     palabras sueltas. El resto del ruido (numeros romanos del encabezado,
     vinetas, restos de OCR) si se va. */
  const bruto = (hastaArt ? trozo.slice(0, hastaArt.index) : trozo)
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Dos a ocho palabras: un nombre de titulo, no un parrafo arrastrado.
  const palabras = bruto.split(' ').filter(Boolean)
  if (palabras.length < 1 || palabras.length > 8) return ''
  // Sin puntuacion colgando en los extremos.
  return palabras.join(' ').replace(/^[\s,-]+/, '').replace(/[\s,-]+$/, '')
}

function marcasSeccion(region) {
  const out = []
  let m
  SECCION_RE.lastIndex = 0
  while ((m = SECCION_RE.exec(region)) !== null) {
    const nombre = nombreSeccion(region, m.index + m[0].length)
    if (nombre) out.push({ start: m.index, nombre })
  }
  return out
}

// ── Articulado ──────────────────────────────────────────────────────────────
// Cabecera de artículo: "ARTÍCULO N°", tolerante a ruido de OCR entre la
// palabra y el número ("Artículo .7", "ARTÍCULO  6 °").
/* La cabecera acepta lo que sale de un PDF real, no lo que debería salir:
     · "ARTÍCULO 3"  la forma correcta
     · "ARTÍCUL0 3"  cero por O, y 1/l por I: el error de OCR más común, y el
                     que antes hacía perder el artículo entero
     · "Art. 5" / "ARTS. 5" / "Artíc. 5"  abreviaturas, frecuentes al final */
const ART_RE = /\b(?:ART[IÍ1l]CUL[O0]|ARTS?\.|ART[IÍ1l]C\.)[\s.·:]+([0-9]{1,4}\s*[°ºoO.]*|[A-ZÁÉÍÓÚa-záéíóú]+(?:\s+[A-ZÁÉÍÓÚa-záéíóú]+)?)/gi

// El articulado va entre "DECRETA" y las firmas / la exposición de motivos.
// Acotarlo evita capturar los artículos citados de la Constitución y de otras
// leyes, y las repeticiones del resumen ("Contenido del proyecto").
const FIN_ARTICULADO = /De\s+los\s+[Hh]onorables\s+[Cc]ongresistas|EXPOSICI[ÓO]N\s+DE\s+MOTIVOS|\bAntecedentes\s+legislativos|EL\s+PRESIDENTE\s+DEL\s+HONORABLE\s+SENADO|LA\s+PRESIDENTA?\s+DE\s+LA\s+HONORABLE\s+C[ÁA]MARA|EL\s+SECRETARIO\s+GENERAL|PUBL[ÍI]QUESE\s+Y\s+C[ÚU]MPLASE|EL\s+MINISTRO\s+DEL\s+INTERIOR/

/* Dónde empieza el articulado.

   Antes: la PRIMERA aparición de "DECRETA", y si no había ninguna, el byte 0.
   Las dos ramas fallan en documentos reales. Muchos proyectos citan "el
   Congreso decreta" dentro de la exposición de motivos, y entonces el corte
   caía cientos de párrafos antes de tiempo; y sin "DECRETA" se barría el
   documento entero, capturando como articulado propio cada "artículo 95 de la
   Constitución" que apareciera citado.

   Ahora se busca la fórmula de promulgación más cercana ANTES del primer
   "ARTÍCULO 1", que es donde de verdad está. Si no hay ninguna, se arranca en
   ese primer artículo en vez de en el principio del documento. */
function inicioArticulado(txt) {
  ART_RE.lastIndex = 0
  let primeraMarca = -1
  let m
  while ((m = ART_RE.exec(txt)) !== null) {
    if (tokenANumero(m[1]) === 1) { primeraMarca = m.index; break }
  }
  const tope = primeraMarca >= 0 ? primeraMarca : txt.length
  const formula = /\b(DECRETA|ORDENA|ACUERDA)\b\s*[:.]?/gi
  let ultima = -1, fin = 0
  formula.lastIndex = 0
  while ((m = formula.exec(txt)) !== null) {
    if (m.index >= tope) break
    ultima = m.index; fin = m.index + m[0].length
  }
  if (ultima >= 0) return fin
  return primeraMarca >= 0 ? primeraMarca : 0
}

function regionArticulado(txt) {
  const start = inicioArticulado(txt)
  const sub = txt.slice(start)
  const finRel = sub.search(FIN_ARTICULADO)
  const end = finRel >= 0 ? start + finRel : txt.length
  return txt.slice(start, end)
}

// Separa "Objeto. La presente ley…" → { titulo:'Objeto', contenido:'La…' }.
function partirTitulo(cuerpo) {
  // Primer segmento breve terminado en "." o ":" seguido de espacio.
  const m = cuerpo.match(/^(.{2,120}?)\s*[.:]\s+/)
  if (m) {
    const posible = m[1].trim()
    const palabras = posible.split(/\s+/).filter(Boolean).length
    const conector = /^(el|la|los|las|se|en|con|por|para|de|del|un|una|este|esta|dicho|cuando|no|a)\b/i.test(posible)
    const puntoInterno = /[.:;]/.test(posible)
    if (palabras >= 1 && palabras <= 18 && !conector && !puntoInterno) {
      return { titulo: posible, contenido: cuerpo.slice(m[0].length).trim() }
    }
  }
  return { titulo: '', contenido: cuerpo }
}

function extraerArticulos(txt) {
  const region = regionArticulado(txt)

  const secciones = marcasSeccion(region)
  const marcas = []
  let m
  ART_RE.lastIndex = 0
  while ((m = ART_RE.exec(region)) !== null) {
    const numero = tokenANumero(m[1])
    if (numero == null) continue
    marcas.push({ numero, start: m.index, headEnd: m.index + m[0].length })
  }
  if (marcas.length === 0) return []

  /* Secuencia creciente CON tolerancia a huecos.

     Antes se exigía exactamente el siguiente número ("=== esperado"). Un solo
     artículo mal leído por el OCR ("ARTÍCUL0 4") rompía la cadena y se perdía
     TODO el articulado de ahí en adelante. Esa es la causa principal de que
     "falle mucho" con documentos reales: basta un carácter sucio.

     Ahora se acepta cualquier número mayor que el último aceptado, siempre que
     el salto sea pequeño. Sigue descartando lo que importa: las referencias
     hacia atrás ("el artículo 2 de la presente ley", menor que el actual) y
     las citas a normas ajenas ("artículo 95 de la Constitución", salto
     enorme). Los huecos quedan anotados en `meta.saltos` para avisar al
     admin en el preview de que revise esos números. */
  const SALTO_MAX = 3
  const aceptadas = []
  const saltos = []
  let ultimo = 0
  for (const mk of marcas) {
    if (mk.numero > ultimo && mk.numero <= ultimo + SALTO_MAX) {
      if (mk.numero > ultimo + 1) saltos.push({ desde: ultimo, hasta: mk.numero })
      aceptadas.push(mk)
      ultimo = mk.numero
    }
  }
  if (aceptadas.length === 0) return []

  const arts = []
  for (let i = 0; i < aceptadas.length; i++) {
    const cur = aceptadas[i]
    const next = aceptadas[i + 1]
    let cuerpo = region.slice(cur.headEnd, next ? next.start : region.length)
    cuerpo = cuerpo
      .replace(/^\s*[°º]?\s*[.\-–:)]*\s*/, '')   // restos de la cabecera ("°.", ".-", ":")
      .replace(/\s+/g, ' ')
      .trim()
    if (!cuerpo) { arts.push({ numero: String(cur.numero), titulo: '', contenido: '', seccion: '' }); continue }
    const { titulo, contenido } = partirTitulo(cuerpo)
    // La seccion es el ultimo encabezado que quedo por encima del articulo.
    let seccion = ''
    for (const sc of secciones) { if (sc.start < cur.start) seccion = sc.nombre; else break }
    arts.push({ numero: String(cur.numero), titulo, contenido, seccion })
  }
  arts.saltos = saltos
  return arts
}

// Descripción breve: el "objeto" del artículo 1º, si se detectó.
function extraerDescripcion(articulos) {
  const art1 = articulos.find(a => a.numero === '1')
  if (!art1) return ''
  const base = art1.contenido || ''
  if (!base) return ''
  return base.length > 320 ? base.slice(0, 317).trimEnd() + '…' : base
}

/* Proyecto en trámite o ley ya sancionada.

   Importa para el preview: una ley publicada en el Diario Oficial NO tiene
   exposición de motivos ni autores. Sus firmas son las de los presidentes de
   Senado y Cámara y las de los ministros, que no son quienes la propusieron;
   tomarlos como "autores" sería inventar un dato con cara de correcto. En esos
   documentos los dos campos salen vacíos porque no existen, no porque el
   lector haya fallado, y el admin merece saber la diferencia. */
function detectarTipo(txt) {
  if (/PROYECT[OÓ]\s+DE\s+LEY/i.test(txt)) return 'proyecto'
  if (/\b(?:LEY|ACTO\s+LEGISLATIVO)\s*(?:N[°ºo.]*\s*|No\.?\s*)?\d{1,4}\b/i.test(txt)) return 'ley'
  return 'desconocido'
}

export function parseProyectoLey(rawText) {
  const txt = normalizar(rawText)
  const tipo = detectarTipo(txt)
  const numero = extraerNumero(txt, tipo)
  const nombre = extraerNombre(txt)
  const fecha_radicacion = extraerFecha(txt)
  const autores = extraerAutores(txt)
  const exposicion_motivos = extraerExposicion(txt)
  const articulos = extraerArticulos(txt)
  const descripcion = extraerDescripcion(articulos)

  return {
    tipo,
    numero,
    nombre,
    fecha_radicacion,
    autores,
    exposicion_motivos,
    descripcion,
    articulos,
    meta: {
      tipo,
      totalArticulos: articulos.length,
      // Huecos en la numeración: el preview los muestra para que el admin
      // revise si falta un artículo que el OCR se comió.
      saltos: articulos.saltos || [],
      detecto: {
        numero: !!numero,
        nombre: !!nombre,
        fecha: !!fecha_radicacion,
        autores: !!autores,
        exposicion: !!exposicion_motivos,
        articulos: articulos.length,
      },
    },
  }
}
