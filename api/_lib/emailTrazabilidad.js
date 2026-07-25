// ── Correo de trazabilidad para el gestor ──────────────────────────────────
//  Reutiliza la MISMA tarjeta de marca (renderShell) que el resto de correos
//  AAP: header "Parada Bridge" navy/oro, cuerpo y pie. Adentro, una barra de
//  progreso de 3 etapas (Inicio → En desarrollo → Cierre) y, al cerrar, el
//  resultado (Exitosa / No concluida).

import { renderShell, emailButton, em, C, FONT_SANS } from './emailTemplate.js'

const APP_URL = process.env.VITE_APP_URL || 'https://abogadosparada.com'

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Barra de progreso de 3 pasos (tabla email-safe, tema claro de la marca).
function barra(pasoActual) {
  const pasos = ['Inicio', 'En desarrollo', 'Cierre']
  const idx = { inicio: 0, en_curso: 1, cierre: 2 }[pasoActual] ?? 0
  const celdas = pasos.map((label, i) => {
    const activo = i <= idx
    const bg = activo ? C.gold : '#e3ebf6'
    const num = activo ? C.navy : '#9fb0c8'
    const fg = activo ? C.navy : '#9fb0c8'
    return `
      <td align="center" width="33%" valign="top" style="padding:0 3px;">
        <div style="width:34px;height:34px;line-height:34px;margin:0 auto 9px;border-radius:50%;background-color:${bg};color:${num};font-family:${FONT_SANS};font-size:15px;font-weight:700;">${i + 1}</div>
        <div style="font-family:${FONT_SANS};font-size:12px;font-weight:700;color:${fg};letter-spacing:0.01em;">${label}</div>
      </td>`
  }).join('')
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
      <tr>${celdas}</tr>
    </table>`
}

/**
 * @param {object} o
 * @param {string} [o.gestorNombre] nombre del gestor (para el saludo)
 * @param {string} o.referido       cliente que llegó por el QR
 * @param {string} o.profesional    nombre del profesional
 * @param {string} o.profesionalRol 'abogado' | 'contador'
 * @param {string} o.area
 * @param {'inicio'|'en_curso'|'cierre'} o.estado
 * @param {'exitosa'|'no_concluida'|null} [o.resultado]
 * @param {string} [o.codigo]
 * @param {string} [o.comision]  ej "$2.500"
 */
export function renderTrazabilidadEmail(o) {
  const { gestorNombre, referido, profesional, profesionalRol, area, estado, resultado, codigo, comision } = o
  const trato = profesionalRol === 'contador' ? 'el contador' : 'la abogada/el abogado'
  const prof = esc(profesional || 'un profesional')
  const ref = esc(referido || 'tu referido')
  const saludo = gestorNombre ? `Estimado/a ${em(esc(gestorNombre))},` : 'Estimado/a gestor,'

  let titulo, cuerpo
  if (estado === 'inicio') {
    titulo = 'Tu referido inició su consulta'
    cuerpo = `${ref} entró por tu código y ya está en consulta con ${trato} ${em(prof)}${area ? ` en el área de ${em(esc(area))}` : ''}. Te avisaremos a medida que avance.`
  } else if (estado === 'en_curso') {
    titulo = 'La consulta está en desarrollo'
    cuerpo = `${ref} y ${trato} ${em(prof)} siguen trabajando en el caso${area ? ` de ${em(esc(area))}` : ''}. Todo marcha bien; falta el cierre.`
  } else if (resultado === 'exitosa') {
    titulo = 'Consulta cerrada con éxito'
    cuerpo = `La consulta de ${ref} con ${trato} ${em(prof)} se cerró de forma ${em('exitosa')}.` +
      (comision ? ` Tu comisión de ${em(esc(comision))} ya está disponible para solicitar el pago desde tu panel.` : '')
  } else {
    titulo = 'La consulta se cerró sin concretarse'
    cuerpo = `La consulta de ${ref} con ${trato} ${em(prof)} se cerró sin concretarse. Esta vez no genera comisión, pero gracias por traer el contacto.`
  }

  const badge = estado === 'cierre'
    ? `<div align="center" style="margin-top:8px;"><span style="display:inline-block;padding:7px 18px;border-radius:999px;font-family:${FONT_SANS};font-size:12px;font-weight:700;letter-spacing:0.04em;${
        resultado === 'exitosa'
          ? 'color:#1f7a4d;background-color:#e7f6ee;border:1px solid #bfe6cf;'
          : 'color:#b23b3b;background-color:#fbeded;border:1px solid #f0cccc;'
      }">${resultado === 'exitosa' ? 'RESULTADO · EXITOSA' : 'RESULTADO · NO CONCLUIDA'}</span></div>`
    : ''

  const refPie = codigo
    ? `<div style="font-family:${FONT_SANS};font-size:12px;color:${C.muted};margin-top:20px;text-align:center;">Código: <strong style="color:${C.goldText};">${esc(codigo)}</strong></div>`
    : ''

  const inner =
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.navy};">${saludo}</p>
     <h1 style="margin:0 0 12px;font-family:${FONT_SANS};font-size:19px;font-weight:700;color:${C.navy};line-height:1.35;">${esc(titulo)}</h1>
     <div style="margin:0 0 8px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">${cuerpo}</div>
     ${barra(estado)}
     ${badge}
     <div style="text-align:center;margin-top:28px;">${emailButton('Ir a mi panel', `${APP_URL}/perfil-gestor`)}</div>
     ${refPie}`

  return renderShell({
    subjectLine: `Seguimiento de tu referido${area ? ` · ${esc(area)}` : ''}`,
    preheader: titulo,
    innerHtml: inner,
  })
}

export function asuntoTrazabilidad(o) {
  if (o.estado === 'inicio')   return `${o.referido || 'Tu referido'} inició su consulta`
  if (o.estado === 'en_curso') return `La consulta de ${o.referido || 'tu referido'} avanza`
  return o.resultado === 'exitosa'
    ? 'Consulta cerrada con éxito · comisión disponible'
    : `La consulta de ${o.referido || 'tu referido'} se cerró`
}
