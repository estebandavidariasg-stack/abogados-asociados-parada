// Envía correos de trazabilidad de DEMO al gestor (esteban2098m@gmail.com).
// Uso: node scripts/enviar-trazabilidad-demo.mjs
// Requiere GMAIL_USER + GMAIL_PASS en .env.local y nodemailer instalado.

import fs from 'node:fs'
import nodemailer from 'nodemailer'
import { renderTrazabilidadEmail, asuntoTrazabilidad } from '../api/_lib/emailTrazabilidad.js'

// ── Cargar .env.local a mano (script fuera del runtime de Vite/Vercel) ──
const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const GMAIL_USER = env.GMAIL_USER
const GMAIL_PASS = env.GMAIL_PASS
if (!GMAIL_USER || !GMAIL_PASS) { console.error('Faltan GMAIL_USER / GMAIL_PASS en .env.local'); process.exit(1) }

const DEST = 'esteban2098m@gmail.com'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
})

// Contexto de la consulta de demo (referido por el código del gestor).
const base = {
  referido: 'Andrés Duarte',
  profesional: 'Diana Restrepo',
  profesionalRol: 'abogado',
  area: 'Derecho Penal',
  codigo: 'AAP-4FZB4Y',
}

const secuencia = [
  { ...base, estado: 'inicio' },
  { ...base, estado: 'en_curso' },
  { ...base, estado: 'cierre', resultado: 'exitosa', comision: '$2.000' },
  // Etapa 4 (nueva): la comisión ya fue pagada, con comprobante en el panel.
  { ...base, estado: 'pago', comision: '$2.000' },
  // Un ejemplo de cierre no concluido (otro referido) para ver ambos estados:
  { referido: 'Marcela Ríos', profesional: 'Carlos Restrepo', profesionalRol: 'abogado', area: 'Derecho Laboral', codigo: 'AAP-4FZB4Y', estado: 'cierre', resultado: 'no_concluida' },
]

const pausa = (ms) => new Promise(r => setTimeout(r, ms))

for (const ctx of secuencia) {
  const html = renderTrazabilidadEmail(ctx)
  const subject = asuntoTrazabilidad(ctx)
  try {
    const info = await transporter.sendMail({
      from: `"Parada Bridge · Gestores" <${GMAIL_USER}>`,
      to: DEST,
      subject: `[DEMO] ${subject}`,
      html,
    })
    console.log('enviado:', ctx.estado, ctx.resultado || '', '→', info.messageId)
  } catch (e) {
    console.error('fallo:', ctx.estado, e?.message || e)
  }
  await pausa(1200)
}
console.log('Listo. Revisa', DEST)
