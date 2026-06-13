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
