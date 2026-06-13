// api/solicitudes-abiertas.js
// Lista las solicitudes abiertas (chat_rooms status='open') del tipo del
// profesional que llama, cada una con un resumen corto del caso extraído del
// primer mensaje. Service-role: así incluye el resumen aunque la RLS de
// chat_messages no deje al profesional leer salas que aún no tomó.
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';

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
  txt = txt.split('📋')[0];                  // descarta el bloque "Resumen IA"
  txt = txt.replace(/\s+/g, ' ').trim();
  return txt.length > 180 ? txt.slice(0, 180).trimEnd() + '…' : txt;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') { res.status(403).json({ error: 'No autorizado' }); return; }
  const datos = await perfilAprobado(perfil.id);
  if (!datos?.aprobado) { res.status(403).json({ error: 'Perfil no aprobado' }); return; }

  // Salas abiertas del tipo del profesional.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_rooms` +
    `?status=eq.open&tipo_profesional=eq.${perfil.rol}` +
    `&select=id,client_nombre,area_derecho,created_at&order=created_at.desc&limit=20`,
    { headers: serviceHeaders() }
  );
  const salas = await r.json().catch(() => []);
  if (!Array.isArray(salas) || salas.length === 0) { res.status(200).json({ solicitudes: [] }); return; }

  // Primer mensaje de cada sala (para el resumen). Una sola consulta con IN.
  const ids = salas.map(s => `"${s.id}"`).join(',');
  let primeros = {};
  try {
    const m = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages` +
      `?room_id=in.(${ids})&sender_type=eq.client&select=room_id,content,created_at&order=created_at.asc`,
      { headers: serviceHeaders() }
    );
    const msgs = await m.json().catch(() => []);
    if (Array.isArray(msgs)) {
      for (const msg of msgs) {
        if (!(msg.room_id in primeros)) primeros[msg.room_id] = msg.content; // el primero por orden asc
      }
    }
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
