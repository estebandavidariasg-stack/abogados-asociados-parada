// api/ai.js
// Proxy de IA. v1: modo 'cliente' (triage). El modo 'abogado' se añade en el Plan 2.
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE, SYSTEM_ABOGADO } from './_lib/aiPrompts.js';
import { hashIp, parseTriageReply, buildProfesionalesBlock, limiteAlcanzado } from './_lib/aiLogic.js';
import { completar } from './_lib/anthropic.js';

const MAX_MSGS = Number(process.env.AI_CLIENTE_MAX_MSGS || 6);
const MAX_SESIONES_IP_HORA = Number(process.env.AI_MAX_SESIONES_IP_HORA || 10);
const MAX_LEN_MENSAJE = 2000;

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  return (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim() || req.socket?.remoteAddress || '';
}

async function getSesion(id) {
  if (!id) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_sesiones?id=eq.${id}&select=*&limit=1`, { headers: serviceHeaders() });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

async function contarSesionesIp(ipHash) {
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_sesiones?ip_hash=eq.${ipHash}&created_at=gte.${desde}&select=id`,
    { headers: serviceHeaders() }
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function crearSesion(ipHash, tipo) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_sesiones`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ ip_hash: ipHash, tipo_profesional: tipo || 'abogado', mensajes_count: 0 }),
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function actualizarSesion(id, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_sesiones?id=eq.${id}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify(patch),
  });
}

async function fetchProfesionales(req, rol) {
  // Reusa la lista pública cacheada en CDN.
  const base = `https://${req.headers.host}`;
  try {
    const res = await fetch(`${base}/api/professionals?rol=${rol === 'contador' ? 'contador' : 'abogado'}`);
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

const MAX_LEN_MENSAJE_ABOGADO = 12000; // permite pegar transcripciones largas
const MAX_USOS_SALA_DIA = Number(process.env.AI_MAX_USOS_SALA_DIA || 2);
const MEDIA_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MEDIA_DOC = ['application/pdf'];

// Usos de IA de hoy para una sala. Devuelve null si la tabla no existe
// (en ese caso NO se aplica el tope, para no romper nada).
async function usosSalaHoy(roomId) {
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${roomId}&fecha=eq.${hoy}&select=usos&limit=1`, { headers: serviceHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    return rows[0]?.usos ?? 0;
  } catch { return null; }
}

async function registrarUsoSala(roomId, profesionalId) {
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${roomId}&fecha=eq.${hoy}&select=usos`, { headers: serviceHeaders() });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${roomId}&fecha=eq.${hoy}`, {
        method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ usos: (rows[0].usos || 0) + 1 }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas`, {
        method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ room_id: roomId, fecha: hoy, usos: 1, profesional_id: profesionalId || null }),
      });
    }
  } catch { /* no bloquear el flujo si falla el conteo */ }
}

// Convierte adjuntos en bloques de contenido para Claude (imagen / PDF).
function bloquesAdjuntos(adjuntos) {
  if (!Array.isArray(adjuntos)) return [];
  return adjuntos.slice(0, 5).map((a) => {
    const kind = MEDIA_DOC.includes(a?.media_type) ? 'document'
      : MEDIA_IMG.includes(a?.media_type) ? 'image' : null;
    if (!kind || !a?.data) return null;
    return { type: kind, source: { type: 'base64', media_type: a.media_type, data: a.data } };
  }).filter(Boolean);
}

async function handleAbogado(req, res) {
  const { mensajes, adjuntos, roomId, accion } = req.body || {};

  // Solo profesionales autenticados (abogado/contador).
  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') {
    res.status(403).json({ error: 'No autorizado' }); return;
  }

  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo?.content || typeof ultimo.content !== 'string' || ultimo.content.length > MAX_LEN_MENSAJE_ABOGADO) {
    res.status(400).json({ error: 'Mensaje inválido o demasiado largo' }); return;
  }

  // Tope por sala/día solo para resumir/analizar (control de costo).
  if (accion && roomId) {
    const usos = await usosSalaHoy(roomId);
    if (usos != null && usos >= MAX_USOS_SALA_DIA) {
      res.status(429).json({ error: 'limite', mensaje: `Alcanzaste el máximo de ${MAX_USOS_SALA_DIA} análisis por consulta al día. Vuelve a intentarlo mañana.` });
      return;
    }
  }

  // Si hay adjuntos, el último mensaje del usuario lleva texto + imágenes/PDF.
  const bloques = bloquesAdjuntos(adjuntos);
  let messages = mensajes;
  if (bloques.length) {
    messages = mensajes.map((m, i) =>
      i === mensajes.length - 1
        ? { role: m.role, content: [{ type: 'text', text: m.content }, ...bloques] }
        : m
    );
  }

  let reply = '';
  try {
    reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, messages, maxTokens: 2600 });
  } catch (e) {
    console.error('[api/ai] Anthropic error (abogado):', e?.message);
    res.status(502).json({ error: 'fallback', mensaje: 'El asistente no está disponible ahora. Intenta de nuevo en un momento.' });
    return;
  }

  if (accion && roomId) await registrarUsoSala(roomId, perfil.id);

  res.status(200).json({ reply });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { modo, sessionId, mensajes, tipo_profesional } = req.body || {};
  if (!Array.isArray(mensajes) || mensajes.length === 0) { res.status(400).json({ error: 'Faltan mensajes' }); return; }
  if (modo === 'abogado') { return handleAbogado(req, res); }
  if (modo !== 'cliente') { res.status(400).json({ error: 'Modo no soportado' }); return; }

  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo?.content || typeof ultimo.content !== 'string' || ultimo.content.length > MAX_LEN_MENSAJE) {
    res.status(400).json({ error: 'Mensaje inválido o demasiado largo' }); return;
  }

  const ipHash = hashIp(clientIp(req));

  // Sesión nueva o existente.
  let sesion = await getSesion(sessionId);
  if (!sesion) {
    if ((await contarSesionesIp(ipHash)) >= MAX_SESIONES_IP_HORA) {
      res.status(429).json({ error: 'Demasiadas consultas desde tu conexión. Intenta más tarde o elige un profesional manualmente.' });
      return;
    }
    sesion = await crearSesion(ipHash, tipo_profesional);
    if (!sesion?.id) { res.status(500).json({ error: 'No se pudo iniciar la sesión de IA' }); return; }
  }

  // Tope de mensajes del cliente.
  if (limiteAlcanzado(sesion.mensajes_count, MAX_MSGS)) {
    res.status(429).json({ error: 'limite', sessionId: sesion.id, restantes: 0 });
    return;
  }

  // Construir contexto y llamar al modelo.
  const profs = await fetchProfesionales(req, tipo_profesional || sesion.tipo_profesional);
  const systemText = SYSTEM_CLIENTE.replace('{profesionales}', buildProfesionalesBlock(profs));

  let replyRaw = '';
  try {
    // prefill '{' fuerza salida JSON aunque el historial tenga turnos en prosa
    // (evita que Haiku responda en texto plano y caiga al fallback de parseo).
    replyRaw = await completar({ modo: 'cliente', systemText, messages: mensajes, maxTokens: 1024, prefill: '{' });
  } catch (e) {
    console.error('[api/ai] Anthropic error:', e?.message);
    res.status(502).json({ error: 'fallback', mensaje: 'La asistente no está disponible ahora. Continúa eligiendo un profesional manualmente.' });
    return;
  }

  const parsed = parseTriageReply(replyRaw);
  const nuevoCount = (sesion.mensajes_count || 0) + 1;
  const patch = { mensajes_count: nuevoCount };
  if (parsed.listo_para_recomendar) {
    patch.area_detectada = parsed.area_detectada;
    patch.resumen = parsed.resumen_para_profesional;
    patch.recomendados = parsed.recomendados;
    patch.costo_rango = parsed.costo_rango;
  }
  await actualizarSesion(sesion.id, patch);

  res.status(200).json({
    sessionId: sesion.id,
    restantes: Math.max(0, MAX_MSGS - nuevoCount),
    ...parsed,
  });
}
