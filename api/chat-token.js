// ───────────────────────────────────────────────────────────────────────────
// POST /api/chat-token
//
// Emite un JWT de "cliente anónimo" para el chat: role='anon' + un claim
// `client_token` = hash de la cédula. Las políticas RLS v2 de chat_rooms /
// chat_messages acotan las filas por ese claim
// (client_token = request.jwt.claims ->> 'client_token'), así que con este
// token el cliente solo ve/recibe (REST y Realtime) SUS salas y mensajes.
//
// Se firma HS256 con SUPABASE_JWT_SECRET (el "Legacy JWT Secret" del proyecto,
// el mismo que verifica la anon key), así que Supabase lo acepta. El role es
// SIEMPRE 'anon' (hardcodeado); lo único que aporta el llamante es el hash, que
// no otorga más de lo que ya otorga conocer la cédula (mismo modelo actual).
//
// Requiere: SUPABASE_JWT_SECRET (nueva var de entorno en Vercel + .env.local).
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'

const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const PROJECT_REF  = (SUPABASE_URL.match(/https?:\/\/([^.]+)\./) || [])[1] || ''

const TTL_SECONDS = 60 * 60 * 4 // 4 horas (una consulta cabe de sobra; se re-emite al retomar)

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Firma un JWT HS256 sin dependencias externas.
function signHS256(payload, secret) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body    = b64url(JSON.stringify(payload))
  const data    = `${header}.${body}`
  const sig     = crypto.createHmac('sha256', secret).update(data).digest()
  return `${data}.${b64url(sig)}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!JWT_SECRET) {
    console.error('[chat-token] falta SUPABASE_JWT_SECRET')
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' })
  }

  const { cedulaHash } = req.body || {}
  // El hash es SHA-256 hex (64 chars). Rechazamos cualquier otra cosa: el claim
  // solo puede ser un identificador de sala de cliente, nunca texto arbitrario.
  if (typeof cedulaHash !== 'string' || !/^[a-f0-9]{64}$/i.test(cedulaHash)) {
    return res.status(400).json({ error: 'Identificador inválido.' })
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + TTL_SECONDS

  const payload = {
    iss:          'supabase',
    role:         'anon',            // SIEMPRE anon — no se escala nada
    client_token: cedulaHash.toLowerCase(),
    iat:          now,
    exp,
  }
  if (PROJECT_REF) payload.ref = PROJECT_REF

  const token = signHS256(payload, JWT_SECRET)
  return res.status(200).json({ token, exp })
}
