// src/components/chat/TriagePanel.jsx — Asistente de admisión del cliente
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { pedirIA } from '../../lib/aiClient';
import styles from './TriagePanel.module.css';

const PLANTILLAS = [
  'Tengo un problema de [área]. Pasó [cuándo]. Quiero [objetivo].',
  'Me [despidieron/demandaron/deben] y necesito saber qué puedo hacer.',
  'Necesito ayuda con un tema de [familia/laboral/penal/deudas/empresa].',
];

const SALUDO = '¡Hola! Cuéntame brevemente tu situación y te oriento, además de recomendarte al profesional ideal. ¿Qué necesitas?';

const IconChispa = (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" {...p}><path d="M12 2l1.9 5.6L19.5 9.4 14 11.4 12 17l-2-5.6L4.5 9.4 10.1 7.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
const IconEnviar = (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>);
const IconBombilla = (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></svg>);
const IconChevron = (p) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="m6 9 6 6 6-6" /></svg>);
const IconLapiz = (p) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);

// Props:
//  tipoProfesional: 'abogado' | 'contador'
//  onIniciarChat({ profesionalId, area, resumen, costo }): salta al form pre-llenado
//  onManual(): escape hatch al formulario manual de hoy
export default function TriagePanel({ tipoProfesional = 'abogado', onIniciarChat, onManual, onPublicar }) {
  const [thread, setThread] = useState([{ role: 'assistant', content: SALUDO }]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [restantes, setRestantes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reco, setReco] = useState(null);
  const [profs, setProfs] = useState([]);
  const [error, setError] = useState('');
  const [glossOpen, setGlossOpen] = useState(false);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch(`/api/professionals?rol=${tipoProfesional === 'contador' ? 'contador' : 'abogado'}`)
      .then((r) => (r.ok ? r.json() : [])).then(setProfs).catch(() => setProfs([]));
  }, [tipoProfesional]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread, reco, busy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input]);

  async function enviar() {
    const texto = input.trim();
    if (!texto || busy) return;
    const nuevoThread = [...thread, { role: 'user', content: texto }];
    setThread(nuevoThread); setInput(''); setBusy(true); setError('');

    const mensajes = nuevoThread.filter((m, i) => !(i === 0 && m.role === 'assistant'));
    const { ok, status, data } = await pedirIA({ modo: 'cliente', sessionId, mensajes, tipo_profesional: tipoProfesional });

    if (!ok) {
      if (status === 429 && data?.error === 'limite') {
        setThread((t) => [...t, { role: 'assistant', content: 'Hemos llegado al límite de esta orientación. Con lo que me contaste, puedes iniciar el chat con el profesional recomendado abajo.' }]);
      } else {
        setError(data?.mensaje || 'La asistente no está disponible. Puedes elegir un profesional manualmente.');
      }
      setBusy(false);
      return;
    }

    setSessionId(data.sessionId);
    setRestantes(data.restantes);
    setThread((t) => [...t, { role: 'assistant', content: data.mensaje }]);
    if (data.listo_para_recomendar && (data.recomendados?.length || data.sugerir_publicar)) {
      setReco({
        area: data.area_detectada,
        recomendados: data.recomendados,
        costo: data.costo_rango,
        resumen: data.resumen_para_profesional,
        sugerirPublicar: !!data.sugerir_publicar,
      });
    }
    setBusy(false);
  }

  const recomendados = (reco?.recomendados || [])
    .map((id) => profs.find((p) => String(p.id) === String(id)))
    .filter(Boolean);
  const puedeEnviar = !!input.trim() && !busy;
  const iniciales = (p) => `${(p.nombre || '?')[0] || ''}${(p.apellido || '')[0] || ''}`.toUpperCase();

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.brandMark}><IconChispa /></span>
          <div className={styles.headText}>
            <strong className={styles.brandName}>Asistente de admisión</strong>
            <span className={styles.disclaimer}>Orientación general. No constituye asesoría legal ni genera relación abogado-cliente.</span>
          </div>
          {restantes != null && <span className={styles.restantes}>Te quedan {restantes}</span>}
        </header>

        <div className={styles.body}>
          <div className={styles.thread} ref={threadRef}>
            {thread.map((m, i) => (
              m.role === 'user' ? (
                <motion.div key={i} className={styles.bubMe} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                  {m.content}
                </motion.div>
              ) : (
                <motion.div key={i} className={styles.aiRow} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                  <span className={styles.aiAvatar}><IconChispa /></span>
                  <div className={styles.bubAi}>{m.content}</div>
                </motion.div>
              )
            ))}
            {busy && (
              <div className={styles.aiRow}>
                <span className={styles.aiAvatar}><IconChispa /></span>
                <div className={styles.thinking} aria-label="Pensando"><span /><span /><span /></div>
              </div>
            )}
          </div>

      {recomendados.length > 0 && (
        <div className={styles.recos}>
          {reco.costo && <div className={styles.costo}>Rango orientativo: {reco.costo}</div>}
          {recomendados.map((p) => (
            <motion.div key={p.id} className={styles.reco} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <span className={styles.recoAvatar}>
                {p.foto_url ? <img src={p.foto_url} alt="" /> : iniciales(p)}
              </span>
              <div className={styles.recoInfo}>
                <strong>{p.nombre} {p.apellido}</strong>
                <span>{p.area_derecho}{p.ciudad ? ` · ${p.ciudad}` : ''}</span>
              </div>
              <button
                className={styles.recoBtn}
                onClick={() => onIniciarChat({ profesionalId: p.id, area: reco.area || p.area_derecho, resumen: reco.resumen, costo: reco.costo })}
              >
                Iniciar chat
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {reco?.sugerirPublicar && (
        <motion.div className={styles.openCta} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <span className={styles.openCtaBadge}>Sin profesional del área</span>
          <p className={styles.openCtaText}>
            Ahora mismo no hay un {tipoProfesional === 'contador' ? 'contador' : 'abogado'} de esta área disponible.
            Publica tu consulta y el <b>primer profesional disponible</b> la tomará.
          </p>
          <button
            type="button"
            className={styles.openCtaBtn}
            onClick={() => onPublicar?.({ area: reco.area, resumen: reco.resumen, costo: reco.costo })}
          >
            Publicar mi consulta
          </button>
        </motion.div>
      )}

      {!reco && (
        <>
          <div className={styles.pill} data-active={!!input || undefined}>
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={input}
              placeholder="Escribe lo que necesites…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            />
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
          </div>

          <div className={styles.foot}>
            <button type="button" className={styles.gloss} aria-expanded={glossOpen} onClick={() => setGlossOpen((o) => !o)}>
              <IconBombilla className={styles.glossLed} />
              ¿Cómo contarlo mejor?
              <IconChevron className={`${styles.glossChevron} ${glossOpen ? styles.glossChevronOpen : ''}`} />
            </button>
          </div>
          <AnimatePresence initial={false}>
            {glossOpen && (
              <motion.div className={styles.glossWrap} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: 'hidden' }}>
                <div className={styles.glossBody}>
                  <IconBombilla className={styles.glossIcon} />
                  <span>Sé concreto: incluye <b>fechas</b>, <b>lugar</b> y <b>qué quieres lograr</b>. Ejemplo: "Me despidieron el 1 de mayo sin carta. Quiero saber si tengo indemnización."</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

          {error && <div className={styles.error}>{error}</div>}
        </div>
      </div>

      {!reco && (
        <div className={styles.chipsBlock}>
          <span className={styles.chipsLabel}><IconLapiz /> Empieza con una plantilla</span>
          <div className={styles.chips}>
            {PLANTILLAS.map((t, i) => (
              <button key={i} type="button" className={styles.chip} onClick={() => { setInput(t); inputRef.current?.focus(); }}>
                <IconLapiz /> {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" className={styles.manual} onClick={onManual}>Prefiero elegir un profesional yo mismo</button>
    </div>
  );
}
