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

  const canvas = document.createElement('canvas')
  canvas.width  = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)

  // Fondo degradado navy (tono de marca).
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0,   '#6b3d15')
  bg.addColorStop(0.5, '#864e1d')
  bg.addColorStop(1,   '#6b3d15')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Textura sutil.
  ctx.fillStyle = 'rgba(255,255,255,0.013)'
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

  // Marco exterior.
  ctx.strokeStyle = 'rgba(201,168,76,0.3)'
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
  ctx.strokeStyle = 'rgba(201,168,76,0.65)'
  ctx.lineWidth = 2
  corners.forEach(([cx,cy], i) => {
    const [dx,dy] = dirs[i]
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+dx*24,cy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+dy*24); ctx.stroke()
  })

  // Cabecera firma.
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(232,201,106,0.85)'
  ctx.font = '600 9px sans-serif'
  ctx.fillText('─── DESPACHO JURÍDICO ───', W / 2, 74)

  ctx.font = 'bold 24px serif'
  ctx.fillStyle = '#ffffff'
  const wParada = ctx.measureText('PARADA ').width
  const wBridge = ctx.measureText('BRIDGE').width
  const startX = W / 2 - (wParada + wBridge) / 2
  ctx.textAlign = 'left'
  ctx.fillText('PARADA ', startX, 118)
  ctx.fillStyle = '#C9A84C'
  ctx.fillText('BRIDGE', startX + wParada, 118)
  ctx.textAlign = 'center'

  // Separador 1.
  ctx.strokeStyle = 'rgba(201,168,76,0.2)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(100,148); ctx.lineTo(W-100,148); ctx.stroke()
  ctx.fillStyle = 'rgba(201,168,76,0.55)'
  ctx.beginPath(); ctx.moveTo(W/2,143); ctx.lineTo(W/2+5,148); ctx.lineTo(W/2,153); ctx.lineTo(W/2-5,148); ctx.closePath(); ctx.fill()

  // Etiqueta.
  ctx.fillStyle = 'rgba(255,255,255,0.62)'
  ctx.font = '600 10px sans-serif'
  ctx.fillText(etiqueta, W / 2, 178)

  // QR a 700px — nítido en canvas 2x.
  const qrApiUrl = getQRUrl(target, 700)
  const qrImg = new Image()
  qrImg.crossOrigin = 'anonymous'
  await new Promise((res, rej) => { qrImg.onload = res; qrImg.onerror = rej; qrImg.src = qrApiUrl })

  // Fondo blanco redondeado para el QR.
  const qrX = 148, qrY = 196, qrSize = 304, r = 10
  ctx.fillStyle = '#FAFAFA'
  ctx.shadowColor = 'rgba(201,168,76,0.2)'
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

  // Código.
  ctx.fillStyle = '#C9A84C'
  ctx.font = 'bold 26px monospace'
  ctx.shadowColor = 'rgba(201,168,76,0.35)'
  ctx.shadowBlur = 12
  ctx.fillText(codigo, W/2, 562)
  ctx.shadowBlur = 0

  // Separador 2.
  ctx.strokeStyle = 'rgba(201,168,76,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(100,582); ctx.lineTo(W-100,582); ctx.stroke()
  ctx.fillStyle = 'rgba(201,168,76,0.45)'
  ctx.beginPath(); ctx.moveTo(W/2,577); ctx.lineTo(W/2+4,582); ctx.lineTo(W/2,587); ctx.lineTo(W/2-4,582); ctx.closePath(); ctx.fill()

  // Nombre.
  const titular = `${nombre} ${apellido}`.trim()
  if (titular) {
    ctx.fillStyle = '#fbf7ec'
    ctx.font = 'bold 20px serif'
    ctx.fillText(titular, W/2, 632)
  }

  if (subtitulo) {
    ctx.fillStyle = 'rgba(232,201,106,0.8)'
    ctx.font = '600 9.5px sans-serif'
    ctx.fillText(subtitulo.toUpperCase(), W/2, titular ? 656 : 636)
  }

  // Instrucción.
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '11px sans-serif'
  ctx.fillText(instruccion, W/2, 722)

  // URL de marca.
  ctx.fillStyle = 'rgba(232,201,106,0.85)'
  ctx.font = '600 12px sans-serif'
  ctx.fillText('paradabridge.com', W/2, 806)

  // Descargar.
  const link = document.createElement('a')
  link.download = filename || `Tarjeta_PB_${codigo}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}
