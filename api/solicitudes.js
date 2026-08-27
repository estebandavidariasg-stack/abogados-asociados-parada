// api/solicitudes.js
// Endpoint ÚNICO de "solicitudes abiertas" (modelo claim tipo Uber/DiDi).
// Consolida 3 acciones en una sola función serverless (límite Hobby = 12 funciones):
//   GET                          -> lista las solicitudes 'open' del tipo del profesional (+ resumen)
//   POST { accion: 'publicar' }  -> el cliente publica su consulta (crea sala 'open' + intro)
//   POST { accion: 'tomar', roomId } -> el profesional toma una solicitud (claim atómico, primero gana)
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';
import crypto from 'node:crypto';

const cap = (s, n) => String(s || '').slice(0, n);

// ── Emisión del JWT del cliente anónimo (fusionado aquí por el límite de 12
//    funciones serverless de Vercel Hobby; antes era api/chat-token.js) ──
const JWT_SECRET     = process.env.SUPABASE_JWT_SECRET;
const PROJECT_REF    = (SUPABASE_URL?.match(/https?:\/\/([^.]+)\./) || [])[1] || '';
const CHAT_TOKEN_TTL = 60 * 60 * 4; // 4 horas

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signHS256(payload, secret) {
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${b64url(crypto.createHmac('sha256', secret).update(data).digest())}`;
}

// Extrae la "Descripción del caso" del mensaje de intro y la recorta.
function resumenDeMensaje(content) {
  if (!content) return '';
  let txt = String(content);
  const marca = 'Descripción del caso:';
  const ix = txt.indexOf(marca);
  if (ix >= 0) txt = txt.slice(ix + marca.length);
  txt = txt.split('📋')[0];
  txt = txt.replace(/\s+/g, ' ').trim();
  return txt.length > 180 ? txt.slice(0, 180).trimEnd() + '…' : txt;
}

// ── GET: listar solicitudes abiertas del tipo del profesional (con resumen) ──
async function listar(req, res) {
  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') { res.status(403).json({ error: 'No autorizado' }); return; }
  // `aprobado` ya viene en getCallerProfile — antes se releía la misma fila
  // de profiles en cada GET (el request más polleado del sistema).
  if (!perfil.aprobado) { res.status(403).json({ error: 'Perfil no aprobado' }); return; }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_rooms` +
    `?status=eq.open&tipo_profesional=eq.${perfil.rol}` +
    `&select=id,client_nombre,area_derecho,created_at&order=created_at.desc&limit=20`,
    { headers: serviceHeaders() }
  );
  const salas = await r.json().catch(() => []);
  if (!Array.isArray(salas) || salas.length === 0) { res.status(200).json({ solicitudes: [] }); return; }

  const ids = salas.map(s => `"${s.id}"`).join(',');
  const primeros = {};
  try {
    const m = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages` +
      `?room_id=in.(${ids})&sender_type=eq.client&select=room_id,content,created_at&order=created_at.asc`,
      { headers: serviceHeaders() }
    );
    const msgs = await m.json().catch(() => []);
    if (Array.isArray(msgs)) for (const msg of msgs) if (!(msg.room_id in primeros)) primeros[msg.room_id] = msg.content;
  } catch { /* sin resumen si falla */ }

  const solicitudes = salas.map(s => ({
    id: s.id,
    client_nombre: s.client_nombre,
    area_derecho: s.area_derecho,
    created_at: s.created_at,
    resumen: resumenDeMensaje(primeros[s.id]),
  }));
  res.status(200).json({ solicitudes });
}

// ── POST publicar: el cliente publica su consulta (crea sala 'open' + intro, service-role) ──
async function publicar(req, res) {
  const b = req.body || {};
  const cedulaHash = cap(b.cedulaHash, 128);
  const nombre = cap(b.nombre, 80).trim();
  const apellido = cap(b.apellido, 80).trim();
  const areas = Array.isArray(b.areas) ? b.areas.map(a => cap(a, 120)).filter(Boolean).slice(0, 3) : [];
  const descripcion = cap(b.descripcion, 4000).trim();
  const ubicacion = cap(b.ubicacion, 200).trim();
  const resumen = cap(b.resumen, 1200).trim();
  const correo = cap(b.correo, 160).trim() || null;
  const celular = cap(b.celular, 30).trim() || null;
  const genero = cap(b.genero, 30).trim() || null;
  const codigoRef = b.codigoRef ? cap(b.codigoRef, 60) : null;
  const tipo = b.tipoProfesional === 'contador' ? 'contador' : 'abogado';

  if (!cedulaHash || !nombre || !descripcion || areas.length === 0) {
    res.status(400).json({ error: 'Faltan datos para publicar la solicitud.' });
    return;
  }

  const baseRoom = {
    area_derecho:     areas.join(', '),
    client_token:     cedulaHash,
    client_cedula:    cedulaHash,
    client_email:     correo,
    client_nombre:    `${nombre} ${apellido}`.trim(),
    client_celular:   celular,
    client_genero:    genero,
    tipo_profesional: tipo,
    status:           'open',
  };

  async function crear(room) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms`, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(room),
    });
    const rows = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, row: Array.isArray(rows) ? rows[0] : rows };
  }

  let creada = await crear({ ...baseRoom, codigo_referencia: codigoRef });
  if (!creada.ok && creada.status === 409) creada = await crear({ ...baseRoom, codigo_referencia: null });
  if (!creada.ok || !creada.row?.id) { res.status(502).json({ error: 'No se pudo crear la consulta.' }); return; }
  const roomId = creada.row.id;

  // La descripción en el flujo guiado por IA ya es el resumen del asistente;
  // solo adjuntamos el bloque cuando difiere (evita repetir el mismo texto).
  const resumenBloque = (resumen && resumen !== descripcion) ? `\n\n📋 Resumen del asistente IA:\n${resumen}` : '';
  const content =
    `Hola, mi nombre es ${nombre} ${apellido}.\n\n` +
    `Ubicación: ${ubicacion}\nÁrea(s): ${areas.join(', ')}\n\n` +
    `Descripción del caso:\n${descripcion}${resumenBloque}`;

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ room_id: roomId, sender_type: 'client', lawyer_id: null, content }),
  }).catch(() => {});

  res.status(200).json({ ok: true, roomId });
}

// ── POST tomar: el profesional toma una solicitud (claim atómico) ──
async function tomar(req, res) {
  const roomId = cap((req.body || {}).roomId, 64);
  if (!roomId) { res.status(400).json({ error: 'Falta roomId' }); return; }
  const rid = encodeURIComponent(roomId);

  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') { res.status(403).json({ error: 'No autorizado' }); return; }
  if (!perfil.aprobado) { res.status(403).json({ error: 'Tu perfil aún no está aprobado.' }); return; }

  // Claim atómico: solo tiene éxito si la sala sigue 'open' y es del mismo tipo.
  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${rid}&status=eq.open&tipo_profesional=eq.${perfil.rol}`,
    { method: 'PATCH', headers: serviceHeaders({ Prefer: 'return=representation' }), body: JSON.stringify({ status: 'active' }) }
  );
  const rows = await patch.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(409).json({ error: 'tomada', mensaje: 'Esta consulta ya fue tomada por otro profesional.' });
    return;
  }

  // Si la asignación falla, la sala quedaría 'active' sin profesional: no
  // aparecería en ningún dashboard ni en la lista de abiertas (huérfana para
  // siempre). Verificamos el INSERT y revertimos el claim si no se pudo.
  let asignada = false;
  try {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/chat_room_lawyers`, {
      method: 'POST', headers: serviceHeaders(),
      body: JSON.stringify({ room_id: roomId, lawyer_id: perfil.id, status: 'active' }),
    });
    // 409 = la asignación YA existe (reintento tras respuesta perdida) →
    // tratarla como éxito para que el retry se auto-repare en vez de
    // revertir una sala correctamente asignada.
    asignada = ins.ok || ins.status === 409;
  } catch { asignada = false; }
  if (!asignada) {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${rid}&status=eq.active`, {
      method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ status: 'open' }),
    }).catch(() => {});
    res.status(502).json({ error: 'reintenta', mensaje: 'No se pudo completar la asignación. Intenta de nuevo.' });
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: serviceHeaders(),
    // sender_type 'system' NO existe en el CHECK del esquema (ver api/reassign.js):
    // usar 'lawyer' + message_type 'system' → el cliente lo pinta como aviso
    // centrado (ChatSection: `msg.message_type === 'system'`) sin violar el CHECK.
    body: JSON.stringify({ room_id: roomId, sender_type: 'lawyer', lawyer_id: null, message_type: 'system', content: 'Un profesional tomó tu consulta y se unió al chat.' }),
  }).catch(() => {});
  await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?room_id=eq.${rid}&tipo=eq.solicitud_abierta`, {
    method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ atendida: true, leido: true }),
  }).catch(() => {});

  res.status(200).json({ ok: true, roomId });
}

// ── POST chat_token: emite el JWT del cliente anónimo (claim client_token) ──
// Con él, las políticas RLS "v2" acotan chat_rooms/chat_messages (REST y
// Realtime) a SUS salas. role SIEMPRE 'anon' (no escala nada); lo único que
// aporta el llamante es el hash, que no otorga más de lo que ya da conocer la
// cédula. Firma HS256 con SUPABASE_JWT_SECRET (Legacy Secret del proyecto).
// Limitador en memoria (por instancia) para acotar la emisión de tokens: sin
// esto, un atacante podía pedir tokens en masa (enumerar hashes de cédula).
// NO es la solución de fondo (ver docs/sql/security-fixes-2026-08-17.sql:
// el client_token debe derivarse con un pepper server-side y/o prueba de
// posesión), pero corta el abuso acelerado desde un mismo origen.
const _tokHits = new Map(); // ip -> { n, resetAt }
const TOK_MAX = Number(process.env.CHAT_TOKEN_MAX_IP_HORA || 60);
function tokRateLimited(req) {
  const real = req.headers['x-real-ip'];
  const ip = (Array.isArray(real) ? real[0] : real)
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  if (!ip) return false;
  const now = Date.now();
  const e = _tokHits.get(ip);
  if (!e || e.resetAt <= now) { _tokHits.set(ip, { n: 1, resetAt: now + 3600_000 }); return false; }
  e.n += 1;
  return e.n > TOK_MAX;
}

async function chatToken(req, res) {
  if (!JWT_SECRET) { res.status(500).json({ error: 'Configuración del servidor incompleta.' }); return; }
  if (tokRateLimited(req)) { res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' }); return; }
  const cedulaHash = String((req.body || {}).cedulaHash || '');
  // SHA-256 hex (64 chars): el claim solo puede ser un id de sala de cliente.
  if (!/^[a-f0-9]{64}$/i.test(cedulaHash)) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + CHAT_TOKEN_TTL;
  const payload = { iss: 'supabase', role: 'anon', client_token: cedulaHash.toLowerCase(), iat: now, exp };
  if (PROJECT_REF) payload.ref = PROJECT_REF;
  res.status(200).json({ token: signHS256(payload, JWT_SECRET), exp });
}

// ── POST firma_finalizar: escribe la firma de un firmante SERVER-SIDE ────────
// Cierra F12–F16/F27: el cliente ya NO marca otp_verificado con la anon key.
// Exige la prueba HMAC que emitió /api/verify-code al verificar el OTP, y ata
// la escritura al correo REALMENTE verificado (no al que teclee el firmante),
// eliminando el IDOR y la firma con identidad inventada.
function verifyFirmaProof(proof) {
  const secret = process.env.FIRMA_PROOF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !proof || typeof proof !== 'string') return null;
  const parts = proof.split('.');
  if (parts.length !== 3) return null;
  const [b, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${b}.${expStr}`).digest('hex');
  if (expected.length !== sig.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try { return Buffer.from(b, 'base64url').toString('utf8').toLowerCase(); } catch { return null; }
}

async function firmaFinalizar(req, res) {
  const b = req.body || {};
  const email = verifyFirmaProof(b.firmaProof);
  if (!email) { res.status(403).json({ error: 'Verificación de identidad inválida o expirada.' }); return; }
  const firmanteId = String(b.firmanteId || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(firmanteId)) { res.status(400).json({ error: 'Firmante inválido.' }); return; }

  // La fila del firmante manda el correo verdadero; el proof debe coincidir.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/firmas_firmantes?id=eq.${encodeURIComponent(firmanteId)}&select=id,correo,estado`,
    { headers: serviceHeaders() }
  );
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) { res.status(404).json({ error: 'Firmante no encontrado.' }); return; }
  if (String(row.correo || '').toLowerCase() !== email) {
    res.status(403).json({ error: 'El correo verificado no coincide con el firmante.' }); return;
  }

  const pie = b.pie || {};
  const ip = (req.headers['x-real-ip'] ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '').slice(0, 64);
  const patch = {
    estado: 'firmado', otp_verificado: true,
    nombre: cap(pie.nombre, 200) || null, cedula: cap(pie.cedula, 40) || null,
    telefono: cap(pie.telefono, 40) || null,
    correo: row.correo,                 // FORZADO al correo verificado por OTP
    ciudad: cap(pie.ciudad, 120) || null,
    firmado_at: new Date().toISOString(),
    ip: ip || null,
    user_agent: cap(b.userAgent, 300) || null,
    doc_hash: cap(b.docHash, 200) || null,
  };
  const up = await fetch(
    `${SUPABASE_URL}/rest/v1/firmas_firmantes?id=eq.${encodeURIComponent(firmanteId)}`,
    { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(patch) }
  );
  if (!up.ok) { res.status(500).json({ error: 'No se pudo registrar la firma.' }); return; }
  const out = await up.json().catch(() => []);
  res.status(200).json({ ok: true, firmante: Array.isArray(out) ? out[0] : out });
}

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST') {
    const accion = (req.body && req.body.accion) || '';
    if (accion === 'chat_token') return chatToken(req, res);
    if (accion === 'firma_finalizar') return firmaFinalizar(req, res);
    if (accion === 'publicar') return publicar(req, res);
    if (accion === 'tomar') return tomar(req, res);
    res.status(400).json({ error: 'Acción no soportada' });
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
