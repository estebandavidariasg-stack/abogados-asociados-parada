# Plan 1 — Fundación de IA + Triage del Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el endpoint serverless de IA (`api/ai.js`) con su tabla de estado y el paso de triage conversacional del cliente en `ChatSection`, que clasifica el caso, recomienda profesional, da un rango de costo orientativo y entrega un resumen al profesional al iniciar el chat.

**Architecture:** Un proxy serverless único (Enfoque A del spec) llamado en modo `cliente` con Claude Haiku 4.5. El conteo de mensajes y el resumen viven en la tabla `ai_sesiones` de Supabase (escrita con service-role), de modo que el límite es inviolable desde el navegador. El frontend añade un paso `triage` antes del `form`; al iniciar chat, el `form` aparece pre-llenado (área + descripción del triage, profesional pre-seleccionado) para capturar datos personales, y reusa el `startChat` existente inyectando el resumen de la IA como primer mensaje de la sala.

**Tech Stack:** React 18 + Vite, Vercel serverless (Node), cliente Supabase REST hand-rolled, Anthropic SDK (`@anthropic-ai/sdk`) con prompt caching, `node:test` para lógica pura.

**Spec:** [docs/superpowers/specs/2026-06-10-integracion-ia-cliente-abogado-design.md](../specs/2026-06-10-integracion-ia-cliente-abogado-design.md)

**Convención de commits:** terminar cada mensaje con
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---------|-----------------|--------|
| `docs/sql/ai_sesiones.sql` | DDL + RLS de la tabla `ai_sesiones` (se aplica a mano en Supabase, patrón de `notificaciones`) | Crear |
| `api/_lib/aiPrompts.js` | System prompts (modo cliente; el modo abogado llega en el Plan 2) | Crear |
| `api/_lib/aiLogic.js` | Lógica pura testeable: `hashIp`, `parseTriageReply`, `buildClientPrompt`, `limiteMensajes` | Crear |
| `api/_lib/anthropic.js` | Wrapper del SDK Anthropic con prompt caching y selección de modelo | Crear |
| `api/ai.js` | Endpoint HTTP: valida, aplica límites, persiste `ai_sesiones`, llama a Anthropic | Crear |
| `src/lib/aiClient.js` | Helper de frontend para `POST /api/ai` (compartido con el Plan 2) | Crear |
| `src/components/chat/TriagePanel.jsx` | UI conversacional del triage (chips de plantillas, input libre, indicador de límite, tarjetas de recomendación) | Crear |
| `src/components/chat/TriagePanel.module.css` | Estilos del panel de triage | Crear |
| `src/components/chat/ChatSection.jsx` | Añadir paso `triage`, pre-llenar `form` desde el triage, inyectar resumen en `startChat` | Modificar |
| `scripts/test-ai-endpoint.mjs` | Script de verificación del endpoint contra `vercel dev` / preview (sin DevTools) | Crear |
| `test/aiLogic.test.mjs` | Pruebas `node:test` de la lógica pura | Crear |
| `.env.example` o README | Documentar `ANTHROPIC_API_KEY`, `AI_CLIENTE_MAX_MSGS` | Modificar |

---

## Task 1: Tabla `ai_sesiones` (DDL + RLS)

**Files:**
- Create: `docs/sql/ai_sesiones.sql`

- [ ] **Step 1: Escribir el DDL + RLS**

```sql
-- docs/sql/ai_sesiones.sql
-- Estado server-authoritative de las sesiones de triage de IA del cliente.
-- Aplicar a mano en Supabase (igual que la tabla `notificaciones`).
-- El navegador NUNCA lee/escribe esto: todo pasa por api/ai.js con service-role.

create table if not exists public.ai_sesiones (
  id               uuid primary key default gen_random_uuid(),
  ip_hash          text,
  mensajes_count   int  not null default 0,
  area_detectada   text,
  resumen          text,
  recomendados     jsonb not null default '[]'::jsonb,
  costo_rango      text,
  tipo_profesional text not null default 'abogado',
  created_at       timestamptz not null default now()
);

-- Para el rate-limit por IP/hora.
create index if not exists ai_sesiones_ip_created_idx
  on public.ai_sesiones (ip_hash, created_at desc);

alter table public.ai_sesiones enable row level security;

-- Sin policies para anon/authenticated => acceso directo bloqueado.
-- La service-role key (usada por api/ai.js) bypassa RLS.
revoke all on public.ai_sesiones from anon, authenticated;
```

- [ ] **Step 2: Aplicar en Supabase y verificar**

Ejecutar el SQL en el editor SQL de Supabase. Luego verificar que el cliente anónimo NO puede leer la tabla (debe fallar/0 filas con error RLS). En la consola del navegador del sitio:

```js
// Debe devolver error o vacío por RLS (NO debe listar filas):
const r = await fetch(`${import.meta.env?.VITE_SUPABASE_URL || ''}/rest/v1/ai_sesiones?select=id`, {
  headers: { apikey: '<ANON_KEY>', Authorization: 'Bearer <ANON_KEY>' }
});
console.log(r.status, await r.text());
```

Expected: status 200 con `[]`, o 401/403 — en ningún caso filas con datos.

- [ ] **Step 3: Commit**

```bash
git add docs/sql/ai_sesiones.sql
git commit -m "feat(ia): DDL + RLS de la tabla ai_sesiones

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: System prompts del modo cliente

**Files:**
- Create: `api/_lib/aiPrompts.js`

- [ ] **Step 1: Escribir el módulo de prompts**

```js
// api/_lib/aiPrompts.js
// System prompts de la IA. Archivos _ no se publican como rutas en Vercel.
// El prompt del cliente es largo y FIJO => se marca para prompt caching en anthropic.js.

// {profesionales} se reemplaza con la lista candidata (id, nombre, area, ciudad).
export const SYSTEM_CLIENTE = `Eres el asistente de admisión virtual de "Abogados & Asociados Parada", una firma legal y contable en Colombia. Tu único objetivo es ORIENTAR de forma general y REDIRIGIR al cliente con el mejor profesional humano de la firma. NO eres su abogado.

REGLAS ESTRICTAS:
- Habla en español claro y sencillo, sin tecnicismos. Frases cortas.
- Da SOLO orientación general. NUNCA afirmes que esto es asesoría legal ni que se crea una relación abogado-cliente.
- NUNCA inventes leyes, artículos, números de norma ni jurisprudencia. Si no estás seguro, dilo y remite al profesional.
- NUNCA prometas resultados ("vas a ganar", "te pagarán X seguro").
- Si el caso implica riesgo grave (violencia, amenaza a la vida, plazos penales urgentes), recomienda contacto humano INMEDIATO.
- Haz UNA pregunta a la vez para entender el caso. Sé breve.
- Cuando entiendas el caso, clasifícalo en un área y recomienda 1 a 3 profesionales SOLO de la lista provista (por su id). No inventes profesionales.
- Puedes dar un RANGO de costo orientativo en pesos colombianos, SIEMPRE rotulado como "orientativo, no vinculante". Si no tienes base, di que el profesional lo definirá.
- Cierra SIEMPRE dirigiendo al profesional recomendado.

FORMATO DE SALIDA — responde SIEMPRE con un único bloque JSON válido, sin texto fuera del JSON:
{
  "mensaje": "lo que le dices al cliente (texto natural, breve)",
  "listo_para_recomendar": false,
  "area_detectada": "" ,
  "recomendados": [],
  "costo_rango": "",
  "resumen_para_profesional": ""
}
- "listo_para_recomendar" = true SOLO cuando ya tengas suficiente contexto.
- Cuando sea true: llena "area_detectada", "recomendados" (array de ids de la lista), "costo_rango" (ej. "$300.000–$600.000, orientativo, no vinculante") y "resumen_para_profesional" (3-5 líneas: área, hechos clave, qué busca el cliente).
- Mientras sea false: deja esos campos vacíos y usa "mensaje" para tu siguiente pregunta.

LISTA DE PROFESIONALES DISPONIBLES (usa SOLO estos ids):
{profesionales}`;
```

- [ ] **Step 2: Verificar export con node**

Run: `node -e "import('./api/_lib/aiPrompts.js').then(m => console.log(typeof m.SYSTEM_CLIENTE, m.SYSTEM_CLIENTE.includes('{profesionales}')))"`
Expected: `string true`

- [ ] **Step 3: Commit**

```bash
git add api/_lib/aiPrompts.js
git commit -m "feat(ia): system prompt del modo cliente (triage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lógica pura testeable (`aiLogic.js`)

**Files:**
- Create: `api/_lib/aiLogic.js`
- Test: `test/aiLogic.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

```js
// test/aiLogic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashIp, parseTriageReply, buildProfesionalesBlock, limiteAlcanzado } from '../api/_lib/aiLogic.js';

test('hashIp es determinista y oculta la IP', () => {
  const a = hashIp('190.0.0.1');
  const b = hashIp('190.0.0.1');
  assert.equal(a, b);
  assert.notEqual(a, '190.0.0.1');
  assert.equal(a.length, 64); // sha-256 hex
});

test('hashIp con IP vacía devuelve un marcador estable', () => {
  assert.equal(typeof hashIp(''), 'string');
});

test('parseTriageReply extrae el JSON aunque venga con texto alrededor', () => {
  const raw = 'Claro:\n{"mensaje":"Hola","listo_para_recomendar":false,"area_detectada":"","recomendados":[],"costo_rango":"","resumen_para_profesional":""}\nfin';
  const out = parseTriageReply(raw);
  assert.equal(out.mensaje, 'Hola');
  assert.equal(out.listo_para_recomendar, false);
  assert.deepEqual(out.recomendados, []);
});

test('parseTriageReply ante JSON inválido devuelve un fallback seguro', () => {
  const out = parseTriageReply('respuesta sin json');
  assert.equal(out.listo_para_recomendar, false);
  assert.equal(typeof out.mensaje, 'string');
  assert.ok(out.mensaje.length > 0);
});

test('buildProfesionalesBlock lista solo campos públicos', () => {
  const block = buildProfesionalesBlock([
    { id: 'p1', nombre: 'Ana', apellido: 'Ríos', area_derecho: 'Laboral', ciudad: 'Bogotá', correo: 'x@y.com' },
  ]);
  assert.ok(block.includes('p1'));
  assert.ok(block.includes('Laboral'));
  assert.ok(!block.includes('x@y.com')); // nunca exponer correo
});

test('limiteAlcanzado compara count contra el máximo', () => {
  assert.equal(limiteAlcanzado(5, 6), false);
  assert.equal(limiteAlcanzado(6, 6), true);
  assert.equal(limiteAlcanzado(7, 6), true);
});
```

- [ ] **Step 2: Ejecutar el test y verlo fallar**

Run: `node --test test/aiLogic.test.mjs`
Expected: FAIL — `Cannot find module '../api/_lib/aiLogic.js'`

- [ ] **Step 3: Implementar `aiLogic.js`**

```js
// api/_lib/aiLogic.js
import { createHash } from 'node:crypto';

const SALT = process.env.AI_IP_SALT || 'aap-ia-salt-v1';

export function hashIp(ip) {
  return createHash('sha256').update(`${SALT}:${ip || 'unknown'}`).digest('hex');
}

// Extrae el primer objeto JSON de la respuesta del modelo. Robusto ante texto
// alrededor del bloque. Si no hay JSON válido, devuelve un fallback seguro.
export function parseTriageReply(raw) {
  const fallback = {
    mensaje: 'Disculpa, no entendí bien. ¿Puedes contarme con otras palabras qué necesitas?',
    listo_para_recomendar: false,
    area_detectada: '',
    recomendados: [],
    costo_rango: '',
    resumen_para_profesional: '',
  };
  if (!raw || typeof raw !== 'string') return fallback;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return fallback;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return {
      mensaje: typeof obj.mensaje === 'string' && obj.mensaje ? obj.mensaje : fallback.mensaje,
      listo_para_recomendar: obj.listo_para_recomendar === true,
      area_detectada: typeof obj.area_detectada === 'string' ? obj.area_detectada : '',
      recomendados: Array.isArray(obj.recomendados) ? obj.recomendados.map(String) : [],
      costo_rango: typeof obj.costo_rango === 'string' ? obj.costo_rango : '',
      resumen_para_profesional: typeof obj.resumen_para_profesional === 'string' ? obj.resumen_para_profesional : '',
    };
  } catch {
    return fallback;
  }
}

// Bloque de texto con SOLO campos públicos de los profesionales candidatos.
export function buildProfesionalesBlock(lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return '(no hay profesionales disponibles en este momento)';
  }
  return lista
    .map(p => `- id:${p.id} | ${p.nombre || ''} ${p.apellido || ''} | área:${p.area_derecho || ''} | ciudad:${p.ciudad || ''}`)
    .join('\n');
}

export function limiteAlcanzado(count, max) {
  return Number(count) >= Number(max);
}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

Run: `node --test test/aiLogic.test.mjs`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/aiLogic.js test/aiLogic.test.mjs
git commit -m "feat(ia): lógica pura de triage (hashIp, parseTriageReply, límites) + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wrapper de Anthropic con prompt caching

**Files:**
- Create: `api/_lib/anthropic.js`
- Modify: `package.json` (dependencia `@anthropic-ai/sdk`)

- [ ] **Step 1: Instalar el SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: se añade a `dependencies` en `package.json`.

- [ ] **Step 2: Escribir el wrapper**

```js
// api/_lib/anthropic.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODELOS = {
  cliente: 'claude-haiku-4-5-20251001',
  abogado: 'claude-sonnet-4-6', // usado por el Plan 2
};

// systemText: string del system prompt (se cachea).
// messages: [{ role:'user'|'assistant', content:'...' }]
// Devuelve el texto plano de la respuesta del modelo.
export async function completar({ modo, systemText, messages, maxTokens = 1024 }) {
  const resp = await client.messages.create({
    model: MODELOS[modo] || MODELOS.cliente,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });
  return resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}
```

- [ ] **Step 3: Smoke test (requiere `ANTHROPIC_API_KEY` en el entorno)**

Run:
```bash
node --env-file=.env.local -e "import('./api/_lib/anthropic.js').then(async m => { const t = await m.completar({ modo:'cliente', systemText:'Responde solo la palabra: ok', messages:[{role:'user',content:'di ok'}], maxTokens:10 }); console.log('REPLY:', t); })"
```
Expected: imprime una respuesta del modelo (ej. `REPLY: ok`). Si falla por falta de clave, documentar y continuar (se valida en Task 6 end-to-end).

- [ ] **Step 4: Commit**

```bash
git add api/_lib/anthropic.js package.json package-lock.json
git commit -m "feat(ia): wrapper de Anthropic con prompt caching y selección de modelo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Endpoint `api/ai.js` (modo cliente)

**Files:**
- Create: `api/ai.js`

- [ ] **Step 1: Escribir el endpoint**

```js
// api/ai.js
// Proxy de IA. v1: modo 'cliente' (triage). El modo 'abogado' se añade en el Plan 2.
import { SUPABASE_URL, serviceHeaders } from './_lib/adminAuth.js';
import { SYSTEM_CLIENTE } from './_lib/aiPrompts.js';
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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { modo, sessionId, mensajes, tipo_profesional } = req.body || {};
  if (modo !== 'cliente') { res.status(400).json({ error: 'Modo no soportado en v1' }); return; }
  if (!Array.isArray(mensajes) || mensajes.length === 0) { res.status(400).json({ error: 'Faltan mensajes' }); return; }

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
    replyRaw = await completar({ modo: 'cliente', systemText, messages: mensajes, maxTokens: 1024 });
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
```

- [ ] **Step 2: Escribir el script de verificación**

```js
// scripts/test-ai-endpoint.mjs
// Uso: node scripts/test-ai-endpoint.mjs [baseUrl]
// baseUrl por defecto http://localhost:3000 (vercel dev). También sirve un preview.
const base = process.argv[2] || 'http://localhost:3000';

async function call(body) {
  const r = await fetch(`${base}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const r1 = await call({ modo: 'cliente', mensajes: [{ role: 'user', content: 'Me despidieron sin justa causa hace 2 semanas y no me pagaron liquidación.' }], tipo_profesional: 'abogado' });
console.log('1) primer mensaje:', r1.status, JSON.stringify(r1.json, null, 2));

if (r1.json?.sessionId) {
  const r2 = await call({ modo: 'cliente', sessionId: r1.json.sessionId, mensajes: [
    { role: 'user', content: 'Me despidieron sin justa causa hace 2 semanas.' },
    { role: 'assistant', content: r1.json.mensaje },
    { role: 'user', content: 'Llevaba 3 años en la empresa, contrato a término indefinido. Estoy en Bogotá.' },
  ], tipo_profesional: 'abogado' });
  console.log('2) segundo mensaje:', r2.status, 'restantes:', r2.json?.restantes, 'listo:', r2.json?.listo_para_recomendar);
}

// Mensaje inválido (vacío) -> 400
const rBad = await call({ modo: 'cliente', mensajes: [{ role: 'user', content: '' }] });
console.log('3) inválido (espera 400):', rBad.status);
```

- [ ] **Step 3: Levantar `vercel dev` y ejecutar el script**

Run (terminal 1): `npx vercel dev` (necesita `ANTHROPIC_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.local` / variables del proyecto)
Run (terminal 2): `node scripts/test-ai-endpoint.mjs`
Expected:
- (1) status 200, con `sessionId`, `restantes:5`, y un `mensaje` que hace una pregunta de seguimiento.
- (2) status 200, `restantes:4`; eventualmente `listo:true` con `recomendados` no vacío.
- (3) status 400.

- [ ] **Step 4: Commit**

```bash
git add api/ai.js scripts/test-ai-endpoint.mjs
git commit -m "feat(ia): endpoint api/ai.js modo cliente (límites, persistencia, anthropic)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Helper de frontend `aiClient.js`

**Files:**
- Create: `src/lib/aiClient.js`

- [ ] **Step 1: Escribir el helper**

```js
// src/lib/aiClient.js
// Cliente de frontend para el proxy de IA. Compartido por el triage (cliente)
// y, en el Plan 2, por el asistente del profesional.

// Devuelve { ok, status, data }. Nunca lanza: el llamador decide el fallback.
export async function pedirIA(body, { authHeader } = {}) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}
```

- [ ] **Step 2: Verificar import en build**

Run: `npm run build`
Expected: build sin errores (el módulo es importable; aún no se usa).

- [ ] **Step 3: Commit**

```bash
git add src/lib/aiClient.js
git commit -m "feat(ia): helper de frontend aiClient.pedirIA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Componente `TriagePanel`

**Files:**
- Create: `src/components/chat/TriagePanel.jsx`
- Create: `src/components/chat/TriagePanel.module.css`

- [ ] **Step 1: Escribir el CSS module**

```css
/* src/components/chat/TriagePanel.module.css */
.wrap { max-width: 720px; margin: 0 auto; }
.header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.restantes { font-size:12px; color:#7a5e15; background:#fff7e2; border:1px dashed #c9a84c; border-radius:999px; padding:4px 12px; }
.disclaimer { font-size:11px; color:#5a6678; text-align:center; margin:8px 0; }
.thread { display:flex; flex-direction:column; gap:8px; min-height:220px; max-height:380px; overflow-y:auto; padding:6px; }
.bubAi, .bubMe { border-radius:12px; padding:9px 12px; font-size:14px; line-height:1.4; max-width:85%; white-space:pre-wrap; }
.bubAi { background:#eef2f9; color:#13305f; border:1px solid #d7e0ef; align-self:flex-start; }
.bubMe { background:linear-gradient(135deg,#15376b,#0d2d5e); color:#fff; align-self:flex-end; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.chip { font-size:12px; padding:6px 11px; border-radius:999px; background:#fff; color:#0d2d5e; border:1px solid #c9a84c; cursor:pointer; }
.chip:hover { background:#fff7e2; }
.inputRow { display:flex; gap:8px; margin-top:10px; }
.input { flex:1; border:1px solid #cdd6e6; border-radius:10px; padding:10px 12px; font-size:14px; resize:none; }
.send { background:linear-gradient(135deg,#15376b,#0d2d5e); color:#fff; border:none; border-radius:10px; padding:0 18px; font-weight:600; cursor:pointer; }
.send:disabled { opacity:.5; cursor:not-allowed; }
.recos { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
.reco { display:flex; gap:10px; align-items:center; border:1px solid #c9a84c; border-radius:12px; padding:10px; background:#fff; }
.recoBtn { margin-left:auto; background:#0d2d5e; color:#f2e9cf; border:none; border-radius:999px; padding:7px 14px; cursor:pointer; font-weight:600; }
.costo { font-size:12px; background:#fff7e2; border:1px dashed #c9a84c; color:#7a5e15; border-radius:8px; padding:8px 10px; margin-top:8px; }
.gloss { font-size:12px; color:#46546e; margin-top:8px; }
.glossBody { background:#f6f8fc; border:1px solid #e1e8f2; border-radius:8px; padding:8px 10px; margin-top:6px; }
.manual { display:block; text-align:center; font-size:12px; color:#7a8499; margin-top:12px; text-decoration:underline; cursor:pointer; background:none; border:none; width:100%; }
.error { color:#b00020; font-size:13px; text-align:center; margin-top:8px; }
```

- [ ] **Step 2: Escribir el componente**

```jsx
// src/components/chat/TriagePanel.jsx
import { useState, useRef, useEffect } from 'react';
import { pedirIA } from '../../lib/aiClient';
import styles from './TriagePanel.module.css';

const PLANTILLAS = [
  'Tengo un problema de [área]. Pasó [cuándo]. Quiero [objetivo].',
  'Me [despidieron/demandaron/deben] y necesito saber qué puedo hacer.',
  'Necesito ayuda con un tema de [familia/laboral/penal/deudas/empresa].',
];

const SALUDO = '¡Hola! 👋 Cuéntame brevemente tu situación y te oriento, además de recomendarte al profesional ideal. ¿Qué necesitas?';

// Props:
//  tipoProfesional: 'abogado' | 'contador'
//  onIniciarChat({ profesionalId, area, resumen, costo }): salta al form pre-llenado
//  onManual(): escape hatch al formulario manual de hoy
export default function TriagePanel({ tipoProfesional = 'abogado', onIniciarChat, onManual }) {
  const [thread, setThread] = useState([{ role: 'assistant', content: SALUDO }]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [restantes, setRestantes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reco, setReco] = useState(null); // { area, recomendados, costo, resumen }
  const [profs, setProfs] = useState([]);
  const [error, setError] = useState('');
  const [glossOpen, setGlossOpen] = useState(false);
  const threadRef = useRef(null);

  useEffect(() => {
    // Lista pública para mostrar nombre/área en las tarjetas de recomendación.
    fetch(`/api/professionals?rol=${tipoProfesional === 'contador' ? 'contador' : 'abogado'}`)
      .then(r => (r.ok ? r.json() : [])).then(setProfs).catch(() => setProfs([]));
  }, [tipoProfesional]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread, reco]);

  async function enviar() {
    const texto = input.trim();
    if (!texto || busy) return;
    const nuevoThread = [...thread, { role: 'user', content: texto }];
    setThread(nuevoThread); setInput(''); setBusy(true); setError('');

    // Solo enviamos roles user/assistant reales (sin el saludo inicial fijo).
    const mensajes = nuevoThread.filter((m, i) => !(i === 0 && m.role === 'assistant'));
    const { ok, status, data } = await pedirIA({ modo: 'cliente', sessionId, mensajes, tipo_profesional: tipoProfesional });

    if (!ok) {
      if (status === 429 && data?.error === 'limite') {
        setThread(t => [...t, { role: 'assistant', content: 'Hemos llegado al límite de esta orientación. Con lo que me contaste, puedes iniciar el chat con el profesional recomendado abajo. 🙂' }]);
      } else {
        setError(data?.mensaje || 'La asistente no está disponible. Puedes elegir un profesional manualmente.');
      }
      setBusy(false);
      return;
    }

    setSessionId(data.sessionId);
    setRestantes(data.restantes);
    setThread(t => [...t, { role: 'assistant', content: data.mensaje }]);
    if (data.listo_para_recomendar && data.recomendados?.length) {
      setReco({ area: data.area_detectada, recomendados: data.recomendados, costo: data.costo_rango, resumen: data.resumen_para_profesional });
    }
    setBusy(false);
  }

  const recomendados = (reco?.recomendados || [])
    .map(id => profs.find(p => String(p.id) === String(id)))
    .filter(Boolean);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <strong>Asistente de admisión</strong>
        {restantes != null && <span className={styles.restantes}>Te quedan {restantes} mensajes</span>}
      </div>
      <p className={styles.disclaimer}>Orientación general. No constituye asesoría legal ni genera relación abogado-cliente.</p>

      <div className={styles.thread} ref={threadRef}>
        {thread.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.bubMe : styles.bubAi}>{m.content}</div>
        ))}
      </div>

      {recomendados.length > 0 && (
        <div className={styles.recos}>
          {reco.costo && <div className={styles.costo}>💡 Rango {reco.costo}</div>}
          {recomendados.map(p => (
            <div key={p.id} className={styles.reco}>
              <span>{p.nombre} {p.apellido} · {p.area_derecho}</span>
              <button
                className={styles.recoBtn}
                onClick={() => onIniciarChat({ profesionalId: p.id, area: reco.area || p.area_derecho, resumen: reco.resumen, costo: reco.costo })}
              >
                Iniciar chat
              </button>
            </div>
          ))}
        </div>
      )}

      {!reco && (
        <>
          <div className={styles.chips}>
            {PLANTILLAS.map((t, i) => (
              <button key={i} className={styles.chip} onClick={() => setInput(t)}>{t}</button>
            ))}
          </div>
          <div className={styles.inputRow}>
            <textarea
              className={styles.input} rows={2} value={input}
              placeholder="Escribe lo que necesites…"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            />
            <button className={styles.send} onClick={enviar} disabled={busy || !input.trim()}>
              {busy ? '…' : 'Enviar'}
            </button>
          </div>
          <button className={styles.gloss} onClick={() => setGlossOpen(o => !o)}>💡 ¿Cómo contarlo mejor?</button>
          {glossOpen && (
            <div className={styles.glossBody}>
              Sé concreto: incluye <b>fechas</b>, <b>lugar</b> y <b>qué quieres lograr</b>.<br />
              Ejemplo: "Me despidieron el 1 de mayo sin carta. Quiero saber si tengo indemnización."
            </div>
          )}
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}
      <button className={styles.manual} onClick={onManual}>Prefiero elegir un profesional yo mismo</button>
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/TriagePanel.jsx src/components/chat/TriagePanel.module.css
git commit -m "feat(ia): TriagePanel (chat de admisión con plantillas, límite y recomendación)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Integrar el paso `triage` en `ChatSection` + handoff

**Files:**
- Modify: `src/components/chat/ChatSection.jsx`

- [ ] **Step 1: Importar TriagePanel y añadir estado de pre-llenado**

En `src/components/chat/ChatSection.jsx`, junto a los demás imports de `./` (cerca de la línea 6), añadir:

```jsx
import TriagePanel from './TriagePanel'
```

Dentro de `ChatSection()`, junto a los `useState` (después de `const [step, setStep] = useState('cedula')`, ~línea 820), añadir estado para el resumen del triage:

```jsx
  const [triageResumen, setTriageResumen] = useState('')   // resumen de la IA → primer mensaje de la sala
```

- [ ] **Step 2: Enrutar la cédula al triage en vez de al form**

Localizar (≈ línea 1343):

```jsx
              <StepCedula onNew={() => setStep('form')} onResume={handleResume} />
```

Reemplazar por:

```jsx
              <StepCedula onNew={() => setStep('triage')} onResume={handleResume} />
```

- [ ] **Step 3: Renderizar el paso `triage`**

Inmediatamente después del bloque `{(step === 'cedula' || step === 'chat') && ( … )}` y ANTES de `{step === 'form' && (`, insertar:

```jsx
      {step === 'triage' && (
        <div ref={lawyersRef}>
          <TriagePanel
            tipoProfesional={form.tipo_profesional}
            onManual={() => setStep('form')}
            onIniciarChat={({ profesionalId, area, resumen }) => {
              // Pre-llenar el form con lo detectado por la IA y pre-seleccionar el profesional.
              setForm(f => ({
                ...f,
                areas: area ? [area] : f.areas,
                descripcion: resumen || f.descripcion,
              }))
              setTriageResumen(resumen || '')
              setPicked([profesionalId])
              setStep('form')
            }}
          />
        </div>
      )}
```

- [ ] **Step 4: Inyectar el resumen de la IA como primer mensaje en `startChat`**

Localizar en `startChat` (≈ línea 1112) el insert del primer `chat_messages`:

```jsx
    await supabase.from('chat_messages').insert({
      room_id: room.id, sender_type:'client', lawyer_id: null,
      content: `Hola, mi nombre es ${nombre} ${apellido}.\n\nUbicación: ${ubicacionTxt}\nÁrea(s): ${areas.join(', ')}\n\nDescripción del caso:\n${descripcion}`,
    })
```

Reemplazar la plantilla de `content` para anteponer el resumen del triage cuando exista:

```jsx
    const resumenBloque = triageResumen
      ? `\n\n📋 Resumen del asistente IA:\n${triageResumen}`
      : ''
    await supabase.from('chat_messages').insert({
      room_id: room.id, sender_type:'client', lawyer_id: null,
      content: `Hola, mi nombre es ${nombre} ${apellido}.\n\nUbicación: ${ubicacionTxt}\nÁrea(s): ${areas.join(', ')}\n\nDescripción del caso:\n${descripcion}${resumenBloque}`,
    })
```

- [ ] **Step 5: Limpiar `triageResumen` en `resetToStart`**

Localizar `resetToStart` (≈ línea 1001) y añadir al final de los setters de estado:

```jsx
    setTriageResumen('')
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 7: Verificación manual end-to-end (con `vercel dev`)**

Run: `npx vercel dev` y abrir el sitio. En la sección de consulta:
1. Entrar (cédula nueva) → aparece el TriagePanel (no el form directo).
2. Contar un caso laboral → la IA pregunta y, tras 1-2 mensajes, muestra tarjeta(s) de profesional + rango de costo.
3. "Iniciar chat" → aparece el `form` con área y descripción pre-llenadas y el profesional ya seleccionado; completar nombre/ubicación/contacto → enviar.
4. Abrir el dashboard del abogado asignado → el primer mensaje de la sala incluye "📋 Resumen del asistente IA".
5. Volver a entrar y usar "Prefiero elegir un profesional yo mismo" → cae al form manual.

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/ChatSection.jsx
git commit -m "feat(ia): paso triage en ChatSection + handoff del resumen a la sala

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Documentar variables de entorno

**Files:**
- Modify: `CLAUDE.md` (sección Environment Variables) y `.env.example` si existe

- [ ] **Step 1: Añadir las nuevas variables a CLAUDE.md**

En la sección "## Environment Variables" de `CLAUDE.md`, añadir al bloque:

```
ANTHROPIC_API_KEY            # Clave de Anthropic — usada SOLO por api/ai.js (server-side)
AI_CLIENTE_MAX_MSGS          # Tope de mensajes del triage del cliente (default 6)
AI_MAX_SESIONES_IP_HORA      # Máx. sesiones de triage por IP/hora (default 10)
AI_IP_SALT                   # Sal para hashear IPs en ai_sesiones
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(ia): documentar variables de entorno del proxy de IA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: QA final del Plan 1

**Files:** ninguno (verificación)

- [ ] **Step 1: Re-ejecutar la suite de lógica pura**

Run: `node --test test/aiLogic.test.mjs`
Expected: PASS.

- [ ] **Step 2: Checklist de QA del spec**

Verificar manualmente (con `vercel dev`):
- [ ] Triage feliz: clasifica área → recomienda → costo orientativo → iniciar chat.
- [ ] Límite agotado: al llegar a 6 mensajes responde `429 limite` y la UI muestra el cierre con la recomendación (no se bloquea sin salida).
- [ ] Fallback: con `ANTHROPIC_API_KEY` inválida, el endpoint responde `502 fallback` y la UI muestra el error + el enlace "elegir manualmente" funciona.
- [ ] Handoff: el primer mensaje de la sala incluye el resumen de la IA.
- [ ] RLS: el cliente anónimo no puede leer `ai_sesiones` directamente.
- [ ] Rate-limit IP: tras 10 sesiones nuevas en <1h desde la misma IP, la nueva sesión recibe `429`.

- [ ] **Step 3: Merge / PR**

Una vez verde el checklist, usar la skill `superpowers:finishing-a-development-branch` para decidir merge/PR de `feat/ia-cliente-abogado`.

---

## Notas de implementación

- **Sin streaming (v1):** el endpoint devuelve la respuesta completa. La UI muestra "…" mientras `busy`. Migrar a SSE es un cambio aislado en `anthropic.js` + `aiClient.js` + `TriagePanel`.
- **Modo abogado:** `api/ai.js` rechaza `modo !== 'cliente'` a propósito. El Plan 2 añadirá la rama `abogado` (auth vía `getCallerProfile`, modelo Sonnet, lectura de `chat_messages` de la sala) sin tocar la del cliente.
- **`node:test`** corre sin configuración ni dependencias (Node v24 en el equipo). No hay test runner del proyecto; las pruebas de red/UI son los scripts y el checklist manual, acorde al flujo de trabajo del usuario.
