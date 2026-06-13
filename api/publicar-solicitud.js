// api/publicar-solicitud.js
// El cliente publica una "solicitud abierta" (modelo claim tipo Uber/DiDi).
// Crea la sala status='open' + su mensaje de intro con service-role, así el
// mensaje queda garantizado (la RLS de chat_messages bloquea que el cliente
// anónimo escriba en una sala sin profesional asignado). No asigna profesional.
import { SUPABASE_URL, serviceHeaders } from './_lib/adminAuth.js';

const cap = (s, n) => String(s || '').slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

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

  // Crear la sala (service-role → bypassa RLS).
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
  // Si el codigo_referencia choca con un UNIQUE legacy, reintenta sin él.
  if (!creada.ok && creada.status === 409) {
    creada = await crear({ ...baseRoom, codigo_referencia: null });
  }
  if (!creada.ok || !creada.row?.id) {
    res.status(502).json({ error: 'No se pudo crear la consulta.' });
    return;
  }
  const roomId = creada.row.id;

  // Mensaje de intro con los datos clave (igual que una consulta normal).
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
