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
