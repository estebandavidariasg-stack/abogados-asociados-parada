// api/solicitudes.js
// Endpoint ÚNICO de "solicitudes abiertas" (modelo claim tipo Uber/DiDi).
// Consolida 3 acciones en una sola función serverless (límite Hobby = 12 funciones):
//   GET                          -> lista las solicitudes 'open' del tipo del profesional (+ resumen)
//   POST { accion: 'publicar' }  -> el cliente publica su consulta (crea sala 'open' + intro)
//   POST { accion: 'tomar', roomId } -> el profesional toma una solicitud (claim atómico, primero gana)
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';

const cap = (s, n) => String(s || '').slice(0, n);

async function perfilAprobado(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=aprobado&limit=1`, { headers: serviceHeaders() });
    const rows = await r.json();
    return Array.isArray(rows) ? rows[0] : null;
  } catch { return null; }
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
  const datos = await perfilAprobado(perfil.id);
  if (!datos?.aprobado) { res.status(403).json({ error: 'Perfil no aprobado' }); return; }

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

  const resumenBloque = resumen ? `\n\n📋 Resumen del asistente IA:\n${resumen}` : '';
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
  const { roomId } = req.body || {};
  if (!roomId) { res.status(400).json({ error: 'Falta roomId' }); return; }

  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') { res.status(403).json({ error: 'No autorizado' }); return; }
  const datos = await perfilAprobado(perfil.id);
  if (!datos?.aprobado) { res.status(403).json({ error: 'Tu perfil aún no está aprobado.' }); return; }

  // Claim atómico: solo tiene éxito si la sala sigue 'open' y es del mismo tipo.
  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${roomId}&status=eq.open&tipo_profesional=eq.${perfil.rol}`,
    { method: 'PATCH', headers: serviceHeaders({ Prefer: 'return=representation' }), body: JSON.stringify({ status: 'active' }) }
  );
  const rows = await patch.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(409).json({ error: 'tomada', mensaje: 'Esta consulta ya fue tomada por otro profesional.' });
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/chat_room_lawyers`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ room_id: roomId, lawyer_id: perfil.id, status: 'active' }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ room_id: roomId, sender_type: 'system', lawyer_id: null, content: 'Un profesional tomó tu consulta y se unió al chat.' }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?room_id=eq.${roomId}&tipo=eq.solicitud_abierta`, {
    method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ atendida: true, leido: true }),
  }).catch(() => {});

  res.status(200).json({ ok: true, roomId });
}

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST') {
    const accion = (req.body && req.body.accion) || '';
    if (accion === 'publicar') return publicar(req, res);
    if (accion === 'tomar') return tomar(req, res);
    res.status(400).json({ error: 'Acción no soportada' });
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
