// api/_lib/anthropic.js
import Anthropic from '@anthropic-ai/sdk';

export const MODELOS = {
  cliente: 'claude-haiku-4-5-20251001',
  abogado: 'claude-sonnet-4-6', // usado por el Plan 2
};

// El cliente se construye de forma lazy (en cada llamada) para leer
// ANTHROPIC_API_KEY del entorno en runtime. Construirlo al cargar el módulo
// es frágil en serverless: si el módulo se importa antes de que la variable
// esté inyectada, el cliente queda cacheado sin clave.
function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// systemText: string del system prompt (se cachea).
// messages: [{ role:'user'|'assistant', content:'...' }]
// prefill: si se pasa, se inyecta como turno assistant final para FORZAR el
//   formato de salida (técnica de Anthropic). El modelo continúa desde ahí.
//   Ej. prefill='{' obliga a que la respuesta sea JSON aunque el historial
//   tenga turnos en prosa (clave para modelos pequeños como Haiku). El texto
//   devuelto incluye el prefill al inicio.
// Devuelve el texto plano de la respuesta del modelo.
export async function completar({ modo, model, systemText, messages, maxTokens = 1024, prefill = null }) {
  const msgs = prefill != null
    ? [...messages, { role: 'assistant', content: prefill }]
    : messages;
  const resp = await getClient().messages.create({
    model: model || MODELOS[modo] || MODELOS.cliente,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
    ],
    messages: msgs,
  });
  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return prefill != null ? prefill + text : text;
}
