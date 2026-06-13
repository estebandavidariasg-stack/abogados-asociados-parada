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
    sugerir_publicar: false,
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
      sugerir_publicar: obj.sugerir_publicar === true,
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
