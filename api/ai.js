// api/ai.js
// Proxy de IA. v1: modo 'cliente' (triage). El modo 'abogado' se añade en el Plan 2.
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE, SYSTEM_ABOGADO } from './_lib/aiPrompts.js';
import { hashIp, parseTriageReply, buildProfesionalesBlock, limiteAlcanzado } from './_lib/aiLogic.js';
import { completar, MODELOS } from './_lib/anthropic.js';

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

// ── Límites prudentes de adjuntos ──────────────────────────────────────────
// Las imágenes van en base64 (visión); los PDF llegan como TEXTO ya extraído en
// el cliente (sin tope de 100 páginas ni inflado base64). Las imágenes se acotan
// en MB; el texto, en caracteres (que el backend trocea si hace falta).
const MAX_ADJUNTOS = 5;
const MAX_IMG_BYTES = 3 * 1024 * 1024;   // 3 MB por imagen
const MAX_DOC_CHARS_TOTAL = 1_800_000;   // ~500-600 págs de texto denso (tope duro)
const SINGLE_CALL_CHARS = 480_000;       // hasta aquí cabe en UNA llamada Sonnet
const CHUNK_CHARS = 90_000;              // tamaño de cada tramo (paso MAP → Haiku)
const MAX_CHUNKS = 24;                    // tope de tramos: acota el costo
const MAP_CONCURRENCY = 5;                // tramos en paralelo por lote

function bytesBase64(b64) {
  if (typeof b64 !== 'string' || !b64) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

// Separa adjuntos en imágenes (base64) y documentos de texto (PDF extraído).
function separarAdjuntos(adjuntos) {
  const imagenes = [], docs = [];
  if (!Array.isArray(adjuntos)) return { imagenes, docs };
  for (const a of adjuntos.slice(0, MAX_ADJUNTOS)) {
    if (a?.kind === 'image' && a?.data && MEDIA_IMG.includes(a.media_type)) imagenes.push(a);
    else if (a?.kind === 'doc' && typeof a?.text === 'string' && a.text.trim()) docs.push(a);
  }
  return { imagenes, docs };
}

// Valida tamaños y da un mensaje claro (no el genérico "no disponible").
function validarAdjuntos(imagenes, docs) {
  for (const a of imagenes) {
    if (bytesBase64(a.data) > MAX_IMG_BYTES) {
      return { ok: false, mensaje: `"${a?.name || 'La imagen'}" supera ${Math.round(MAX_IMG_BYTES / 1048576)} MB.` };
    }
  }
  const totalChars = docs.reduce((s, d) => s + d.text.length, 0);
  if (totalChars > MAX_DOC_CHARS_TOTAL) {
    return { ok: false, mensaje: 'El documento es demasiado extenso. Adjunta menos páginas o divídelo en partes.' };
  }
  return { ok: true };
}

// Bloques de imagen para Claude (visión).
function bloquesImagenes(imagenes) {
  return imagenes.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } }));
}

// Une el texto de los documentos con un encabezado por archivo.
function unirDocs(docs) {
  return docs.map((d) =>
    `===== DOCUMENTO: ${d.name || 'archivo'} (${d.pages || '?'} págs${d.truncated ? ', truncado' : ''}) =====\n${d.text}`
  ).join('\n\n');
}

// Trocea texto largo en pedazos de ~CHUNK_CHARS, cortando en saltos de línea.
function trocear(texto) {
  const chunks = [];
  let i = 0;
  while (i < texto.length && chunks.length < MAX_CHUNKS) {
    let fin = Math.min(i + CHUNK_CHARS, texto.length);
    if (fin < texto.length) {
      const corte = texto.lastIndexOf('\n', fin);
      if (corte > i + CHUNK_CHARS * 0.6) fin = corte;
    }
    chunks.push(texto.slice(i, fin));
    i = fin;
  }
  return chunks;
}

// Ejecuta promesas en lotes (no saturar el rate limit de Anthropic).
async function enLotes(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// System del paso MAP: extracción fiel y barata (Haiku) de lo relevante.
const SYSTEM_TRAMO =
  'Eres un asistente jurídico y contable. Recibes UN fragmento de un documento ' +
  'más grande y la solicitud del profesional. Extrae del fragmento, de forma fiel ' +
  'y concisa, TODO lo relevante para esa solicitud: hechos, fechas, partes, ' +
  'normas/artículos citados, montos, pretensiones, decisiones o conclusiones. ' +
  'Cita textual cuando el detalle importe. NO inventes ni completes lo que no esté ' +
  'en el fragmento. Si el fragmento no aporta nada relevante, responde únicamente: ' +
  'NADA_RELEVANTE.';

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

  // Adjuntos: imágenes (visión) + documentos PDF como TEXTO ya extraído.
  const { imagenes, docs } = separarAdjuntos(adjuntos);
  const valAdj = validarAdjuntos(imagenes, docs);
  if (!valAdj.ok) { res.status(413).json({ error: 'adjunto', mensaje: valAdj.mensaje }); return; }

  const imgBloques = bloquesImagenes(imagenes);
  const textoDocs = unirDocs(docs);
  const last = mensajes.length - 1;

  // Construye el contenido del último mensaje (texto del usuario + extra) con o
  // sin imágenes inline. `extra` es el texto del documento o sus extractos.
  const armarMensajes = (extra) => mensajes.map((m, i) => {
    if (i !== last) return m;
    const txt = extra ? `${m.content}\n\n${extra}` : m.content;
    return { role: m.role, content: imgBloques.length ? [{ type: 'text', text: txt }, ...imgBloques] : txt };
  });

  let reply = '';
  try {
    if (textoDocs && textoDocs.length > SINGLE_CALL_CHARS) {
      // ── Documento extenso → MAP (Haiku por tramos) + REDUCE (Sonnet) ──
      // Lee todo el documento barato (Haiku) y deja a Sonnet el razonamiento
      // final con la misma calidad de siempre. Mantiene el costo prudente.
      const tramos = trocear(textoDocs);
      const extractos = await enLotes(tramos, MAP_CONCURRENCY, async (tramo) => {
        const out = await completar({
          model: MODELOS.cliente, // Haiku
          systemText: SYSTEM_TRAMO,
          messages: [{ role: 'user', content: `Solicitud del profesional: "${ultimo.content}"\n\n--- FRAGMENTO DEL DOCUMENTO ---\n${tramo}` }],
          maxTokens: 1400,
        });
        return out && !/^\s*NADA_RELEVANTE\s*$/i.test(out) ? out.trim() : '';
      });
      const relevantes = extractos.filter(Boolean);
      const sintesis = relevantes.length
        ? relevantes.map((e, i) => `[Parte ${i + 1}]\n${e}`).join('\n\n')
        : '(El documento no contiene información relevante para la solicitud.)';
      const reduceMsgs = armarMensajes(`[Extractos del documento adjunto, en orden de aparición]\n${sintesis}`);
      reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, messages: reduceMsgs, maxTokens: 2600 });
    } else {
      // ── Cabe en una sola llamada → Sonnet con el texto + imágenes inline ──
      const messages = (textoDocs || imgBloques.length) ? armarMensajes(textoDocs) : mensajes;
      reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, messages, maxTokens: 2600 });
    }
  } catch (e) {
    console.error('[api/ai] Anthropic error (abogado):', e?.status, e?.message);
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
