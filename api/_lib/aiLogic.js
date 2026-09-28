// api/_lib/aiLogic.js
import { createHash } from 'node:crypto';

const SALT = process.env.AI_IP_SALT || 'aap-ia-salt-v1';

export function hashIp(ip) {
  return createHash('sha256').update(`${SALT}:${ip || 'unknown'}`).digest('hex');
}

// Extrae el primer objeto JSON de la respuesta del modelo. Robusto ante texto
// alrededor del bloque. Si no hay JSON válido, devuelve un fallback seguro.
/* ── Datos de contacto en el resumen del triage ──────────────────────
   El cliente le cuenta su caso a la IA en lenguaje libre, y ahí dentro cabe un
   "llámame al 300...". Ese texto NO se queda en la conversación: el resumen va
   al primer mensaje de la sala y, cuando la consulta se PUBLICA, lo leen todos
   los profesionales de esa área antes de que ninguno la tome.

   El formulario manual tiene su filtro, pero por aquí no pasaba: el campo ni
   siquiera se muestra en el flujo guiado.

   Se REDACTA en vez de bloquear. El cliente no puede editar un resumen que
   escribió la IA, así que rechazarlo lo dejaría sin salida; y el profesional
   necesita el caso, no el teléfono. La marca queda visible a propósito: el
   profesional ve que se omitió algo, no un hueco silencioso.

   Va en el servidor y no en el navegador porque es la única puerta por la que
   sale el resumen, y desde aquí no se puede saltar. */
const MARCA = '[dato de contacto omitido]';
const SEP = '[\\s.\\-()]*';

export function redactarContacto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let t = texto;
  // El correo va primero: si no, la regla del arroba suelto partiría
  // "juan@gmail.com" y dejaría "gmail.com" suelto en el texto.
  t = t.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, MARCA);
  // Correo dicho con palabras: "juan arroba gmail punto com".
  t = t.replace(
    new RegExp(
      '[a-z0-9._%+\\-]{2,}\\s*[([]?\\s*(?:@|\\b(?:arroba|at)\\b)\\s*[)\\]]?\\s*' +
      '[a-z0-9\\-]{2,}\\s*[([]?\\s*(?:\\.|\\b(?:punto|dot)\\b)\\s*[)\\]]?\\s*[a-z]{2,}',
      'gi'
    ),
    MARCA
  );
  // Teléfono internacional: el signo + ya delata que es un número.
  t = t.replace(new RegExp('\\+' + SEP + '\\d(?:' + SEP + '\\d){6,14}', 'g'), MARCA);
  // Celular colombiano, con o sin indicativo.
  t = t.replace(new RegExp('(?:\\+?' + SEP + '57' + SEP + ')?3(?:' + SEP + '\\d){9}', 'g'), MARCA);
  // Diez o más dígitos seguidos: cuentas bancarias, cédulas, fijos con
  // indicativo. Por debajo de diez se dejan pasar los montos (1.500.000).
  t = t.replace(new RegExp('\\d(?:' + SEP + '\\d){9,}', 'g'), MARCA);
  // Llave de pago: un arroba suelto (@juanperez de Bre-B, Nequi, Daviplata).
  t = t.replace(/(^|[\s(,;:¡!¿?"'])@[a-z0-9._-]{3,}/gi, '$1' + MARCA);
  return t;
}

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
      // Lo lee un profesional que todavia no ha sido contratado.
      resumen_para_profesional: redactarContacto(obj.resumen_para_profesional),
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
