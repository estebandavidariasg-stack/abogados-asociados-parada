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
}

// ── Número / radicado ───────────────────────────────────────────────────────
function extraerNumero(txt) {
  // "Proyecto de Ley No. 123 de 2026 (Cámara/Senado)"
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
function extraerFecha(txt) {
  // "22 de julio de 2026" | "22 de Julio del año 2026".
  const m = txt.match(
    /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:del?\s+a[ñn]o\s+|de\s+)?(\d{4})/i
  )
  if (!m) return ''
  const dia = parseInt(m[1], 10)
  const mes = MESES[sinTilde(m[2].toLowerCase())]
  const anio = parseInt(m[3], 10)
  if (!mes || dia < 1 || dia > 31 || anio < 1990 || anio > 2100) return ''
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// ── Articulado ──────────────────────────────────────────────────────────────
// Cabecera de artículo: "ARTÍCULO N°", tolerante a ruido de OCR entre la
// palabra y el número ("Artículo .7", "ARTÍCULO  6 °").
const ART_RE = /\bART[IÍ]CULO[\s.·]+([0-9]{1,4}\s*[°ºoO.]*|[A-ZÁÉÍÓÚa-záéíóú]+(?:\s+[A-ZÁÉÍÓÚa-záéíóú]+)?)/gi

// El articulado va entre "DECRETA" y las firmas / la exposición de motivos.
// Acotarlo evita capturar los artículos citados de la Constitución y de otras
// leyes, y las repeticiones del resumen ("Contenido del proyecto").
const FIN_ARTICULADO = /De\s+los\s+[Hh]onorables\s+[Cc]ongresistas|EXPOSICI[ÓO]N\s+DE\s+MOTIVOS|\bAntecedentes\s+legislativos\b/

function regionArticulado(txt) {
  const dec = txt.search(/\bDECRETA\b/i)
  const start = dec >= 0 ? dec + 'DECRETA'.length : 0
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

  const marcas = []
  let m
  ART_RE.lastIndex = 0
  while ((m = ART_RE.exec(region)) !== null) {
    const numero = tokenANumero(m[1])
    if (numero == null) continue
    marcas.push({ numero, start: m.index, headEnd: m.index + m[0].length })
  }
  if (marcas.length === 0) return []

  // Secuencia monótona desde 1: solo se acepta el artículo cuyo número es el
  // siguiente esperado. Así se descartan las referencias cruzadas dentro de un
  // artículo ("…el artículo 10 de la presente ley") y cualquier repetición.
  const aceptadas = []
  let esperado = 1
  for (const mk of marcas) {
    if (mk.numero === esperado) { aceptadas.push(mk); esperado++ }
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
    if (!cuerpo) { arts.push({ numero: String(cur.numero), titulo: '', contenido: '' }); continue }
    const { titulo, contenido } = partirTitulo(cuerpo)
    arts.push({ numero: String(cur.numero), titulo, contenido })
  }
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

export function parseProyectoLey(rawText) {
  const txt = normalizar(rawText)
  const numero = extraerNumero(txt)
  const nombre = extraerNombre(txt)
  const fecha_radicacion = extraerFecha(txt)
  const articulos = extraerArticulos(txt)
  const descripcion = extraerDescripcion(articulos)

  return {
    numero,
    nombre,
    fecha_radicacion,
    descripcion,
    articulos,
    meta: {
      totalArticulos: articulos.length,
      detecto: {
        numero: !!numero,
        nombre: !!nombre,
        fecha: !!fecha_radicacion,
        articulos: articulos.length,
      },
    },
  }
}
