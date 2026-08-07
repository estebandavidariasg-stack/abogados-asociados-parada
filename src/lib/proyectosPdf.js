/* ─────────────────────────────────────────────────────────────────────────
   proyectosPdf.js — Informe PDF de resultados del debate de proyectos de ley.

   Genera un PDF vectorial (pdf-lib, ya en el proyecto: cero dependencias
   nuevas) con la paleta oficial de Parada Bridge, el logo, el título del
   proyecto, la fecha de descarga y, para el proyecto completo y CADA artículo,
   una gráfica de torta + el resumen "De un total de X votos: Z a favor (sí),
   Y en contra (no)…". Solo gráficas, sin comentarios.
   ───────────────────────────────────────────────────────────────────────── */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { APOYA } from './proyectosLey'

// Paleta oficial (global.css): café + dorado + verde/rojo semánticos.
const hx = (h) => {
  const n = parseInt(h.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
const PAL = {
  ink:      hx('#472F29'),
  cafe:     hx('#6D3C1B'),
  gold:     hx('#C9A84C'),
  muted:    hx('#9A8064'),
  hair:     hx('#E6D9C7'),
  a_favor:  hx('#2E7D5B'),
  en_contra:hx('#B4442F'),
  neutral:  hx('#C9A84C'),
}
const COLOR_APOYA = { a_favor: PAL.a_favor, en_contra: PAL.en_contra, neutral: PAL.neutral }

const A4 = { w: 595.28, h: 841.89 }
const M = 48                 // margen
const CW = A4.w - M * 2      // ancho de contenido

const fmtFechaLarga = (d) => {
  if (!d) return ''
  try { return new Date(typeof d === 'string' && d.length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return String(d) }
}

// Cuenta votos por postura para un ámbito (articuloId null = proyecto completo)
// aplicando el filtro territorial activo.
function contar(resumen, articuloId, filtro) {
  const acc = { a_favor: 0, en_contra: 0, neutral: 0 }
  for (const r of resumen) {
    const match = articuloId == null ? r.articulo_id == null : r.articulo_id === articuloId
    if (!match) continue
    if (filtro?.depto && r.departamento !== filtro.depto) continue
    if (filtro?.muni && r.municipio !== filtro.muni) continue
    acc[r.apoya] = (acc[r.apoya] || 0) + r.total
  }
  return acc
}

function filtroLabel(filtro) {
  if (!filtro || filtro.nivel === 'nacional' || (!filtro.depto && !filtro.muni)) return 'Cobertura: Nacional'
  if (filtro.muni) return `Municipio: ${filtro.muni} (${filtro.depto})`
  return `Departamento: ${filtro.depto}`
}

// Path SVG (polígono) de un sector de anillo centrado en (0,0).
function slicePath(R, r, a0, a1) {
  const seg = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 64))
  const pts = []
  for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * (i / seg); pts.push([R * Math.cos(a), R * Math.sin(a)]) }
  for (let i = seg; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / seg); pts.push([r * Math.cos(a), r * Math.sin(a)]) }
  return 'M ' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ') + ' Z'
}

// Anillo completo (para el estado "sin votos").
function ringPath(R, r) {
  return slicePath(R, r, 0, Math.PI * 1.999)
}

// Genera el PDF y devuelve los bytes (Uint8Array). Separado de la descarga
// para poder previsualizarlo/probarlo sin disparar el diálogo del navegador.
export async function generarReportePDF({ proyecto, articulos = [], resumen = [], filtro }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Logo (transparente, café). Si falla la carga, seguimos sin logo.
  let logo = null
  try {
    const bytes = await fetch('/logo-nav.png').then(r => r.arrayBuffer())
    logo = await pdf.embedPng(bytes)
  } catch { /* sin logo */ }

  const fechaDescarga = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

  let page, y

  function nuevaPagina() {
    page = pdf.addPage([A4.w, A4.h])
    // Encabezado de marca
    let tx = M
    if (logo) {
      const lh = 34, lw = logo.width * (lh / logo.height)
      page.drawImage(logo, { x: M, y: A4.h - M - lh, width: lw, height: lh })
      tx = M + lw + 12
    }
    page.drawText('Parada Bridge', { x: tx, y: A4.h - M - 13, size: 15, font: bold, color: PAL.ink })
    page.drawText('Informe de resultados — Debate ciudadano de proyectos de ley', {
      x: tx, y: A4.h - M - 28, size: 9, font, color: PAL.muted,
    })
    page.drawLine({ start: { x: M, y: A4.h - M - 42 }, end: { x: A4.w - M, y: A4.h - M - 42 }, thickness: 1, color: PAL.hair })
    y = A4.h - M - 62
  }

  // Envuelve texto a un ancho máximo (en pt) devolviendo líneas.
  function wrap(text, size, f, maxW) {
    const words = String(text).split(/\s+/)
    const lines = []
    let cur = ''
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w }
      else cur = t
    }
    if (cur) lines.push(cur)
    return lines
  }

  nuevaPagina()

  // ── Bloque de cabecera del proyecto ──
  for (const line of wrap(proyecto.nombre || 'Proyecto de ley', 18, bold, CW)) {
    page.drawText(line, { x: M, y, size: 18, font: bold, color: PAL.ink }); y -= 22
  }
  y -= 2
  const metaLinea = [proyecto.numero, proyecto.fecha_radicacion ? `Radicado el ${fmtFechaLarga(proyecto.fecha_radicacion)}` : null]
    .filter(Boolean).join('  ·  ')
  if (metaLinea) { page.drawText(metaLinea, { x: M, y, size: 10, font, color: PAL.cafe }); y -= 15 }
  page.drawText(`${filtroLabel(filtro)}     Fecha de descarga: ${fechaDescarga}`, { x: M, y, size: 9.5, font, color: PAL.muted })
  y -= 20

  // ── Ámbitos: proyecto completo + cada artículo ──
  const scopes = [{ id: null, titulo: 'Proyecto completo' }]
  for (const a of articulos) {
    scopes.push({ id: a.id, titulo: `Artículo ${a.numero ?? ''}${a.titulo ? ` — ${a.titulo}` : ''}`.trim() })
  }

  const BLOCK_H = 168
  for (const sc of scopes) {
    if (y - BLOCK_H < M) { nuevaPagina() }

    // Título del ámbito
    const tLines = wrap(sc.titulo, 12.5, bold, CW)
    for (const line of tLines) { page.drawText(line, { x: M, y, size: 12.5, font: bold, color: PAL.cafe }); y -= 16 }
    y -= 4

    const c = contar(resumen, sc.id, filtro)
    const total = c.a_favor + c.en_contra + c.neutral

    // Donut a la izquierda
    const R = 58, r = 34
    const cx = M + R + 6
    const cy = y - R
    if (total === 0) {
      page.drawSvgPath(ringPath(R, r), { x: cx, y: cy, color: PAL.hair })
    } else {
      let a0 = -Math.PI / 2
      for (const a of APOYA) {
        const v = c[a.key]
        if (!v) continue
        const a1 = a0 + (v / total) * Math.PI * 2
        page.drawSvgPath(slicePath(R, r, a0, a1), { x: cx, y: cy, color: COLOR_APOYA[a.key] })
        a0 = a1
      }
    }
    // Total al centro del donut
    const totalStr = String(total)
    page.drawText(totalStr, { x: cx - bold.widthOfTextAtSize(totalStr, 20) / 2, y: cy - 4, size: 20, font: bold, color: PAL.ink })
    const votLbl = total === 1 ? 'voto' : 'votos'
    page.drawText(votLbl, { x: cx - font.widthOfTextAtSize(votLbl, 8) / 2, y: cy - 16, size: 8, font, color: PAL.muted })

    // Resumen + leyenda a la derecha
    const rx = M + R * 2 + 34
    let ry = y - 6
    const pctd = (v) => total ? Math.round((v / total) * 100) : 0
    const resumenTxt = total === 0
      ? 'Aún no hay votos registrados para este ámbito.'
      : `De un total de ${total} votos: ${c.a_favor} a favor (sí), ${c.en_contra} en contra (no)` +
        (c.neutral ? ` y ${c.neutral} neutrales.` : '.')
    for (const line of wrap(resumenTxt, 10.5, font, CW - (rx - M))) {
      page.drawText(line, { x: rx, y: ry, size: 10.5, font, color: PAL.ink }); ry -= 14
    }
    ry -= 6
    for (const a of APOYA) {
      const v = c[a.key]
      page.drawRectangle({ x: rx, y: ry - 1, width: 10, height: 10, color: COLOR_APOYA[a.key] })
      page.drawText(`${a.label}`, { x: rx + 16, y: ry, size: 10, font: bold, color: PAL.ink })
      const valTxt = `${v}  ·  ${pctd(v)}%`
      page.drawText(valTxt, { x: A4.w - M - font.widthOfTextAtSize(valTxt, 10), y: ry, size: 10, font, color: PAL.cafe })
      ry -= 16
    }

    y = Math.min(cy - R - 18, ry - 6)
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4.w - M, y: y + 4 }, thickness: 0.6, color: PAL.hair })
    y -= 12
  }

  // Pie de página en todas las páginas
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawText(`Parada Bridge · paradabridge.com · Generado el ${fechaDescarga}`, {
      x: M, y: 26, size: 8, font, color: PAL.muted,
    })
    p.drawText(`Página ${i + 1} de ${paginas.length}`, {
      x: A4.w - M - font.widthOfTextAtSize(`Página ${i + 1} de ${paginas.length}`, 8), y: 26, size: 8, font, color: PAL.muted,
    })
  })

  return await pdf.save()
}

export async function descargarReportePDF(args) {
  const pdfBytes = await generarReportePDF(args)
  const p = args.proyecto || {}
  const nombre = `resultados-${(p.numero || p.nombre || 'proyecto').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.pdf`
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombre
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
