// src/lib/aiClient.js
// Cliente de frontend para el proxy de IA. Compartido por el triage (cliente)
// y, en el Plan 2, por el asistente del profesional.

// Devuelve { ok, status, data, aborted }. Nunca lanza: el llamador decide el
// fallback. `signal` permite cancelar la petición (botón detener).
export async function pedirIA(body, { authHeader, signal } = {}) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, status: 0, aborted: true, data: null };
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}
