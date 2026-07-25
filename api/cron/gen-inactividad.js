/* ────────────────────────────────────────────────────────────────────────
   GET /api/cron/gen-inactividad   (Vercel Cron)
   Escanea salas waiting/active sin actividad en 24h y crea las notificaciones
   `inactividad` que falten (dedup por sala con atendida=false). Sin correo.

   Protección: Vercel envía «Authorization: Bearer <CRON_SECRET>» a los crons
   cuando CRON_SECRET está configurado en el proyecto. Validamos ese header.

   Programación en vercel.json:
     { "crons": [{ "path": "/api/cron/gen-inactividad", "schedule": "0 * * * *" }] }
   (cada hora en Pro; en Hobby Vercel lo corre 1×/día — suficiente para 24h.)
──────────────────────────────────────────────────────────────────────── */

import nodemailer from 'nodemailer'
import { SUPABASE_URL, serviceHeaders } from '../_lib/adminAuth.js'
import { renderShell, emailButton, C, FONT_SANS, FONT_SERIF } from '../_lib/emailTemplate.js'

const DIA_MS = 24 * 60 * 60 * 1000
const BARRERA_MS = 4 * 60 * 60 * 1000  // 4h desde que se notificó al profesional

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
})
const APP_URL = (process.env.VITE_APP_URL || process.env.APP_URL || 'https://abogadosparada.com')
  .replace(/\/$/, '')

// Escapa texto de usuario que se inyecta en el HTML del correo.
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/* Correo de reseña: sello "Ayudamos a mejorar" + 5 estrellas clicables
   (enmarcadas) → /opinar?token=..&rating=N, siguiendo el estético AAP. */
export function renderResenaEmail({ nombre, token }) {
  const base = `${APP_URL}/opinar`
  const link = (extra = '') => `${base}?token=${encodeURIComponent(token)}${extra}`
  const estrellas = [1, 2, 3, 4, 5].map(n =>
    `<a href="${link(`&rating=${n}`)}" target="_blank" ` +
    `style="font-size:40px;line-height:1;color:${C.gold};text-decoration:none;margin:0 5px;">&#9733;</a>`
  ).join('')

  const inner =
    `<div style="text-align:center;">
       <div style="font-family:${FONT_SANS};font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${C.goldText};margin:0 0 12px;">
         Ayudamos a mejorar
       </div>
       <h1 style="font-family:${FONT_SERIF};font-size:23px;font-weight:700;color:${C.navy};line-height:1.35;margin:0 0 14px;">
         ${nombre ? `${esc(nombre)}, ` : ''}tu opinión nos hace mejores
       </h1>
       <p style="margin:0 auto 24px;font-size:15px;line-height:1.75;color:${C.body};max-width:420px;">
         Gracias por confiar en Parada Bridge. Cuéntanos cómo fue tu experiencia con nuestra página:
         cada reseña nos ayuda a mejorar para ti y para quienes vienen después.
       </p>

       <!-- Estrellas enmarcadas (mini-tarjeta cálida) -->
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
         <tr>
           <td align="center" style="background-color:#faf6ec;border:1px solid #efe4c4;border-radius:14px;padding:24px 16px;">
             <div style="margin:0 0 10px;">${estrellas}</div>
             <div style="font-family:${FONT_SANS};font-size:12.5px;color:${C.muted};letter-spacing:0.02em;">
               Toca una estrella para calificar
             </div>
           </td>
         </tr>
       </table>

       <div>${emailButton('Escribir mi opinión', link())}</div>
       <p style="margin:22px auto 0;max-width:420px;font-size:12.5px;line-height:1.7;color:${C.muted};">
         Si quieres, deja el link de una red social (Instagram, Facebook…). Nos ayuda a mostrar en
         nuestras reseñas que eres una persona real. Es opcional.
       </p>
       <p style="margin:10px 0 0;font-size:12px;color:${C.muted};">Solo te tomará un minuto.</p>
     </div>`

  return renderShell({
    subjectLine: 'Ayúdanos a mejorar',
    preheader: 'Tu opinión sobre Parada Bridge nos ayuda a mejorar',
    innerHtml: inner,
  })
}

/* Envía los correos de reseña pendientes cuya espera de 5 min ya venció y las
   marca `enviada`. Devuelve cuántas envió. Reutilizado por pg_cron (cada 5 min)
   que hace POST a este endpoint. */
async function procesarResenas() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return 0
  const ahora = new Date().toISOString()
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/resenas` +
    `?estado=eq.pendiente&enviar_despues=lte.${ahora}&select=id,token,nombre,correo&limit=50`,
    { headers: serviceHeaders() }
  )
  const filas = await r.json().catch(() => null)
  if (!Array.isArray(filas) || filas.length === 0) return 0

  let enviadas = 0
  for (const f of filas) {
    try {
      await transporter.sendMail({
        from: `"Parada Bridge" <${process.env.GMAIL_USER}>`,
        to: f.correo,
        subject: 'Cuéntanos tu opinión sobre nuestra página',
        html: renderResenaEmail({ nombre: f.nombre, token: f.token }),
      })
      await fetch(`${SUPABASE_URL}/rest/v1/resenas?id=eq.${f.id}`, {
        method: 'PATCH',
        headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ estado: 'enviada' }),
      })
      enviadas++
    } catch (e) {
      console.error('[cron resenas] fallo enviando a', f.id, e?.message || e)
    }
  }
  return enviadas
}

/* Ejecuta una query con `campo=in.(...)` troceada en lotes de ~150 ids y
   concatena los resultados. Un in.() con cientos de UUIDs supera el límite de
   longitud de URL del gateway → la request entera falla (o PostgREST trunca
   en max-rows en silencio) justo cuando la plataforma más salas tiene. */
async function fetchInBatches(baseUrl, campo, ids, resto, tam = 150) {
  const out = []
  for (let i = 0; i < ids.length; i += tam) {
    const lote = ids.slice(i, i + tam)
    const r = await fetch(
      `${baseUrl}?${campo}=in.(${lote.join(',')})${resto}&limit=1000`,
      { headers: serviceHeaders() }
    )
    const rows = await r.json().catch(() => null)
    if (Array.isArray(rows)) out.push(...rows)
  }
  return out
}

/* ── SEGUNDA BARRERA: escalada a reasignación obligatoria (4h) ──────────────
   El admin ya notificó al profesional (api/notify.js selló `notificado_at` en
   la notificación de inactividad). Si pasaron 4h+ y la sala SIGUE sin mensajes
   desde ese sello y sigue abierta, se marca la sala `reasignacion_forzada=true`
   y se inserta UNA notificación `reasignacion_obligatoria` (dedup por sala).

   Idempotente y correcta a cualquier cadencia (compara contra now()):
   si el cron corre 1×/día o 1×/hora, el corte notificado_at < now()-4h no
   cambia. Devuelve cuántas escalaciones creó. */
async function procesarBarrera4h() {
  const corte = new Date(Date.now() - BARRERA_MS).toISOString()

  // 1) Notificaciones de inactividad ya notificadas hace 4h+, sin atender.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/notificaciones` +
    `?tipo=eq.inactividad&atendida=eq.false&notificado_at=not.is.null&notificado_at=lt.${corte}` +
    `&select=room_id,lawyer_id,client_nombre,area,notificado_at&limit=1000`,
    { headers: serviceHeaders() }
  )
  const notifs = await r.json().catch(() => null)
  if (!Array.isArray(notifs) || notifs.length === 0) return 0

  // Una notificación por sala (la más antigua notificada basta como ancla).
  const porSala = {}
  for (const n of notifs) {
    if (!n.room_id) continue
    const prev = porSala[n.room_id]
    if (!prev || new Date(n.notificado_at) < new Date(prev.notificado_at)) porSala[n.room_id] = n
  }
  const roomIds = Object.keys(porSala)
  if (roomIds.length === 0) return 0

  // 2) Salas aún abiertas (waiting/active) y no escaladas todavía.
  const salas = await fetchInBatches(
    `${SUPABASE_URL}/rest/v1/chat_rooms`, 'id', roomIds,
    `&status=in.(waiting,active)&select=id,status,reasignacion_forzada`
  )
  const salaById = {}
  for (const s of salas) salaById[s.id] = s
  const candidatas = roomIds.filter(id => salaById[id]) // sigue abierta

  if (candidatas.length === 0) return 0

  // 3) ¿Hubo algún mensaje DESPUÉS del sello notificado_at? Si sí, ya no está
  //    inactiva → se descarta. Se consulta por sala (cada una tiene su propio
  //    ancla temporal, así que no se puede batchear con un solo gte global).
  const aunInactivas = []
  for (const id of candidatas) {
    const desde = porSala[id].notificado_at
    try {
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages` +
        `?room_id=eq.${id}&created_at=gt.${encodeURIComponent(desde)}&select=id&limit=1`,
        { headers: serviceHeaders() }
      )
      const rows = await mr.json().catch(() => null)
      if (Array.isArray(rows) && rows.length === 0) aunInactivas.push(id)
    } catch { /* ante la duda, no escalar */ }
  }
  if (aunInactivas.length === 0) return 0

  // 4) Dedup: saltar salas que YA tienen una escalada sin atender.
  const yaEscaladas = await fetchInBatches(
    `${SUPABASE_URL}/rest/v1/notificaciones`, 'room_id', aunInactivas,
    `&tipo=eq.reasignacion_obligatoria&atendida=eq.false&select=room_id`
  )
  const escaladasSet = new Set(yaEscaladas.map(n => n.room_id))
  const aEscalar = aunInactivas.filter(id => !escaladasSet.has(id))
  if (aEscalar.length === 0) return 0

  // 5) Marcar la sala con la bandera de barrera superada. `reasignado_at` se
  //    setea después, cuando el admin reasigna de verdad (api/reassign.js).
  for (const id of aEscalar) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${id}`, {
        method: 'PATCH',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ reasignacion_forzada: true }),
      })
    } catch (e) { console.error('[cron barrera] flag sala', id, e?.message || e) }
  }

  // 6) Insertar las escalaciones (batch).
  const filas = aEscalar.map(id => {
    const n = porSala[id]
    return {
      tipo: 'reasignacion_obligatoria', room_id: id,
      lawyer_id: n.lawyer_id || null,
      client_nombre: n.client_nombre || 'Anónimo',
      area: n.area || 'Consulta',
      mensaje: 'Barrera de 4h superada: el profesional no respondió tras ser notificado. Reasignación obligatoria.',
    }
  })
  await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(filas),
  })
  return filas.length
}

export default async function handler(req, res) {
  // Auth del cron.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || req.headers.Authorization || ''
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'No autorizado.' })
    }
  }

  // Cola de reseñas: se procesa en CADA invocación (pg_cron la llama cada 5 min).
  // Su fallo no debe tumbar el escaneo de inactividad, y viceversa.
  let enviadas = 0
  try { enviadas = await procesarResenas() }
  catch (e) { console.error('[cron resenas] error:', e?.message || e) }

  // ── PASO A: primera barrera (24h) — inserta notificaciones `inactividad` ──
  // No debe impedir la segunda barrera: si algo falla acá, se registra y se
  // sigue con la escalada de 4h igual.
  let creadas = 0
  try {
    const hace24h = new Date(Date.now() - DIA_MS).toISOString()

    // 1) Salas abiertas (no cerradas). Limit explícito: sin él PostgREST
    //    trunca en max-rows en silencio; 1000 salas abiertas cubren de sobra
    //    un ciclo del cron (las más antiguas entran al siguiente).
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms?status=in.(waiting,active)&select=id,client_nombre,area_derecho,created_at&order=created_at.asc&limit=1000`,
      { headers: serviceHeaders() }
    )
    const rooms = await rRes.json()

    if (Array.isArray(rooms) && rooms.length > 0) {
      // 2) Salas con actividad reciente (mensaje en las últimas 24h) — lotes de
      //    50 salas: con limit=1000 por lote hay margen holgado y una sala CON
      //    actividad no puede quedar fuera del corte (falsa notificación).
      const msgs = await fetchInBatches(
        `${SUPABASE_URL}/rest/v1/chat_messages`, 'room_id', rooms.map(r => r.id),
        `&created_at=gte.${hace24h}&select=room_id`, 50
      )
      const conActividad = new Set(msgs.map(m => m.room_id))

      // Inactivas = sin actividad en 24h Y creadas hace más de 24h.
      const inactivas = rooms.filter(
        r => !conActividad.has(r.id) && new Date(r.created_at).getTime() < Date.now() - DIA_MS
      )

      if (inactivas.length > 0) {
        // 3) Notificaciones de inactividad YA existentes y sin atender (dedup) — por lotes.
        const existentes = await fetchInBatches(
          `${SUPABASE_URL}/rest/v1/notificaciones`, 'room_id', inactivas.map(r => r.id),
          `&tipo=eq.inactividad&atendida=eq.false&select=room_id`
        )
        const yaNotificadas = new Set(existentes.map(n => n.room_id))

        const nuevas = inactivas.filter(r => !yaNotificadas.has(r.id))

        if (nuevas.length > 0) {
          // 4) Abogado asignado a cada sala nueva (para mostrar / reasignar) — por lotes.
          const asignaciones = await fetchInBatches(
            `${SUPABASE_URL}/rest/v1/chat_room_lawyers`, 'room_id', nuevas.map(r => r.id),
            `&select=room_id,lawyer_id,status`
          )
          const lawyerByRoom = {}
          for (const a of asignaciones) {
            // Preferimos el 'active'; si no, el primero.
            if (!lawyerByRoom[a.room_id] || a.status === 'active') lawyerByRoom[a.room_id] = a.lawyer_id
          }

          // 5) Insertar (batch).
          const filas = nuevas.map(r => ({
            tipo: 'inactividad', room_id: r.id,
            lawyer_id: lawyerByRoom[r.id] || null,
            client_nombre: r.client_nombre || 'Anónimo',
            area: r.area_derecho || 'Consulta',
            mensaje: lawyerByRoom[r.id]
              ? 'El abogado asignado no ha respondido en 24h.'
              : 'Nadie ha tomado esta consulta en 24h.',
          }))
          await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
            method: 'POST',
            headers: serviceHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify(filas),
          })
          creadas = filas.length
        }
      }
    }
  } catch (e) {
    console.error('[cron gen-inactividad] error (barrera 24h):', e?.message || e)
  }

  // ── PASO B: segunda barrera (4h desde que se notificó al profesional) ──
  // Independiente del paso A: aunque no haya nuevas inactividades, puede haber
  // salas notificadas hace 4h+ que hay que escalar a reasignación obligatoria.
  let escaladas = 0
  try { escaladas = await procesarBarrera4h() }
  catch (e) { console.error('[cron gen-inactividad] error (barrera 4h):', e?.message || e) }

  return res.status(200).json({ ok: true, creadas, escaladas, resenas: enviadas })
}
