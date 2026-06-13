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

const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_FILE_MB = 4;

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
const IconEnviar = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>);
const IconClip = (p) => (<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l8.49-8.49a3 3 0 0 1 4.24 4.24l-8.49 8.49a1 1 0 0 1-1.41-1.41l7.78-7.78" /></svg>);
const IconDoc = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>);
const IconBombilla = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></svg>);
const IconChevron = (p) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="m6 9 6 6 6-6" /></svg>);

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
  const [glossOpen, setGlossOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [focused, setFocused] = useState(false);
  const [phIndex, setPhIndex] = useState(0);
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
  }, [thread, busy]);

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
    for (const f of files) {
      if (!TIPOS_OK.includes(f.type)) { setError('Solo se admiten PDF o imágenes (JPG, PNG, WEBP).'); continue; }
      if (f.size / 1048576 > MAX_FILE_MB) { setError(`"${f.name}" supera ${MAX_FILE_MB} MB.`); continue; }
      const data = await fileToBase64(f);
      setAdjuntos((a) => [...a, { name: f.name, media_type: f.type, data }]);
    }
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

    const { Authorization } = await getAuthHeaders();
    const { ok, data } = await pedirIA(
      { modo: 'abogado', mensajes: nuevoThread.map((m) => ({ role: m.role, content: m.content })), adjuntos: adjEnviar },
      { authHeader: Authorization }
    );

    if (!ok || !data?.reply) {
      setError(data?.mensaje || 'El asistente no está disponible. Intenta de nuevo.');
      setBusy(false);
      return;
    }
    const finalThread = [...nuevoThread, { role: 'assistant', content: data.reply }];
    setThread(finalThread);
    persistir(id, finalThread);
    setBusy(false);
  }

  const copiar = (i, texto) => {
    navigator.clipboard?.writeText(texto);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1600);
  };

  const puedeEnviar = (!!input.trim() || adjuntos.length > 0) && !busy;
  const phVacio = !focused && !input;
  const saludo = saludoDelMomento(profile?.nombre);

  // ── Composer (pill) reutilizado en hero y en conversación ──
  const composer = (
    <div className={styles.composer}>
      {adjuntos.length > 0 && (
        <div className={styles.adjFila}>
          {adjuntos.map((a, i) => (
            <span key={i} className={styles.adjChip}>
              <IconDoc />
              <span className={styles.adjName}>{a.name}</span>
              <button type="button" onClick={() => setAdjuntos((arr) => arr.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.pill} data-active={focused || !!input || undefined}>
        <button type="button" className={styles.attach} onClick={() => fileRef.current?.click()} aria-label="Adjuntar PDF o imagen" title="Adjuntar PDF o imagen">
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
          {busy ? <span className={styles.spin} /> : <IconEnviar />}
        </motion.button>
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" multiple style={{ display: 'none' }} onChange={onFiles} />
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
                Puedes adjuntar PDF o imágenes (máx. {MAX_FILE_MB} MB c/u). Los borradores <b>requieren tu revisión</b>.
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
        {thread.map((m, i) =>
          m.role === 'user' ? (
            <motion.div key={i} className={styles.bubMe} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              {m.content}
              {m.files?.length > 0 && (
                <div className={styles.bubFiles}>
                  {m.files.map((n, j) => <span key={j} className={styles.bubFile}><IconDoc /> {n}</span>)}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key={i} className={styles.bubAi} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <div className={styles.aiHead}>
                <span>IA Parada Precise</span>
                <button className={styles.copyBtn} onClick={() => copiar(i, m.content)}>{copiedIdx === i ? 'Copiado ✓' : 'Copiar'}</button>
              </div>
              <Markdown>{m.content}</Markdown>
            </motion.div>
          )
        )}
        {busy && (<div className={styles.thinking} aria-label="Generando respuesta"><span /><span /><span /></div>)}
      </div>

      {composer}
    </>
  );

  return (
    <div className={styles.shell}>
      {historial}
      <div className={styles.main}>{principal}</div>
    </div>
  );
}
