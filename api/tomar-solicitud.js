// api/tomar-solicitud.js
// El profesional "toma" una solicitud abierta (modelo claim tipo Uber/DiDi).
// El claim es atómico (primero gana): un PATCH condicional sobre status='open'.
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';

async function perfilAprobado(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=aprobado,area_derecho&limit=1`, { headers: serviceHeaders() });
    const rows = await r.json();
    return Array.isArray(rows) ? rows[0] : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

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

  // Asignar al profesional + mensaje de sistema para el cliente.
  await fetch(`${SUPABASE_URL}/rest/v1/chat_room_lawyers`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ room_id: roomId, lawyer_id: perfil.id, status: 'active' }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ room_id: roomId, sender_type: 'system', lawyer_id: null, content: 'Un profesional tomó tu consulta y se unió al chat.' }),
  });
  // Marca como atendida cualquier notificación de solicitud abierta para esa sala.
  await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?room_id=eq.${roomId}&tipo=eq.solicitud_abierta`, {
    method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ atendida: true, leido: true }),
  }).catch(() => {});

  res.status(200).json({ ok: true, roomId });
}
