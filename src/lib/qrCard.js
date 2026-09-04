/* ─────────────────────────────────────────────────────────────────────────
   Tarjeta QR de marca (Parada Bridge) — helper compartido.

   Usado por:
     · admin/CodigosReferencia  → códigos de comisionista + código oficial
     · pages/ProfileGestorPage  → el gestor descarga el QR que le asignaron

   `getQRUrl` devuelve la imagen del QR (servicio externo). `downloadQRCard`
   rasteriza en canvas una tarjeta navy+dorado en alta resolución y la descarga.
   El QR puede apuntar a cualquier URL (chat con código prellenado, o el sitio
   oficial), por eso el `target` es explícito.
   ───────────────────────────────────────────────────────────────────────── */

const APP_URL = 'https://paradabridge.com'

// Deep-link al chat con el código prellenado (códigos de comisionista/gestor).
export function chatUrlFor(codigo) {
  return `${APP_URL}/#chat?codigo=${encodeURIComponent(codigo)}`
}

// URL de la imagen del QR para previsualización inline.
export function getQRUrl(target, size = 320) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}` +
    `&data=${encodeURIComponent(target)}&color=1A1A2E&bgcolor=FAFAFA&margin=2&qzone=1`
}

/**
 * Descarga la tarjeta PNG (600×860 @2x) con el QR embebido.
 * @param {object} o
 * @param {string} o.target      URL que codifica el QR.
 * @param {string} o.codigo      Texto del código mostrado bajo el QR.
 * @param {string} [o.nombre]    Titular (línea principal del pie).
 * @param {string} [o.apellido]
 * @param {string} [o.subtitulo] Rol bajo el nombre (ej "Comisionista Autorizado").
 * @param {string} [o.etiqueta]  Encabezado sobre el QR.
 * @param {string} [o.instruccion] Texto de instrucción sobre la URL.
 * @param {string} [o.filename]  Nombre del archivo descargado.
 */
export async function downloadQRCard({
  target,
  codigo,
  nombre = '',
  apellido = '',
  subtitulo = 'Comisionista Autorizado',
  etiqueta = 'CÓDIGO DE REFERENCIA AUTORIZADO',
  instruccion = 'Escanea el código QR para iniciar tu consulta jurídica',
  filename,
}) {
  const SCALE = 2
  const W = 600, H = 860

  // Las MISMAS tipografías de la página (Cinzel para marca/nombre, Poppins
  // para el resto). El canvas solo las usa si ya están cargadas en el
  // documento — se fuerzan aquí; si alguna falla, cae a serif/sans genérica.
  try {
    await Promise.all([
      document.fonts.load('700 24px Cinzel'),
      document.fonts.load('700 20px Cinzel'),
      document.fonts.load('600 10px Poppins'),
      document.fonts.load('700 26px Poppins'),
      document.fonts.load('400 11px Poppins'),
    ])
  } catch { /* fuentes genéricas como respaldo */ }
  const F_DISPLAY = 'Cinzel, Georgia, serif'
  const F_BODY    = 'Poppins, Arial, sans-serif'

  const canvas = document.createElement('canvas')
  canvas.width  = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)

  // Fondo claro (marfil de marca) — la tarjeta se lee y se imprime mejor que
  // la versión café oscura anterior, y el QR contrasta más.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0,   '#fffdf6')
  bg.addColorStop(0.5, '#f7eedf')
  bg.addColorStop(1,   '#fdf8ee')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Textura sutil.
  ctx.fillStyle = 'rgba(109,60,27,0.015)'
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

  // Marco exterior.
  ctx.strokeStyle = 'rgba(169,132,47,0.4)'
  ctx.lineWidth = 1
  ctx.strokeRect(24, 24, W - 48, H - 48)

  // Líneas acento.
  ctx.strokeStyle = '#C9A84C'
  ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(110, 24); ctx.lineTo(W - 110, 24); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(110, H - 24); ctx.lineTo(W - 110, H - 24); ctx.stroke()

  // Esquinas decorativas.
  const corners = [[44,44],[W-44,44],[44,H-44],[W-44,H-44]]
  const dirs    = [[1,1],[-1,1],[1,-1],[-1,-1]]
  ctx.strokeStyle = 'rgba(169,132,47,0.7)'
  ctx.lineWidth = 2
  corners.forEach(([cx,cy], i) => {
    const [dx,dy] = dirs[i]
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+dx*24,cy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+dy*24); ctx.stroke()
  })

  // Cabecera firma (solo la marca — sin el rótulo "Despacho jurídico").
  ctx.textAlign = 'center'
  ctx.font = `700 26px ${F_DISPLAY}`
  ctx.fillStyle = '#472f29'
  const wParada = ctx.measureText('PARADA ').width
  const wBridge = ctx.measureText('BRIDGE').width
  const startX = W / 2 - (wParada + wBridge) / 2
  ctx.textAlign = 'left'
  ctx.fillText('PARADA ', startX, 108)
  ctx.fillStyle = '#9a7a2c'
  ctx.fillText('BRIDGE', startX + wParada, 108)
  ctx.textAlign = 'center'

  // Separador 1.
  ctx.strokeStyle = 'rgba(169,132,47,0.3)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(100,148); ctx.lineTo(W-100,148); ctx.stroke()
  ctx.fillStyle = 'rgba(169,132,47,0.6)'
  ctx.beginPath(); ctx.moveTo(W/2,143); ctx.lineTo(W/2+5,148); ctx.lineTo(W/2,153); ctx.lineTo(W/2-5,148); ctx.closePath(); ctx.fill()

  // Etiqueta.
  ctx.fillStyle = 'rgba(71,47,41,0.65)'
  ctx.font = `600 10px ${F_BODY}`
  ctx.fillText(etiqueta, W / 2, 178)

  // QR a 700px — nítido en canvas 2x.
  const qrApiUrl = getQRUrl(target, 700)
  const qrImg = new Image()
  qrImg.crossOrigin = 'anonymous'
  await new Promise((res, rej) => { qrImg.onload = res; qrImg.onerror = rej; qrImg.src = qrApiUrl })

  // Fondo blanco redondeado para el QR.
  const qrX = 148, qrY = 196, qrSize = 304, r = 10
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(109,60,27,0.18)'
  ctx.shadowBlur = 24
  ctx.beginPath()
  ctx.moveTo(qrX+r,qrY)
  ctx.arcTo(qrX+qrSize,qrY,qrX+qrSize,qrY+qrSize,r)
  ctx.arcTo(qrX+qrSize,qrY+qrSize,qrX,qrY+qrSize,r)
  ctx.arcTo(qrX,qrY+qrSize,qrX,qrY,r)
  ctx.arcTo(qrX,qrY,qrX+qrSize,qrY,r)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.strokeStyle = 'rgba(201,168,76,0.4)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.drawImage(qrImg, qrX+10, qrY+10, qrSize-20, qrSize-20)

  // Código — Poppins con tracking (dibujado letra a letra), nada de monospace.
  ctx.fillStyle = '#6d3c1b'
  ctx.font = `700 26px ${F_BODY}`
  {
    const chars = String(codigo).split('')
    const TRACK = 3   // px extra entre caracteres (legibilidad del código)
    const total = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + TRACK * (chars.length - 1)
    let x = W / 2 - total / 2
    ctx.textAlign = 'left'
    chars.forEach(c => { ctx.fillText(c, x, 562); x += ctx.measureText(c).width + TRACK })
    ctx.textAlign = 'center'
  }

  // Separador 2.
  ctx.strokeStyle = 'rgba(169,132,47,0.28)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(100,582); ctx.lineTo(W-100,582); ctx.stroke()
  ctx.fillStyle = 'rgba(169,132,47,0.55)'
  ctx.beginPath(); ctx.moveTo(W/2,577); ctx.lineTo(W/2+4,582); ctx.lineTo(W/2,587); ctx.lineTo(W/2-4,582); ctx.closePath(); ctx.fill()

  // Nombre.
  const titular = `${nombre} ${apellido}`.trim()
  if (titular) {
    ctx.fillStyle = '#472f29'
    ctx.font = `700 21px ${F_DISPLAY}`
    ctx.fillText(titular, W/2, 632)
  }

  if (subtitulo) {
    ctx.fillStyle = 'rgba(109,60,27,0.75)'
    ctx.font = `600 9.5px ${F_BODY}`
    ctx.fillText(subtitulo.toUpperCase(), W/2, titular ? 658 : 636)
  }

  // Instrucción.
  ctx.fillStyle = 'rgba(71,47,41,0.65)'
  ctx.font = `400 11px ${F_BODY}`
  ctx.fillText(instruccion, W/2, 722)

  // URL de marca.
  ctx.fillStyle = '#9a7a2c'
  ctx.font = `600 12px ${F_BODY}`
  ctx.fillText('paradabridge.com', W/2, 806)

  // Descargar.
  const link = document.createElement('a')
  link.download = filename || `Tarjeta_PB_${codigo}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}
