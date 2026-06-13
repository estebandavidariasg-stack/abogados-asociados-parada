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
