# Plan 2 — Asistente IA del Profesional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al abogado/contador un asistente de IA (Claude Sonnet 4.6) para generar documentos, resumir la consulta de una sala, analizar el caso y chatear libremente — vía una sección "Asistente IA" en su perfil y un botón "Resumir con IA" dentro de cada sala de consulta.

**Architecture:** Reusa el endpoint `api/ai.js` del Plan 1 añadiendo la rama `modo === 'abogado'`: valida el token del profesional (rol `abogado`/`contador`) con `_lib/adminAuth.getCallerProfile`, usa el modelo Sonnet, no aplica tope de mensajes ni persiste sesión, y devuelve texto/markdown libre (`{ reply }`) en vez del JSON de triage. El frontend construye los prompts (plantillas y transcripciones de sala) y renderiza la respuesta con un botón de copiar.

**Tech Stack:** React 18 + Vite, Vercel serverless (Node), Anthropic SDK (ya instalado), `getAuthHeaders()` del cliente Supabase hand-rolled para el token.

**Spec:** [docs/superpowers/specs/2026-06-10-integracion-ia-cliente-abogado-design.md](../specs/2026-06-10-integracion-ia-cliente-abogado-design.md)
**Depende de:** Plan 1 (endpoint `api/ai.js`, `aiClient.pedirIA`, wrapper `anthropic.js` con `MODELOS.abogado`).

**Convención de commits:** terminar cada mensaje con
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---------|-----------------|--------|
| `api/_lib/aiPrompts.js` | Añadir `SYSTEM_ABOGADO` (asistente legal, markdown libre, "requiere revisión profesional") | Modificar |
| `api/ai.js` | Despachar por `modo`; añadir rama `abogado` (auth + Sonnet + reply libre) sin tocar la rama cliente | Modificar |
| `src/components/chat/AsistenteIA.jsx` | Workspace compartido: chat libre + chips de sugerencias + plantillas rellenables + glosario + copiar | Crear |
| `src/components/chat/AsistenteIA.module.css` | Estilos del workspace | Crear |
| `src/pages/ProfilePage.jsx` | Montar `AsistenteIA` como nueva sección | Modificar |
| `src/pages/ProfileContadorPage.jsx` | Montar `AsistenteIA` como nueva sección | Modificar |
| `src/components/chat/LawyerChatDashboard.jsx` | Botón "✨ Resumir con IA" / "✨ Analizar caso" en la sala activa + panel de resultado | Modificar |
| `src/components/chat/ContadorChatDashboard.jsx` | Mismo botón/panel | Modificar |
| `scripts/test-ai-abogado.mjs` | Verificar que el modo `abogado` rechaza sin token (401/403) | Crear |

**Sin nuevas variables de entorno** (reusa `ANTHROPIC_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY`).

---

## Task 1: System prompt del modo abogado

**Files:**
- Modify: `api/_lib/aiPrompts.js`

- [ ] **Step 1: Añadir el export `SYSTEM_ABOGADO`**

Al FINAL de `api/_lib/aiPrompts.js` (después del export `SYSTEM_CLIENTE`), añadir:

```js

// Asistente para el profesional (abogado/contador). Responde en markdown libre,
// NO en JSON. El frontend construye el prompt concreto (documento, resumen, análisis).
export const SYSTEM_ABOGADO = `Eres el asistente jurídico-contable interno de "Abogados & Asociados Parada" (Colombia). Asistes a un PROFESIONAL (abogado o contador) de la firma, no a un cliente.

REGLAS:
- Responde en español, en formato markdown claro (títulos, listas, negritas cuando ayuden).
- Puedes redactar borradores de documentos (derechos de petición, tutelas, demandas, contratos, conceptos), resúmenes de casos y análisis de estrategia.
- Marca SIEMPRE los borradores de documentos con una nota al inicio: "**Borrador generado por IA — requiere revisión profesional.**"
- Usa marcadores entre corchetes [como este] donde falten datos que el profesional deba completar.
- NUNCA inventes números de norma, jurisprudencia o cifras. Si no estás seguro, dilo explícitamente y sugiere verificarlo.
- Sé concreto y útil; prioriza practicidad para el ejercicio profesional en Colombia.
- Si te piden resumir o analizar una consulta, identifica: área, hechos clave, pretensión del cliente, riesgos y próximos pasos sugeridos.`;
```

- [ ] **Step 2: Verificar el export**

Run: `node -e "import('./api/_lib/aiPrompts.js').then(m => console.log(typeof m.SYSTEM_CLIENTE, typeof m.SYSTEM_ABOGADO))"`
Expected: `string string`

- [ ] **Step 3: Commit**

```bash
git add api/_lib/aiPrompts.js
git commit -m "feat(ia): system prompt del modo abogado (asistente profesional)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rama `abogado` en el endpoint `api/ai.js`

**Files:**
- Modify: `api/ai.js`

- [ ] **Step 1: Importar lo necesario para auth y el prompt del abogado**

En `api/ai.js`, la primera línea de imports es:

```js
import { SUPABASE_URL, serviceHeaders } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE } from './_lib/aiPrompts.js';
```

Reemplazarla por:

```js
import { SUPABASE_URL, serviceHeaders, getCallerProfile } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE, SYSTEM_ABOGADO } from './_lib/aiPrompts.js';
```

- [ ] **Step 2: Reemplazar el rechazo de modo por un despacho**

Localizar en el `handler` este bloque exacto:

```js
  const { modo, sessionId, mensajes, tipo_profesional } = req.body || {};
  if (modo !== 'cliente') { res.status(400).json({ error: 'Modo no soportado en v1' }); return; }
  if (!Array.isArray(mensajes) || mensajes.length === 0) { res.status(400).json({ error: 'Faltan mensajes' }); return; }
```

Reemplazarlo por:

```js
  const { modo, sessionId, mensajes, tipo_profesional } = req.body || {};
  if (!Array.isArray(mensajes) || mensajes.length === 0) { res.status(400).json({ error: 'Faltan mensajes' }); return; }
  if (modo === 'abogado') { return handleAbogado(req, res, mensajes); }
  if (modo !== 'cliente') { res.status(400).json({ error: 'Modo no soportado' }); return; }
```

- [ ] **Step 3: Añadir la función `handleAbogado`**

Justo ANTES de `export default async function handler(req, res) {`, añadir:

```js
const MAX_LEN_MENSAJE_ABOGADO = 12000; // permite pegar transcripciones largas

async function handleAbogado(req, res, mensajes) {
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

  let reply = '';
  try {
    reply = await completar({ modo: 'abogado', systemText: SYSTEM_ABOGADO, messages: mensajes, maxTokens: 2048 });
  } catch (e) {
    console.error('[api/ai] Anthropic error (abogado):', e?.message);
    res.status(502).json({ error: 'fallback', mensaje: 'El asistente no está disponible ahora. Intenta de nuevo en un momento.' });
    return;
  }

  res.status(200).json({ reply });
}
```

- [ ] **Step 4: Verificar que el módulo sigue importándose**

Run: `node -e "import('./api/ai.js').then(m => console.log('handler:', typeof m.default))"`
Expected: `handler: function`

- [ ] **Step 5: Commit**

```bash
git add api/ai.js
git commit -m "feat(ia): rama 'abogado' en api/ai.js (auth de profesional + Sonnet + reply libre)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Componente `AsistenteIA` (workspace)

**Files:**
- Create: `src/components/chat/AsistenteIA.module.css`
- Create: `src/components/chat/AsistenteIA.jsx`

- [ ] **Step 1: Crear el CSS module**

```css
/* src/components/chat/AsistenteIA.module.css */
.wrap { max-width: 860px; }
.thread { display:flex; flex-direction:column; gap:10px; min-height:160px; max-height:460px; overflow-y:auto; padding:6px; }
.bubAi, .bubMe { border-radius:12px; padding:10px 13px; font-size:14px; line-height:1.5; white-space:pre-wrap; }
.bubMe { background:linear-gradient(135deg,#15376b,#0d2d5e); color:#fff; align-self:flex-end; max-width:85%; }
.bubAi { background:#f4f7fc; color:#13305f; border:1px solid #dbe4f1; align-self:flex-start; width:100%; }
.aiHead { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-size:11px; color:#6b7689; text-transform:uppercase; letter-spacing:.5px; }
.copyBtn { font-size:11px; border:1px solid #c9a84c; background:#fff; color:#0d2d5e; border-radius:7px; padding:3px 9px; cursor:pointer; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
.chip { font-size:12px; padding:6px 11px; border-radius:999px; background:#fff; color:#0d2d5e; border:1px solid #c9a84c; cursor:pointer; }
.chip:hover { background:#fff7e2; }
.label { font-size:11px; color:#8a7a3c; text-transform:uppercase; letter-spacing:.5px; margin-top:6px; }
.inputRow { display:flex; gap:8px; margin-top:8px; }
.input { flex:1; border:1px solid #cdd6e6; border-radius:10px; padding:10px 12px; font-size:14px; resize:vertical; min-height:64px; font-family:inherit; }
.send { background:linear-gradient(135deg,#15376b,#0d2d5e); color:#fff; border:none; border-radius:10px; padding:0 20px; font-weight:600; cursor:pointer; align-self:stretch; }
.send:disabled { opacity:.5; cursor:not-allowed; }
.gloss { font-size:12px; color:#46546e; margin-top:8px; background:none; border:none; cursor:pointer; text-decoration:underline; }
.glossBody { background:#f6f8fc; border:1px solid #e1e8f2; border-radius:8px; padding:8px 10px; margin-top:6px; font-size:12px; color:#46546e; }
.error { color:#b00020; font-size:13px; margin-top:8px; }
```

- [ ] **Step 2: Crear el componente**

```jsx
// src/components/chat/AsistenteIA.jsx
import { useState, useRef, useEffect } from 'react';
import { pedirIA } from '../../lib/aiClient';
import { getAuthHeaders } from '../../lib/supabase';
import styles from './AsistenteIA.module.css';

const SUGERENCIAS = [
  { label: '✍️ Redactar derecho de petición', texto: 'Redacta un derecho de petición dirigido a [entidad]. Hechos: [describe los hechos]. Pretensión: [lo que se solicita].' },
  { label: '⚖️ Analizar estrategia del caso', texto: 'Analiza la estrategia para este caso. Área: [área]. Hechos: [hechos]. Objetivo del cliente: [objetivo].' },
  { label: '📄 Redactar contrato', texto: 'Redacta un borrador de contrato de [tipo] entre [parte A] y [parte B]. Objeto: [objeto]. Condiciones clave: [condiciones].' },
  { label: '🔎 ¿Qué debo verificar?', texto: 'Para un caso de [área] con estos hechos: [hechos], ¿qué normas, requisitos y plazos debería verificar?' },
];

export default function AsistenteIA() {
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [glossOpen, setGlossOpen] = useState(false);
  const threadRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  async function enviar() {
    const texto = input.trim();
    if (!texto || busy) return;
    const nuevoThread = [...thread, { role: 'user', content: texto }];
    setThread(nuevoThread); setInput(''); setBusy(true); setError('');

    const { Authorization } = await getAuthHeaders();
    const { ok, data } = await pedirIA(
      { modo: 'abogado', mensajes: nuevoThread },
      { authHeader: Authorization }
    );

    if (!ok || !data?.reply) {
      setError(data?.mensaje || 'El asistente no está disponible. Intenta de nuevo.');
      setBusy(false);
      return;
    }
    setThread(t => [...t, { role: 'assistant', content: data.reply }]);
    setBusy(false);
  }

  function copiar(texto) { navigator.clipboard?.writeText(texto); }

  return (
    <div className={styles.wrap}>
      <div className={styles.thread} ref={threadRef}>
        {thread.length === 0 && (
          <div className={styles.bubAi}>Soy tu asistente IA. Pídeme redactar un documento, resumir o analizar un caso, o lo que necesites. Usa una sugerencia abajo o escribe libremente.</div>
        )}
        {thread.map((m, i) => (
          m.role === 'user'
            ? <div key={i} className={styles.bubMe}>{m.content}</div>
            : <div key={i} className={styles.bubAi}>
                <div className={styles.aiHead}><span>Asistente IA</span>
                  <button className={styles.copyBtn} onClick={() => copiar(m.content)}>Copiar</button>
                </div>
                {m.content}
              </div>
        ))}
      </div>

      <div className={styles.label}>Sugerencias (rellena los [campos])</div>
      <div className={styles.chips}>
        {SUGERENCIAS.map((s, i) => (
          <button key={i} className={styles.chip} onClick={() => setInput(s.texto)}>{s.label}</button>
        ))}
      </div>

      <div className={styles.inputRow}>
        <textarea
          className={styles.input} value={input}
          placeholder="Escribe tu instrucción… (Shift+Enter para nueva línea)"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
        />
        <button className={styles.send} onClick={enviar} disabled={busy || !input.trim()}>
          {busy ? '…' : 'Enviar'}
        </button>
      </div>

      <button className={styles.gloss} onClick={() => setGlossOpen(o => !o)}>💡 ¿Cómo pedirle mejor?</button>
      {glossOpen && (
        <div className={styles.glossBody}>
          Sé específico: indica <b>tipo de documento</b>, <b>destinatario</b>, <b>hechos</b> y <b>qué buscas</b>.
          Los borradores son orientativos y <b>requieren tu revisión</b> antes de usarse.
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/AsistenteIA.jsx src/components/chat/AsistenteIA.module.css
git commit -m "feat(ia): componente AsistenteIA (workspace del profesional)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Montar `AsistenteIA` en los perfiles

**Files:**
- Modify: `src/pages/ProfilePage.jsx`
- Modify: `src/pages/ProfileContadorPage.jsx`

- [ ] **Step 1: Importar en ProfilePage**

En `src/pages/ProfilePage.jsx`, junto a la línea:

```jsx
import LawyerInternalChat from '../components/chat/LawyerInternalChat'
```

añadir debajo:

```jsx
import AsistenteIA from '../components/chat/AsistenteIA'
```

- [ ] **Step 2: Añadir la sección en ProfilePage**

Localizar el bloque de la sección de chat con clientes (empieza con `{/* ── Sección de Chat con clientes ── */}`). INMEDIATAMENTE ANTES de ese comentario, insertar:

```jsx
        {/* ── Asistente IA ── */}
        <div className={styles.sectionBlock}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Asistente <em>IA</em>
            </h2>
            <p className={styles.sectionSub}>
              Genera documentos, resúmenes y análisis de casos. Los borradores requieren tu revisión.
            </p>
          </div>
          <AsistenteIA />
        </div>

```

- [ ] **Step 3: Repetir en ProfileContadorPage**

En `src/pages/ProfileContadorPage.jsx`, añadir el import (junto al import de `LawyerInternalChat`, que ese archivo también usa):

```jsx
import AsistenteIA from '../components/chat/AsistenteIA'
```

Luego, localizar la primera sección que renderiza el dashboard o el chat interno (busca `sectionBlock` con `ContadorChatDashboard` o `LawyerInternalChat`) e insertar ANTES de ella el mismo bloque de sección:

```jsx
        {/* ── Asistente IA ── */}
        <div className={styles.sectionBlock}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Asistente <em>IA</em>
            </h2>
            <p className={styles.sectionSub}>
              Genera documentos, resúmenes y análisis. Los borradores requieren tu revisión.
            </p>
          </div>
          <AsistenteIA />
        </div>

```

NOTA: si `ProfileContadorPage.jsx` usa clases CSS distintas para las secciones, usa las mismas que ya emplea ese archivo (revisa cómo envuelve sus otras secciones y copia ese patrón). Si no encuentras un patrón `sectionBlock`/`sectionHeader`, STOP y reporta DONE_WITH_CONCERNS describiendo qué estructura usa.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfilePage.jsx src/pages/ProfileContadorPage.jsx
git commit -m "feat(ia): montar AsistenteIA en perfiles de abogado y contador

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Botón "Resumir con IA" en los dashboards de sala

**Files:**
- Modify: `src/components/chat/LawyerChatDashboard.jsx`
- Modify: `src/components/chat/ContadorChatDashboard.jsx`

Contexto: ambos dashboards tienen `activeRoom` (la sala seleccionada) y `messages` (array de mensajes de esa sala, cada uno con `sender_type` y `content`). Importan `getAuthHeaders` desde `../../lib/supabase`.

- [ ] **Step 1: Añadir imports en LawyerChatDashboard**

En `src/components/chat/LawyerChatDashboard.jsx`, cerca de los imports de `../../lib`, añadir:

```jsx
import { pedirIA } from '../../lib/aiClient'
```

(El archivo ya importa `getAuthHeaders` desde `../../lib/supabase`; si no, añádelo también.)

- [ ] **Step 2: Añadir estado y handler para el resumen IA**

Dentro del componente, junto a los demás `useState` (cerca de `const [activeRoom, setActiveRoom] = useState(null)`), añadir:

```jsx
  const [iaResultado, setIaResultado] = useState(null)   // texto de la IA a mostrar en panel
  const [iaCargando, setIaCargando]   = useState(false)
```

Y añadir esta función dentro del componente (cerca de los otros handlers):

```jsx
  async function pedirResumenIA(tipo) {
    if (!activeRoom || iaCargando) return
    setIaCargando(true); setIaResultado(null)
    const transcripcion = (messages || [])
      .map(m => `${m.sender_type === 'client' ? 'Cliente' : 'Profesional'}: ${m.content || ''}`)
      .join('\n')
    const instruccion = tipo === 'analisis'
      ? `Analiza este caso para el profesional (área, hechos, pretensión, riesgos, próximos pasos).\n\nTranscripción:\n${transcripcion}`
      : `Resume esta consulta para el profesional en pocas líneas (área, hechos clave y qué busca el cliente).\n\nTranscripción:\n${transcripcion}`
    const { Authorization } = await getAuthHeaders()
    const { ok, data } = await pedirIA(
      { modo: 'abogado', mensajes: [{ role: 'user', content: instruccion }] },
      { authHeader: Authorization }
    )
    setIaResultado(ok && data?.reply ? data.reply : (data?.mensaje || 'El asistente no está disponible ahora.'))
    setIaCargando(false)
  }
```

- [ ] **Step 3: Añadir los botones y el panel de resultado en la cabecera de la sala activa**

Localiza dónde se renderiza la cabecera de la sala activa (donde está el botón "Verificar" — busca `Verificar` o `confirmVerificar`). Junto a ese botón, añade:

```jsx
            <button type="button" className="btn-ghost" disabled={iaCargando} onClick={() => pedirResumenIA('resumen')}>
              {iaCargando ? '✨ Generando…' : '✨ Resumir con IA'}
            </button>
            <button type="button" className="btn-ghost" disabled={iaCargando} onClick={() => pedirResumenIA('analisis')}>
              ✨ Analizar caso
            </button>
```

Y donde tenga sentido visualmente bajo la cabecera (antes de la lista de mensajes), añade el panel de resultado:

```jsx
          {iaResultado && (
            <div style={{ background:'#f4f7fc', border:'1px solid #dbe4f1', borderRadius:12, padding:'12px 14px', margin:'8px 0', whiteSpace:'pre-wrap', fontSize:14, color:'#13305f' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6, fontSize:11, textTransform:'uppercase', letterSpacing:'.5px', color:'#6b7689' }}>
                <span>Asistente IA</span>
                <span>
                  <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(iaResultado)}>Copiar</button>
                  <button type="button" className="btn-ghost" onClick={() => setIaResultado(null)}>Cerrar</button>
                </span>
              </div>
              {iaResultado}
            </div>
          )}
```

NOTA: si la clase `btn-ghost` no existe en este componente, usa la clase de botón que ya emplee el dashboard (revisa los botones existentes). Si la estructura de la cabecera no coincide, STOP y reporta DONE_WITH_CONCERNS con lo que encontraste.

- [ ] **Step 4: Repetir en ContadorChatDashboard**

Aplica los mismos 3 pasos (imports, estado+handler, botones+panel) a `src/components/chat/ContadorChatDashboard.jsx`, que tiene la misma estructura (`activeRoom`, `messages`, `getAuthHeaders`).

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/LawyerChatDashboard.jsx src/components/chat/ContadorChatDashboard.jsx
git commit -m "feat(ia): botón Resumir/Analizar con IA por sala en los dashboards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verificación y QA

**Files:**
- Create: `scripts/test-ai-abogado.mjs`

- [ ] **Step 1: Script de verificación de auth (rechazo sin token)**

```js
// scripts/test-ai-abogado.mjs
// Uso: node scripts/test-ai-abogado.mjs [baseUrl]
const base = process.argv[2] || 'http://localhost:3000';

async function call(body, headers = {}) {
  const r = await fetch(`${base}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// Sin token -> 401
const sinToken = await call({ modo: 'abogado', mensajes: [{ role: 'user', content: 'Hola' }] });
console.log('1) sin token (espera 401):', sinToken.status);

// Token basura -> 401
const tokenMalo = await call(
  { modo: 'abogado', mensajes: [{ role: 'user', content: 'Hola' }] },
  { Authorization: 'Bearer token-invalido' }
);
console.log('2) token inválido (espera 401):', tokenMalo.status);
```

- [ ] **Step 2: Ejecutar (con `vercel dev` corriendo)**

Run (terminal 1): `npx vercel dev`
Run (terminal 2): `node scripts/test-ai-abogado.mjs http://localhost:3000`
Expected: ambos imprimen `401`. (El path exitoso requiere un token real de profesional → se valida en el navegador, Step 3.)

- [ ] **Step 3: QA en el navegador (logueado como abogado)**

Con `vercel dev` y un usuario `rol='abogado'` aprobado:
- [ ] Perfil → sección **"Asistente IA"**: escribir/usar una sugerencia (ej. "Redactar derecho de petición") → la IA responde un borrador en markdown con la nota "requiere revisión profesional"; el botón **Copiar** funciona.
- [ ] Dashboard de consultas → abrir una sala con mensajes → **"✨ Resumir con IA"** → aparece el panel con el resumen del caso; **Copiar**/**Cerrar** funcionan.
- [ ] **"✨ Analizar caso"** → devuelve análisis (área, hechos, riesgos, pasos).
- [ ] Repetir en un usuario `rol='contador'` (perfil contador + su dashboard).
- [ ] Confirmar que el modo `abogado` NO consume el tope del cliente ni crea filas en `ai_sesiones`.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-ai-abogado.mjs
git commit -m "test(ia): verificación de auth del modo abogado

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Cierre**

Cuando el QA esté verde, usar `superpowers:finishing-a-development-branch` para decidir merge/PR de `feat/ia-cliente-abogado` (Plan 1 + Plan 2 juntos).

---

## Notas de implementación

- El modo `abogado` devuelve `{ reply }` (texto/markdown libre), distinto del modo `cliente` que devuelve el JSON de triage. `aiClient.pedirIA` es agnóstico; cada llamador conoce su forma.
- **Renderizado:** v1 muestra la respuesta como texto con `white-space: pre-wrap` (sin dependencia de markdown). Si más adelante se quiere markdown renderizado (negritas/listas reales), añadir `react-markdown` es un cambio aislado en `AsistenteIA` y el panel de los dashboards.
- **Auth:** el token va en `Authorization: Bearer <jwt>` vía `getAuthHeaders()`. El endpoint lo valida contra `/auth/v1/user` y resuelve el rol con service-role (patrón ya usado por `verify-request`/`reassign`).
- **Sin tope ni persistencia** para el profesional en v1 (uso interno autenticado). Si se quiere control de costo, añadir un contador diario es un cambio localizado en `handleAbogado`.
