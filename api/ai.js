// api/ai.js
// Proxy de IA. v1: modo 'cliente' (triage). El modo 'abogado' se añade en el Plan 2.
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE, SYSTEM_ABOGADO } from './_lib/aiPrompts.js';
import { hashIp, parseTriageReply, buildProfesionalesBlock, limiteAlcanzado } from './_lib/aiLogic.js';
import { completar, MODELOS } from './_lib/anthropic.js';

// Resumir documentos largos (map-reduce) toma decenas de segundos: subimos el
// límite de ejecución de la función. Vercel lo recorta al máximo del plan
// (Hobby ~60s, Pro hasta 300s); para documentos muy extensos conviene Pro.
export const config = { maxDuration: 60 };

const MAX_MSGS = Number(process.env.AI_CLIENTE_MAX_MSGS || 6);
const MAX_SESIONES_IP_HORA = Number(process.env.AI_MAX_SESIONES_IP_HORA || 10);
const MAX_LEN_MENSAJE = 2000;

function clientIp(req) {
  // Vercel fija `x-real-ip` con la IP real del cliente que observó su edge; el
  // cliente NO puede sobrescribirla. NO usamos el primer valor de
  // `x-forwarded-for`: Vercel lo APENDE, así que su extremo izquierdo es
  // exactamente lo que el cliente mandó y se puede falsificar para rotar el
  // ip_hash y saltarse el límite por IP. `x-real-ip` primero; XFF solo como
  // respaldo en local/dev donde no existe.
  const real = req.headers['x-real-ip'];
  if (real) return (Array.isArray(real) ? real[0] : real).trim();
  const xff = req.headers['x-forwarded-for'] || '';
  return (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim() || req.socket?.remoteAddress || '';
}

async function getSesion(id) {
  if (!id) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_sesiones?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: serviceHeaders() });
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
  await fetch(`${SUPABASE_URL}/rest/v1/ai_sesiones?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify(patch),
  });
}

async function fetchProfesionales(req, rol) {
  // Reusa la lista pública cacheada en CDN. El protocolo se toma de
  // `x-forwarded-proto` (Vercel lo pone en 'https'); en local (`vercel dev`,
  // localhost) es http — hardcodear https rompía el fetch ahí y la IA recibía
  // una lista VACÍA, por lo que siempre sugería publicar aunque hubiera match.
  const host = req.headers.host || '';
  const proto = req.headers['x-forwarded-proto']
    || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const base = `${proto}://${host}`;
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
const CHUNK_CHARS = 150_000;             // tramo grande → menos llamadas (entra en el tope de tiempo)
const MAX_CHUNKS = 12;                    // tope de tramos: acota costo y tiempo
const MAP_CONCURRENCY = 4;                // tramos en paralelo por lote

// Reintenta solo ante saturación/rate-limit (no ante errores reales), para que
// un pico transitorio no tumbe todo el map-reduce.
async function completarConReintento(args, intentos = 2) {
  let ultimo;
  for (let k = 0; k <= intentos; k++) {
    try { return await completar(args); }
    catch (e) {
      ultimo = e;
      const st = e?.status || e?.statusCode;
      if (st !== 429 && st !== 529 && st !== 503) throw e;
      await new Promise((r) => setTimeout(r, 700 * (k + 1)));
    }
  }
  throw ultimo;
}

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

// Módulo de MEMORIA entre chats: mantiene una ficha durable del profesional que
// se inyecta como contexto en cada conversación (corre en Haiku, barato).
const SYSTEM_MEMORIA =
  'Eres el módulo de memoria de un asistente para un profesional (abogado o ' +
  'contador). Mantienes una ficha BREVE y útil para futuras conversaciones, con ' +
  'datos DURABLES: especialidad y áreas del profesional, clientes o casos ' +
  'recurrentes, preferencias de redacción y formato, datos suyos o de su firma ' +
  'que repite, y temas en curso. NO guardes detalles efímeros, ni el contenido ' +
  'completo de documentos, ni datos sensibles innecesarios. Recibes la ficha ' +
  'actual y el último intercambio; devuelve SOLO la ficha ACTUALIZADA en viñetas ' +
  'concisas, sin comentarios, máximo ~1200 caracteres. Si no hay nada nuevo que ' +
  'valga la pena, devuelve la ficha tal cual.';

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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}&select=usos&limit=1`, { headers: serviceHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    return rows[0]?.usos ?? 0;
  } catch { return null; }
}

async function registrarUsoSala(roomId, profesionalId) {
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}&select=usos`, { headers: serviceHeaders() });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}`, {
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
  let { mensajes } = req.body || {};
  const { adjuntos, roomId, accion, memoria } = req.body || {};

  // Solo profesionales autenticados (abogado/contador).
  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'abogado' && perfil.rol !== 'contador') {
    res.status(403).json({ error: 'No autorizado' }); return;
  }
  // Solo profesionales APROBADOS por la administración pueden usar el asistente
  // pagado (mismo criterio que api/solicitudes.js y api/reassign.js). Sin esto,
  // una cuenta autorregistrada sin aprobar consume el modelo Sonnet a costa de
  // la clave Anthropic de la firma.
  if (!perfil.aprobado) {
    res.status(403).json({ error: 'Perfil no aprobado' }); return;
  }

  // Historial acotado: los hilos legítimos crecen sin tope en localStorage,
  // así que se TRUNCA a la cola reciente (empezando en 'user', requisito de
  // la API) en vez de rechazar — un 400 dejaría ese chat roto para siempre.
  // Solo se rechaza el abuso real (forma inválida o >400k chars en 80 msgs).
  if (Array.isArray(mensajes) && mensajes.length > 80) {
    mensajes = mensajes.slice(-80);
    while (mensajes.length && mensajes[0].role !== 'user') mensajes = mensajes.slice(1);
  }
  if (!validarHistorial(mensajes, { maxMsgs: 80, maxTotalChars: 400_000 })) {
    res.status(400).json({ error: 'historial', mensaje: 'La conversación es demasiado larga para procesarla. Inicia un chat nuevo para continuar.' }); return;
  }

  // ── Acción de memoria (segundo plano): fusiona el último intercambio en la
  //    ficha durable del profesional. Best-effort: nunca rompe la UI. ──
  if (accion === 'memoria') {
    const u = mensajes?.find?.((m) => m.role === 'user')?.content || '';
    const a = mensajes?.find?.((m) => m.role === 'assistant')?.content || '';
    const fichaActual = typeof memoria === 'string' ? memoria : '';
    if (!u) { res.status(200).json({ memoria: fichaActual }); return; }
    try {
      const nueva = await completar({
        model: MODELOS.cliente, // Haiku (barato)
        systemText: SYSTEM_MEMORIA,
        messages: [{ role: 'user', content: `FICHA ACTUAL:\n${fichaActual || '(vacía)'}\n\nÚLTIMO INTERCAMBIO:\nProfesional: ${String(u).slice(0, 4000)}\nAsistente: ${String(a).slice(0, 6000)}` }],
        maxTokens: 700,
      });
      res.status(200).json({ memoria: (nueva || fichaActual || '').slice(0, 1500) });
    } catch (e) {
      console.error('[api/ai] memoria error:', e?.message);
      res.status(200).json({ memoria: fichaActual });
    }
    return;
  }

  // ── Acción TRAMO (map orquestado por el cliente): procesa UN fragmento de un
  //    documento largo con Haiku. Cada tramo es su propia petición corta, así
  //    ninguna función se pasa del límite de tiempo de Vercel. ──
  if (accion === 'tramo') {
    const solicitud = mensajes?.find?.((m) => m.role === 'user')?.content || '';
    const tramo = typeof req.body?.tramo === 'string' ? req.body.tramo : '';
    if (!tramo.trim()) { res.status(400).json({ error: 'Falta el fragmento' }); return; }
    try {
      const out = await completarConReintento({
        model: MODELOS.cliente, // Haiku (barato)
        systemText: SYSTEM_TRAMO,
        messages: [{ role: 'user', content: `Solicitud del profesional: "${String(solicitud).slice(0, 2000)}"\n\n--- FRAGMENTO DEL DOCUMENTO ---\n${tramo.slice(0, 220000)}` }],
        maxTokens: 1400,
      });
      res.status(200).json({ extracto: out && !/^\s*NADA_RELEVANTE\s*$/i.test(out) ? out.trim() : '' });
    } catch (e) {
      console.error('[api/ai] tramo error:', e?.status, e?.message);
      res.status(502).json({ error: 'fallback', mensaje: 'No pude procesar un fragmento del documento.' });
    }
    return;
  }

  // ── Acción COMBINAR (reduce orquestado por el cliente): une los extractos de
  //    los tramos en la respuesta final con Sonnet. Los extractos llegan en
  //    `sintesis` (campo aparte), NO en el mensaje del usuario, para no chocar
  //    con el tope de longitud del mensaje. ──
  if (accion === 'combinar') {
    const sintesis = typeof req.body?.sintesis === 'string' ? req.body.sintesis : '';
    const ult = mensajes[mensajes.length - 1];
    if (!ult?.content || typeof ult.content !== 'string' || ult.content.length > MAX_LEN_MENSAJE_ABOGADO) {
      res.status(400).json({ error: 'Mensaje inválido o demasiado largo' }); return;
    }
    const memoriaCtxC = (typeof memoria === 'string' && memoria.trim())
      ? `[Memoria del profesional, de conversaciones anteriores. Úsala como contexto; no la menciones salvo que sea relevante.]\n${memoria.trim().slice(0, 1500)}`
      : null;
    const messagesC = mensajes.map((m, i) =>
      i === mensajes.length - 1
        ? { role: m.role, content: `${m.content}\n\n[Extractos del documento adjunto, en orden de aparición]\n${sintesis}` }
        : { role: m.role, content: m.content }
    );
    try {
      const reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, systemExtra: memoriaCtxC, messages: messagesC, maxTokens: 2200 });
      res.status(200).json({ reply });
    } catch (e) {
      console.error('[api/ai] combinar error:', e?.status, e?.message);
      res.status(502).json({ error: 'fallback', mensaje: 'El asistente no está disponible ahora. Intenta de nuevo en un momento.' });
    }
    return;
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

  // Memoria entre chats: contexto durable del profesional (va como bloque de
  // sistema aparte para no romper el prompt-cache del system base).
  const memoriaCtx = (typeof memoria === 'string' && memoria.trim())
    ? `[Memoria del profesional, de conversaciones anteriores. Úsala como contexto; no la menciones salvo que sea relevante.]\n${memoria.trim().slice(0, 1500)}`
    : null;

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
        const out = await completarConReintento({
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
      reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, systemExtra: memoriaCtx, messages: reduceMsgs, maxTokens: 2600 });
    } else {
      // ── Cabe en una sola llamada → Sonnet con el texto + imágenes inline ──
      const messages = (textoDocs || imgBloques.length) ? armarMensajes(textoDocs) : mensajes;
      reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, systemExtra: memoriaCtx, messages, maxTokens: 2600 });
    }
  } catch (e) {
    console.error('[api/ai] Anthropic error (abogado):', e?.status, e?.message);
    res.status(502).json({ error: 'fallback', mensaje: 'El asistente no está disponible ahora. Intenta de nuevo en un momento.' });
    return;
  }

  if (accion && roomId) await registrarUsoSala(roomId, perfil.id);

  res.status(200).json({ reply });
}

// Valida la forma y el tamaño del historial COMPLETO. Antes solo se validaba
// el último mensaje: el resto del historial viajaba tal cual hasta Anthropic,
// así que una llamada hostil podía inflar el contexto (≈MB de texto o bloques
// de imagen) con costo directo en dólares por request. Solo strings: los
// adjuntos legítimos viajan en campos aparte (`adjuntos`, `sintesis`, `tramo`).
function validarHistorial(mensajes, { maxMsgs, maxTotalChars }) {
  if (mensajes.length > maxMsgs) return false;
  let total = 0;
  for (const m of mensajes) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return false;
    if (typeof m.content !== 'string') return false;
    total += m.content.length;
  }
  return total <= maxTotalChars;
}

// ── Modo CENSURA: ¿un archivo del chat contiene datos de contacto? ──────────
// Recibe imágenes (fotos, capturas o páginas de un PDF escaneado, ya
// comprimidas en el cliente) y devuelve { contiene_contacto, motivo }. Los PDF
// con texto NO pasan por aquí: el cliente extrae el texto y lo revisa gratis
// con contieneContacto. Lo usan los tres roles del chat de consulta: el
// profesional autenticado y el cliente anónimo (se valida que la sala exista y
// esté abierta; el tope por sala/día acota el costo).
const MAX_CENSURAS_SALA_DIA = Number(process.env.AI_MAX_CENSURAS_SALA_DIA || 30);
const MAX_IMG_CENSURA = 4;

const SYSTEM_CENSURA =
  'Eres un filtro de moderación de una plataforma de consultas jurídicas y ' +
  'contables. Recibes una o varias imágenes enviadas dentro de un chat entre un ' +
  'cliente y un profesional (fotos, capturas de pantalla, páginas escaneadas). ' +
  'Tu ÚNICA tarea es detectar si contienen DATOS DE CONTACTO de una persona o ' +
  'empresa: números de teléfono o celular, correos electrónicos, direcciones ' +
  'físicas (calle, carrera, avenida, casa, apartamento, oficina), usuarios de ' +
  'redes sociales o WhatsApp, o instrucciones para contactar por fuera del chat. ' +
  'NO cuentan como contacto: números de cédula, NIT, montos de dinero, fechas, ' +
  'números de radicado o expediente, ni nombres de personas sin forma de ' +
  'contactarlas. Responde SOLO con un objeto JSON: ' +
  '{"contiene_contacto": true|false, "motivo": "..."} donde motivo describe en ' +
  'pocas palabras QUÉ tipo de dato se encontró (sin transcribir el dato) o es ' +
  'una cadena vacía si no hay contacto. Ante duda razonable, marca true.';

async function censurasSalaHoy(roomId) {
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}&select=censuras&limit=1`, { headers: serviceHeaders() });
    if (!r.ok) return null; // columna/tabla ausente → sin tope (fail-open, como `usos`)
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    return rows[0]?.censuras ?? 0;
  } catch { return null; }
}

async function registrarCensuraSala(roomId, profesionalId) {
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}&select=censuras`, { headers: serviceHeaders() });
    if (!r.ok) return;
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas?room_id=eq.${encodeURIComponent(roomId)}&fecha=eq.${hoy}`, {
        method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ censuras: (rows[0].censuras || 0) + 1 }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_uso_salas`, {
        method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ room_id: roomId, fecha: hoy, usos: 0, censuras: 1, profesional_id: profesionalId || null }),
      });
    }
  } catch { /* el conteo nunca bloquea el envío */ }
}

async function handleCensura(req, res) {
  const { roomId, adjuntos } = req.body || {};
  if (!roomId || typeof roomId !== 'string') { res.status(400).json({ error: 'Falta la sala' }); return; }

  // Quién llama: profesional autenticado, o cliente anónimo de una sala abierta.
  const perfil = await getCallerProfile(req);
  if (perfil && !['abogado', 'contador', 'superadmin'].includes(perfil.rol)) {
    res.status(403).json({ error: 'No autorizado' }); return;
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${encodeURIComponent(roomId)}&select=id,status&limit=1`, { headers: serviceHeaders() });
    const rows = r.ok ? await r.json() : [];
    const sala = Array.isArray(rows) ? rows[0] : null;
    if (!sala || !['waiting', 'active', 'open'].includes(sala.status)) {
      res.status(403).json({ error: 'Sala no disponible' }); return;
    }
  } catch { res.status(502).json({ error: 'fallback' }); return; }

  const usadas = await censurasSalaHoy(roomId);
  if (usadas != null && usadas >= MAX_CENSURAS_SALA_DIA) {
    res.status(429).json({ error: 'limite', mensaje: 'Se alcanzó el máximo de revisiones de archivos por consulta hoy.' }); return;
  }

  const { imagenes } = separarAdjuntos(adjuntos);
  if (!imagenes.length) { res.status(400).json({ error: 'Sin imágenes para revisar' }); return; }
  const valAdj = validarAdjuntos(imagenes.slice(0, MAX_IMG_CENSURA), []);
  if (!valAdj.ok) { res.status(413).json({ error: 'adjunto', mensaje: valAdj.mensaje }); return; }

  let raw = '';
  try {
    raw = await completar({
      model: MODELOS.censura,
      systemText: SYSTEM_CENSURA,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Revisa si estas imágenes contienen datos de contacto y responde solo el JSON.' },
          ...bloquesImagenes(imagenes.slice(0, MAX_IMG_CENSURA)),
        ],
      }],
      maxTokens: 200,
      prefill: '{',
    });
  } catch (e) {
    console.error('[api/ai] censura error:', e?.status, e?.message);
    res.status(502).json({ error: 'fallback' }); return;
  }

  // Parseo tolerante: si el modelo no devolvió JSON, se informa como no
  // revisado (el cliente decide; hoy sube sin revisar y deja aviso en consola).
  let contiene = null, motivo = '';
  try {
    const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    contiene = obj.contiene_contacto === true;
    motivo = typeof obj.motivo === 'string' ? obj.motivo.slice(0, 200) : '';
  } catch { /* contiene queda null */ }
  if (contiene == null) { res.status(502).json({ error: 'fallback' }); return; }

  await registrarCensuraSala(roomId, perfil?.id);
  res.status(200).json({ contiene_contacto: contiene, motivo });
}

/* ── Lectura de un proyecto de ley / ley (solo superadmin) ─────────────────
   El texto llega del navegador ya extraído (pdf.js / mammoth), igual que en la
   censura de archivos: el binario en base64 chocaría con el límite de cuerpo
   de la función.

   Por qué IA y no expresiones regulares: el parser de regex funciona con un
   PDF nativo, pero estos documentos suelen ser ESCANEOS con capa OCR sucia.
   Ahí el texto llega con palabras partidas, mayúsculas en medio de palabra
   ("muniCipales"), barras por letras ("e/ Ministerio") y renglones convertidos
   en basura ("~~ ____ u~ ___"). Una regex no puede repararlo porque no sabe
   qué DICE el documento, solo qué forma tiene. También confundía el número del
   documento con el de una ley citada dentro de un artículo.

   Reglas del prompt, en este orden de importancia: no inventar, transcribir
   fielmente, y limpiar solo el ruido del OCR. */
const SYSTEM_META = [
  'Extraes los datos de cabecera de un documento legislativo colombiano (proyecto de ley, ley sancionada o acto legislativo) desde el texto de un PDF, a menudo escaneado y con errores de OCR.',
  '',
  'REGLAS:',
  '1. NO INVENTES. Si un dato no esta en el documento, devuelvelo vacio. Un campo vacio es mejor que un dato plausible pero falso.',
  '',
  '2. NUMERO: la CITA COMPLETA Y LEGIBLE del documento, no el numero pelado. Se arma como "<Tipo> <numero> de <anio>":',
  '   - "Ley 2173 de 2021"',
  '   - "Proyecto de Ley 123 de 2026 (Camara)" si el encabezado dice la camara',
  '   - "Acto Legislativo 05 de 2019"',
  '   El anio es el del propio documento: el de su radicacion si es un proyecto, o el de su sancion o promulgacion si ya es ley. Si el encabezado trae el numero pero el anio solo aparece en la fecha de al lado (por ejemplo "LEY No. 2173  30 DIC 2021"), usa ese anio.',
  '   Las leyes citadas DENTRO del articulado (la Ley 1955 de 2019, el articulo 66 de la Ley 99 de 1993) NO son el numero del documento.',
  '   Un proyecto todavia sin radicar NO tiene numero: el encabezado dice "PROYECTO DE LEY No. ___ DE 2026" o deja el hueco en blanco. En ese caso devuelve numero VACIO. NO escribas "Proyecto de Ley 2026" ni inventes un numero: media cita se lee como un radicado real y no lo es.',
  '',
  '3. FECHA_RADICACION: la fecha propia del documento, en formato AAAA-MM-DD.',
  '   - En un proyecto de ley: la fecha de radicacion.',
  '   - En una ley ya sancionada: la de sancion o promulgacion, la del sello "PUBLIQUESE Y CUMPLASE" o la que acompania al numero en el encabezado.',
  '   Los sellos vienen con el mes abreviado y en mayusculas ("30 DIC 2021" = 2021-12-30).',
  '   Si el proyecto no trae una fecha de radicacion marcada, usa la de la linea de ciudad y fecha que acompania a las firmas de los autores ("Bogota D.C., 20 de julio de 2026") o la del encabezado. NO dejes este campo vacio si el documento trae una fecha propia; solo si de verdad no hay ninguna.',
  '',
  '4. TITULO_OFICIAL: la formula completa y literal que empieza por "por medio de la cual...". Va entera, sin resumir. Quita del final la basura de OCR: guiones bajos, tildes sueltas, comillas y simbolos como ~~ ____ u~ ___. Termina en la ultima palabra real.',
  '',
  '5. NOMBRE: un nombre CORTO para mostrar en una lista, de 3 a 8 palabras. No es un resumen del titulo oficial: es como llamaria un ciudadano a esta norma. Sin la formula "por medio de la cual" y sin punto final.',
  '   Va en Title Case del espanol: inicial mayuscula en cada palabra MENOS en articulos, preposiciones y conjunciones (de, del, la, el, los, y, e, o, u, en, para, por, con, a, al, un, una, que, se), que van en minuscula salvo si abren el nombre. Las siglas se quedan en mayusculas (IVA, ICBF).',
  '   Ejemplos: "Siembra de Arboles y Areas de Vida", "Seguridad Hidrica y Riego para el Desarrollo Agropecuario", "Exencion del IVA en la Canasta Familiar".',
  '',
  '6. AUTORES: los congresistas que PROPUSIERON la norma, solo si el documento los nombra como autores o ponentes.',
  '   OJO con la diferencia: en una ley ya sancionada quienes aparecen firmando son los presidentes de Senado y Camara, los secretarios generales y los ministros. Esos SANCIONAN y PROMULGAN la ley, no la propusieron. NO son autores: deja el campo vacio.',
  '   Los autores de verdad figuran en el documento del proyecto de ley original, no en el texto de la ley publicada.',
  '',
  '',
  '',
  '7. DESCRIPCION: 2 o 3 frases en lenguaje llano sobre de que trata, para un ciudadano.',
  '',
  'Responde SOLO con este JSON, sin texto alrededor:',
  '{"tipo":"proyecto"|"ley"|"acto_legislativo","numero":"","nombre":"","titulo_oficial":"","fecha_radicacion":"AAAA-MM-DD o vacio","autores":"","descripcion":""}',
].join(String.fromCharCode(10))

const SYSTEM_ARTICULOS = [
  'Limpias articulos de una norma colombiana que vienen del OCR de un PDF escaneado. Recibes un JSON con articulos ya separados y devuelves los mismos, corregidos.',
  '',
  'REGLAS, en orden de prioridad:',
  '1. TRANSCRIBE, no resumas ni parafrasees. El contenido va completo y literal, con sus paragrafos, literales y numerales. No acortes.',
  '2. NO CAMBIES la redaccion juridica. No mejores el estilo, no corrijas la gramatica del legislador, no reordenes.',
  '3. CORRIGE SOLO el ruido del OCR:',
  '   - palabras partidas por saltos de linea, reunelas;',
  '   - mayusculas sueltas en medio de palabra: muniCipales -> municipales, AmbiE;nte -> Ambiente;',
  '   - barras o simbolos por letras: e/ -> el, l -> L cuando es obvio (POR MEDIO DE lA -> POR MEDIO DE LA);',
  '   - secuencias de guiones bajos, tildes, comillas o simbolos sin sentido: borralas;',
  '   - si al principio del contenido falta texto y arranca a media frase, dejalo como esta: NO inventes el comienzo.',
  '4. TITULO: si el articulo tiene uno (una palabra o frase corta antes del punto, como OBJETO o AREA DE VIDA), ponlo en "titulo" y quitalo del contenido. Si NO tiene, deja "titulo" vacio: es correcto y frecuente en las normas, no te lo inventes.',
  '5. SECCION: es el titulo o capitulo del que cuelga el articulo (GENERALIDADES, DEL CIUDADANO, DE LAS EMPRESAS...). Te llega ya asignada: NO la cambies ni la reasignes, solo corrige su ortografia si trae ruido de OCR (DE lAS EMPRESAS -> DE LAS EMPRESAS) y devuelvela en mayuscula inicial y minusculas: "De las empresas".',
  '6. DESCARTAR: si un elemento NO es un articulo de la norma sino basura arrastrada (bloques de firmas, nombres de ministros, presidentes de Senado o Camara, sellos, numeros de pagina), marca "descartar": true y deja el contenido vacio.',
  '',
  'Responde SOLO con este JSON, sin texto alrededor, con un elemento por cada articulo recibido y en el mismo orden:',
  '{"articulos":[{"numero":"1","seccion":"","titulo":"","contenido":"","descartar":false}]}',
].join('\n')

const SYSTEM_EXPOSICION = [
  'Resumes la EXPOSICION DE MOTIVOS de un proyecto de ley colombiano para que un ciudadano entienda por que se propone la norma. El texto viene del OCR de un PDF y trae ruido.',
  '',
  'REGLAS:',
  '1. NO INVENTES. Solo lo que dice el texto. Si el texto es ilegible o no dice nada util, devuelve resumen vacio.',
  '2. FUERA el aparato academico: citas bibliograficas, notas al pie, numeros de nota, URLs, "Disponible en:", "Ibid", "op. cit.", numeros de pagina y encabezados repetidos. No los menciones ni los resumas.',
  '3. ESTRUCTURA en 3 a 5 parrafos cortos, en este orden y solo con los que el texto sustente:',
  '   - el problema que se quiere resolver;',
  '   - que propone la norma para resolverlo;',
  '   - a quien beneficia o afecta;',
  '   - antecedentes o normas anteriores, si los hay;',
  '   - impacto fiscal, si el texto lo trata.',
  '4. LENGUAJE LLANO, en tercera persona, sin "el presente proyecto" ni formulas de oficio. Frases cortas. Nada de vinetas ni titulos: solo parrafos separados por una linea en blanco.',
  '5. LARGO: entre 120 y 320 palabras en total. Es un resumen, no una transcripcion.',
  '6. Cifras y fechas concretas del texto SI se conservan: son lo que sostiene el argumento.',
  '',
  'Responde SOLO con este JSON, sin texto alrededor:',
  '{"resumen":""}',
].join(String.fromCharCode(10));

const MAX_CHARS_PROYECTO = 180000;

/* Dos etapas, y no por capricho: una funcion de Vercel en plan Hobby muere a
   los 60 segundos, y transcribir 19 articulos son ~10.000 tokens de salida,
   o sea dos o tres minutos. Una sola llamada NO cabe: se cortaba y el cliente
   caia al respaldo de regex, que es justo lo que se veia.

     meta      -> solo los datos de cabecera. Salida corta, unos segundos.
     articulos -> limpia un LOTE de articulos ya separados por el parser.

   El navegador orquesta: pide la meta y luego los lotes, y cada llamada cabe
   de sobra en los 60 segundos. */

async function handleProyecto(req, res) {
  const { etapa, texto, articulos } = req.body || {};

  // Solo el panel: este modo usa Sonnet y lo paga la clave de la firma.
  const perfil = await getCallerProfile(req);
  if (!perfil) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (perfil.rol !== 'superadmin' && perfil.rol !== 'admin') {
    res.status(403).json({ error: 'No autorizado' }); return;
  }

  if (etapa === 'articulos') return proyectoArticulos(req, res, articulos);
  if (etapa === 'exposicion') return proyectoExposicion(req, res, texto);
  return proyectoMeta(req, res, texto);
}

/* CAUSA del 502: esta funcion usaba prefill: { para forzar JSON. En Haiku 4.5
   (los modos cliente y censura) eso funciona, pero en Sonnet 5 el prefill esta
   ELIMINADO: mandar un turno assistant final devuelve 400, completar() lanza y
   aqui se convertia en fallback. Por eso el lector asistido nunca entraba.

   Sin prefill, el modelo puede envolver el JSON en un bloque de codigo, asi que
   la extraccion tolera las vallas y se queda con el primer objeto completo. */
/* Solo lo ve un superadmin o admin, que es quien puede hacer algo con el dato.
   Sin esto el motivo real se quedaba en la terminal de `vercel dev` y desde el
   panel solo llegaba un "fallback" que no dice nada. */
function detalleError(e) {
  const partes = []
  if (e?.status) partes.push(`HTTP ${e.status}`)
  if (e?.error?.error?.message) partes.push(e.error.error.message)
  else if (e?.message) partes.push(e.message)
  return partes.join(' · ').slice(0, 300)
}

function extraerJSON(raw) {
  // Sin regex a propósito: buscar la primera llave y la última basta, y una
  // valla de bloque de código (```json) no contiene llaves, así que queda
  // fuera del recorte por construcción.
  const t = String(raw || '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) {
    throw new Error(`la respuesta no contiene JSON: ${t.slice(0, 200)}`);
  }
  return JSON.parse(t.slice(a, b + 1));
}

async function pedirJSON({ systemText, userText, maxTokens }) {
  const raw = await completar({
    model: MODELOS.proyecto,
    systemText,
    messages: [{ role: 'user', content: userText }],
    maxTokens,
  });
  return extraerJSON(raw);
}
const limpio = (v) => (typeof v === 'string' ? v.trim() : '');

// ── Etapa 1: la cabecera del documento ────────────────────────────────────
async function proyectoMeta(req, res, texto) {
  if (typeof texto !== 'string' || texto.trim().length < 40) {
    res.status(400).json({ error: 'Sin texto que leer' }); return;
  }
  // Los datos de cabecera estan al principio y al final; el articulado del
  // medio no aporta nada aqui y solo gastaria tokens.
  const t = texto.slice(0, MAX_CHARS_PROYECTO);
  /* Solo la cabecera y el cierre: en el medio esta el articulado y la
     exposicion de motivos, que NO se le piden al modelo. La exposicion la
     copia el parser literal del documento; hacersela transcribir costaria mas
     tokens de salida que todo el resto junto, y para un texto que se reproduce
     tal cual el modelo no aporta nada. */
  const recorte = t.length > 24000 ? t.slice(0, 14000) + '\n[...]\n' + t.slice(-10000) : t;
  let d = null;
  try {
    d = await pedirJSON({ systemText: SYSTEM_META, userText: 'Documento:\n\n' + recorte, maxTokens: 4000 });
  } catch (e) {
    console.error('[api/ai] proyecto meta:', e?.status, e?.message);
    res.status(502).json({ error: 'fallback', detalle: detalleError(e) }); return;
  }
  res.status(200).json({
    ok: true,
    tipo: limpio(d.tipo) || 'desconocido',
    // Media cita ("Proyecto de Ley 2026", sin numero) se lee como un radicado
    // real. Si no trae digitos de numero, mejor vacio y que el admin lo ponga.
    numero: /[0-9]/.test(limpio(d.numero).replace(/(?:19|20)[0-9]{2}/g, '')) ? limpio(d.numero) : '',
    nombre: limpio(d.nombre),
    titulo_oficial: limpio(d.titulo_oficial),
    fecha_radicacion: /^\d{4}-\d{2}-\d{2}$/.test(limpio(d.fecha_radicacion)) ? limpio(d.fecha_radicacion) : '',
    autores: limpio(d.autores),
    descripcion: limpio(d.descripcion),
  });
}

/* ── Etapa 3: la exposicion de motivos, resumida y ordenada ────────────
   Antes se copiaba literal del documento y el resultado eran quince paginas
   con notas al pie, bibliografia y numeros de pagina metidos en medio de las
   frases: ilegible para un ciudadano, que es justo para quien se publica.

   El modelo recibe SOLO la exposicion (el parser ya la aislo), no el documento
   entero, y devuelve un resumen corto. Eso cuesta poco: la entrada es una
   fraccion del documento y la salida son 300 palabras, no quince paginas.

   El texto literal no se pierde: queda en el documento original, al que apunta
   el enlace del proyecto. */
const MAX_CHARS_EXPOSICION = 16000;

async function proyectoExposicion(req, res, texto) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  // Menos de un parrafo no es una exposicion de motivos: no hay nada que
  // resumir y una llamada al modelo seria dinero tirado.
  if (t.length < 400) { res.status(200).json({ ok: true, resumen: '' }); return; }

  // Cabeza y cola: el problema y la propuesta van al principio, y el impacto
  // fiscal y el conflicto de intereses al final. El medio es el desarrollo.
  const recorte = t.length > MAX_CHARS_EXPOSICION
    ? t.slice(0, 11000) + String.fromCharCode(10) + '[...]' + String.fromCharCode(10) + t.slice(-5000)
    : t;

  let d = null;
  try {
    d = await pedirJSON({ systemText: SYSTEM_EXPOSICION, userText: 'Exposicion de motivos:' + String.fromCharCode(10, 10) + recorte, maxTokens: 1200 });
  } catch (e) {
    console.error('[api/ai] proyecto exposicion:', e?.status, e?.message);
    res.status(502).json({ error: 'fallback', detalle: detalleError(e) }); return;
  }
  res.status(200).json({ ok: true, resumen: limpio(d.resumen) });
}

// ── Etapa 2: limpia un lote de articulos ya separados ─────────────────────
const MAX_ARTS_LOTE = 5;

async function proyectoArticulos(req, res, articulos) {
  if (!Array.isArray(articulos) || articulos.length === 0) {
    res.status(400).json({ error: 'Sin articulos' }); return;
  }
  const lote = articulos.slice(0, MAX_ARTS_LOTE).map(a => ({
    numero: limpio(a?.numero),
    seccion: limpio(a?.seccion),
    titulo: limpio(a?.titulo),
    contenido: limpio(a?.contenido).slice(0, 12000),
  }));
  let d = null;
  try {
    d = await pedirJSON({
      systemText: SYSTEM_ARTICULOS,
      userText: 'Articulos a limpiar:\n\n' + JSON.stringify(lote),
      maxTokens: 16000,
    });
  } catch (e) {
    console.error('[api/ai] proyecto articulos:', e?.status, e?.message);
    res.status(502).json({ error: 'fallback', detalle: detalleError(e) }); return;
  }
  const salida = Array.isArray(d.articulos) ? d.articulos : [];
  res.status(200).json({
    ok: true,
    articulos: salida.map((a, i) => ({
      numero: limpio(a?.numero) || lote[i]?.numero || String(i + 1),
      // Si el modelo la omite se conserva la que calculó el parser: es suya.
      seccion: limpio(a?.seccion) || lote[i]?.seccion || '',
      titulo: limpio(a?.titulo),
      contenido: limpio(a?.contenido),
      descartar: a?.descartar === true,
    })),
  });
}
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { modo, sessionId, mensajes, tipo_profesional } = req.body || {};
  // La censura no lleva historial: se despacha antes de exigir `mensajes`.
  if (modo === 'censura') { return handleCensura(req, res); }
  // Como la censura, no lleva historial: se despacha antes de exigir `mensajes`.
  if (modo === 'proyecto') { return handleProyecto(req, res); }
  if (!Array.isArray(mensajes) || mensajes.length === 0) { res.status(400).json({ error: 'Faltan mensajes' }); return; }
  if (modo === 'abogado') { return handleAbogado(req, res); }
  if (modo !== 'cliente') { res.status(400).json({ error: 'Modo no soportado' }); return; }

  // Endpoint público: historial acotado (el flujo legítimo del triage queda
  // lejísimos de estos topes — MAX_MSGS=6 mensajes de ≤2.000 chars).
  if (!validarHistorial(mensajes, { maxMsgs: 16, maxTotalChars: 40_000 })) {
    res.status(400).json({ error: 'Historial inválido o demasiado largo' }); return;
  }

  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo?.content || typeof ultimo.content !== 'string' || ultimo.content.length > MAX_LEN_MENSAJE) {
    res.status(400).json({ error: 'Mensaje inválido o demasiado largo' }); return;
  }

  const ipHash = hashIp(clientIp(req));
  // Normalizado (antes se insertaba en ai_sesiones tal cual llegara del body).
  const tipoNorm = tipo_profesional ? (tipo_profesional === 'contador' ? 'contador' : 'abogado') : null;

  // Sesión nueva o existente. Si la tabla `ai_sesiones` no está disponible
  // (ausente, o la service-role mal configurada), NO deshabilitamos el
  // asistente: caemos a una sesión EFÍMERA (sin persistencia) y estimamos el
  // conteo de mensajes a partir del propio hilo. Así un problema de infra del
  // límite/telemetría nunca deja al cliente sin orientación.
  let sesion = null;
  try {
    sesion = await getSesion(sessionId);
    if (!sesion) {
      if ((await contarSesionesIp(ipHash)) >= MAX_SESIONES_IP_HORA) {
        res.status(429).json({ error: 'Demasiadas consultas desde tu conexión. Intenta más tarde o elige un profesional manualmente.' });
        return;
      }
      sesion = await crearSesion(ipHash, tipoNorm || 'abogado');
    }
  } catch (e) {
    console.error('[api/ai] ai_sesiones inaccesible:', e?.message);
  }
  if (!sesion?.id) {
    console.error('[api/ai] Usando sesión efímera (ai_sesiones no disponible). Aplica docs/sql/ai_sesiones.sql y revisa SUPABASE_SERVICE_ROLE_KEY para restaurar el límite y el guardado de la recomendación.');
    const usados = mensajes.filter(m => m.role === 'user').length;
    sesion = { id: null, mensajes_count: Math.max(0, usados - 1), tipo_profesional: tipoNorm || 'abogado' };
  }

  // Tope de mensajes del cliente.
  if (limiteAlcanzado(sesion.mensajes_count, MAX_MSGS)) {
    res.status(429).json({ error: 'limite', sessionId: sesion.id, restantes: 0 });
    return;
  }

  // Construir contexto y llamar al modelo.
  const profs = await fetchProfesionales(req, tipoNorm || sesion.tipo_profesional);
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
  if (sesion.id) await actualizarSesion(sesion.id, patch);

  res.status(200).json({
    sessionId: sesion.id,
    restantes: Math.max(0, MAX_MSGS - nuevoCount),
    ...parsed,
  });
}
