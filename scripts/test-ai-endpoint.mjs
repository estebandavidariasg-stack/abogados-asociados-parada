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
