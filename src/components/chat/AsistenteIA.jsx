// src/components/chat/AsistenteIA.jsx — "IA Parada Precise"
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { pedirIA } from '../../lib/aiClient';
import { getAuthHeaders } from '../../lib/supabase';
import Markdown from '../shared/Markdown';
import styles from './AsistenteIA.module.css';

const SUGERENCIAS = [
  { label: 'Redactar derecho de petición', texto: 'Redacta un derecho de petición dirigido a [entidad]. Hechos: [describe los hechos]. Pretensión: [lo que se solicita].' },
  { label: 'Analizar estrategia del caso', texto: 'Analiza la estrategia para este caso. Área: [área]. Hechos: [hechos]. Objetivo del cliente: [objetivo].' },
  { label: 'Redactar contrato', texto: 'Redacta un borrador de contrato de [tipo] entre [parte A] y [parte B]. Objeto: [objeto]. Condiciones clave: [condiciones].' },
  { label: '¿Qué debo verificar?', texto: 'Para un caso de [área] con estos hechos: [hechos], ¿qué normas, requisitos y plazos debería verificar?' },
];

const PLACEHOLDERS = [
  'Redacta un derecho de petición…',
  'Resume este caso laboral…',
  'Analiza este contrato de arrendamiento…',
  '¿Qué norma aplica a este caso?',
  'Adjunta un PDF y pídeme un resumen…',
  'Redacta una tutela por demora en la EPS…',
];

// Imágenes → visión (base64, acotadas en MB). Documentos (PDF, Word .docx, TXT)
// → se extrae el texto en el navegador y solo viaja el texto, así que pueden
// pesar más (sin inflado base64 ni tope de 100 páginas); el límite real es el
// texto extraído.
const TIPOS_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMG_MB = 3;             // por imagen
const MAX_DOC_MB = 25;            // por documento (se lee localmente; solo viaja el texto)
const MAX_DOC_CHARS = 1_800_000;  // tope de texto extraído por documento
const MAX_FILES = 5;

// Documentos largos: el cliente orquesta el map-reduce (cada tramo es UNA
// petición corta), así ninguna función serverless se pasa del límite de tiempo.
const DOC_LARGO_CHARS = 280_000;  // por encima de esto → se procesa por tramos
const DOC_CHUNK_CHARS = 150_000;  // tamaño de cada tramo
const MAP_LOTE = 3;               // tramos en paralelo

// Trocea texto largo cortando en saltos de línea (≈ misma lógica del backend).
function trocearTexto(texto, tam) {
  const out = [];
  let i = 0;
  while (i < texto.length) {
    let fin = Math.min(i + tam, texto.length);
    if (fin < texto.length) {
      const corte = texto.lastIndexOf('\n', fin);
      if (corte > i + tam * 0.6) fin = corte;
    }
    out.push(texto.slice(i, fin));
    i = fin;
  }
  return out;
}

const esImagen = (f) => TIPOS_IMG.includes(f.type);
// PDF, Word (.docx / .doc) o TXT, por MIME o por extensión (algunos navegadores
// no reportan el tipo). El .doc viejo se enruta para dar un mensaje claro.
const esDoc = (f) =>
  /pdf|text\/plain|officedocument\.wordprocessingml|msword/.test(f.type || '') ||
  /\.(pdf|docx?|txt)$/i.test(f.name || '');

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

// Saludo que varía por hora y día, personalizado con el nombre.
function saludoDelMomento(nombre) {
  const d = new Date();
  const h = d.getHours();
  const hora = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const dias = ['el domingo', 'este lunes', 'este martes', 'este miércoles', 'este jueves', 'este viernes', 'el sábado'];
  const sub = h < 12
    ? `Listo para ayudarte a arrancar ${dias[d.getDay()]}.`
    : h < 19
      ? `Sigamos avanzando ${dias[d.getDay()]}.`
      : `Aquí estoy para lo que necesites cerrar ${dias[d.getDay()]}.`;
  return { hora, nombre: nombre || '', sub };
}

const phContainer = { animate: { transition: { staggerChildren: 0.02 } }, exit: { transition: { staggerChildren: 0.012, staggerDirection: -1 } } };
const phLetter = {
  initial: { opacity: 0, filter: 'blur(10px)', y: 8 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { opacity: { duration: 0.22 }, filter: { duration: 0.35 }, y: { type: 'spring', stiffness: 90, damping: 20 } } },
  exit: { opacity: 0, filter: 'blur(10px)', y: -8, transition: { duration: 0.18 } },
};

const IconChispa = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" {...p}><path d="M12 2l1.9 5.6L19.5 9.4 14 11.4 12 17l-2-5.6L4.5 9.4 10.1 7.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
const IconPlus = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M12 5v14M5 12h14" /></svg>);
const IconTrash = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>);
const IconMensaje = (p) => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);

// ── Historial de chats con la IA (persistido por usuario en localStorage) ──
function chatsKey(uid) { return `ia_chats_${uid || 'anon'}`; }
function cargarChats(uid) {
  try { const v = JSON.parse(localStorage.getItem(chatsKey(uid)) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function guardarChats(uid, chats) {
  try { localStorage.setItem(chatsKey(uid), JSON.stringify(chats.slice(0, 50))); } catch { /* cuota llena */ }
}
function nuevoId() {
  try { return crypto.randomUUID(); } catch { return `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }
}
function tituloDe(messages) {
  const primero = messages.find((m) => m.role === 'user' && m.content)?.content || '';
  const t = primero.replace(/\s+/g, ' ').trim();
  return t ? (t.length > 46 ? t.slice(0, 46).trimEnd() + '…' : t) : 'Nuevo chat';
}

// Documento exportable (Word/PDF) con el MISMO contenido de la respuesta, ya
// renderizado a HTML, envuelto en un formato AAP más organizado (membrete + estilos).
function construirDocumento(innerHTML) {
  let fecha = '';
  try { fecha = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { /* */ }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Documento — Abogados & Asociados Parada</title>
<style>
  @page { margin: 2.5cm; }
  body { font-family: 'Calibri','Segoe UI',Arial,sans-serif; color:#1f2d44; line-height:1.6; font-size:12pt; margin:0; }
  .doc-head { border-bottom: 2px solid #c9a84c; padding-bottom: 10px; margin-bottom: 24px; }
  .doc-firm { font-family:'Georgia','Times New Roman',serif; font-size:19pt; font-weight:700; color:#0d2d5e; margin:0; letter-spacing:.3px; }
  .doc-meta { font-size:9.5pt; color:#6b7689; margin:4px 0 0; }
  h1,h2,h3,h4 { font-family:'Georgia','Times New Roman',serif; color:#0d2d5e; line-height:1.25; }
  h1{font-size:16pt} h2{font-size:14pt} h3{font-size:12.5pt}
  p,li{font-size:12pt}
  ul,ol{padding-left:1.2cm}
  table{border-collapse:collapse;width:100%;margin:10px 0} th,td{border:1px solid #cdd6e6;padding:6px 9px;text-align:left} th{background:#f1f4fa;color:#0d2d5e}
  blockquote{border-left:3px solid #c9a84c;margin:0;padding-left:14px;color:#46546e}
  code{background:#f1f4fa;padding:1px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:11pt}
  .doc-foot{margin-top:30px;border-top:1px solid #e2e8f3;padding-top:10px;font-size:9pt;color:#8a93a6;font-style:italic}
</style></head>
<body>
  <div class="doc-head">
    <p class="doc-firm">Abogados &amp; Asociados Parada</p>
    <p class="doc-meta">Documento generado${fecha ? ' el ' + fecha : ''} con IA Parada Precise</p>
  </div>
  ${innerHTML}
  <p class="doc-foot">Borrador generado con asistencia de IA. Requiere revisión profesional antes de su uso o presentación.</p>
</body></html>`;
}
const IconEnviar = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>);
const IconClip = (p) => (<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l8.49-8.49a3 3 0 0 1 4.24 4.24l-8.49 8.49a1 1 0 0 1-1.41-1.41l7.78-7.78" /></svg>);
const IconDoc = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconBombilla = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></svg>);
const IconChevron = (p) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="m6 9 6 6 6-6" /></svg>);
const IconCopy = (p) => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>);
const IconCheck = (p) => (<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M20 6 9 17l-5-5" /></svg>);
const IconEdit = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);

export default function AsistenteIA() {
  const { profile } = useAuth();
  const uid = profile?.id;
  const reduce = useReducedMotion();
  const [thread, setThread] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [adjuntos, setAdjuntos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leyendo, setLeyendo] = useState(null); // nombre del PDF que se está extrayendo
  const [memoria, setMemoria] = useState('');   // ficha durable del profesional (memoria entre chats)
  const [progreso, setProgreso] = useState(null); // progreso al analizar documentos largos
  const abortRef = useRef(null);                 // para detener la respuesta en curso
  const [glossOpen, setGlossOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [focused, setFocused] = useState(false);
  const [phIndex, setPhIndex] = useState(0);
  const [stream, setStream] = useState(null); // efecto "escritura": { idx, n }
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const enConversacion = thread.length > 0;

  // Carga el historial al montar / al cambiar de usuario.
  useEffect(() => { setChats(cargarChats(uid)); }, [uid]);

  // Inserta o actualiza el chat activo en el historial.
  function persistir(id, messages) {
    setChats((prev) => {
      const existe = prev.some((c) => c.id === id);
      const next = existe
        ? prev.map((c) => (c.id === id ? { ...c, messages, updatedAt: Date.now() } : c))
        : [{ id, title: tituloDe(messages), messages, updatedAt: Date.now() }, ...prev];
      // El chat más reciente primero.
      next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      guardarChats(uid, next);
      return next;
    });
  }

  function nuevoChat() {
    setActiveId(null); setThread([]); setInput(''); setAdjuntos([]); setError('');
    inputRef.current?.focus();
  }
  function seleccionarChat(id) {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    setActiveId(id); setThread(c.messages || []); setInput(''); setAdjuntos([]); setError('');
  }
  function eliminarChat(id) {
    setChats((prev) => { const next = prev.filter((c) => c.id !== id); guardarChats(uid, next); return next; });
    if (id === activeId) nuevoChat();
  }

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread, busy, stream]);

  // Efecto "modo escritura": revela la última respuesta de la IA progresivamente.
  useEffect(() => {
    if (!stream) return;
    const msg = thread[stream.idx];
    if (!msg || msg.role !== 'assistant') { setStream(null); return; }
    const full = msg.content || '';
    if (stream.n >= full.length) { setStream(null); return; }
    // Revelado PROPORCIONAL a la longitud: una respuesta corta aparece casi al
    // instante (~0.3s) y una larga se revela rápido pero con tope (~3s). Antes
    // era fijo ~4.5s para cualquier respuesta, lo que hacía sentir lentas las
    // respuestas simples.
    const TICK = 24;
    const totalMs = Math.min(3000, Math.max(300, (full.length / 700) * 1000));
    const ticks = Math.max(1, Math.round(totalMs / TICK));
    const step = Math.max(1, Math.ceil(full.length / ticks));
    const t = setTimeout(() => setStream((s) => (s ? { ...s, n: Math.min(full.length, s.n + step) } : s)), TICK);
    return () => clearTimeout(t);
  }, [stream, thread]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [input]);

  useEffect(() => {
    if (focused || input) return;
    const id = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 3200);
    return () => clearInterval(id);
  }, [focused, input]);

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setError('');
    let count = adjuntos.length; // el estado no se actualiza dentro del bucle async
    for (const f of files) {
      if (count >= MAX_FILES) { setError(`Máximo ${MAX_FILES} archivos por mensaje.`); break; }
      const img = esImagen(f);
      const doc = !img && esDoc(f);
      if (!img && !doc) { setError('Solo se admiten PDF, Word (.docx), TXT o imágenes (JPG, PNG, WEBP).'); continue; }

      if (doc) {
        // Documento → extraer el TEXTO en el navegador (sin tope de 100 páginas).
        if (f.size / 1048576 > MAX_DOC_MB) { setError(`"${f.name}" supera ${MAX_DOC_MB} MB.`); continue; }
        setLeyendo(f.name);
        try {
          const { extractDocText } = await import('../../utils/extractDocText');
          const { text, pages, truncated } = await extractDocText(f, { maxChars: MAX_DOC_CHARS });
          if (!text || text.length < 20) {
            setError(`"${f.name}" no tiene texto legible (¿es un escaneo o está vacío?). Adjunta un archivo con texto seleccionable o pégalo en el chat.`);
          } else {
            count += 1;
            setAdjuntos((a) => [...a, { name: f.name, kind: 'doc', text, pages, truncated }]);
          }
        } catch (err) {
          setError(err?.message || `No pude leer "${f.name}". Intenta con otro archivo o pega el texto en el chat.`);
        } finally {
          setLeyendo(null);
        }
      } else {
        // Imagen → base64 (visión).
        if (f.size / 1048576 > MAX_IMG_MB) { setError(`"${f.name}" supera ${MAX_IMG_MB} MB.`); continue; }
        const data = await fileToBase64(f);
        count += 1;
        setAdjuntos((a) => [...a, { name: f.name, kind: 'image', media_type: f.type, data }]);
      }
    }
  }

  // ── Memoria entre chats (persistente por profesional) ──
  useEffect(() => {
    if (!uid) return;
    try { setMemoria(localStorage.getItem(`ia_memoria_${uid}`) || ''); } catch { /* */ }
  }, [uid]);

  function guardarMemoria(m) {
    const v = m || '';
    setMemoria(v);
    try { if (uid) localStorage.setItem(`ia_memoria_${uid}`, v); } catch { /* best-effort */ }
  }

  // Fusiona el último intercambio en la ficha durable (en segundo plano, no bloquea).
  async function actualizarMemoria(userMsg, reply) {
    if (!userMsg || userMsg.trim().length < 25) return; // no gastar en saludos triviales
    try {
      const { Authorization } = await getAuthHeaders();
      const { ok, data } = await pedirIA(
        { modo: 'abogado', accion: 'memoria', memoria, mensajes: [
          { role: 'user', content: userMsg.slice(0, 4000) },
          { role: 'assistant', content: (reply || '').slice(0, 6000) },
        ] },
        { authHeader: Authorization }
      );
      if (ok && typeof data?.memoria === 'string') guardarMemoria(data.memoria);
    } catch { /* la memoria es best-effort */ }
  }

  function detener() {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgreso(null);
    setBusy(false);
  }

  // Map-reduce orquestado desde el cliente para documentos largos: cada tramo es
  // su propia petición (corta), y al final una petición de combinación. Así
  // ninguna función serverless se pasa del límite de tiempo. Devuelve el mismo
  // shape que pedirIA ({ ok, aborted, data }).
  async function analizarLargo({ texto, docText, thread, authHeader, signal, onProgress }) {
    const chunks = trocearTexto(docText, DOC_CHUNK_CHARS);
    const total = chunks.length;
    const extractos = [];
    onProgress?.(`Analizando documento… 0/${total}`);
    for (let i = 0; i < chunks.length; i += MAP_LOTE) {
      if (signal?.aborted) return { aborted: true };
      const grupo = chunks.slice(i, i + MAP_LOTE);
      const res = await Promise.all(grupo.map((c) =>
        pedirIA(
          { modo: 'abogado', accion: 'tramo', tramo: c, mensajes: [{ role: 'user', content: texto || 'Resume el documento.' }] },
          { authHeader, signal }
        )
      ));
      for (const r of res) {
        if (r.aborted) return { aborted: true };
        if (r.ok && r.data?.extracto) extractos.push(r.data.extracto);
      }
      onProgress?.(`Analizando documento… ${Math.min(i + grupo.length, total)}/${total}`);
    }
    if (signal?.aborted) return { aborted: true };
    onProgress?.('Redactando la respuesta…');
    const sintesis = extractos.length
      ? extractos.map((e, i) => `[Parte ${i + 1}]\n${e}`).join('\n\n')
      : '(El documento no contiene información relevante para la solicitud.)';
    const mensajesCombine = thread.map((m, i) =>
      i === thread.length - 1
        ? { role: m.role, content: `${m.content}\n\n[Extractos del documento adjunto, en orden de aparición]\n${sintesis}` }
        : { role: m.role, content: m.content }
    );
    return pedirIA({ modo: 'abogado', memoria, mensajes: mensajesCombine }, { authHeader, signal });
  }

  async function enviar() {
    const texto = input.trim();
    if ((!texto && adjuntos.length === 0) || busy) return;
    const adjEnviar = adjuntos;
    // Asegura un id para el chat activo (lo crea si es un chat nuevo).
    let id = activeId;
    if (!id) { id = nuevoId(); setActiveId(id); }
    const nuevoThread = [...thread, { role: 'user', content: texto || 'Analiza el archivo adjunto.', files: adjEnviar.map((a) => a.name) }];
    setThread(nuevoThread); setInput(''); setAdjuntos([]); setBusy(true); setError('');
    persistir(id, nuevoThread);

    const controller = new AbortController();
    abortRef.current = controller;
    const { Authorization } = await getAuthHeaders();

    // ¿Documento(s) largo(s)? → el cliente orquesta el map-reduce por tramos.
    const docsAdj = adjEnviar.filter((a) => a.kind === 'doc');
    const docText = docsAdj.map((d) => `===== ${d.name} =====\n${d.text}`).join('\n\n');

    const resp = docText.length > DOC_LARGO_CHARS
      ? await analizarLargo({ texto, docText, thread: nuevoThread, authHeader: Authorization, signal: controller.signal, onProgress: setProgreso })
      : await pedirIA(
          { modo: 'abogado', memoria, mensajes: nuevoThread.map((m) => ({ role: m.role, content: m.content })), adjuntos: adjEnviar },
          { authHeader: Authorization, signal: controller.signal }
        );
    abortRef.current = null;
    setProgreso(null);
    const { ok, aborted, data } = resp || {};

    if (aborted) { setBusy(false); return; } // el profesional detuvo: deja su mensaje, sin respuesta

    if (!ok || !data?.reply) {
      setError(data?.mensaje || 'El asistente no está disponible. Intenta de nuevo.');
      setBusy(false);
      return;
    }
    const finalThread = [...nuevoThread, { role: 'assistant', content: data.reply }];
    setThread(finalThread);
    persistir(id, finalThread);
    setBusy(false);
    if (!reduce) setStream({ idx: finalThread.length - 1, n: 0 }); // arranca la animación de escritura
    actualizarMemoria(texto, data.reply); // memoria entre chats, en segundo plano
  }

  const copiar = (i, texto) => {
    navigator.clipboard?.writeText(texto);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1600);
  };

  // Exporta la respuesta como Word (.doc) o PDF (vía impresión), reusando el
  // mismo HTML ya renderizado de la respuesta para conservar el formato.
  function exportar(i, formato) {
    const el = document.getElementById(`aimsg-body-${i}`);
    const inner = el ? el.innerHTML : '';
    if (!inner) return;
    const html = construirDocumento(inner);
    if (formato === 'word') {
      const blob = new Blob(['﻿', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'documento-aap.doc';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const w = window.open('', '_blank');
      if (!w) { setError('Permite las ventanas emergentes para descargar el PDF.'); return; }
      w.document.open(); w.document.write(html); w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch { /* */ } }, 400);
    }
  }

  // Reutilizar un prompt enviado: carga su texto en el composer SIN borrar la
  // conversación. El usuario lo corrige/afina y lo reenvía como un mensaje nuevo.
  function editarMensaje(i) {
    const msg = thread[i];
    if (!msg) return;
    setInput(msg.content);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const puedeEnviar = (!!input.trim() || adjuntos.length > 0) && !busy && !leyendo;
  const phVacio = !focused && !input;
  const saludo = saludoDelMomento(profile?.nombre);

  // ── Composer (pill) reutilizado en hero y en conversación ──
  const composer = (
    <div className={styles.composer}>
      {(adjuntos.length > 0 || leyendo) && (
        <div className={styles.adjFila}>
          {adjuntos.map((a, i) => (
            <span key={i} className={styles.adjChip}>
              <IconDoc />
              <span className={styles.adjName}>
                {a.name}{a.kind === 'doc' && a.pages ? ` · ${a.pages} pág${a.truncated ? '+' : ''}` : ''}
              </span>
              <button type="button" onClick={() => setAdjuntos((arr) => arr.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`}>✕</button>
            </span>
          ))}
          {leyendo && (
            <span className={styles.adjChip}>
              <span className={styles.spin} />
              <span className={styles.adjName}>Leyendo {leyendo}…</span>
            </span>
          )}
        </div>
      )}

      <div className={styles.pill} data-active={focused || !!input || undefined}>
        <button type="button" className={styles.attach} onClick={() => fileRef.current?.click()} aria-label="Adjuntar documento o imagen" title="Adjuntar PDF, Word, TXT o imagen">
          <IconClip />
        </button>
        <div className={styles.inputZone}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={input}
            rows={1}
            aria-label="Instrucción para IA Parada Precise"
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          />
          <div className={styles.phLayer} aria-hidden="true">
            <AnimatePresence mode="wait">
              {phVacio && (
                <motion.span key={phIndex} className={styles.ph} variants={phContainer} initial="initial" animate="animate" exit="exit">
                  {PLACEHOLDERS[phIndex].split('').map((ch, i) => (
                    <motion.span key={i} variants={phLetter} style={{ display: 'inline-block' }}>{ch === ' ' ? ' ' : ch}</motion.span>
                  ))}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        {busy ? (
          <motion.button
            type="button"
            className={styles.send}
            onClick={detener}
            aria-label="Detener respuesta"
            title="Detener"
            whileTap={{ scale: 0.9 }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <rect x="2" y="2" width="11" height="11" rx="2.5" fill="currentColor" />
            </svg>
          </motion.button>
        ) : (
          <motion.button
            type="button"
            className={styles.send}
            onClick={enviar}
            disabled={!puedeEnviar}
            aria-label="Enviar"
            whileTap={puedeEnviar ? { scale: 0.9 } : undefined}
            animate={{ scale: puedeEnviar ? 1 : 0.94, opacity: puedeEnviar ? 1 : 0.55 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >
            <IconEnviar />
          </motion.button>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp,image/gif" multiple style={{ display: 'none' }} onChange={onFiles} />
      </div>

      <div className={styles.composerFoot}>
        <button type="button" className={styles.gloss} aria-expanded={glossOpen} onClick={() => setGlossOpen((o) => !o)}>
          <IconBombilla className={styles.glossLed} />
          Consejos para escribir mejor
          <IconChevron className={`${styles.glossChevron} ${glossOpen ? styles.glossChevronOpen : ''}`} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {glossOpen && (
          <motion.div
            className={styles.glossWrap}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className={styles.glossBody}>
              <IconBombilla className={styles.glossIcon} />
              <span>
                Sé específico: indica <b>tipo de documento</b>, <b>destinatario</b>, <b>hechos</b> y <b>qué buscas</b>.
                Puedes adjuntar PDF, Word (.docx) o TXT (leo el texto, incluso documentos largos) e imágenes (máx. {MAX_IMG_MB} MB c/u). Los borradores <b>requieren tu revisión</b>.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );

  const sugerencias = (
    <motion.div
      className={styles.chips}
      initial={reduce ? false : 'hidden'}
      animate="show"
    >
      {SUGERENCIAS.map((s, i) => (
        <motion.button
          key={i}
          type="button"
          className={styles.chip}
          custom={i}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: (idx) => ({ opacity: 1, y: 0, transition: { delay: 0.18 + idx * 0.07, duration: 0.34, ease: [0.16, 1, 0.3, 1] } }),
          }}
          whileHover={reduce ? undefined : { y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => { setInput(s.texto); inputRef.current?.focus(); }}
        >
          {s.label}
        </motion.button>
      ))}
    </motion.div>
  );

  // ── Panel de historial de chats ──
  const historial = (
    <aside className={styles.histPanel} aria-label="Historial de chats con la IA">
      <button type="button" className={styles.nuevoBtn} onClick={nuevoChat}>
        <IconPlus /> Nuevo chat
      </button>
      <div className={styles.histScroll}>
        {chats.length === 0 ? (
          <p className={styles.histEmpty}>Tus conversaciones con la IA aparecerán aquí.</p>
        ) : (
          chats.map((c) => (
            <div
              key={c.id}
              className={`${styles.histItem} ${c.id === activeId ? styles.histItemActive : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => seleccionarChat(c.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seleccionarChat(c.id); } }}
            >
              <IconMensaje className={styles.histIcon} />
              <span className={styles.histTitle}>{c.title}</span>
              <button
                type="button"
                className={styles.histDel}
                onClick={(e) => { e.stopPropagation(); eliminarChat(c.id); }}
                aria-label={`Eliminar "${c.title}"`}
                title="Eliminar chat"
              >
                <IconTrash />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );

  // ── Contenido principal: hero (vacío) o conversación ──
  const principal = !enConversacion ? (
    <motion.div
      className={styles.hero}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.heroHead}>
        <motion.span
          className={styles.heroMark}
          animate={reduce ? undefined : {
            y: [0, -6, 0],
            boxShadow: [
              '0 6px 18px rgba(201,168,76,0.3)',
              '0 14px 30px rgba(201,168,76,0.5)',
              '0 6px 18px rgba(201,168,76,0.3)',
            ],
          }}
          transition={reduce ? undefined : { duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <IconChispa />
        </motion.span>
        <h2 className={styles.heroTitulo}>
          {saludo.hora}{saludo.nombre ? <>, <em>{saludo.nombre}</em></> : ''}
        </h2>
        <p className={styles.heroSub}>{saludo.sub} Escribe una instrucción o adjunta un documento para que lo revise.</p>
      </div>
      <div className={styles.heroComposer}>{composer}</div>
      {sugerencias}
    </motion.div>
  ) : (
    <>
      <header className={styles.topBar}>
        <span className={styles.topMark}><IconChispa /></span>
        <strong className={styles.topName}>IA Parada <em>Precise</em></strong>
      </header>

      <div className={styles.thread} ref={threadRef}>
        <div className={styles.threadInner}>
          {thread.map((m, i) =>
            m.role === 'user' ? (
              <motion.div key={i} className={styles.meRow} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                <button className={styles.editBtn} onClick={() => editarMensaje(i)} aria-label="Editar y reenviar" title="Editar y reenviar"><IconEdit /></button>
                <div className={styles.bubMe}>
                  {m.content}
                  {m.files?.length > 0 && (
                    <div className={styles.bubFiles}>
                      {m.files.map((n, j) => <span key={j} className={styles.bubFile}><IconDoc /> {n}</span>)}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key={i} className={styles.aiMsg} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <div className={styles.aiBody} id={`aimsg-body-${i}`}>
                  <Markdown>{stream && stream.idx === i ? (m.content.slice(0, stream.n) || '…') : m.content}</Markdown>
                  {stream && stream.idx === i && <span className={styles.caret} aria-hidden="true" />}
                </div>
                {!(stream && stream.idx === i) && (
                  <div className={styles.aiActions}>
                    <button
                      className={`${styles.actBtn} ${copiedIdx === i ? styles.actBtnDone : ''}`}
                      onClick={() => copiar(i, m.content)}
                      title={copiedIdx === i ? 'Copiado' : 'Copiar respuesta'}
                    >
                      {copiedIdx === i ? <IconCheck /> : <IconCopy />}
                      <span>{copiedIdx === i ? 'Copiado' : 'Copiar'}</span>
                    </button>
                    <button className={styles.actBtn} onClick={() => exportar(i, 'word')} title="Descargar como Word">
                      <IconDoc /><span>Word</span>
                    </button>
                    <button className={styles.actBtn} onClick={() => exportar(i, 'pdf')} title="Descargar como PDF">
                      <IconDoc /><span>PDF</span>
                    </button>
                  </div>
                )}
              </motion.div>
            )
          )}
          {busy && (<div className={styles.thinking} aria-label="Generando respuesta"><span /><span /><span /></div>)}
          {busy && progreso && (
            <div style={{ fontSize: '0.78rem', color: '#6b7fa3', marginTop: 6, fontFamily: 'Raleway, sans-serif' }}>{progreso}</div>
          )}
        </div>
      </div>

      <div className={styles.composerWrap}>{composer}</div>
    </>
  );

  return (
    <div className={styles.shell}>
      {historial}
      <div className={styles.main}>{principal}</div>
    </div>
  );
}
